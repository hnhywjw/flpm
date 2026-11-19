-- ============================================================
-- 迁移 021：系统账号（供定时任务写审计日志用）
-- ============================================================
-- 背景：audit_logs.user_id 有外键指向 users.id，
-- 而 SLA 升级任务用 userId: 0 写审计，用户 0 不存在 → 外键失败，
-- 导致整个任务回滚。只在「有工单需要升级」时才触发，长期被掩盖。
--
-- 方案：建一个真实的系统账号，id 固定，不可登录。

INSERT OR IGNORE INTO users
  (id, name, username, role, dept, phone, active, reg_status,
   password_hash, password_salt, must_change_pwd)
VALUES
  (0, '系统', '__system__', 'admin', '系统', NULL, 0, 'approved',
   NULL, NULL, 0);

-- 说明：
--   active = 0        → 不可登录
--   password_hash 为空 → 无法通过任何密码校验
--   username = __system__ → 不会出现在人员列表中（列表已显式排除）
--
-- 注意：seed-passwords.js 会给「没有密码的账号」设置默认密码，
-- 必须排除 __system__，否则系统账号会被设上默认密码（已在脚本中排除）。
-- 下面两条确保它始终无密码、无法登录。

UPDATE users SET password_hash = NULL, password_salt = NULL
WHERE username = '__system__';

UPDATE users SET active = 0
WHERE username = '__system__';
