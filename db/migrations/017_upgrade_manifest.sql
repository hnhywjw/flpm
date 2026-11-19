-- ============================================================
-- 迁移 017：升级包清单与校验结果
-- ============================================================
PRAGMA foreign_keys = ON;

ALTER TABLE upgrade_packages ADD COLUMN manifest TEXT;
ALTER TABLE upgrade_packages ADD COLUMN verify_ok INTEGER DEFAULT 0;
ALTER TABLE upgrade_packages ADD COLUMN verify_errors TEXT;
ALTER TABLE upgrade_packages ADD COLUMN applied_at TEXT;
ALTER TABLE upgrade_packages ADD COLUMN rollback_to TEXT;
