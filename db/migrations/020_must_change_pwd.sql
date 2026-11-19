-- ============================================================
-- 迁移 020：首次登录强制改密
-- ============================================================
-- 标记用户必须修改密码（密码泄露 / 初始化账号 / 管理员重置后）
ALTER TABLE users ADD COLUMN must_change_pwd INTEGER NOT NULL DEFAULT 0;

-- 已有账号如果还在用默认密码，标记为需改密
UPDATE users SET must_change_pwd = 1 WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_users_must_change ON users(must_change_pwd);
