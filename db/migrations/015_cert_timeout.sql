-- ============================================================
-- 迁移 015：证书配置 + 登录超时
-- ============================================================
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO system_params (key, value, label, description) VALUES
  ('session_timeout_min', '120',  '登录超时（分钟）', '无操作超过该时长自动退出，0 表示不超时'),
  ('ssl_cert_path',       '',     'SSL 证书路径',     '服务器上证书文件路径，如 /home/ltc/nginx/certs/server.crt'),
  ('ssl_key_path',        '',     'SSL 密钥路径',     '服务器上私钥文件路径'),
  ('ssl_expire_warn_days','30',   '证书到期提醒天数', '剩余天数少于该值时在待办预警中提示');
