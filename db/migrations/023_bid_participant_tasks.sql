-- ============================================================
-- 迁移 023：投标参与方的任务进度
-- ============================================================
-- 背景：
--   原来 bid_tasks 是「项目级」任务（这个招标要做什么），
--   但实际编标时，每家投标人的进度是分开的：
--     我方的商务标做完了，陪标那家的商务标可能还没开始。
--
--   所以新增一张 bid_participant_tasks，挂在参与方下面，
--   用于算「这一家的编标进度百分比」。
--
-- 与 bid_tasks 的分工：
--   bid_tasks              项目级（整个招标要做哪些事）
--   bid_participant_tasks  参与方级（这一家做到哪一步了）
--
-- progress：0-100，由前端按完成项数自动算，也可以手工微调
--   存下来是为了「100% 但还有子项没完成」这类特殊情况不被覆盖。

CREATE TABLE IF NOT EXISTS bid_participant_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES bid_participants(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,           -- 商务标 / 技术标 / 投标报价 / 资质文件 / 用章
  progress    INTEGER NOT NULL DEFAULT 0, -- 0-100
  owner       TEXT,                       -- 这一项的负责人（自由文本，可能是外部人员）
  due_date    TEXT,
  note        TEXT,
  seq         INTEGER DEFAULT 0,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_ppt_part ON bid_participant_tasks(participant_id, seq);

-- 给已有参与方初始化默认任务项（只看已存在的参与方，不影响新建）
-- 用 INSERT ... SELECT，避免逐条循环
INSERT INTO bid_participant_tasks (participant_id, title, progress, seq)
SELECT p.id, '商务标', 0, 1 FROM bid_participants p
WHERE NOT EXISTS (
  SELECT 1 FROM bid_participant_tasks t WHERE t.participant_id = p.id AND t.title = '商务标'
);

INSERT INTO bid_participant_tasks (participant_id, title, progress, seq)
SELECT p.id, '技术标', 0, 2 FROM bid_participants p
WHERE NOT EXISTS (
  SELECT 1 FROM bid_participant_tasks t WHERE t.participant_id = p.id AND t.title = '技术标'
);

INSERT INTO bid_participant_tasks (participant_id, title, progress, seq)
SELECT p.id, '投标报价', 0, 3 FROM bid_participants p
WHERE NOT EXISTS (
  SELECT 1 FROM bid_participant_tasks t WHERE t.participant_id = p.id AND t.title = '投标报价'
);

INSERT INTO bid_participant_tasks (participant_id, title, progress, seq)
SELECT p.id, '资质文件', 0, 4 FROM bid_participants p
WHERE NOT EXISTS (
  SELECT 1 FROM bid_participant_tasks t WHERE t.participant_id = p.id AND t.title = '资质文件'
);

INSERT INTO bid_participant_tasks (participant_id, title, progress, seq)
SELECT p.id, '用章与授权', 0, 5 FROM bid_participants p
WHERE NOT EXISTS (
  SELECT 1 FROM bid_participant_tasks t WHERE t.participant_id = p.id AND t.title = '用章与授权'
);
