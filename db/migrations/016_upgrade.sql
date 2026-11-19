-- ============================================================
-- 迁移 016：离线升级包
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS upgrade_packages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  version     TEXT,
  sha256      TEXT,
  status      TEXT NOT NULL DEFAULT 'uploaded',  -- uploaded / applied / failed
  note        TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_upgrade_created ON upgrade_packages(created_at DESC);
