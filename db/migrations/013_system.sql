-- ============================================================
-- 迁移 013：系统参数表
-- 用于「系统管理 → 参数配置」的键值存储
-- ============================================================
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS system_params (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  label       TEXT,
  description TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_by  INTEGER
);

-- 内置参数默认值
INSERT OR IGNORE INTO system_params (key, value, label, description) VALUES
  ('company_name',   '河南弘毅科技有限公司', '公司名称',       '显示在报表页眉、导出文件署名'),
  ('system_title',   '项目全流程管理系统',   '系统标题',       '浏览器标签页与登录页显示'),
  ('session_days',   '7',                   '会话有效期',     '登录后保持天数，默认 7'),
  ('login_max_fail', '5',                   '登录失败上限',   '连续失败 N 次后锁定账号'),
  ('lock_minutes',   '15',                  '锁定时长',       '账号锁定分钟数'),
  ('page_size',      '20',                  '列表每页条数',   '各列表页默认分页大小'),
  ('sla_hours',      '48',                  '工单 SLA',       '售后工单响应时限（小时）'),
  ('backup_keep',    '30',                  '备份保留份数',   '超过该数量的旧备份会被清理');
