-- ============================================================
-- 迁移 022：投标参与方扩展字段
-- ============================================================
-- 背景：
--   原来 bid_participants 只有「名称 / 报价 / 关联关系 / 状态」，
--   而开标现场实际需要记录：
--     · 保证金：每家交了多少、交没交
--     · 结果：这家最终中标/未中标/废标（bids.result 是整个项目的，
--             参与方各自的结果可能不同）
--     · 编制人：谁做的这份标书，出问题找谁
--
-- 说明：
--   · 投标文件不新增字段 —— 走 attachments 表（entity_type='bid_participant'），
--     这样能存多个文件、有版本、有上传人，比一个字符串字段强得多。
--   · bond_cents 复用「元刻度」（1 万 = 10000），与全库一致。
--   · result 用 CHECK 约束，避免写成「中標」「中标 」这类脏值。

ALTER TABLE bid_participants ADD COLUMN bond_cents INTEGER;
ALTER TABLE bid_participants ADD COLUMN bond_status TEXT DEFAULT '未缴';
ALTER TABLE bid_participants ADD COLUMN result TEXT DEFAULT '待开标';
ALTER TABLE bid_participants ADD COLUMN preparer TEXT;
ALTER TABLE bid_participants ADD COLUMN updated_at TEXT;

-- 已有数据：把「本方」参与方的编制人默认留空，
-- 结果按所属投标的 result 回填，避免老数据显示成「待开标」但其实已出结果
UPDATE bid_participants
SET result = (
  SELECT b.result FROM bids b WHERE b.id = bid_participants.bid_id
)
WHERE result IS NULL OR result = '待开标';

CREATE INDEX IF NOT EXISTS idx_parts_result ON bid_participants(bid_id, result);
