-- ============================================================
-- 迁移 006：消息通知
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL DEFAULT 'web',   -- web/dingtalk/wecom/webhook
  category      TEXT NOT NULL,                 -- approval/node/payment/bid/warranty/stock/role
  title         TEXT NOT NULL,
  content       TEXT,
  link          TEXT,                          -- 站内跳转路径
  level         TEXT DEFAULT 'info',           -- info/warn/bad
  is_read       INTEGER NOT NULL DEFAULT 0,
  sent_status   TEXT DEFAULT 'pending',        -- pending/sent/failed/skipped
  sent_at       TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at);

-- 推送配置（存数据库，可在界面配置）
CREATE TABLE IF NOT EXISTS notify_config (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
