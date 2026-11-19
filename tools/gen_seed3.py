# -*- coding: utf-8 -*-
import io, sys
sys.stdout.reconfigure(encoding='utf-8')
W=10000
def y(v): return int(round(v*W))
L=[]
def w(s=''): L.append(s)
def q(s):
    if s is None: return 'NULL'
    return "'"+str(s).replace("'","''")+"'"
def ins(table, cols, rows):
    w('-- '+table)
    w('INSERT INTO %s (%s) VALUES' % (table, ', '.join(cols)))
    vs=[]
    for r in rows:
        a=[]
        for v in r:
            if v is None: a.append('NULL')
            elif isinstance(v,(int,float)): a.append(str(v))
            else: a.append(q(v))
        vs.append('  ('+', '.join(a)+')')
    w(',\n'.join(vs)+';'); w()

w('-- ==============================')
w('-- 代中标协议与过单费')
w('-- ==============================')
# 关键设计：项目1 差价法(公司)；项目2 现金方式(付个人，三件套凭证)；项目6 差价法(公司)
agreements = [
 (1,'DZ2025-004',1,'河南中联智能科技有限公司','company','diff',None,y(486.00),y(435.00),y(51.00),'486.00 − 435.00 = 51.00','2026-03-20','已结清',6,'差价即过单费，中标公司按 435.00 向我方开票'),
 (2,'DZ2025-002',2,'李建军','individual','cash',6.00,y(268.00),y(268.00),y(16.08),'268.00 × 6.00% = 16.08','2026-01-25','执行中',6,'客户合同额 100% 开票，过单费按 6% 单独现金支付给个人，对方不开票'),
 (3,'DZ2024-011',6,'河南育软信息技术有限公司','company','diff',None,y(156.00),y(143.60),y(12.40),'156.00 − 143.60 = 12.40','2025-09-15','已结清',6,'差价即过单费'),
]
ins('agent_agreements',['id','code','project_id','agreement_with','party_type','fee_method','fee_rate','customer_amount_cents','invoiced_amount_cents','fee_cents','fee_formula','agree_date','status','owner_id','note'],agreements)

# 过单费支付记录：个人现金支付，三件套缺一不可
# 协议2 应付 16.08，已付 9.65，剩 6.43
feepay = [
 # 已完成的付款：三件套齐备
 (1,2,y(9.65),'2026-02-10','现金','李建军','3821','13900002222','SK-2026-0210',
  'DZ2025-002_代中标协议.pdf','SK-2026-0210_签收单.jpg','QR-2026-0210_收款确认单.jpg',1,6,6,'2026-02-10','首笔过单费，现金支付，三件套已归档'),
]
ins('agent_fee_payments',['id','agreement_id','amount_cents','pay_date','pay_method','payee_name','payee_id_tail','payee_phone','voucher_no','doc_agreement','doc_voucher','doc_confirm','docs_complete','paid_by','approved_by','approved_at','remark'],feepay)

# 差价法视为无需支付动作（差额留存），但记录一条结清说明
feepay2 = [
 (2,1,y(51.00),'2026-03-25','差价留存','—',None,None,'DZ2025-004-DIFF',
  'DZ2025-004_代中标协议.pdf','FP-2026-0412_发票.pdf','SK-2026-0325_对账确认单.pdf',1,6,6,'2026-03-25','差价法：过单费为开票差额，无需单独付款；凭证为对账单'),
 (3,3,y(12.40),'2025-09-20','差价留存','—',None,None,'DZ2024-011-DIFF',
  'DZ2024-011_代中标协议.pdf','FP-2025-0781_发票.pdf','SK-2025-0920_对账确认单.pdf',1,6,6,'2025-09-20','差价法：过单费为开票差额，已随首笔款结清'),
]
ins('agent_fee_payments',['id','agreement_id','amount_cents','pay_date','pay_method','payee_name','payee_id_tail','payee_phone','voucher_no','doc_agreement','doc_voucher','doc_confirm','docs_complete','paid_by','approved_by','approved_at','remark'],feepay2)

w('-- ==============================')
w('-- 投标 + 参与方留痕')
w('-- ==============================')
bids=[
 (1,'B2026-031',4,'河南省交通运输厅数据中心网络安全升级',4,y(320.00),y(6.40),'已缴','2026-10-15',None,'2026-11-05','2026-11-05 09:30',3,'编标中','待开标',None,None,'direct'),
 (2,'B2026-034',5,'许昌市水务集团管网在线监测项目',5,y(210.00),y(4.20),'已缴','2026-10-18',None,'2026-10-30','2026-10-30 09:30',2,'待递交','待开标',None,None,'direct'),
 (3,'B2026-036',None,'郑州航空港区管委会视频会议系统',8,y(96.00),y(1.92),'未缴',None,None,'2026-11-12','2026-11-12 09:30',3,'技术方案','待开标',None,None,'agent'),
 (4,'B2026-028',None,'开封市第一中学多媒体教室采购',None,y(68.00),y(1.36),'已退','2026-10-08','2026-10-25','2026-10-20','2026-10-20 09:30',4,'已中标','中标',None,y(66.80),'direct'),
 (5,'B2026-019',None,'某县医院 HIS 接口改造项目',None,y(45.00),y(0.90),'已退','2026-09-05','2026-09-28','2026-09-18','2026-09-18 09:30',2,'已废标','废标','安防工程企业资质已过期，资格审查未通过',None,'direct'),
]
ins('bids',['id','code','project_id','name','customer_id','budget_cents','bond_cents','bond_status','bond_paid_date','bond_back_date','deadline','open_date','owner_id','phase','result','fail_reason','win_amount_cents','mode'],bids)

parts=[
 # bid1
 (1,'河南弘毅科技有限公司',1,None,'本方',None,'编标中',None,None),
 (1,'郑州华信网络技术有限公司',0,None,'未知',None,'未知',None,None),
 (1,'河南鑫源信息技术有限公司',0,None,'未知',None,'未知',None,None),
 # bid2 含关联风险
 (2,'河南弘毅科技有限公司',1,y(206.80),'本方',None,'待递交',None,None),
 (2,'许昌智联自动化有限公司',0,None,'未知',None,'未知',None,None),
 (2,'河南水科信息技术有限公司',0,None,'未知',None,'未知',None,None),
 (2,'郑州蓝川电子科技有限公司',0,None,'关联风险','与许昌智联股东存在重合，需核查','未知',2,'2026-10-28'),
 # bid3 代中标
 (3,'河南中联智能科技有限公司',0,None,'本方',None,'编标中',None,None),
 (3,'河南视通电子有限公司',0,None,'未知',None,'未知',None,None),
 # bid4 已开标
 (4,'河南弘毅科技有限公司',1,y(66.80),'本方',None,'中标',None,None),
 (4,'开封育才教仪有限公司',0,y(69.20),'未知',None,'未中标',None,None),
 (4,'河南新视听科技有限公司',0,y(71.50),'未知',None,'未中标',None,None),
 # bid5 废标
 (5,'河南弘毅科技有限公司',1,None,'本方',None,'废标',None,None),
]
ins('bid_participants',['id','bid_id','company_name','is_self','price_cents','relation','risk_note','status','checked_by','checked_at'],
    [(i+1,)+r for i,r in enumerate(parts)])

tasks=[
 (1,'商务标（资格文件、业绩、承诺函）',2,'2026-10-26','已完成',1),
 (1,'技术标（方案、拓扑图、参数响应）',3,'2026-10-28','进行中',2),
 (1,'报价文件（成本测算、报价单）',2,'2026-11-01','未开始',3),
 (1,'用章与法人授权',8,'2026-11-02','待办',4),
 (2,'商务标（资格文件、业绩、承诺函）',2,'2026-10-26','已完成',1),
 (2,'技术标（方案、拓扑图、参数响应）',3,'2026-10-28','进行中',2),
 (2,'报价文件（成本测算、报价单）',2,'2026-10-29','风险',3),
 (2,'用章与法人授权',8,'2026-10-29','待办',4),
 (3,'商务标（以代中标公司资质）',2,'2026-10-30','进行中',1),
 (3,'技术标（方案、拓扑图）',3,'2026-11-04','进行中',2),
 (3,'报价文件',2,'2026-11-06','未开始',3),
 (3,'保证金缴纳（1.92 万）',6,'2026-11-08','待办',4),
]
ins('bid_tasks',['id','bid_id','title','owner_id','due_date','status','seq'],
    [(i+1,)+r for i,r in enumerate(tasks)])

w('-- ==============================')
w('-- 验收四件套')
w('-- ==============================')
acc=[
 (1,1,'安装配置文档','已提交','2026-09-30',4,'/files/P2025-018/安装配置文档.pdf',None),
 (2,1,'到货签收单','已签收','2026-09-15',7,'/files/P2025-018/到货签收单.pdf',None),
 (3,1,'验收报告','待提交',None,4,None,'尚未出具'),
 (4,1,'项目资料','缺项',None,4,None,'竣工图 2 份、移交清单缺失'),
 (5,2,'安装配置文档','已提交','2026-09-08',4,'/files/P2025-009/安装配置文档.pdf',None),
 (6,2,'到货签收单','已签收','2026-08-20',7,'/files/P2025-009/到货签收单.pdf',None),
 (7,2,'验收报告','待签字',None,4,None,'终验现场已过，等待客户签字'),
 (8,2,'项目资料','已齐备','2026-09-25',4,'/files/P2025-009/项目资料.zip',None),
 (9,6,'安装配置文档','已提交','2026-05-20',4,'/files/P2024-047/安装配置文档.pdf',None),
 (10,6,'到货签收单','已签收','2026-03-15',7,'/files/P2024-047/到货签收单.pdf',None),
 (11,6,'验收报告','已出具','2026-05-26',4,'/files/P2024-047/验收报告.pdf',None),
 (12,6,'项目资料','已齐备','2026-05-28',4,'/files/P2024-047/项目资料.zip',None),
 (13,7,'安装配置文档','已提交','2025-09-20',4,'/files/P2024-033/安装配置文档.pdf',None),
 (14,7,'到货签收单','已签收','2025-07-10',7,'/files/P2024-033/到货签收单.pdf',None),
 (15,7,'验收报告','已出具','2025-09-28',4,'/files/P2024-033/验收报告.pdf',None),
 (16,7,'项目资料','已齐备','2025-09-30',4,'/files/P2024-033/项目资料.zip',None),
]
ins('acceptances',['id','project_id','doc_type','status','submit_date','owner_id','file_path','note'],acc)

print('\n'.join(L))
io.open('db/seed3.sql','w',encoding='utf-8').write('\n'.join(L))
print('WROTE db/seed3.sql')
