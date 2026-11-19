-- ============================================================
-- 迁移 004：角色表化（角色与人员分离）
-- 目标：
--   1. 角色从硬编码改为数据库表，可增删改
--   2. 去掉法务/行政，职责并入商务
--   3. 人员与角色多对多，一个人可以有多个角色（主角色用于默认）
-- ============================================================
PRAGMA foreign_keys = ON;

-- 角色定义表
CREATE TABLE IF NOT EXISTS roles (
  key           TEXT PRIMARY KEY,          -- boss/sales/finance/pm/warehouse/service/admin
  name          TEXT NOT NULL,             -- 显示名
  description   TEXT,
  menus         TEXT NOT NULL DEFAULT '[]',-- 可访问菜单 JSON 数组
  can_see_amount INTEGER NOT NULL DEFAULT 1,
  is_system     INTEGER NOT NULL DEFAULT 0,-- 系统内置角色不可删除
  sort          INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 用户-角色关联（多对多）
CREATE TABLE IF NOT EXISTS user_roles (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key  TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,   -- 主角色
  PRIMARY KEY (user_id, role_key)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
