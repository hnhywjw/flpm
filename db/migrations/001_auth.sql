-- ============================================================
-- 迁移 001：用户认证
-- 幂等写法，可重复执行
-- ============================================================
PRAGMA foreign_keys = ON;

-- 密码哈希（scrypt）与安全字段
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN must_change_pwd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,          -- 随机 token
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at    TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  last_seen_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
