-- ============================================================
-- 迁移 011：验证码一次性消耗
-- 防止同一验证码被重放使用
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS captcha_used (
  token_hash TEXT PRIMARY KEY,
  used_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_captcha_used_at ON captcha_used(used_at);
