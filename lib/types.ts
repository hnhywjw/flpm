import type { NodeStatus, ProjectMode, FeeMethod, InvoiceMode, ContractType, TermType, Role } from "./domain";

export interface User {
  id: number;
  name: string;
  role: Role;
  dept: string | null;
  phone: string | null;
  active: number;
}

export interface Customer {
  id: number;
  name: string;
  short_name: string | null;
  contact: string | null;
  phone: string | null;
  address: string | null;
}

export interface Project {
  id: number;
  code: string;
  name: string;
  customer_id: number | null;
  customer_name?: string;
  project_type: string | null;
  mode: ProjectMode;
  stage: string;
  status: string;
  owner_id: number | null;
  owner_name?: string;
  winner_name?: string | null;
  budget_cents: number | null;
  start_date: string | null;
  plan_due: string | null;
  actual_due: string | null;
  progress: number;
  remark: string | null;
  created_at: string;
  updated_at: string;
  /** 乐观锁版本号 */
  version?: number;

  // ---- P1 新增 ----
  /** 合同编号：立项后签的合同号，和合同模块对账用 */
  contract_no: string | null;
  /** 项目实施地点：派工、售后需要 */
  site_address: string | null;
}

export interface ProjectNode {
  id: number;
  project_id: number;
  node_key: string;
  seq: number;
  is_parallel: number;
  owner_id: number | null;
  owner_name?: string;
  plan_date: string | null;
  actual_date: string | null;
  status: NodeStatus;
  require_files: string | null;
  note: string | null;
  updated_at: string;
  /** 中标通知书编号 */
  win_notice_no?: string | null;
  /** 中标金额（分） */
  win_amount_cents?: number | null;
  /** 中标日期 */
  win_date?: string | null;
  /** 实施方案说明 */
  impl_plan?: string | null;
  /** 进度说明 */
  progress_note?: string | null;
}

export interface Bid {
  id: number;
  code: string;
  project_id: number | null;
  name: string;
  customer_id: number | null;
  customer_name?: string;
  budget_cents: number | null;
  bond_cents: number | null;
  bond_status: string;
  bond_paid_date: string | null;
  bond_back_date: string | null;
  deadline: string | null;
  open_date: string | null;
  owner_id: number | null;
  owner_name?: string;
  phase: string | null;
  result: string;
  fail_reason: string | null;
  win_amount_cents: number | null;
  mode: ProjectMode;
  created_at: string;
  /** 乐观锁版本号 */
  version?: number;

  // ---- P1 新增 ----
  /** 招标文件上的编号（和系统内部 code 不同） */
  bid_no: string | null;
  /** 招标代理机构 */
  agent_company: string | null;
  /** 公开招标 / 邀请招标 / 竞争性谈判 / 单一来源 */
  bid_method: string | null;
  /** 开标地点 */
  bid_open_place: string | null;
  /** 现场踏勘日期 */
  site_visit_date: string | null;
  /** 答疑截止 */
  qa_deadline: string | null;
  /** 标书费（元刻度） */
  doc_price_cents: number | null;
  /** 保证金退还金额（元刻度） */
  bond_back_cents: number | null;

  // ---- 与项目管理打通（project_id 已在上面声明，这里只补展示字段）----
  /** 关联项目编号，如 P2026-034 */
  project_code?: string | null;
  /** 关联项目名称 */
  project_name?: string | null;
}

export interface BidParticipant {
  id: number;
  bid_id: number;
  company_name: string;
  is_self: number;
  price_cents: number | null;
  relation: string;
  risk_note: string | null;
  status: string | null;
  checked_by: number | null;
  checked_by_name?: string;
  checked_at: string | null;
  /** 该参与方缴纳的投标保证金（元刻度，1 万 = 10000） */
  bond_cents: number | null;
  /** 未缴 / 已缴 / 已退 / 不退 */
  bond_status: string | null;
  /** 该参与方自己的开标结果：待开标 / 中标 / 未中标 / 废标 */
  result: string | null;
  /** 标书编制人（出问题能找到人） */
  preparer: string | null;
  /** 联系人（陪标方对接用） */
  contact_person: string | null;
  /** 联系电话 */
  contact_phone: string | null;
  /** 资质情况：是否满足招标要求的资质等级 */
  qualification: string | null;
  /** 评标排名（得分拿不到，不做记录） */
  rank: number | null;
  updated_at: string | null;
}

export interface BidTask {
  id: number;
  bid_id: number;
  title: string;
  owner_id: number | null;
  owner_name?: string;
  due_date: string | null;
  status: string | null;
  seq: number;
}

export interface Contract {
  id: number;
  code: string;
  project_id: number | null;
  project_name?: string;
  type: ContractType;
  party_name: string;
  title: string | null;
  amount_cents: number;
  sign_date: string | null;
  warranty_months: number | null;
  invoice_mode: InvoiceMode;
  tax_rate: string | null;
  pay_summary: string | null;
  standard: string | null;
  breach_clause: string | null;
  status: string | null;
  owner_id: number | null;
  file_path: string | null;
  remark: string | null;
  /** 乐观锁版本号 */
  version?: number;
}

export interface PaymentTerm {
  id: number;
  contract_id: number;
  seq: number;
  name: string;
  term_type: TermType;
  percent: number | null;
  amount_cents: number;
  plan_date: string | null;
  actual_cents: number;
  actual_date: string | null;
  status: string;
  remark: string | null;
  /** 已开票金额（分），与回款状态并列 */
  invoiced_cents?: number;
  invoice_date?: string | null;
  /** 运行时计算：逾期天数 */
  overdue?: number;
}

export interface Invoice {
  id: number;
  contract_id: number | null;
  project_id: number | null;
  invoice_no: string | null;
  amount_cents: number;
  tax_rate: string | null;
  invoice_type: string | null;
  basis: string | null;
  term_id: number | null;
  issue_date: string | null;
  status: string;
  remark: string | null;
}

export interface Acceptance {
  id: number;
  project_id: number;
  doc_type: string;
  status: string;
  submit_date: string | null;
  owner_id: number | null;
  owner_name?: string;
  file_path: string | null;
  note: string | null;
}

export interface AgentAgreement {
  id: number;
  code: string;
  project_id: number | null;
  project_name?: string;
  agreement_with: string;
  party_type: "company" | "individual";
  fee_method: FeeMethod;
  fee_rate: number | null;
  customer_amount_cents: number;
  invoiced_amount_cents: number;
  fee_cents: number;
  fee_formula: string | null;
  agree_date: string | null;
  status: string | null;
  owner_id: number | null;
  note: string | null;
  /** 运行时汇总 */
  paid_cents?: number;
  unpaid_cents?: number;
}

export interface AgentFeePayment {
  id: number;
  agreement_id: number;
  amount_cents: number;
  pay_date: string | null;
  pay_method: string | null;
  payee_name: string | null;
  payee_id_tail: string | null;
  payee_phone: string | null;
  voucher_no: string | null;
  doc_agreement: string | null;
  doc_voucher: string | null;
  doc_confirm: string | null;
  docs_complete: number;
  paid_by: number | null;
  paid_by_name?: string;
  approved_by: number | null;
  approved_by_name?: string;
  approved_at: string | null;
  remark: string | null;
  created_at: string;
}

export interface Warehouse {
  id: number;
  name: string;
  keeper_id: number | null;
  address: string | null;
}

export interface Item {
  id: number;
  sku: string;
  name: string;
  spec: string | null;
  unit: string;
  category: string | null;
  safe_stock: number;
  track_sn: number;
  price_cents: number | null;
  active: number;
}

export interface Stock {
  item_id: number;
  warehouse_id: number;
  qty: number;
  sku?: string;
  item_name?: string;
  warehouse_name?: string;
  safe_stock?: number;
  unit?: string;
}

export interface StockMove {
  id: number;
  code: string;
  direction: "in" | "out";
  item_id: number;
  item_name?: string;
  sku?: string;
  qty: number;
  warehouse_id: number | null;
  warehouse_name?: string;
  source_type: string | null;
  source_id: number | null;
  source_text: string | null;
  target_text: string | null;
  project_id: number | null;
  project_code?: string;
  move_date: string | null;
  operator_id: number | null;
  operator_name?: string;
  status: string;
  remark: string | null;
  created_at: string;
}

export interface ItemSerial {
  id: number;
  item_id: number;
  sn: string;
  move_in_id: number | null;
  move_out_id: number | null;
  project_id: number | null;
  status: string;
  installed_at: string | null;
}

export interface Ticket {
  id: number;
  code: string;
  project_id: number | null;
  project_name?: string;
  customer_id: number | null;
  customer_name?: string;
  title: string;
  level: string;
  sla_hours: number | null;
  reported_at: string | null;
  responded_at: string | null;
  resolved_at: string | null;
  owner_id: number | null;
  owner_name?: string;
  status: string;
  sn_list: string | null;
  is_warranty: number;
  note: string | null;
}

export interface Warranty {
  id: number;
  code: string;
  project_id: number | null;
  project_name?: string;
  contract_id: number | null;
  start_date: string | null;
  end_date: string | null;
  bond_cents: number | null;
  bond_status: string;
  bond_back_date: string | null;
  note: string | null;
}

export interface Attachment {
  id: number;
  entity_type: string;
  entity_id: number;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: number | null;
  uploaded_by_name?: string;
  uploaded_at: string;
  remark: string | null;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  summary: string | null;
  ip: string | null;
  created_at: string;
}

/** 首页看板聚合 */
export interface DashboardData {
  contractTotal: number;
  receivedTotal: number;
  overdueTotal: number;
  overdueCount: number;
  biddingCount: number;
  implementingCount: number;
  feeUnpaid: number;
  warrantyPending: number;
  bondPending: number;
  payablePending: number;
  biddingProjects: Bid[];
  implementingProjects: Project[];
  alerts: AlertItem[];
}

export interface AlertItem {
  kind: string;
  level: "bad" | "warn" | "info";
  title: string;
  detail: string;
  entityType?: string;
  entityId?: number;
  action?: string;
}
