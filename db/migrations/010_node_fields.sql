-- ============================================================
-- 迁移 010：节点结构化字段 + 保证金退还记录
-- ============================================================
PRAGMA foreign_keys = ON;

-- 节点：中标信息、实施方案
ALTER TABLE project_nodes ADD COLUMN win_notice_no TEXT;      -- 中标通知书编号
ALTER TABLE project_nodes ADD COLUMN win_amount_cents INTEGER; -- 中标金额
ALTER TABLE project_nodes ADD COLUMN win_date TEXT;            -- 中标日期
ALTER TABLE project_nodes ADD COLUMN impl_plan TEXT;           -- 实施方案说明
ALTER TABLE project_nodes ADD COLUMN progress_note TEXT;       -- 进度说明

-- 投标：保证金退还记录
ALTER TABLE bids ADD COLUMN bond_back_date TEXT;   -- 退还日期
ALTER TABLE bids ADD COLUMN bond_back_cents INTEGER; -- 退还金额
ALTER TABLE bids ADD COLUMN bond_back_voucher TEXT;  -- 退还凭证（附件 id）

-- 索引
CREATE INDEX IF NOT EXISTS idx_nodes_project ON project_nodes(project_id, seq);
