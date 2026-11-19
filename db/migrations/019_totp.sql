-- ============================================================
-- 迁移 019：令牌认证（TOTP 两步验证）
-- ============================================================
PRAGMA foreign_keys = ON;

-- TOTP 密钥（base32），未启用时为空
ALTER TABLE users ADD COLUMN totp_secret TEXT;

-- 是否启用令牌认证：0 未启用 / 1 已启用
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

-- 恢复码（JSON 数组，每个码只能用一次，用后置为已用）
ALTER TABLE users ADD COLUMN totp_recovery TEXT;

-- 绑定时间
ALTER TABLE users ADD COLUMN totp_bound_at TEXT;

-- 最近一次使用令牌的时间（防重放）
ALTER TABLE users ADD COLUMN totp_last_used TEXT;

CREATE INDEX IF NOT EXISTS idx_users_totp ON users(totp_enabled);
