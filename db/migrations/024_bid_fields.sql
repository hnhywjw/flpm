-- ============================================================
-- 迁移 024：投标字段补全（P0 + P1 + P2）
-- ============================================================
-- P0：字段早就在库里，只是界面没露出来 —— 这次只改前端，不建字段。
--     bids.open_date / bond_paid_date / customer_id
--
-- P1：真实业务需要但库里没有的
-- P2：参与方 status 与 result 语义冲突（数据清洗，见文末）
-- ============================================================

-- ---------- P1：投标项目 ----------

-- 招标编号：招标文件上的编号。
-- 现在 bids.code 是系统自动生成的 B2026-034，和招标文件对不上，
-- 对账、答疑、提交澄清都要报招标方的编号。
ALTER TABLE bids ADD COLUMN bid_no TEXT;

-- 招标代理机构：答疑、退保证金、开标都要联系他们
ALTER TABLE bids ADD COLUMN agent_company TEXT;

-- 招标方式：影响时限和流程（邀请招标不用公告期，竞谈可以二次报价）
ALTER TABLE bids ADD COLUMN bid_method TEXT DEFAULT '公开招标';

-- 开标地点：异地开标要提前安排行程
ALTER TABLE bids ADD COLUMN bid_open_place TEXT;

-- 现场踏勘日期：很多项目要求踏勘签到，漏了直接废标
ALTER TABLE bids ADD COLUMN site_visit_date TEXT;

-- 答疑截止：晚于这个时间提问无效
ALTER TABLE bids ADD COLUMN qa_deadline TEXT;

-- 标书费：购买招标文件的费用，要报销（元刻度，1万=10000）
ALTER TABLE bids ADD COLUMN doc_price_cents INTEGER;

-- ---------- P1：投标参与方 ----------

-- 联系人/电话：陪标方要联系对接，现在只有公司名
ALTER TABLE bid_participants ADD COLUMN contact_person TEXT;
ALTER TABLE bid_participants ADD COLUMN contact_phone TEXT;

-- 资质情况：这家是否满足招标要求的资质等级
ALTER TABLE bid_participants ADD COLUMN qualification TEXT;

-- 评标得分与排名：开标后复盘「输在哪」的关键数据
ALTER TABLE bid_participants ADD COLUMN score REAL;
ALTER TABLE bid_participants ADD COLUMN rank INTEGER;

-- ---------- P1：项目 ----------

-- 合同编号：立项后签的合同号，和合同模块对账用
ALTER TABLE projects ADD COLUMN contract_no TEXT;

-- 实施地点：实施、售后派工需要
ALTER TABLE projects ADD COLUMN site_address TEXT;

-- ---------- P2：参与方 status / result 语义清洗 ----------
--
-- 问题：status 里混进了「中标 / 未中标 / 废标」，
--       和 result 完全重复，可能出现 status='中标' 但 result='未中标' 的矛盾。
--
-- 正确语义：
--   status  →  过程：编标中 / 待递交 / 已递交 / 已撤回
--   result  →  结果：待开标 / 中标 / 未中标 / 废标
--
-- 清洗步骤：把 status 里的结果值搬到 result（仅当 result 还没填时），
--           再把 status 归一到「已递交」。

UPDATE bid_participants
SET result = status
WHERE status IN ('中标', '未中标', '废标')
  AND (result IS NULL OR result = '待开标');

UPDATE bid_participants
SET status = '已递交'
WHERE status IN ('中标', '未中标', '废标');

-- 索引：按招标编号查重、按评标排名复盘
CREATE INDEX IF NOT EXISTS idx_bids_bid_no ON bids(bid_no);
CREATE INDEX IF NOT EXISTS idx_parts_rank ON bid_participants(bid_id, rank);
