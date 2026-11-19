-- ============================================================
-- 迁移 007：软删除支持
-- 设计原则：
--   财务相关（合同/回款/发票/过单费）不物理删除，只标记 deleted_at
--   基础数据（项目/投标/工单等）也走软删除，保留审计痕迹
--   查询默认过滤 deleted_at IS NULL
-- ============================================================
PRAGMA foreign_keys = ON;

ALTER TABLE projects ADD COLUMN deleted_at TEXT;
ALTER TABLE projects ADD COLUMN deleted_by INTEGER;

ALTER TABLE bids ADD COLUMN deleted_at TEXT;
ALTER TABLE bids ADD COLUMN deleted_by INTEGER;

ALTER TABLE contracts ADD COLUMN deleted_at TEXT;
ALTER TABLE contracts ADD COLUMN deleted_by INTEGER;

ALTER TABLE payment_terms ADD COLUMN deleted_at TEXT;
ALTER TABLE payment_terms ADD COLUMN deleted_by INTEGER;

ALTER TABLE invoices ADD COLUMN deleted_at TEXT;
ALTER TABLE invoices ADD COLUMN deleted_by INTEGER;

ALTER TABLE tickets ADD COLUMN deleted_at TEXT;
ALTER TABLE tickets ADD COLUMN deleted_by INTEGER;

ALTER TABLE stock_moves ADD COLUMN deleted_at TEXT;
ALTER TABLE stock_moves ADD COLUMN deleted_by INTEGER;

ALTER TABLE change_requests ADD COLUMN deleted_at TEXT;
ALTER TABLE change_requests ADD COLUMN deleted_by INTEGER;

ALTER TABLE risk_register ADD COLUMN deleted_at TEXT;
ALTER TABLE risk_register ADD COLUMN deleted_by INTEGER;

ALTER TABLE agent_agreements ADD COLUMN deleted_at TEXT;
ALTER TABLE agent_agreements ADD COLUMN deleted_by INTEGER;

ALTER TABLE agent_fee_payments ADD COLUMN deleted_at TEXT;
ALTER TABLE agent_fee_payments ADD COLUMN deleted_by INTEGER;

ALTER TABLE acceptances ADD COLUMN deleted_at TEXT;
ALTER TABLE acceptances ADD COLUMN deleted_by INTEGER;

ALTER TABLE warranties ADD COLUMN deleted_at TEXT;
ALTER TABLE warranties ADD COLUMN deleted_by INTEGER;
