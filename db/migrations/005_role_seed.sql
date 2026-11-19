-- 角色初始数据（幂等：已存在则更新定义）
INSERT OR REPLACE INTO roles (key, name, description, menus, can_see_amount, is_system, sort) VALUES
('boss', '总经理', '全公司数据 + 审批', '["dashboard","projects","bidding","agent","contracts","finance","changes","inventory","service","approvals","alerts","settings","logs","reports"]', 1, 1, 1),
('sales', '商务/销售', '商机、投标、合同、法务审核、行政用章', '["dashboard","projects","bidding","agent","contracts","changes","approvals","alerts"]', 1, 1, 2),
('finance', '财务', '开票、回款、过单费、采购付款', '["dashboard","projects","agent","contracts","finance","changes","approvals","alerts","reports"]', 1, 1, 3),
('pm', '项目经理', '项目实施、节点推进、验收资料、变更', '["dashboard","projects","changes","inventory","approvals","alerts"]', 1, 1, 4),
('warehouse', '库管', '出入库、库存、SN 台账', '["dashboard","projects","inventory","alerts"]', 0, 1, 5),
('service', '售后', '工单、质保、备件', '["dashboard","projects","service","inventory","alerts"]', 1, 1, 6),
('admin', '系统管理员', '配置、权限、日志（看不到金额）', '["dashboard","projects","bidding","agent","contracts","finance","changes","inventory","service","approvals","alerts","settings","logs"]', 0, 1, 7);

-- 把原有用户的 role 同步到 user_roles（幂等）
INSERT OR IGNORE INTO user_roles (user_id, role_key, is_primary)
SELECT id, role, 1 FROM users WHERE role IN ('boss','sales','finance','pm','warehouse','service','admin');

-- 法务/行政的现有用户并入商务
UPDATE users SET role = 'sales' WHERE role IN ('legal','executive');
INSERT OR IGNORE INTO user_roles (user_id, role_key, is_primary)
SELECT id, 'sales', 1 FROM users WHERE id NOT IN (SELECT user_id FROM user_roles);
