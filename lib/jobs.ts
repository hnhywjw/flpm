import { all, one, run, audit } from "./db";
import { overdueDays, daysFromNow, ROLE_LABEL, type Role } from "./domain";
import { notifyRole, sendMessage, createNotification } from "./notify";
import { getDiskInfo } from "./disk";
import { getParamInt } from "./sysinfo";
import { cleanupOrphanFiles } from "./orphan-cleanup";
import { todayByConfig, nowByConfig } from "@/lib/time-server";

/**
 * 定时任务
 * 由 scripts/scheduler.js 每 10 分钟调用一次 /api/jobs
 * 每个任务按「幂等键」去重，同一天不会重复推送
 */

export interface JobResult {
  key: string;
  name: string;
  sent: number;
  detail: string;
  error?: string;
}

/** 去重：同一天同一对象同一类型只推一次 */
function shouldSend(dedupeKey: string): boolean {
  const hit = one<{ id: number }>(
    "SELECT id FROM notify_sent_log WHERE dedupe_key = ?", [dedupeKey]
  );
  if (hit) return false;
  run("INSERT INTO notify_sent_log (dedupe_key, category) VALUES (?, ?)",
      [dedupeKey, dedupeKey.split(":")[0]]);
  return true;
}

/** 今天（按系统配置的时区） */
function today(): string {
  return todayByConfig();
}

/**
 * 本地时间 "YYYY-MM-DD HH:mm:ss"
 *
 * 实现统一收敛到 lib/time.ts 的 nowLocalFull()：
 * 那里按 app_settings 里配置的时区取时间，而不是跟着容器 TZ 走。
 * 这样「系统参数 → 时区」改了之后，任务执行时间也跟着一致。
 */
function nowLocal(): string {
  return nowByConfig();
}

/**
 * 是否该在「今天」推送
 * 用「余数落在窗口内」而不是「整除」，避免 74 天这类非整数倍永远不命中
 * @param days 已逾期/剩余天数
 * @param dailyWithin 该天数内每天都推
 * @param period 超过后每隔几天推一次
 */
function shouldRemind(days: number, dailyWithin: number, period: number): boolean {
  if (days < 0) return false;
  if (days <= dailyWithin) return true;
  // 超过 dailyWithin 后，每 period 天一个窗口（2 天宽），保证不会漏
  const offset = days - dailyWithin;
  return offset % period < 2;
}

/**
 * 按角色取用户（去重）
 * 一个用户可能有多个角色，用 DISTINCT 避免重复收到同一通知
 */
function usersByRoles(roles: string[]): number[] {
  if (roles.length === 0) return [];
  const ph = roles.map(() => "?").join(",");
  const rows = all<{ user_id: number }>(
    `SELECT DISTINCT ur.user_id
     FROM user_roles ur JOIN users u ON u.id = ur.user_id
     WHERE u.active = 1 AND ur.role_key IN (${ph})`,
    roles
  );
  return rows.map((r) => r.user_id);
}

// ---------------- 任务 1：节点超期 ----------------
/**
 * 节点超期状态同步
 *
 * 背景：节点状态有 late（已超期），但之前没有任何代码会置位，
 * 导致「节点超期」提醒永远查不到数据，形同虚设。
 *
 * 规则：
 *   - 计划日期已过 且 未完成（cur/next）→ 置为 late
 *   - 已 late 但实际完成了 → 由推进流程置 done，此处还原为 cur
 *   - late 但还在计划期内（计划日期被改过）→ 还原为 cur
 *
 * 这是「状态自动流转」的基础，必须在提醒之前执行。
 */
function syncNodeLateStatus(): { toLate: number; toCur: number } {
  // 1. 超期未完成 → late
  const toLate = run(
    `UPDATE project_nodes
     SET status = 'late', updated_at = datetime('now','localtime')
     WHERE status IN ('cur','next')
       AND plan_date IS NOT NULL
       AND plan_date < date('now','localtime')
       AND actual_date IS NULL
       AND project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL)`
  ).changes;

  // 2. late 但计划期已被改到未来 → 还原为 cur
  const toCur = run(
    `UPDATE project_nodes
     SET status = 'cur', updated_at = datetime('now','localtime')
     WHERE status = 'late'
       AND actual_date IS NULL
       AND plan_date >= date('now','localtime')`
  ).changes;

  return { toLate: Number(toLate), toCur: Number(toCur) };
}

function jobNodeOverdue(): JobResult {
  // 先同步状态，确保查询能查到超期节点
  const sync = syncNodeLateStatus();

  const rows = all<{
    project_id: number; project_code: string; project_name: string;
    node_key: string; plan_date: string; owner_id: number | null; owner_name: string | null;
  }>(`
    SELECT n.project_id, p.code AS project_code, p.name AS project_name,
           n.node_key, n.plan_date, n.owner_id, u.name AS owner_name
    FROM project_nodes n
    JOIN projects p ON p.id = n.project_id
    LEFT JOIN users u ON u.id = n.owner_id
    WHERE n.status = 'late'
      AND p.deleted_at IS NULL
      AND p.stage NOT IN ('质保','售后')
  `);

  let sent = 0;
  for (const r of rows) {
    const days = overdueDays(r.plan_date);
    if (days <= 0) continue;
    // 3 天内每天推；超过 3 天后每 3 天一次
    if (!shouldRemind(days, 3, 3)) continue;
    const key = `node:${r.project_id}:${r.node_key}:${today()}`;
    if (!shouldSend(key)) continue;

    const title = `节点超期 ${days} 天：${r.project_code} ${r.node_key}`;
    const content = `项目：${r.project_name}\n节点：${r.node_key}\n计划：${r.plan_date}\n责任人：${r.owner_name ?? "未指派"}`;

    // 推给：项目经理 + 销售 + 节点责任人
    const targets = new Set(usersByRoles(["pm", "sales"]));
    if (r.owner_id) targets.add(r.owner_id);
    for (const uid of targets) {
      createNotification({
        userId: uid, category: "node", title,
        content, link: `/projects/${r.project_id}`, level: days >= 7 ? "bad" : "warn",
      });
    }
    sent++;
  }

  if (sent > 0) {
    sendMessage("节点超期提醒", `今日有 ${sent} 个节点超期需要跟进`, "warn");
  }
  const syncInfo = sync.toLate > 0 || sync.toCur > 0
    ? `（状态同步：新增超期 ${sync.toLate}，恢复 ${sync.toCur}）`
    : "";
  return {
    key: "node_overdue", name: "节点超期", sent,
    detail: `检查 ${rows.length} 个，推送 ${sent} 个${syncInfo}`,
  };
}

// ---------------- 任务 2：回款逾期 ----------------
function jobPaymentOverdue(): JobResult {
  const rows = all<{
    term_id: number; term_name: string; project_id: number; project_code: string;
    customer_name: string | null; amount_cents: number; actual_cents: number;
    plan_date: string; owner_id: number | null;
  }>(`
    SELECT t.id AS term_id, t.name AS term_name, p.id AS project_id, p.code AS project_code,
           cu.name AS customer_name, t.amount_cents, t.actual_cents, t.plan_date, c.owner_id
    FROM payment_terms t
    JOIN contracts c ON c.id = t.contract_id
    JOIN projects p ON p.id = c.project_id
    LEFT JOIN customers cu ON cu.id = p.customer_id
    WHERE c.type = 'customer'
      AND t.status IN ('逾期未收','部分回款')
      AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL
  `);

  let sent = 0;
  for (const r of rows) {
    const days = overdueDays(r.plan_date);
    if (days <= 0) continue;

    // 7 天内每天推；超过 7 天后每 7 天一次
    if (!shouldRemind(days, 7, 7)) continue;

    const key = `payment:${r.term_id}:${today()}`;
    if (!shouldSend(key)) continue;

    const left = r.amount_cents - r.actual_cents;
    const title = `回款逾期 ${days} 天：${r.project_code} ${r.term_name}`;
    const content =
      `项目：${r.project_code}\n客户：${r.customer_name ?? "—"}\n` +
      `待收：${(left / 10000).toFixed(2)} 万元\n计划日期：${r.plan_date}\n逾期：${days} 天`;

    // 推给：财务 + 销售 + 项目经理 + 总经理
    const targets = new Set(usersByRoles(["finance", "sales", "pm", "boss"]));
    if (r.owner_id) targets.add(r.owner_id);
    for (const uid of targets) {
      createNotification({
        userId: uid, category: "payment", title, content,
        link: "/finance", level: days >= 30 ? "bad" : "warn",
      });
    }
    sent++;
  }

  if (sent > 0) {
    sendMessage("回款逾期提醒", `今日有 ${sent} 笔回款逾期需要催收`, "bad");
  }
  return { key: "payment_overdue", name: "回款逾期", sent, detail: `检查 ${rows.length} 笔，推送 ${sent} 笔` };
}

// ---------------- 任务 3：投标截止 ----------------
function jobBidDeadline(): JobResult {
  const rows = all<{
    id: number; code: string; name: string; deadline: string;
    bond_status: string; owner_id: number | null;
  }>(`
    SELECT b.id, b.code, b.name, b.deadline, b.bond_status, b.owner_id
    FROM bids b
    WHERE b.result = '待开标' AND b.deadline IS NOT NULL AND b.deleted_at IS NULL
  `);

  let sent = 0;
  for (const r of rows) {
    const d = daysFromNow(r.deadline);
    if (d < 0 || d > 7) continue;
    // 7 天内每天提醒（临近截止更重要）

    const key = `bid:${r.id}:${d}:${today()}`;
    if (!shouldSend(key)) continue;

    const title = d === 0
      ? `今日开标：${r.code} ${r.name}`
      : `投标截止剩 ${d} 天：${r.code} ${r.name}`;

    const content =
      `项目：${r.name}\n截止：${r.deadline}\n保证金：${r.bond_status}\n` +
      (r.bond_status === "未缴" ? "⚠ 保证金尚未缴纳" : "");

    // 推给：商务 + 销售
    for (const uid of usersByRoles(["sales"])) {
      createNotification({
        userId: uid, category: "bid", title, content,
        link: "/bidding", level: d <= 3 ? "bad" : "warn",
      });
    }
    sent++;
  }

  if (sent > 0) {
    sendMessage("投标截止提醒", `有 ${sent} 个投标临近截止或今日开标`, "warn");
  }
  return { key: "bid_deadline", name: "投标截止", sent, detail: `检查 ${rows.length} 个，推送 ${sent} 个` };
}

// ---------------- 任务 4：质保到期 ----------------
function jobWarrantyExpiry(): JobResult {
  const rows = all<{
    id: number; code: string; project_id: number; project_name: string;
    end_date: string; bond_cents: number | null; bond_status: string | null;
  }>(`
    SELECT w.id, w.code, w.project_id, p.name AS project_name,
           w.end_date, w.bond_cents, w.bond_status
    FROM warranties w
    JOIN projects p ON p.id = w.project_id
    WHERE w.deleted_at IS NULL AND p.deleted_at IS NULL
  `);

  let sent = 0;
  for (const r of rows) {
    const d = daysFromNow(r.end_date);
    if (d < 0 || d > 90) continue;
    // 30 天内每天推；30-90 天每 7 天一次
    if (!shouldRemind(d, 30, 7)) continue;

    const key = `warranty:${r.id}:${d}:${today()}`;
    if (!shouldSend(key)) continue;

    const bond = r.bond_cents ?? 0;
    const title = `质保到期剩 ${d} 天：${r.project_name}`;
    const content =
      `项目：${r.project_name}\n质保到期：${r.end_date}\n` +
      (bond > 0 ? `质保金：${(bond / 10000).toFixed(2)} 万元（${r.bond_status ?? "待收"}）\n到期后可收回` : "");

    // 推给：售后 + 销售 + 项目经理
    for (const uid of usersByRoles(["service", "sales", "pm"])) {
      createNotification({
        userId: uid, category: "warranty", title, content,
        link: "/service", level: d <= 30 ? "warn" : "info",
      });
    }
    sent++;
  }

  if (sent > 0) {
    sendMessage("质保到期提醒", `有 ${sent} 个项目质保即将到期，注意收回质保金`, "info");
  }
  return { key: "warranty_expiry", name: "质保到期", sent, detail: `检查 ${rows.length} 个，推送 ${sent} 个` };
}

// ---------------- 任务 5：库存预警 ----------------
function jobStockAlert(): JobResult {
  const rows = all<{
    item_id: number; name: string; sku: string; qty: number;
    safe_stock: number; unit: string; warehouse_name: string;
  }>(`
    SELECT s.item_id, i.name, i.sku, s.qty, i.safe_stock, i.unit, w.name AS warehouse_name
    FROM stock s
    JOIN items i ON i.id = s.item_id
    JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.qty <= i.safe_stock
  `);

  let sent = 0;
  const lowItems = rows.filter((r) => r.qty < r.safe_stock);
  if (lowItems.length === 0) {
    return { key: "stock_alert", name: "库存预警", sent: 0, detail: "库存充足" };
  }

  const key = `stock:${today()}`;
  if (!shouldSend(key)) {
    return { key: "stock_alert", name: "库存预警", sent: 0, detail: "今日已推送" };
  }

  const content = lowItems
    .slice(0, 10)
    .map((r) => `· ${r.name}（${r.warehouse_name}）：${r.qty} ${r.unit} / 安全 ${r.safe_stock}`)
    .join("\n");

  // 推给：库管 + 财务 + 总经理
  for (const uid of usersByRoles(["warehouse", "finance", "boss"])) {
    createNotification({
      userId: uid, category: "stock",
      title: `库存低于安全线：${lowItems.length} 种物料`,
      content, link: "/inventory", level: "warn",
    });
  }
  sendMessage(`库存预警：${lowItems.length} 种物料低于安全库存`, content, "warn");

  return { key: "stock_alert", name: "库存预警", sent: 1, detail: `${lowItems.length} 种物料不足` };
}

// ---------------- 任务 6：审批超时 ----------------
function jobApprovalTimeout(): JobResult {
  const rows = all<{
    id: number; biz_title: string; current_step: number; created_at: string;
  }>(`
    SELECT id, biz_title, current_step, created_at
    FROM approval_instances
    WHERE status = 'pending'
      AND datetime(created_at, '+2 days') < datetime('now','localtime')
  `);

  let sent = 0;
  for (const r of rows) {
    const key = `approval:${r.id}:${today()}`;
    if (!shouldSend(key)) continue;

    // 注意：approval_steps 只有 role_required，没有 role_label 列。
    // 之前查 role_label 会抛 SQL 错误（等有超时审批触发时才暴露），
    // 这里用 ROLE_LABEL 映射转成中文。
    const step = one<{ role_required: string }>(
      "SELECT role_required FROM approval_steps WHERE instance_id = ? AND step_no = ?",
      [r.id, r.current_step]
    );
    const stepLabel = step?.role_required
      ? (ROLE_LABEL[step.role_required as Role] ?? step.role_required)
      : "未知";

    const title = `审批超时：${r.biz_title}`;
    const content = `该审批已挂起超过 2 天\n当前步骤：${stepLabel}`;

    for (const uid of usersByRoles(["boss"])) {
      createNotification({
        userId: uid, category: "approval", title, content,
        link: "/approvals", level: "warn",
      });
    }
    sent++;
  }

  return { key: "approval_timeout", name: "审批超时", sent, detail: `${rows.length} 个超时` };
}

// ---------------- 任务 7：SLA 超时自动升级 ----------------
function jobSlaEscalate(): JobResult {
  // 找出「待响应」且已超过 SLA 时限的工单
  const rows = all<{
    id: number; code: string; title: string; level: string;
    sla_hours: number | null; reported_at: string; owner_id: number | null;
    project_name: string | null;
  }>(`
    SELECT t.id, t.code, t.title, t.level, t.sla_hours, t.reported_at, t.owner_id,
           p.name AS project_name
    FROM tickets t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.status IN ('待响应','处理中')
      AND t.deleted_at IS NULL
      AND t.sla_hours IS NOT NULL
      AND datetime(t.reported_at, '+' || t.sla_hours || ' hours') < datetime('now','localtime')
  `);

  let escalated = 0;
  let failed = 0;
  for (const r of rows) {
    // 已在今天升级过就跳过（幂等键，防重复推送）
    const key = `sla:${r.id}:${today()}`;
    if (!shouldSend(key)) continue;

    // 注意：tickets 表没有 updated_at 列（只有 reported_at / responded_at / resolved_at），
    // 之前这里写了 updated_at 导致整个任务抛 SQL 错误而失败。
    // 不要加更新时间的列——状态变更本身可由 audit_logs 追溯。
    //
    // 逐条 catch：单个工单处理失败不能连累整批，
    // 否则前面已经改过的工单数据留下，任务却记 failed，
    // 运维看到告警却不知道具体是哪一条出的问题。
    try {
      run("UPDATE tickets SET status = '超时升级' WHERE id = ?", [r.id]);
    } catch (e) {
      // 记录但不中断，继续处理下一个工单
      audit({
        userId: null, userName: "系统", action: "update",
        entityType: "ticket", entityId: r.id,
        summary: `SLA 升级失败：${r.code}（${(e as Error).message}）`,
      });
      failed++;
      continue;
    }

    const overdueHours = Math.round(
      (Date.now() - new Date(r.reported_at.replace(" ", "T")).getTime()) / 3600000
    );

    const title = `工单 SLA 超时升级：${r.code}`;
    const content =
      `项目：${r.project_name ?? "—"}\n问题：${r.title}\n` +
      `级别：${r.level}\nSLA：${r.sla_hours} 小时\n已超时：约 ${overdueHours} 小时`;

    // 推给售后 + 总经理
    const targets = new Set(usersByRoles(["service", "boss"]));
    if (r.owner_id) targets.add(r.owner_id);
    for (const uid of targets) {
      createNotification({
        userId: uid, category: "sla", title, content,
        link: "/service", level: "bad",
      });
    }

    // userId 用 null 表示「系统操作」
    //
    // 原来写死 0，但 users 表里没有 id=0 的记录，
    // audit_logs.user_id 的外键直接拒绝插入 →
    // 整个 jobSlaEscalate 抛异常、任务记 failed、定时任务显示告警。
    // 用 null 更准确（系统行为本来就没有操作人），user_name 保留可读标识。
    audit({
      userId: null, userName: "系统", action: "update",
      entityType: "ticket", entityId: r.id,
      summary: `SLA 超时自动升级：${r.code}（超时约 ${overdueHours} 小时）`,
    });

    escalated++;
  }

  if (escalated > 0) {
    sendMessage("工单 SLA 超时升级", `有 ${escalated} 个工单超时已自动升级`, "bad");
  }

  return {
    key: "sla_escalate", name: "SLA 超时升级", sent: escalated,
    detail: `检查 ${rows.length} 个，升级 ${escalated} 个`
      + (failed > 0 ? `，失败 ${failed} 个` : ""),
  };
}

// ---------------- 调度入口 ----------------
// ---------------- 任务 8：磁盘使用率预警 ----------------
function jobDiskUsage(): JobResult {
  const warnPct = getParamInt("disk_warn_pct", 80);
  const dangerPct = getParamInt("disk_danger_pct", 90);
  const minFreeMB = getParamInt("disk_min_free_mb", 5120);

  const disk = getDiskInfo();
  const name = "磁盘使用率";

  if (!disk.supported) {
    return { key: "disk_usage", name, sent: 0, detail: "当前环境不支持磁盘检测" };
  }

  // 逐分区判断
  const alerts: {
    mount: string; device: string; pct: number; freeMB: number;
    usedMB: number; totalMB: number; level: string;
  }[] = [];

  for (const m of disk.mounts) {
    const overPct = m.usagePct >= warnPct;
    const lowFree = m.freeMB < minFreeMB;
    if (!overPct && !lowFree) continue;

    alerts.push({
      mount: m.path,
      device: m.device,
      pct: m.usagePct,
      freeMB: m.freeMB,
      usedMB: m.usedMB,
      totalMB: m.totalMB,
      level: (m.usagePct >= dangerPct || m.freeMB < minFreeMB / 2) ? "bad" : "warn",
    });
  }

  if (alerts.length === 0) {
    return {
      key: "disk_usage", name, sent: 0,
      detail: `磁盘正常（最高 ${disk.maxUsagePct}%，剩余 ${Math.round(disk.minFreeMB / 1024)}GB）`,
    };
  }

  let sent = 0;
  for (const a of alerts) {
    // 同一天同一分区只推一次
    const key = `disk:${a.mount}:${today()}`;
    if (!shouldSend(key)) continue;

    const pctText = `${a.pct}%`;
    const freeText = a.freeMB >= 1024
      ? `${(a.freeMB / 1024).toFixed(1)} GB`
      : `${a.freeMB} MB`;
    const usedText = a.totalMB >= 1024
      ? `${(a.usedMB / 1024).toFixed(1)} / ${(a.totalMB / 1024).toFixed(1)} GB`
      : `${a.usedMB} / ${a.totalMB} MB`;

    const isDanger = a.level === "bad";
    const title = isDanger
      ? `【紧急】磁盘空间告急：${pctText}，剩余 ${freeText}`
      : `磁盘空间预警：${pctText}，剩余 ${freeText}`;

    const content = [
      `分区：${a.mount}`,
      a.device ? `设备：${a.device}` : null,
      `已用：${usedText}（${pctText}）`,
      `剩余：${freeText}`,
      "",
      "处理建议：",
      "· 清理 db/backup/ 下的旧备份（参数配置可调保留份数）",
      "· 清理 db/upgrade/ 下已应用的升级包",
      "· 检查 uploads/ 是否可以归档旧附件",
      isDanger
        ? "· 已接近满盘，SQLite 写入可能失败，请尽快处理！"
        : "· 建议尽快清理，避免影响业务",
    ].filter(Boolean).join("\n");

    // 推给：总经理 + 系统管理员
    const targets = new Set(usersByRoles(["boss", "admin"]));
    for (const uid of targets) {
      createNotification({
        userId: uid,
        category: "system",
        title,
        content,
        link: "/system",
        level: isDanger ? "bad" : "warn",
      });
    }
    sent++;
  }

  const worst = alerts.reduce((a, b) => (b.pct > a.pct ? b : a), alerts[0]);
  return {
    key: "disk_usage",
    name,
    sent,
    detail: `${alerts.length} 个分区告警，最高 ${worst.pct}%（${worst.mount}）`,
  };
}

// ---------------- 任务 9：孤儿附件清理 ----------------
/**
 * 清理磁盘上存在、但数据库里没有记录的附件文件
 *
 * 这些文件占空间但永远不会被访问：
 *   · 上传后业务单据没保存成功
 *   · 早期测试数据被直接清库，文件没同步删
 *
 * 安全设计见 lib/orphan-cleanup.ts，核心是「宁可漏删不错删」：
 *   宽限期 7 天 + 目录白名单 + 数据库双重校验 + 只删文件不删目录
 */
function jobOrphanCleanup(): JobResult {
  const name = "孤儿附件清理";
  const r = cleanupOrphanFiles();

  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

  if (r.removed === 0 && r.failed === 0) {
    return {
      key: "orphan_cleanup",
      name,
      sent: 0,
      detail: "扫描 " + r.scanned + " 个文件，无孤儿。"
        + "（保留：有记录 " + r.keptReferenced + "，宽限期内 " + r.skippedFresh + "）",
    };
  }

  const parts: string[] = [];
  parts.push("清理 " + r.removed + " 个孤儿文件，释放 " + mb(r.freedBytes) + " MB");
  if (r.failed > 0) parts.push(r.failed + " 个删除失败");
  parts.push("扫描 " + r.scanned + "，保留：有记录 " + r.keptReferenced + "，宽限期内 " + r.skippedFresh);
  if (r.samples.length) parts.push("样例：" + r.samples.slice(0, 5).join("、"));
  const detail = parts.join("；");

  // 只有真的删了东西才通知，避免每天一条噪音
  if (r.removed > 0) {
    const targets = new Set(usersByRoles(["boss", "admin"]));
    for (const uid of targets) {
      createNotification({
        userId: uid,
        category: "system",
        title: "已清理 " + r.removed + " 个孤儿附件（" + mb(r.freedBytes) + " MB）",
        content: detail,
        link: "/system",
        level: "warn",
      });
    }
  }

  return { key: "orphan_cleanup", name, sent: r.removed, detail };
}

/** 任务 key → 中文名（出错时也要显示可读名称，不能只给 key） */
const JOB_LABELS: Record<string, string> = {
  node_overdue: "节点超期",
  payment_overdue: "回款逾期",
  bid_deadline: "投标截止",
  warranty_expiry: "质保到期",
  stock_alert: "库存预警",
  approval_timeout: "审批超时",
  sla_escalate: "工单超时升级",
  disk_usage: "磁盘使用率",
  orphan_cleanup: "孤儿附件清理",
};

export function runAllJobs(onlyKey?: string): JobResult[] {
  const jobs: { key: string; fn: () => JobResult }[] = [
    { key: "node_overdue", fn: jobNodeOverdue },
    { key: "payment_overdue", fn: jobPaymentOverdue },
    { key: "bid_deadline", fn: jobBidDeadline },
    { key: "warranty_expiry", fn: jobWarrantyExpiry },
    { key: "stock_alert", fn: jobStockAlert },
    { key: "approval_timeout", fn: jobApprovalTimeout },
    { key: "sla_escalate", fn: jobSlaEscalate },
    { key: "disk_usage", fn: jobDiskUsage },
    { key: "orphan_cleanup", fn: jobOrphanCleanup },
  ];

  const results: JobResult[] = [];
  for (const j of jobs) {
    if (onlyKey && j.key !== onlyKey) continue;
    // 必须用本地时间，不能用 toISOString()
    //
    // toISOString() 返回 UTC，而 finished_at 用的是 datetime('now','localtime')。
    // 同一行 started_at 和 finished_at 差 8 小时，看起来像任务跑了 8 个钟头。
    // 东八区下 22:22 执行，会被记成 05:22 开始、13:22 结束。
    const started = nowLocal();
    try {
      const r = j.fn();
      run(
        `INSERT INTO job_runs (job_key, run_date, status, detail, items_sent, started_at, finished_at)
         VALUES (?, ?, 'ok', ?, ?, ?, datetime('now','localtime'))`,
        [r.key, today(), r.detail, r.sent, started]
      );
      results.push(r);
    } catch (e) {
      const err = (e as Error).message;
      run(
        `INSERT INTO job_runs (job_key, run_date, status, error, started_at, finished_at)
         VALUES (?, ?, 'failed', ?, ?, datetime('now','localtime'))`,
        [j.key, today(), err, started]
      );
      // 出错时也用中文名，否则前端显示英文 key，用户不知道是哪个任务挂了
      results.push({
        key: j.key, name: JOB_LABELS[j.key] ?? j.key,
        sent: 0, detail: "失败：" + err, error: err,
      });
    }
  }

  // 清理 90 天前的去重记录，防表膨胀
  run("DELETE FROM notify_sent_log WHERE created_at < datetime('now','localtime','-90 days')");

  return results;
}

/** 任务执行历史 */

// ---------------- 配置 ----------------

export interface JobConfig {
  enabled: boolean;
  hour: number;      // 每天几点跑，默认 8
  minute: number;    // 默认 30
}

export function getJobConfig(): JobConfig {
  const rows = all<{ key: string; value: string }>(
    "SELECT key, value FROM app_settings WHERE key LIKE 'job.%'"
  );
  const m = new Map(rows.map((r) => [r.key.replace("job.", ""), r.value ?? ""]));
  return {
    enabled: (m.get("enabled") ?? "1") === "1",
    hour: Number(m.get("hour") ?? 8),
    minute: Number(m.get("minute") ?? 30),
  };
}

export function saveJobConfig(cfg: Partial<JobConfig>) {
  const set = (k: string, v: string) => {
    run(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ["job." + k, v]
    );
  };
  if (cfg.enabled !== undefined) set("enabled", cfg.enabled ? "1" : "0");
  if (cfg.hour !== undefined) set("hour", String(cfg.hour));
  if (cfg.minute !== undefined) set("minute", String(cfg.minute));
}

export function listJobRuns(limit = 50) {
  return all<{
    id: number; job_key: string; run_date: string; status: string;
    detail: string | null; items_sent: number; error: string | null; started_at: string;
  }>(
    "SELECT * FROM job_runs ORDER BY id DESC LIMIT ?", [limit]
  );
}
