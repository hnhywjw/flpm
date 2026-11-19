import { all, one, run } from "./db";
import { overdueDays, daysFromNow } from "./domain";
import type {
  Project, ProjectNode, Bid, BidParticipant, BidTask, Contract, PaymentTerm, Invoice,
  Acceptance, AgentAgreement, AgentFeePayment, StockMove, Stock, Ticket,
  Warranty, AlertItem, DashboardData, User,
} from "./types";

// ---------------- 项目 ----------------
/**
 * 项目列表
 * @param scope 数据权限过滤；不传则看全部（仅限内部调用/管理员）
 */
export function listProjects(scope?: { sql: string; params: unknown[] }): Project[] {
  const filter = scope ? `AND (${scope.sql})` : "";
  return all<Project>(`
    SELECT p.*, c.name AS customer_name, u.name AS owner_name,
      COALESCE(
        (SELECT bp.company_name FROM bid_participants bp
           JOIN bids b ON b.id = bp.bid_id AND b.deleted_at IS NULL
          WHERE b.project_id = p.id AND bp.result = '中标'
          ORDER BY bp.is_self DESC, bp.id LIMIT 1),
        (SELECT a.agreement_with FROM agent_agreements a
          WHERE a.project_id = p.id AND a.deleted_at IS NULL LIMIT 1)
      ) AS winner_name
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users u ON u.id = p.owner_id
    WHERE p.deleted_at IS NULL ${filter}
    ORDER BY
      CASE p.stage WHEN '实施' THEN 1 WHEN '验收' THEN 2 WHEN '投标' THEN 3 WHEN '质保' THEN 4 ELSE 5 END,
      p.plan_due ASC
  `, scope?.params ?? []);
}

export function getProject(id: number): Project | undefined {
  return one<Project>(`
    SELECT p.*, c.name AS customer_name, u.name AS owner_name
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users u ON u.id = p.owner_id
    WHERE p.id = ? AND p.deleted_at IS NULL
  `, [id]);
}

export function getProjectNodes(projectId: number): ProjectNode[] {
  return all<ProjectNode>(`
    SELECT n.*, u.name AS owner_name
    FROM project_nodes n
    LEFT JOIN users u ON u.id = n.owner_id
    WHERE n.project_id = ?
    ORDER BY n.seq
  `, [projectId]);
}

/** 项目下所有客户合同（1:N） */
export function getProjectCustomerContracts(projectId: number): Contract[] {
  return all<Contract>(`
    SELECT * FROM contracts WHERE project_id = ? AND type = 'customer' AND deleted_at IS NULL ORDER BY sign_date
  `, [projectId]);
}

export function getProjectPurchaseContracts(projectId: number): Contract[] {
  return all<Contract>(`
    SELECT * FROM contracts WHERE project_id = ? AND type = 'purchase' AND deleted_at IS NULL ORDER BY sign_date
  `, [projectId]);
}

/** 项目客户合同合计金额（多份合同求和） */
export function getProjectContractTotal(projectId: number): number {
  const row = one<{ total: number | null }>(
    "SELECT SUM(amount_cents) AS total FROM contracts WHERE project_id = ? AND type = 'customer' AND deleted_at IS NULL",
    [projectId]
  );
  return row?.total ?? 0;
}

/** 项目所有回款期次（跨多份合同） */
export function getProjectTerms(projectId: number): (PaymentTerm & { contract_code: string })[] {
  const rows = all<PaymentTerm & { contract_code: string }>(`
    SELECT t.*, c.code AS contract_code
    FROM payment_terms t
    JOIN contracts c ON c.id = t.contract_id
    WHERE c.project_id = ? AND c.type = 'customer'
      AND t.deleted_at IS NULL AND c.deleted_at IS NULL
    ORDER BY c.sign_date, t.seq
  `, [projectId]);
  return rows.map((r) => ({ ...r, overdue: overdueDays(r.plan_date) }));
}

export function getProjectAcceptances(projectId: number): Acceptance[] {
  return all<Acceptance>(`
    SELECT a.*, u.name AS owner_name
    FROM acceptances a LEFT JOIN users u ON u.id = a.owner_id
    WHERE a.project_id = ?
  `, [projectId]);
}

/** 验收四件套齐备数量 */
export function countAcceptanceDone(projectId: number): number {
  const row = one<{ n: number }>(`
    SELECT COUNT(*) AS n FROM acceptances
    WHERE project_id = ? AND status IN ('已提交','已签收','已出具','已齐备')
  `, [projectId]);
  return row?.n ?? 0;
}

/**
 * 能否推进到开票：验收四件套必须 4/4，且每项都要有实际文件
 *
 * ★ 为什么要加「必须附件」这一条
 *
 * 原来只看状态：把四个下拉框依次点成「已提交/已签收/已出具/已齐备」，
 * 一道闸门就全开了 —— 哪怕系统里一个文件都没有。
 * 等真出事（客户拒付、审计要查），才发现「验收报告」根本不存在。
 *
 * 现在：状态齐备 + 每项至少一个附件，才算真齐备。
 * missing 里会明确区分「状态未完成」和「缺文件」。
 */
export function canAdvanceToInvoice(projectId: number): {
  ok: boolean;
  done: number;
  missing: string[];
  /** 状态已完成但没传文件的项 */
  missingFiles: string[];
} {
  const rows = getProjectAcceptances(projectId);
  const DONE = ["已提交", "已签收", "已出具", "已齐备"];
  const required = ["安装配置文档", "到货签收单", "验收报告", "项目资料"];

  const byType = new Map(rows.map((r) => [r.doc_type, r]));

  // 每个验收项的附件数量（entity_type='acceptance', entity_id=acceptances.id）
  const fileCount = new Map<number, number>();
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    const ph = ids.map(() => "?").join(",");
    const cnt = all<{ entity_id: number; n: number }>(
      `SELECT entity_id, COUNT(*) AS n FROM attachments
       WHERE entity_type = 'acceptance' AND entity_id IN (${ph})
       GROUP BY entity_id`,
      ids
    );
    for (const c of cnt) fileCount.set(c.entity_id, c.n);
  }

  const missing: string[] = [];
  const missingFiles: string[] = [];

  for (const docType of required) {
    const row = byType.get(docType);
    const statusOk = row ? DONE.includes(row.status) : false;
    const hasFile = row ? (fileCount.get(row.id) ?? 0) > 0 : false;

    if (!statusOk) {
      missing.push(docType);
    } else if (!hasFile) {
      // 状态已完成但没文件 → 也算没齐备
      missing.push(docType);
      missingFiles.push(docType);
    }
  }

  return {
    ok: missing.length === 0,
    done: required.length - missing.length,
    missing,
    missingFiles,
  };
}

// ---------------- 投标 ----------------
export function listBids(scope?: { sql: string; params: unknown[] }): Bid[] {
  const filter = scope ? `AND (${scope.sql})` : "";
  return all<Bid>(`
    SELECT b.*, u.name AS owner_name, c.name AS customer_name,
           p.code AS project_code, p.name AS project_name
    FROM bids b
    LEFT JOIN users u ON u.id = b.owner_id
    LEFT JOIN customers c ON c.id = b.customer_id
    LEFT JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
    WHERE b.deleted_at IS NULL ${filter}
    ORDER BY CASE WHEN b.result = '待开标' THEN 0 ELSE 1 END, b.deadline ASC
  `, scope?.params ?? []);
}

export function getBid(id: number): Bid | undefined {
  return one<Bid>(`SELECT b.*, u.name AS owner_name FROM bids b LEFT JOIN users u ON u.id = b.owner_id WHERE b.id = ? AND b.deleted_at IS NULL`, [id]);
}

export function getBidParticipants(bidId: number): BidParticipant[] {
  return all<BidParticipant>(`
    SELECT p.*, u.name AS checked_by_name
    FROM bid_participants p LEFT JOIN users u ON u.id = p.checked_by
    WHERE p.bid_id = ? ORDER BY p.is_self DESC, p.id
  `, [bidId]);
}

export function getBidTasks(bidId: number): BidTask[] {
  return all<BidTask>(`SELECT t.*, u.name AS owner_name FROM bid_tasks t LEFT JOIN users u ON u.id = t.owner_id WHERE t.bid_id = ? ORDER BY t.seq`, [bidId]);
}

/** 关联风险参与方 —— 合规提示用 */
export function getRiskParticipants(): (BidParticipant & { bid_code: string; bid_name: string })[] {
  return all<BidParticipant & { bid_code: string; bid_name: string }>(`
    SELECT p.*, b.code AS bid_code, b.name AS bid_name
    FROM bid_participants p JOIN bids b ON b.id = p.bid_id
    WHERE p.relation = '关联风险'
  `);
}

// ---------------- 合同 ----------------
export function listContracts(type?: string): Contract[] {
  const where = type
    ? "WHERE c.deleted_at IS NULL AND c.type = ?"
    : "WHERE c.deleted_at IS NULL";
  return all<Contract>(`
    SELECT c.*, p.name AS project_name
    FROM contracts c LEFT JOIN projects p ON p.id = c.project_id
    ${where}
    ORDER BY c.sign_date DESC
  `, type ? [type] : []);
}

export function getContractTerms(contractId: number): PaymentTerm[] {
  const rows = all<PaymentTerm>("SELECT * FROM payment_terms WHERE contract_id = ? AND deleted_at IS NULL ORDER BY seq", [contractId]);
  return rows.map((r) => ({ ...r, overdue: overdueDays(r.plan_date) }));
}

export function listInvoices(): Invoice[] {
  return all<Invoice>("SELECT * FROM invoices ORDER BY issue_date DESC");
}

export function getProjectInvoices(projectId: number): Invoice[] {
  return all<Invoice>("SELECT * FROM invoices WHERE project_id = ? ORDER BY issue_date", [projectId]);
}

// ---------------- 回款 ----------------
export interface ReceivableRow extends PaymentTerm {
  project_id: number;
  project_name: string;
  project_code: string;
  contract_code: string;
  customer_name: string;
  invoiced_cents: number;
  invoice_date: string | null;
}

export function listReceivables(): ReceivableRow[] {
  const rows = all<ReceivableRow>(`
    SELECT t.*, p.id AS project_id, p.name AS project_name, p.code AS project_code,
           c.code AS contract_code, cu.name AS customer_name
    FROM payment_terms t
    JOIN contracts c ON c.id = t.contract_id
    JOIN projects p ON p.id = c.project_id
    LEFT JOIN customers cu ON cu.id = p.customer_id
    WHERE c.type = 'customer'
    ORDER BY
      CASE t.status WHEN '逾期未收' THEN 1 WHEN '部分回款' THEN 2 WHEN '待收回' THEN 3 WHEN '未到期' THEN 4 ELSE 5 END,
      t.plan_date ASC
  `);
  return rows.map((r) => ({ ...r, overdue: overdueDays(r.plan_date) }));
}

/** 回款汇总 */
export function getReceivableSummary() {
  const row = one<{ plan: number; act: number; overdue: number; overdueCnt: number }>(`
    SELECT
      COALESCE(SUM(t.amount_cents),0) AS plan,
      COALESCE(SUM(t.actual_cents),0) AS act,
      COALESCE(SUM(CASE WHEN t.status='逾期未收' THEN t.amount_cents - t.actual_cents ELSE 0 END),0) AS overdue,
      SUM(CASE WHEN t.status='逾期未收' THEN 1 ELSE 0 END) AS overdueCnt
    FROM payment_terms t JOIN contracts c ON c.id=t.contract_id
    WHERE c.type='customer'
  `);
  return row ?? { plan: 0, act: 0, overdue: 0, overdueCnt: 0 };
}

/** 质保金待收合计 */
export function getWarrantyBondPending(): number {
  const row = one<{ n: number }>(`
    SELECT COALESCE(SUM(t.amount_cents - t.actual_cents),0) AS n
    FROM payment_terms t JOIN contracts c ON c.id=t.contract_id
    WHERE c.type='customer' AND t.term_type='warranty' AND t.actual_cents < t.amount_cents
  `);
  return row?.n ?? 0;
}

/** 采购应付余额 */
export function getPayablePending(): number {
  const row = one<{ n: number }>(`
    SELECT COALESCE(SUM(t.amount_cents - t.actual_cents),0) AS n
    FROM payment_terms t JOIN contracts c ON c.id=t.contract_id
    WHERE c.type='purchase' AND t.actual_cents < t.amount_cents
  `);
  return row?.n ?? 0;
}

/** 投标保证金占用（已缴未退） */
export function getBondPending(): number {
  const row = one<{ n: number }>(`
    SELECT COALESCE(SUM(bond_cents),0) AS n FROM bids WHERE bond_status = '已缴'
  `);
  return row?.n ?? 0;
}

// ---------------- 代中标 / 过单费 ----------------
export function listAgentAgreements(): AgentAgreement[] {
  const rows = all<AgentAgreement>(`
    SELECT a.*, p.name AS project_name
    FROM agent_agreements a LEFT JOIN projects p ON p.id = a.project_id
    WHERE a.deleted_at IS NULL
    ORDER BY a.agree_date DESC
  `);
  return rows.map((a) => {
    const paid = one<{ n: number }>(
      "SELECT COALESCE(SUM(amount_cents),0) AS n FROM agent_fee_payments WHERE agreement_id = ?",
      [a.id]
    )?.n ?? 0;
    return { ...a, paid_cents: paid, unpaid_cents: a.fee_cents - paid };
  });
}

export function getAgentAgreementByProject(projectId: number): AgentAgreement | undefined {
  const a = one<AgentAgreement>("SELECT * FROM agent_agreements WHERE project_id = ? AND deleted_at IS NULL", [projectId]);
  if (!a) return undefined;
  const paid = one<{ n: number }>(
    "SELECT COALESCE(SUM(amount_cents),0) AS n FROM agent_fee_payments WHERE agreement_id = ?",
    [a.id]
  )?.n ?? 0;
  return { ...a, paid_cents: paid, unpaid_cents: a.fee_cents - paid };
}

export function getAgentPayments(agreementId: number): AgentFeePayment[] {
  return all<AgentFeePayment>(`
    SELECT f.*, u1.name AS paid_by_name, u2.name AS approved_by_name
    FROM agent_fee_payments f
    LEFT JOIN users u1 ON u1.id = f.paid_by
    LEFT JOIN users u2 ON u2.id = f.approved_by
    WHERE f.agreement_id = ? ORDER BY f.pay_date
  `, [agreementId]);
}

/** 校验过单费付款：个人付款必须三件套齐备 */
export function validateFeePayment(input: {
  partyType: "company" | "individual";
  docAgreement?: string | null;
  docVoucher?: string | null;
  docConfirm?: string | null;
  payeeName?: string | null;
  voucherNo?: string | null;
  amountCents: number;
  remainingCents: number;
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.amountCents || input.amountCents <= 0) errors.push("付款金额必须大于 0");
  if (input.amountCents > input.remainingCents) {
    errors.push(`付款金额超过未付余额 ${(input.remainingCents / 10000).toFixed(2)} 万元`);
  }
  if (input.partyType === "individual") {
    if (!input.docAgreement) errors.push("缺少代中标协议扫描件");
    if (!input.docVoucher) errors.push("缺少付款凭证（银行回单/现金签收单）");
    if (!input.docConfirm) errors.push("缺少收款确认单");
    if (!input.payeeName) errors.push("必须填写收款人姓名");
    if (!input.voucherNo) errors.push("必须填写凭证编号");
  }
  return { ok: errors.length === 0, errors };
}

// ---------------- 库存 ----------------
export function listStock(): Stock[] {
  return all<Stock>(`
    SELECT s.*, i.sku, i.name AS item_name, i.safe_stock, i.unit, w.name AS warehouse_name
    FROM stock s
    JOIN items i ON i.id = s.item_id
    JOIN warehouses w ON w.id = s.warehouse_id
    ORDER BY i.id
  `);
}

export function listStockMoves(): StockMove[] {
  return all<StockMove>(`
    SELECT m.*, i.name AS item_name, i.sku, w.name AS warehouse_name,
           u.name AS operator_name, p.code AS project_code
    FROM stock_moves m
    JOIN items i ON i.id = m.item_id
    LEFT JOIN warehouses w ON w.id = m.warehouse_id
    LEFT JOIN users u ON u.id = m.operator_id
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.deleted_at IS NULL
    ORDER BY m.move_date DESC
  `);
}

export function getProjectStockMoves(projectId: number): StockMove[] {
  return all<StockMove>(`
    SELECT m.*, i.name AS item_name, i.sku, w.name AS warehouse_name, u.name AS operator_name
    FROM stock_moves m
    JOIN items i ON i.id = m.item_id
    LEFT JOIN warehouses w ON w.id = m.warehouse_id
    LEFT JOIN users u ON u.id = m.operator_id
    WHERE m.project_id = ? AND m.deleted_at IS NULL
    ORDER BY m.move_date DESC
  `, [projectId]);
}

/** 库存预警 */
export function getStockAlerts(): Stock[] {
  return all<Stock>(`
    SELECT s.*, i.sku, i.name AS item_name, i.safe_stock, i.unit, w.name AS warehouse_name
    FROM stock s JOIN items i ON i.id = s.item_id JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.qty <= i.safe_stock
    ORDER BY (s.qty * 1.0 / NULLIF(i.safe_stock,0)) ASC
  `);
}

// ---------------- 售后 ----------------
export function listTickets(): Ticket[] {
  return all<Ticket>(`
    SELECT t.*, u.name AS owner_name, p.name AS project_name, c.name AS customer_name
    FROM tickets t
    LEFT JOIN users u ON u.id = t.owner_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN customers c ON c.id = t.customer_id
    WHERE t.deleted_at IS NULL
    ORDER BY CASE t.status WHEN '超时升级' THEN 1 WHEN '待响应' THEN 2 WHEN '处理中' THEN 3 ELSE 4 END, t.reported_at
  `);
}

export function listWarranties(): (Warranty & { daysLeft: number })[] {
  const rows = all<Warranty>(`
    SELECT w.*, p.name AS project_name
    FROM warranties w LEFT JOIN projects p ON p.id = w.project_id
    ORDER BY w.end_date
  `);
  return rows.map((w) => ({ ...w, daysLeft: daysFromNow(w.end_date) }));
}

// ---------------- 用户 ----------------
export function listUsers(): User[] {
  return all<User>("SELECT * FROM users ORDER BY id");
}

export function getUser(id: number): User | undefined {
  return one<User>("SELECT * FROM users WHERE id = ?", [id]);
}

// ---------------- 预警汇总 ----------------
export function buildAlerts(): AlertItem[] {
  const out: AlertItem[] = [];

  // 1. 节点超期
  const lateNodes = all<{ project_id: number; code: string; node_key: string; plan_date: string; owner_name: string | null; note: string | null }>(`
    SELECT n.project_id, p.code, n.node_key, n.plan_date, u.name AS owner_name, n.note
    FROM project_nodes n
    JOIN projects p ON p.id = n.project_id
    LEFT JOIN users u ON u.id = n.owner_id
    WHERE n.status = 'late'
  `);
  for (const n of lateNodes) {
    out.push({
      kind: "节点超期",
      level: "bad",
      title: `${n.code} ${n.node_key}节点超期 ${overdueDays(n.plan_date)} 天`,
      detail: `责任人 ${n.owner_name ?? "—"} · 计划 ${n.plan_date}${n.note ? " · " + n.note : ""}`,
      entityType: "project",
      entityId: n.project_id,
      action: "催办",
    });
  }

  // 2. 回款逾期
  const overdue = all<{ name: string; code: string; amount_cents: number; actual_cents: number; plan_date: string; owner_name: string | null; customer_name: string | null; project_id: number }>(`
    SELECT t.name, c.code, t.amount_cents, t.actual_cents, t.plan_date, u.name AS owner_name, cu.name AS customer_name, p.id AS project_id
    FROM payment_terms t
    JOIN contracts c ON c.id = t.contract_id
    JOIN projects p ON p.id = c.project_id
    LEFT JOIN users u ON u.id = c.owner_id
    LEFT JOIN customers cu ON cu.id = p.customer_id
    WHERE t.status = '逾期未收'
  `);
  for (const r of overdue) {
    out.push({
      kind: "回款逾期",
      level: "bad",
      title: `${r.code} ${r.name} ${((r.amount_cents - r.actual_cents) / 10000).toFixed(2)} 万逾期 ${overdueDays(r.plan_date)} 天`,
      detail: `责任人 ${r.owner_name ?? "—"} · 客户 ${r.customer_name ?? "—"}`,
      entityType: "project",
      entityId: r.project_id,
      action: "跟进",
    });
  }

  // 3. 部分回款
  const partial = all<{ name: string; code: string; amount_cents: number; actual_cents: number; plan_date: string; project_id: number }>(`
    SELECT t.name, c.code, t.amount_cents, t.actual_cents, t.plan_date, p.id AS project_id
    FROM payment_terms t JOIN contracts c ON c.id=t.contract_id JOIN projects p ON p.id=c.project_id
    WHERE t.status = '部分回款'
  `);
  for (const r of partial) {
    out.push({
      kind: "回款滞收",
      level: "warn",
      title: `${r.code} ${r.name} 还差 ${((r.amount_cents - r.actual_cents) / 10000).toFixed(2)} 万未收`,
      detail: `逾期 ${overdueDays(r.plan_date)} 天 · 计划 ${r.plan_date}`,
      entityType: "project",
      entityId: r.project_id,
      action: "跟进",
    });
  }

  // 4. 投标截止
  const bids = all<{ id: number; code: string; deadline: string; name: string; bond_status: string; owner_name: string | null }>(`
    SELECT b.id, b.code, b.deadline, b.name, b.bond_status, u.name AS owner_name
    FROM bids b LEFT JOIN users u ON u.id = b.owner_id
    WHERE b.result = '待开标' AND b.deadline IS NOT NULL
  `);
  for (const b of bids) {
    const d = daysFromNow(b.deadline);
    if (d <= 7) {
      out.push({
        kind: "投标截止",
        level: d <= 3 ? "bad" : "warn",
        title: `${b.code} ${b.deadline} 递交截止（剩 ${d} 天）`,
        detail: `责任人 ${b.owner_name ?? "—"} · 保证金 ${b.bond_status}`,
        entityType: "bid",
        entityId: b.id,
        action: "查看",
      });
    }
  }

  // 5. 关联风险
  const risk = getRiskParticipants();
  for (const p of risk) {
    out.push({
      kind: "关联风险",
      level: "warn",
      title: `${p.bid_code} 投标方「${p.company_name}」标注关联风险`,
      detail: p.risk_note ?? "建议核查与其他参与方的股权/人员关联",
      entityType: "bid",
      entityId: p.bid_id,
      action: "核查",
    });
  }

  // 6. 过单费未付
  const agents = listAgentAgreements().filter((a) => (a.unpaid_cents ?? 0) > 0);
  for (const a of agents) {
    out.push({
      kind: "过单费待付",
      level: "warn",
      title: `${a.code} 过单费余 ${((a.unpaid_cents ?? 0) / 10000).toFixed(2)} 万未付`,
      detail: `对方 ${a.agreement_with} · ${a.fee_method === "cash" ? "现金方式" : "差价法"}`,
      entityType: "project",
      entityId: a.project_id ?? undefined,
      action: "付款",
    });
  }

  // 7. 质保金即将到期
  const warranties = listWarranties();
  for (const w of warranties) {
    if (w.bond_status !== "已收回" && w.daysLeft <= 90 && w.daysLeft >= 0) {
      out.push({
        kind: "质保金到期",
        level: w.daysLeft <= 30 ? "warn" : "info",
        title: `${w.code} 质保金 ${((w.bond_cents ?? 0) / 10000).toFixed(2)} 万可申请收回`,
        detail: `质保期 ${w.end_date} 届满 · 剩 ${w.daysLeft} 天`,
        entityType: "project",
        entityId: w.project_id ?? undefined,
        action: "发起",
      });
    }
  }

  // 8. 库存预警
  const stockAlerts = getStockAlerts();
  for (const s of stockAlerts) {
    out.push({
      kind: "库存预警",
      level: s.qty <= (s.safe_stock ?? 0) / 2 ? "bad" : "warn",
      title: `${s.item_name} 库存 ${s.qty} ${s.unit}，低于安全库存 ${s.safe_stock}`,
      detail: `仓库 ${s.warehouse_name}`,
      entityType: "item",
      entityId: s.item_id,
      action: "补货",
    });
  }

  const order = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------------- 首页看板 ----------------
export function getDashboard(): DashboardData {
  const projects = listProjects();
  const sum = getReceivableSummary();
  const contractTotal = projects.reduce((s, p) => s + (p.budget_cents ?? 0), 0);
  const received = all<{ n: number }>(`
    SELECT COALESCE(SUM(t.actual_cents),0) AS n FROM payment_terms t JOIN contracts c ON c.id=t.contract_id WHERE c.type='customer'
  `)[0]?.n ?? 0;

  const agentUnpaid = listAgentAgreements().reduce((s, a) => s + (a.unpaid_cents ?? 0), 0);

  return {
    contractTotal,
    receivedTotal: received,
    overdueTotal: sum.overdue,
    overdueCount: sum.overdueCnt,
    biddingCount: projects.filter((p) => p.stage === "投标").length,
    implementingCount: projects.filter((p) => p.stage === "实施" || p.stage === "验收").length,
    feeUnpaid: agentUnpaid,
    warrantyPending: getWarrantyBondPending(),
    bondPending: getBondPending(),
    payablePending: getPayablePending(),
    biddingProjects: listBids().filter((b) => b.result === "待开标"),
    implementingProjects: projects.filter((p) => p.stage === "实施" || p.stage === "验收"),
    alerts: buildAlerts(),
  };
}
