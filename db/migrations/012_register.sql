-- ============================================================
-- 迁移 012：注册待审批
-- ============================================================
PRAGMA foreign_keys = ON;

-- 注册申请状态：pending（待审）/ approved（已通过）/ rejected（已拒绝）
ALTER TABLE users ADD COLUMN reg_status TEXT DEFAULT 'approved';
ALTER TABLE users ADD COLUMN reg_note TEXT;
ALTER TABLE users ADD COLUMN reg_at TEXT;
ALTER TABLE users ADD COLUMN reviewed_by INTEGER;
ALTER TABLE users ADD COLUMN reviewed_at TEXT;

-- 存量用户都是已启用状态
UPDATE users SET reg_status = 'approved' WHERE reg_status IS NULL;

-- 新注册用户默认 active=0，等审批
CREATE INDEX IF NOT EXISTS idx_users_reg_status ON users(reg_status);
