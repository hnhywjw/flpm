-- ============================================================
-- 迁移 008：开票状态 + 定时任务 + 备份记录
-- ============================================================
PRAGMA foreign_keys = ON;

-- 回款期次上增加开票维度（与回款状态并列，互不干扰）
ALTER TABLE payment_terms ADD COLUMN invoiced_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_terms ADD COLUMN invoice_date TEXT;

-- 定时任务执行记录（避免重复推送）
CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key     TEXT NOT NULL,
  run_date    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ok',   -- ok / failed
  detail      TEXT,
  items_sent  INTEGER DEFAULT 0,
  error       TEXT,
  started_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_key ON job_runs(job_key, run_date);

-- 推送去重：同一天同一业务对象同一类型只推一次
CREATE TABLE IF NOT EXISTS notify_sent_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key  TEXT NOT NULL UNIQUE,
  category    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 通用键值配置（存定时任务开关、备份周期等）
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 备份记录
CREATE TABLE IF NOT EXISTS backup_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name  TEXT NOT NULL,
  file_size  INTEGER,
  status     TEXT DEFAULT 'ok',
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 乐观锁：给主要业务表加版本号
ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contracts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bids ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_terms ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- 索引优化（审计发现的性能隐患）
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_contracts_deleted ON contracts(deleted_at);
CREATE INDEX IF NOT EXISTS idx_terms_deleted ON payment_terms(deleted_at);
CREATE INDEX IF NOT EXISTS idx_tickets_deleted ON tickets(deleted_at);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);
