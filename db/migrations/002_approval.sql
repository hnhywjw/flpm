-- ============================================================
-- 迁移 002：审批流引擎
-- 幂等写法
-- ============================================================

-- 审批实例
CREATE TABLE IF NOT EXISTS approval_instances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL,              -- AP2026-0001
  biz_type      TEXT NOT NULL,              -- contract/agent_agreement/payment/stock_move/project_change/... 
  biz_id        INTEGER,
  biz_title     TEXT,
  template_key  TEXT NOT NULL,              -- 见 lib/approval.ts TEMPLATES
  status        TEXT NOT NULL DEFAULT 'pending', -- pending/approved/rejected/cancelled
  current_step  INTEGER NOT NULL DEFAULT 1,
  total_steps   INTEGER NOT NULL,
  applicant_id  INTEGER REFERENCES users(id),
  applicant_name TEXT,
  amount_cents  INTEGER,
  summary       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_appr_biz ON approval_instances(biz_type, biz_id);
CREATE INDEX IF NOT EXISTS idx_appr_status ON approval_instances(status);

-- 审批步骤
CREATE TABLE IF NOT EXISTS approval_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id   INTEGER NOT NULL REFERENCES approval_instances(id) ON DELETE CASCADE,
  step_no       INTEGER NOT NULL,
  role_required TEXT,                       -- 需要的角色（任一即可）
  approver_id   INTEGER REFERENCES users(id),
  approver_name TEXT,
  action        TEXT DEFAULT 'pending',     -- pending/approved/rejected
  comment       TEXT,
  acted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_steps_instance ON approval_steps(instance_id, step_no);
CREATE INDEX IF NOT EXISTS idx_steps_pending ON approval_steps(action);
