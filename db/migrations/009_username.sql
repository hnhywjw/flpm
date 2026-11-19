-- ============================================================
-- 迁移 009：用户名登录
-- users.username 唯一，登录用 username，展示仍用 name
-- ============================================================
PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN username TEXT;

-- 存量用户：用户名初始化为姓名（后续可改）
UPDATE users SET username = name WHERE username IS NULL;

-- 唯一索引（允许 NULL 但业务上会强制填充）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 记录一次用户名变更历史（审计用）
CREATE TABLE IF NOT EXISTS username_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  old_name   TEXT,
  new_name   TEXT NOT NULL,
  changed_by INTEGER,
  changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
