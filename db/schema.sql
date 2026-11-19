-- ============================================================
-- ProjectFlow — Full Lifecycle Project Management
-- SQLite Schema
-- 金额统一以「分」存 INTEGER，避免浮点误差；界面按万元展示
-- ============================================================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------- 组织与人员 ----------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  role          TEXT    NOT NULL,          -- admin/boss/sales/finance/warehouse/service/pm/legal/executive
  dept          TEXT,
  phone         TEXT,
  email         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL UNIQUE,
  short_name    TEXT,
  contact       TEXT,
  phone         TEXT,
  address       TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- 项目 ----------
-- mode: direct 直接中标 / agent 代中标（找公司代投标）
CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,   -- P2025-018
  name          TEXT    NOT NULL,
  customer_id   INTEGER REFERENCES customers(id),
  project_type  TEXT,                      -- 系统集成/工程实施/货物+服务/运维服务
  mode          TEXT    NOT NULL DEFAULT 'direct' CHECK (mode IN ('direct','agent')),
  stage         TEXT    NOT NULL DEFAULT '投标',  -- 当前主阶段（冗余，便于列表筛选）
  status        TEXT    NOT NULL DEFAULT '进行中',
  owner_id      INTEGER REFERENCES users(id),
  budget_cents  INTEGER,                   -- 中标前为预算，中标后以合同为准
  start_date    TEXT,
  plan_due      TEXT,
  actual_due    TEXT,
  progress      INTEGER NOT NULL DEFAULT 0,
  remark        TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);

-- ---------- 流程节点（11 节点）----------
-- node_key 见 lib/domain.ts NODE_CHAIN
-- is_parallel=1 表示并行节点（投标保证金返还），不参与主线通断
CREATE TABLE IF NOT EXISTS project_nodes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_key      TEXT    NOT NULL,
  seq           INTEGER NOT NULL,
  is_parallel   INTEGER NOT NULL DEFAULT 0,
  owner_id      INTEGER REFERENCES users(id),
  plan_date     TEXT,
  actual_date   TEXT,
  status        TEXT    NOT NULL DEFAULT 'next' CHECK (status IN ('next','cur','done','late','skip')),
  require_files TEXT,                       -- 该节点必须齐备的佐证类型（JSON 数组）
  note          TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (project_id, node_key)
);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON project_nodes(project_id, seq);

-- ---------- 投标 ----------
CREATE TABLE IF NOT EXISTS bids (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,     -- B2026-034
  project_id      INTEGER REFERENCES projects(id),  -- 中标后可回填
  name            TEXT NOT NULL,
  customer_id     INTEGER REFERENCES customers(id),
  budget_cents    INTEGER,
  bond_cents      INTEGER,                  -- 投标保证金
  bond_status     TEXT DEFAULT '未缴',       -- 未缴/已缴/已退/不退
  bond_paid_date  TEXT,
  bond_back_date  TEXT,
  deadline        TEXT,
  open_date       TEXT,
  owner_id        INTEGER REFERENCES users(id),
  phase           TEXT,                     -- 立项评审/购买标书/编标中/技术方案/待递交/已开标/已中标/已废标
  result          TEXT DEFAULT '待开标',      -- 待开标/中标/未中标/废标
  fail_reason     TEXT,
  win_amount_cents INTEGER,
  mode            TEXT NOT NULL DEFAULT 'direct' CHECK (mode IN ('direct','agent')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_bids_deadline ON bids(deadline);

-- 参与投标方留痕：只记录事实与关联标注，用于审计与合规提示
CREATE TABLE IF NOT EXISTS bid_participants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_id        INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  company_name  TEXT    NOT NULL,
  is_self       INTEGER NOT NULL DEFAULT 0,
  price_cents   INTEGER,                    -- 开标后回填；开标前为空
  relation      TEXT    NOT NULL DEFAULT '未知',  -- 本方/未知/已核查无关联/关联风险
  risk_note     TEXT,                       -- 关联风险说明（股东/法人/经办人重合等）
  status        TEXT    DEFAULT '未知',      -- 编标中/待递交/已递交/未中标/中标/废标/未知
  checked_by    INTEGER REFERENCES users(id),
  checked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_parts_bid ON bid_participants(bid_id);

CREATE TABLE IF NOT EXISTS bid_tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_id        INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  title         TEXT    NOT NULL,
  owner_id      INTEGER REFERENCES users(id),
  due_date      TEXT,
  status        TEXT    DEFAULT '未开始',    -- 未开始/进行中/已完成/风险/待办
  seq           INTEGER DEFAULT 0
);

-- ---------- 合同（客户合同 1:N，采购合同独立）----------
-- type: customer 客户合同 / purchase 采购合同 / subcontract 分包合同
-- invoice_mode: full 全额一次性 / by_payment 按付款比例
CREATE TABLE IF NOT EXISTS contracts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,     -- HT2025-0212 / CG2026-0031
  project_id      INTEGER REFERENCES projects(id),
  type            TEXT NOT NULL DEFAULT 'customer' CHECK (type IN ('customer','purchase','subcontract')),
  party_name      TEXT NOT NULL,            -- 客户名 或 供应商名
  title           TEXT,
  amount_cents    INTEGER NOT NULL,
  sign_date       TEXT,
  warranty_months INTEGER,
  invoice_mode    TEXT DEFAULT 'by_payment' CHECK (invoice_mode IN ('full','by_payment')),
  tax_rate        TEXT,                     -- 13% / 6% / 9% / 0%
  pay_summary     TEXT,                     -- '30/40/25/5' 便于列表展示
  standard        TEXT,                     -- 验收标准
  breach_clause   TEXT,                     -- 违约条款
  status          TEXT DEFAULT '执行中',
  owner_id        INTEGER REFERENCES users(id),
  file_path       TEXT,
  remark          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id, type);

-- 付款条款 -> 自动生成回款/付款计划
CREATE TABLE IF NOT EXISTS payment_terms (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id     INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  name            TEXT    NOT NULL,          -- 首笔款 30% / 到货款 40% / 验收款 25% / 质保金 5%
  term_type       TEXT    NOT NULL DEFAULT 'progress', -- advance/progress/acceptance/warranty/other
  percent         REAL,                      -- 30 表示 30%
  amount_cents    INTEGER NOT NULL,
  plan_date       TEXT,
  actual_cents    INTEGER NOT NULL DEFAULT 0,
  actual_date     TEXT,
  status          TEXT DEFAULT '未到期',      -- 未到期/待收回/部分回款/已回款/逾期未收
  remark          TEXT,
  UNIQUE (contract_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_terms_contract ON payment_terms(contract_id, seq);
CREATE INDEX IF NOT EXISTS idx_terms_plan ON payment_terms(plan_date);

CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id   INTEGER REFERENCES contracts(id),
  project_id    INTEGER REFERENCES projects(id),
  invoice_no    TEXT,
  amount_cents  INTEGER NOT NULL,
  tax_rate      TEXT,
  invoice_type  TEXT DEFAULT '增值税专用发票',
  basis         TEXT,                        -- 全额开具 / 按付款比例
  term_id       INTEGER REFERENCES payment_terms(id), -- 按比例开具时关联具体期次
  issue_date    TEXT,
  status        TEXT DEFAULT '已开票',        -- 待开票/已开票/已红冲
  remark        TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);

-- ---------- 验收资料四件套 ----------
CREATE TABLE IF NOT EXISTS acceptances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_type      TEXT    NOT NULL,            -- 安装配置文档/到货签收单/验收报告/项目资料
  status        TEXT    DEFAULT '待提交',     -- 待提交/已提交/已签收/已出具/待签字/缺项/已齐备
  submit_date   TEXT,
  owner_id      INTEGER REFERENCES users(id),
  file_path     TEXT,
  note          TEXT,
  UNIQUE (project_id, doc_type)
);

-- ---------- 代中标协议与过单费 ----------
-- party_type: company 公司 / individual 个人（个人不开票，凭证是唯一凭据）
-- fee_method: diff 差价法 / cash 现金+全额发票
CREATE TABLE IF NOT EXISTS agent_agreements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,  -- DZ2025-004
  project_id          INTEGER REFERENCES projects(id),
  agreement_with      TEXT NOT NULL,          -- 中标公司 或 个人姓名
  party_type          TEXT NOT NULL DEFAULT 'company' CHECK (party_type IN ('company','individual')),
  fee_method          TEXT NOT NULL CHECK (fee_method IN ('diff','cash')),
  fee_rate            REAL,                   -- cash 方式下的费率，如 6.00
  customer_amount_cents INTEGER NOT NULL,     -- 客户合同额（多份客户合同则为其合计）
  invoiced_amount_cents INTEGER NOT NULL DEFAULT 0, -- 中标公司/我方开票额
  fee_cents           INTEGER NOT NULL,       -- 过单费
  fee_formula         TEXT,                   -- 核算过程文字留痕
  agree_date          TEXT,
  status              TEXT DEFAULT '执行中',
  owner_id            INTEGER REFERENCES users(id),
  note                TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 过单费支付记录：对方不开票，必须留三件套凭证
CREATE TABLE IF NOT EXISTS agent_fee_payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agreement_id    INTEGER NOT NULL REFERENCES agent_agreements(id) ON DELETE CASCADE,
  amount_cents    INTEGER NOT NULL,
  pay_date        TEXT,
  pay_method      TEXT DEFAULT '现金',        -- 现金/转账/其他
  payee_name      TEXT,                       -- 收款人真实姓名
  payee_id_tail   TEXT,                       -- 身份证后四位（脱敏校验用，不存全号）
  payee_phone     TEXT,
  voucher_no      TEXT,                       -- 收款凭证/收据编号
  -- 三件套（缺一不可）
  doc_agreement   TEXT,                       -- 代中标协议扫描件
  doc_voucher     TEXT,                       -- 付款凭证（银行回单/现金签收单）
  doc_confirm     TEXT,                       -- 收款确认单（对方签字）
  docs_complete   INTEGER NOT NULL DEFAULT 0, -- 三件套是否齐备
  paid_by         INTEGER REFERENCES users(id),
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TEXT,
  remark          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_feepay_agreement ON agent_fee_payments(agreement_id);

-- ---------- 物料与出入库 ----------
CREATE TABLE IF NOT EXISTS warehouses (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  keeper_id INTEGER REFERENCES users(id),
  address TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  spec        TEXT,
  unit        TEXT DEFAULT '台',
  category    TEXT,
  safe_stock  INTEGER DEFAULT 0,
  track_sn    INTEGER NOT NULL DEFAULT 0,   -- 是否记录序列号
  price_cents INTEGER,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stock (
  item_id       INTEGER NOT NULL REFERENCES items(id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  qty           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, warehouse_id)
);

-- 出入库单：必须关联来源与去向（采购合同/项目/工单）
CREATE TABLE IF NOT EXISTS stock_moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,       -- RK/CK2026-0912
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  item_id       INTEGER NOT NULL REFERENCES items(id),
  qty           INTEGER NOT NULL,
  warehouse_id  INTEGER REFERENCES warehouses(id),
  source_type   TEXT,                       -- contract_purchase/project/ticket/other
  source_id     INTEGER,
  source_text   TEXT,                       -- 展示用：采购订单 CG2026-0031 / P2025-018 领用
  target_text   TEXT,
  project_id    INTEGER REFERENCES projects(id),
  move_date     TEXT,
  operator_id   INTEGER REFERENCES users(id),
  status        TEXT DEFAULT '已入库',       -- 已入库/已出库/部分到货/待审批
  remark        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_moves_project ON stock_moves(project_id);
CREATE INDEX IF NOT EXISTS idx_moves_date ON stock_moves(move_date);

-- 设备序列号台账（售后查保修的关键）
CREATE TABLE IF NOT EXISTS item_serials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  sn            TEXT NOT NULL,
  move_in_id    INTEGER REFERENCES stock_moves(id),
  move_out_id   INTEGER REFERENCES stock_moves(id),
  project_id    INTEGER REFERENCES projects(id),
  status        TEXT DEFAULT '在库',         -- 在库/已出库/已安装/已报废
  installed_at  TEXT,
  UNIQUE (item_id, sn)
);

-- ---------- 售后 ----------
CREATE TABLE IF NOT EXISTS tickets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,       -- WO2026-0876
  project_id    INTEGER REFERENCES projects(id),
  customer_id   INTEGER REFERENCES customers(id),
  title         TEXT NOT NULL,
  level         TEXT DEFAULT '一般',         -- 严重/一般/咨询
  sla_hours     INTEGER,
  reported_at   TEXT,
  responded_at  TEXT,
  resolved_at   TEXT,
  owner_id      INTEGER REFERENCES users(id),
  status        TEXT DEFAULT '待响应',       -- 待响应/处理中/待备件/已解决/已关闭/超时升级
  sn_list       TEXT,
  is_warranty   INTEGER DEFAULT 1,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS warranties (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,       -- QB-2024-0455
  project_id    INTEGER REFERENCES projects(id),
  contract_id   INTEGER REFERENCES contracts(id),
  start_date    TEXT,
  end_date      TEXT,
  bond_cents    INTEGER,                    -- 质保金
  bond_status   TEXT DEFAULT '待收回',       -- 待收回/已收回/已逾期
  bond_back_date TEXT,
  note          TEXT
);

-- ---------- 附件（通用）----------
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL,              -- project/node/bid/contract/term/acceptance/agent_payment/ticket
  entity_id     INTEGER NOT NULL,
  file_name     TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_size     INTEGER,
  mime_type     TEXT,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  remark        TEXT
);
CREATE INDEX IF NOT EXISTS idx_att_entity ON attachments(entity_type, entity_id);

-- ---------- 审计日志 ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  user_name     TEXT,
  action        TEXT NOT NULL,              -- create/update/delete/approve/pay/advance
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER,
  field         TEXT,
  old_value     TEXT,
  new_value     TEXT,
  summary       TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ---------- 编码序列 ----------
CREATE TABLE IF NOT EXISTS code_sequences (
  prefix        TEXT NOT NULL,
  year          INTEGER NOT NULL,
  seq           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
);
