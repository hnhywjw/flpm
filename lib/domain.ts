/**
 * 领域常量与共用类型
 *
 * ⚠ 金额单位说明（重要，读代码前必看）
 *
 * 历史原因，数据库里所有 *_cents 字段实际存的**不是「分」，而是「元的 1/10000」**，
 * 也就是「1 万元 = 10000」这个刻度。
 *
 *   输入 88.5 (万元) → 存 885000 → 展示 885000 / 10000 = 88.50 万  ✅
 *
 * 读写两端一致（全系统 15 处写入用 * 10000，16 处读取用 / 10000），
 * 所以**业务数字是正确的**，只是字段命名有误导性。
 *
 * 为什么要保留这个刻度而不是改成真正的「分」：
 *   改成「分」（1 万元 = 1000000）需要迁移全库金额字段 + 改 30 多处换算，
 *   风险远大于收益。现有值自洽，改名比改值安全。
 *
 * 新写代码请遵循：金额统一用 wanToFen / fenToWan 换算，不要手写 10000。
 */

/** 换算常量：1 万元 = 10000（单位刻度，不是「分」） */
export const WAN = 10_000;

/**
 * 「元刻度」-> 万元字符串
 * @param fen 数据库 *_cents 字段的原值（元刻度的 1/10000）
 */
export function fenToWan(fen: number | null | undefined, digits = 2): string {
  if (fen === null || fen === undefined) return "—";
  return (fen / WAN).toFixed(digits);
}

/**
 * 万元 -> 数据库存储值
 * @param wan 万元金额，如 88.5
 */
export function wanToFen(wan: number | string): number {
  return Math.round(Number(wan) * WAN);
}

/** 金额格式化：￥1,234,567.89 */
export function fenToYuan(fen: number | null | undefined): string {
  if (fen === null || fen === undefined) return "—";
  return (fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------- 节点链 ----------------
/** 11 个标准节点。isParallel 表示并行节点，不参与主线通断 */
export const NODE_CHAIN = [
  { key: "招标", seq: 1, isParallel: false, desc: "招标文件、技术参数、预算来源" },
  { key: "投标", seq: 2, isParallel: false, desc: "参与投标方、报价留痕、保证金缴纳" },
  { key: "中标", seq: 3, isParallel: false, desc: "中标通知书 / 中标结果公示" },
  { key: "合同", seq: 4, isParallel: false, desc: "客户合同 + 采购合同，付款比例" },
  { key: "实施", seq: 5, isParallel: false, desc: "实施方案、进度、物资领用" },
  { key: "验收", seq: 6, isParallel: false, desc: "安装配置文档、到货签收、验收报告、项目资料" },
  { key: "开票", seq: 7, isParallel: false, desc: "全额开具 或 按付款比例开具" },
  { key: "回款", seq: 8, isParallel: false, desc: "首笔款及后续各期" },
  { key: "保证金返还", seq: 9, isParallel: true, desc: "投标保证金退回，与回款并行" },
  { key: "质保金", seq: 10, isParallel: false, desc: "尾款，质保期满收回" },
  { key: "售后", seq: 11, isParallel: false, desc: "服务期、工单、SLA" },
] as const;

export type NodeKey = (typeof NODE_CHAIN)[number]["key"];

/**
 * 节点 → 项目阶段映射
 * 推进节点时自动更新项目 stage，避免「投标阶段显示 80% 进度」这类矛盾
 */
export const NODE_TO_STAGE: Record<string, string> = {
  "招标": "投标",
  "投标": "投标",
  "中标": "投标",
  "合同": "合同",
  "实施": "实施",
  "验收": "验收",
  "开票": "回款",
  "回款": "回款",
  "保证金返还": "回款",
  "质保金": "质保",
  "售后": "售后",
};

/**
 * 计算项目进度（0-100）
 * 按主线节点的完成比例计算，不含并行节点
 */
export function calcProjectProgress(
  nodes: { node_key: string; status: string; is_parallel: number }[]
): number {
  const main = nodes.filter((n) => n.is_parallel === 0);
  if (main.length === 0) return 0;
  const done = main.filter((n) => n.status === "done" || n.status === "skip").length;
  return Math.round((done / main.length) * 100);
}
export type NodeStatus = "next" | "cur" | "done" | "late" | "skip";

export const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  next: "未开始",
  cur: "进行中",
  done: "已完成",
  late: "已超期",
  skip: "已跳过",
};

/** 验收四件套 —— 四项齐备才允许推进到「开票」 */
export const ACCEPTANCE_DOCS = [
  { key: "安装配置文档", required: true },
  { key: "到货签收单", required: true },
  { key: "验收报告", required: true },
  { key: "项目资料", required: true },
] as const;

export const ACCEPTANCE_DONE_STATUS = ["已提交", "已签收", "已出具", "已齐备"] as const;

// ---------------- 模式 ----------------
export type ProjectMode = "direct" | "agent";
export const MODE_LABEL: Record<ProjectMode, string> = {
  direct: "直接中标",
  agent: "代中标",
};

export type FeeMethod = "diff" | "cash";
export const FEE_METHOD_LABEL: Record<FeeMethod, string> = {
  diff: "差价法",
  cash: "现金 + 全额发票",
};

/** 过单费核算：diff = 客户合同额 − 开票额；cash = 客户合同额 × 费率 */
export function calcAgentFee(
  method: FeeMethod,
  customerAmountFen: number,
  invoicedAmountFen: number,
  feeRate?: number | null
): { fee: number; formula: string } {
  if (method === "diff") {
    const fee = customerAmountFen - invoicedAmountFen;
    return {
      fee,
      formula: `${fenToWan(customerAmountFen)} − ${fenToWan(invoicedAmountFen)} = ${fenToWan(fee)}`,
    };
  }
  const rate = feeRate ?? 0;
  const fee = Math.round(customerAmountFen * (rate / 100));
  return {
    fee,
    formula: `${fenToWan(customerAmountFen)} × ${rate.toFixed(2)}% = ${fenToWan(fee)}`,
  };
}

/**
 * 过单费率反推开票额（万元）。
 * 开票额 = 客户合同额 × (1 − 费率/100)。例：100 万、费率 6% → 94 万。
 * 费率未填、≤0 或 ≥100 时返回 null，避免把差价法手填的开票额覆盖掉。
 */
export function invoicedWanFromFeeRate(
  customerWan: number | string | boolean | null | undefined,
  feeRate: number | string | boolean | null | undefined
): number | null {
  if (typeof customerWan === "boolean" || typeof feeRate === "boolean") return null;
  if (customerWan === "" || customerWan == null || feeRate === "" || feeRate == null) return null;
  const customer = Number(customerWan);
  const rate = Number(feeRate);
  if (!Number.isFinite(customer) || !Number.isFinite(rate)) return null;
  if (customer < 0 || rate <= 0 || rate >= 100) return null;
  const invoicedFen = Math.round(wanToFen(customer) * (100 - rate) / 100);
  return Number((invoicedFen / WAN).toFixed(4));
}

/** 个人过单费付款凭证三件套是否齐备 */
export function isVoucherComplete(p: {
  doc_agreement?: string | null;
  doc_voucher?: string | null;
  doc_confirm?: string | null;
}): boolean {
  return Boolean(p.doc_agreement && p.doc_voucher && p.doc_confirm);
}

// ---------------- 开票 ----------------
export type InvoiceMode = "full" | "by_payment";
export const INVOICE_MODE_LABEL: Record<InvoiceMode, string> = {
  full: "全额一次性开具",
  by_payment: "按付款比例开具",
};

// ---------------- 合同 ----------------
export type ContractType = "customer" | "purchase" | "subcontract";
export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  customer: "客户合同",
  purchase: "采购合同",
  subcontract: "分包合同",
};

export type TermType = "advance" | "progress" | "acceptance" | "warranty" | "other";
export const TERM_TYPE_LABEL: Record<TermType, string> = {
  advance: "预付款",
  progress: "进度款",
  acceptance: "验收款",
  warranty: "质保金",
  other: "其他",
};

export type TermStatus = "未到期" | "待收回" | "部分回款" | "已回款" | "逾期未收";

/** 解析 "30/40/25/5" -> [30,40,25,5]；总和须为 100 */
export function parsePaySummary(summary: string): number[] {
  return summary
    .split("/")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
}

/**
 * 由付款比例自动生成回款计划
 * @param amountFen 合同总额（分）
 * @param summary  "30/40/25/5"
 * @param firstPlanDate 首期计划日期（YYYY-MM-DD），后续按 baseDays 顺延
 */
export function buildPaymentTerms(
  amountFen: number,
  summary: string,
  baseDays = 30
): { seq: number; name: string; termType: TermType; percent: number; amountFen: number }[] {
  const pcts = parsePaySummary(summary);
  const names: Record<number, { label: string; type: TermType }> = {
    0: { label: "首笔款", type: "advance" },
    1: { label: "进度款", type: "progress" },
  };
  return pcts.map((pct, i) => {
    const isLast = i === pcts.length - 1;
    const meta = isLast
      ? { label: "质保金", type: "warranty" as TermType }
      : names[i] ?? { label: `第 ${i + 1} 期`, type: "progress" as TermType };
    return {
      seq: i + 1,
      name: `${meta.label} ${pct}%`,
      termType: meta.type,
      percent: pct,
      // 最后一期用减法兜底，避免四舍五入导致合计不等于合同额
      amountFen: isLast
        ? amountFen - pcts.slice(0, -1).reduce((s, p) => s + Math.round(amountFen * (p / 100)), 0)
        : Math.round(amountFen * (pct / 100)),
    };
  });
}

/**
 * 逾期天数
 *
 * ★ 必须用 todayLocal() 而不是 toISOString()
 *
 * 原来用 today.toISOString().slice(0,10) 取「今天」，
 * 东八区凌晨 0-8 点会取到昨天，于是：
 *   · 逾期 1 天的账款被算成 0 天 → 不触发催收
 *   · 原本没逾期的被算成逾期（反向也成立）
 * 逾期提醒是整个财务催收的触发器，这里算错等于催收失效。
 *
 * 另外改成用 UTC 构造日期做差：避开夏令时导致的 23/25 小时偏差。
 */
export function overdueDays(planDate: string | null | undefined, today = new Date()): number {
  if (!planDate) return 0;
  const d = daysBetween(datePart(planDate), dateOnlyLocal(today));
  return d > 0 ? d : 0;
}

/** 距今天数（可为负，表示已过期） */
export function daysFromNow(date: string | null | undefined, today = new Date()): number {
  if (!date) return 0;
  return daysBetween(dateOnlyLocal(today), datePart(date));
}

/** 从任意 Date 取本地日期 YYYY-MM-DD */
function dateOnlyLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** 从 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm:ss" 里取出日期部分 */
function datePart(v: string): string {
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(v);
}

/** 两个日期字符串相差天数（b - a），用 UTC 构造避免时区/夏令时干扰 */
function daysBetween(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  if (pa.length < 3 || pb.length < 3 || pa.some(isNaN) || pb.some(isNaN)) return 0;
  const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((tb - ta) / 86400000);
}

// ---------------- 角色权限 ----------------
export type Role =
  | "boss"
  | "sales"
  | "finance"
  | "pm"
  | "warehouse"
  | "service"
  | "admin";

export const ROLE_LABEL: Record<Role, string> = {
  boss: "总经理",
  sales: "商务/销售",
  finance: "财务",
  pm: "项目经理",
  warehouse: "库管",
  service: "售后",
  admin: "系统管理员",
};

/** 角色说明（用于配置界面） */
export const ROLE_DESC: Record<Role, string> = {
  boss: "全公司数据 + 全部审批权限",
  sales: "商机、投标、合同、法务审核、行政用章",
  finance: "开票、回款、过单费、采购付款",
  pm: "项目实施、节点推进、验收资料、变更申请",
  warehouse: "出入库、库存、SN 台账（看不到金额）",
  service: "工单、质保、备件",
  admin: "系统配置、权限管理、日志（看不到金额）",
};

/** 内置角色默认菜单（数据库 roles.menus 覆盖此值） */
export const ROLE_MENUS: Record<Role, string[]> = {
  admin: ["dashboard", "projects", "bidding", "agent", "contracts", "finance", "changes", "inventory", "service", "approvals", "alerts", "settings", "logs", "system"],
  boss: ["dashboard", "projects", "bidding", "agent", "contracts", "finance", "changes", "inventory", "service", "approvals", "alerts", "settings", "logs", "reports", "system"],
  sales: ["dashboard", "projects", "bidding", "agent", "contracts", "changes", "approvals", "alerts"],
  finance: ["dashboard", "projects", "agent", "contracts", "finance", "changes", "approvals", "alerts", "reports"],
  warehouse: ["dashboard", "projects", "inventory", "alerts"],
  service: ["dashboard", "projects", "service", "inventory", "alerts"],
  pm: ["dashboard", "projects", "changes", "inventory", "approvals", "alerts"],
};

/** 全部可用菜单项（配置界面用） */
export const ALL_MENUS: { key: string; label: string }[] = [
  { key: "dashboard", label: "工作台" },
  { key: "projects", label: "项目管理" },
  { key: "bidding", label: "投标管理" },
  { key: "agent", label: "中标管理" },
  { key: "contracts", label: "合同管理" },
  { key: "finance", label: "开票与回款" },
  { key: "changes", label: "变更管理" },
  { key: "inventory", label: "出入库" },
  { key: "service", label: "售后服务" },
  { key: "approvals", label: "审批中心" },
  { key: "alerts", label: "待办预警" },
  { key: "reports", label: "报表分析" },
  { key: "logs", label: "操作日志" },
  { key: "settings", label: "基础数据" },
  { key: "system", label: "系统管理" },
];

/** 是否可见金额（数据库 roles.can_see_amount 覆盖此值） */
export function canSeeAmount(role: Role): boolean {
  return role !== "admin" && role !== "warehouse";
}

/**
 * 法务/行政职责并入商务：
 * - 合同会签原「法务审核」步骤改由商务承担
 * - 用章、资质证照由商务承担
 */
export const ROLE_MERGED_NOTE: Record<string, string> = {
  legal: "法务职责已并入「商务/销售」，合同会签的法务审核步骤由商务承担",
  executive: "行政职责已并入「商务/销售」，用章与资质证照由商务承担",
};

/** 是否可审批过单费 */
export function canApproveAgentFee(role: Role): boolean {
  return role === "finance" || role === "boss";
}

// ---------------- 编码规则 ----------------
export const CODE_PREFIX = {
  project: "P",
  bid: "B",
  customerContract: "HT",
  purchaseContract: "CG",
  agent: "DZ",
  ticket: "WO",
  stockIn: "RK",
  stockOut: "CK",
  warranty: "QB",
} as const;

export function formatCode(prefix: string, year: number, seq: number, pad = 3): string {
  if (prefix === CODE_PREFIX.customerContract || prefix === CODE_PREFIX.purchaseContract) {
    return `${prefix}${year}-${String(seq).padStart(4, "0")}`;
  }
  return `${prefix}${year}-${String(seq).padStart(pad, "0")}`;
}

// ---------------- 变更管理 ----------------
export type ChangeType = "scope" | "schedule" | "amount" | "tech" | "other";
export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  scope: "范围变更",
  schedule: "工期变更",
  amount: "金额变更",
  tech: "技术变更",
  other: "其他",
};

export type ChangeStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled";
export const CHANGE_STATUS_LABEL: Record<ChangeStatus, string> = {
  draft: "草稿",
  pending: "审批中",
  approved: "已批准",
  rejected: "已驳回",
  cancelled: "已撤回",
};

// ---------------- 风险台账 ----------------
export type RiskLevel = "高" | "中" | "低";
export const RISK_LEVEL_TONE: Record<string, string> = {
  高: "bad",
  中: "warn",
  低: "info",
};

export type RiskStatus = "open" | "monitoring" | "closed";
export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  open: "待处理",
  monitoring: "观察中",
  closed: "已关闭",
};

/** 金额影响展示（分 -> 带符号的万元） */
export function changeAmountText(cents: number): string {
  if (!cents) return "—";
  const wan = cents / 10000;
  return (wan > 0 ? "+" : "") + wan.toFixed(2) + " 万";
}

