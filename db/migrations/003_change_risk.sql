-- ============================================================
-- 迁移 003：变更管理（CR）+ 风险台账
-- 幂等写法
-- ============================================================

CREATE TABLE IF NOT EXISTS change_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL,             -- CR2026-0001
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  change_type     TEXT NOT NULL DEFAULT 'other', -- scope/schedule/amount/tech/other
  reason          TEXT,                      -- 变更原因
  impact          TEXT,                      -- 影响分析
  amount_delta_cents INTEGER DEFAULT 0,      -- 金额增减（正=加，负=减）
  days_delta      INTEGER DEFAULT 0,         -- 工期增减（天）
  status          TEXT NOT NULL DEFAULT 'draft', -- draft/pending/approved/rejected/cancelled
  applicant_id    INTEGER REFERENCES users(id),
  applicant_name  TEXT,
  approval_id     INTEGER REFERENCES approval_instances(id),
  customer_confirmed INTEGER DEFAULT 0,      -- 客户是否签字确认
  confirm_date    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_cr_project ON change_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_cr_status ON change_requests(status);

CREATE TABLE IF NOT EXISTS risk_register (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL,             -- RK2026-0001
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  category        TEXT DEFAULT 'other',      -- schedule/quality/cost/supplier/customer/other
  level           TEXT NOT NULL DEFAULT '中', -- 高/中/低
  probability     TEXT DEFAULT '中',          -- 高/中/低
  impact_desc     TEXT,                       -- 影响描述
  response        TEXT,                       -- 应对措施
  owner_id        INTEGER REFERENCES users(id),
  owner_name      TEXT,
  status          TEXT NOT NULL DEFAULT 'open', -- open/monitoring/closed
  due_date        TEXT,
  closed_at       TEXT,
  close_note      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_risk_project ON risk_register(project_id);
CREATE INDEX IF NOT EXISTS idx_risk_status ON risk_register(status);
