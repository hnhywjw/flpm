-- ==============================
-- 代中标协议与过单费
-- ==============================
-- agent_agreements
INSERT INTO agent_agreements (id, code, project_id, agreement_with, party_type, fee_method, fee_rate, customer_amount_cents, invoiced_amount_cents, fee_cents, fee_formula, agree_date, status, owner_id, note) VALUES
  (1, 'DZ2025-004', 1, '河南中联智能科技有限公司', 'company', 'diff', NULL, 4860000, 4350000, 510000, '486.00 − 435.00 = 51.00', '2026-03-20', '已结清', 6, '差价即过单费，中标公司按 435.00 向我方开票'),
  (2, 'DZ2025-002', 2, '李建军', 'individual', 'cash', 6.0, 2680000, 2680000, 160800, '268.00 × 6.00% = 16.08', '2026-01-25', '执行中', 6, '客户合同额 100% 开票，过单费按 6% 单独现金支付给个人，对方不开票'),
  (3, 'DZ2024-011', 6, '河南育软信息技术有限公司', 'company', 'diff', NULL, 1560000, 1436000, 124000, '156.00 − 143.60 = 12.40', '2025-09-15', '已结清', 6, '差价即过单费');

-- agent_fee_payments
INSERT INTO agent_fee_payments (id, agreement_id, amount_cents, pay_date, pay_method, payee_name, payee_id_tail, payee_phone, voucher_no, doc_agreement, doc_voucher, doc_confirm, docs_complete, paid_by, approved_by, approved_at, remark) VALUES
  (1, 2, 96500, '2026-02-10', '现金', '李建军', '3821', '13900002222', 'SK-2026-0210', 'DZ2025-002_代中标协议.pdf', 'SK-2026-0210_签收单.jpg', 'QR-2026-0210_收款确认单.jpg', 1, 6, 6, '2026-02-10', '首笔过单费，现金支付，三件套已归档');

-- agent_fee_payments
INSERT INTO agent_fee_payments (id, agreement_id, amount_cents, pay_date, pay_method, payee_name, payee_id_tail, payee_phone, voucher_no, doc_agreement, doc_voucher, doc_confirm, docs_complete, paid_by, approved_by, approved_at, remark) VALUES
  (2, 1, 510000, '2026-03-25', '差价留存', '—', NULL, NULL, 'DZ2025-004-DIFF', 'DZ2025-004_代中标协议.pdf', 'FP-2026-0412_发票.pdf', 'SK-2026-0325_对账确认单.pdf', 1, 6, 6, '2026-03-25', '差价法：过单费为开票差额，无需单独付款；凭证为对账单'),
  (3, 3, 124000, '2025-09-20', '差价留存', '—', NULL, NULL, 'DZ2024-011-DIFF', 'DZ2024-011_代中标协议.pdf', 'FP-2025-0781_发票.pdf', 'SK-2025-0920_对账确认单.pdf', 1, 6, 6, '2025-09-20', '差价法：过单费为开票差额，已随首笔款结清');

-- ==============================
-- 投标 + 参与方留痕
-- ==============================
-- bids
INSERT INTO bids (id, code, project_id, name, customer_id, budget_cents, bond_cents, bond_status, bond_paid_date, bond_back_date, deadline, open_date, owner_id, phase, result, fail_reason, win_amount_cents, mode) VALUES
  (1, 'B2026-031', 4, '河南省交通运输厅数据中心网络安全升级', 4, 3200000, 64000, '已缴', '2026-10-15', NULL, '2026-11-05', '2026-11-05 09:30', 3, '编标中', '待开标', NULL, NULL, 'direct'),
  (2, 'B2026-034', 5, '许昌市水务集团管网在线监测项目', 5, 2100000, 42000, '已缴', '2026-10-18', NULL, '2026-10-30', '2026-10-30 09:30', 2, '待递交', '待开标', NULL, NULL, 'direct'),
  (3, 'B2026-036', NULL, '郑州航空港区管委会视频会议系统', 8, 960000, 19200, '未缴', NULL, NULL, '2026-11-12', '2026-11-12 09:30', 3, '技术方案', '待开标', NULL, NULL, 'agent'),
  (4, 'B2026-028', NULL, '开封市第一中学多媒体教室采购', NULL, 680000, 13600, '已退', '2026-10-08', '2026-10-25', '2026-10-20', '2026-10-20 09:30', 4, '已中标', '中标', NULL, 668000, 'direct'),
  (5, 'B2026-019', NULL, '某县医院 HIS 接口改造项目', NULL, 450000, 9000, '已退', '2026-09-05', '2026-09-28', '2026-09-18', '2026-09-18 09:30', 2, '已废标', '废标', '安防工程企业资质已过期，资格审查未通过', NULL, 'direct');

-- bid_participants
INSERT INTO bid_participants (id, bid_id, company_name, is_self, price_cents, relation, risk_note, status, checked_by, checked_at) VALUES
  (1, 1, '河南弘毅科技有限公司', 1, NULL, '本方', NULL, '编标中', NULL, NULL),
  (2, 1, '郑州华信网络技术有限公司', 0, NULL, '未知', NULL, '未知', NULL, NULL),
  (3, 1, '河南鑫源信息技术有限公司', 0, NULL, '未知', NULL, '未知', NULL, NULL),
  (4, 2, '河南弘毅科技有限公司', 1, 2068000, '本方', NULL, '待递交', NULL, NULL),
  (5, 2, '许昌智联自动化有限公司', 0, NULL, '未知', NULL, '未知', NULL, NULL),
  (6, 2, '河南水科信息技术有限公司', 0, NULL, '未知', NULL, '未知', NULL, NULL),
  (7, 2, '郑州蓝川电子科技有限公司', 0, NULL, '关联风险', '与许昌智联股东存在重合，需核查', '未知', 2, '2026-10-28'),
  (8, 3, '河南中联智能科技有限公司', 0, NULL, '本方', NULL, '编标中', NULL, NULL),
  (9, 3, '河南视通电子有限公司', 0, NULL, '未知', NULL, '未知', NULL, NULL),
  (10, 4, '河南弘毅科技有限公司', 1, 668000, '本方', NULL, '中标', NULL, NULL),
  (11, 4, '开封育才教仪有限公司', 0, 692000, '未知', NULL, '未中标', NULL, NULL),
  (12, 4, '河南新视听科技有限公司', 0, 715000, '未知', NULL, '未中标', NULL, NULL),
  (13, 5, '河南弘毅科技有限公司', 1, NULL, '本方', NULL, '废标', NULL, NULL);

-- bid_tasks
INSERT INTO bid_tasks (id, bid_id, title, owner_id, due_date, status, seq) VALUES
  (1, 1, '商务标（资格文件、业绩、承诺函）', 2, '2026-10-26', '已完成', 1),
  (2, 1, '技术标（方案、拓扑图、参数响应）', 3, '2026-10-28', '进行中', 2),
  (3, 1, '报价文件（成本测算、报价单）', 2, '2026-11-01', '未开始', 3),
  (4, 1, '用章与法人授权', 8, '2026-11-02', '待办', 4),
  (5, 2, '商务标（资格文件、业绩、承诺函）', 2, '2026-10-26', '已完成', 1),
  (6, 2, '技术标（方案、拓扑图、参数响应）', 3, '2026-10-28', '进行中', 2),
  (7, 2, '报价文件（成本测算、报价单）', 2, '2026-10-29', '风险', 3),
  (8, 2, '用章与法人授权', 8, '2026-10-29', '待办', 4),
  (9, 3, '商务标（以代中标公司资质）', 2, '2026-10-30', '进行中', 1),
  (10, 3, '技术标（方案、拓扑图）', 3, '2026-11-04', '进行中', 2),
  (11, 3, '报价文件', 2, '2026-11-06', '未开始', 3),
  (12, 3, '保证金缴纳（1.92 万）', 6, '2026-11-08', '待办', 4);

-- ==============================
-- 验收四件套
-- ==============================
-- acceptances
INSERT INTO acceptances (id, project_id, doc_type, status, submit_date, owner_id, file_path, note) VALUES
  (1, 1, '安装配置文档', '已提交', '2026-09-30', 4, '/files/P2025-018/安装配置文档.pdf', NULL),
  (2, 1, '到货签收单', '已签收', '2026-09-15', 7, '/files/P2025-018/到货签收单.pdf', NULL),
  (3, 1, '验收报告', '待提交', NULL, 4, NULL, '尚未出具'),
  (4, 1, '项目资料', '缺项', NULL, 4, NULL, '竣工图 2 份、移交清单缺失'),
  (5, 2, '安装配置文档', '已提交', '2026-09-08', 4, '/files/P2025-009/安装配置文档.pdf', NULL),
  (6, 2, '到货签收单', '已签收', '2026-08-20', 7, '/files/P2025-009/到货签收单.pdf', NULL),
  (7, 2, '验收报告', '待签字', NULL, 4, NULL, '终验现场已过，等待客户签字'),
  (8, 2, '项目资料', '已齐备', '2026-09-25', 4, '/files/P2025-009/项目资料.zip', NULL),
  (9, 6, '安装配置文档', '已提交', '2026-05-20', 4, '/files/P2024-047/安装配置文档.pdf', NULL),
  (10, 6, '到货签收单', '已签收', '2026-03-15', 7, '/files/P2024-047/到货签收单.pdf', NULL),
  (11, 6, '验收报告', '已出具', '2026-05-26', 4, '/files/P2024-047/验收报告.pdf', NULL),
  (12, 6, '项目资料', '已齐备', '2026-05-28', 4, '/files/P2024-047/项目资料.zip', NULL),
  (13, 7, '安装配置文档', '已提交', '2025-09-20', 4, '/files/P2024-033/安装配置文档.pdf', NULL),
  (14, 7, '到货签收单', '已签收', '2025-07-10', 7, '/files/P2024-033/到货签收单.pdf', NULL),
  (15, 7, '验收报告', '已出具', '2025-09-28', 4, '/files/P2024-033/验收报告.pdf', NULL),
  (16, 7, '项目资料', '已齐备', '2025-09-30', 4, '/files/P2024-033/项目资料.zip', NULL);
