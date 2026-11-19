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
w('-- 仓储')
w('-- ==============================')
ins('warehouses',['id','name','keeper_id','address'],[
 (1,'郑州中心库',7,'郑州市高新区'),(2,'洛阳项目仓',7,'洛阳市涧西区')])

items=[
 (1,'DS-2CD3T46','海康威视网络摄像机 400万','400万/POE','台','安防设备',20,1,y(0.085)),
 (2,'H3C-S5130','H3C 交换机 48口千兆','S5130-52S','台','网络设备',10,1,y(0.62)),
 (3,'UPS-10K','山特 UPS 10KVA','C10KS','台','电源',5,1,y(1.15)),
 (4,'CAT6-305','超六类网线 305米/箱','CAT6 UTP','箱','线材',30,0,y(0.068)),
 (5,'NVR-8832','32路网络硬盘录像机','DS-8832N','台','安防设备',8,1,y(0.34)),
]
ins('items',['id','sku','name','spec','unit','category','safe_stock','track_sn','price_cents'],items)

ins('stock',['item_id','warehouse_id','qty'],[(1,1,12),(2,1,26),(3,2,8),(4,1,64),(5,1,4)])

moves=[
 (1,'RK2026-0912','in',1,120,1,'contract_purchase',7,'采购订单 CG2026-0031','郑州中心库',1,'2026-09-12',7,'已入库',None),
 (2,'CK2026-0918','out',1,80,1,'project',1,'郑州中心库','P2025-018 项目领用',1,'2026-09-18',7,'已出库',None),
 (3,'CK2026-0921','out',2,12,1,'project',3,'郑州中心库','P2025-012 项目领用',3,'2026-09-21',7,'已出库',None),
 (4,'RK2026-0925','in',5,4,1,'contract_purchase',7,'采购订单 CG2026-0031','郑州中心库',1,'2026-09-25',7,'部分到货','原定 8 台，实际到 4 台'),
 (5,'CK2026-0928','out',3,2,2,'ticket',1,'洛阳项目仓','WO2026-0871 售后备件',2,'2026-09-28',5,'已出库',None),
 (6,'CK2026-0930','out',4,18,1,'project',1,'郑州中心库','P2025-018 综合布线',1,'2026-09-30',7,'已出库',None),
]
ins('stock_moves',['id','code','direction','item_id','qty','warehouse_id','source_type','source_id','source_text','target_text','project_id','move_date','operator_id','status','remark'],moves)

serials=[]
for i in range(1,6):
    serials.append((i,1,'SN-%05d'%(88230+i),1,2,1,'已安装','2026-09-20'))
for i in range(6,9):
    serials.append((i,2,'SN-%05d'%(77305+i),None,3,3,'已安装','2026-09-25'))
ins('item_serials',['id','item_id','sn','move_in_id','move_out_id','project_id','status','installed_at'],serials)

w('-- ==============================')
w('-- 售后')
w('-- ==============================')
tickets=[
 (1,'WO2026-0876',1,1,'3号病房楼呼叫系统整体离线','严重',4,'2026-10-27 14:20','2026-10-27 14:35',None,5,'处理中','SN-88231 / SN-88232',1,'3块主板需更换'),
 (2,'WO2026-0871',2,2,'东门 12 号摄像机画面异常','一般',24,'2026-10-26 09:05','2026-10-26 09:40',None,7,'待备件','SN-77310',1,'摄像机整机更换，备件待出库'),
 (3,'WO2026-0865',6,6,'智慧校园平台登录偶发超时','一般',24,'2026-10-20 10:12','2026-10-20 10:30','2026-10-21 16:00',5,'已关闭','—',1,'已优化会话超时配置'),
 (4,'WO2026-0859',7,7,'指挥大厅大屏拼接控制器黑屏','严重',4,'2026-10-18 16:40','2026-10-18 17:10',None,7,'超时升级','SN-66102',0,'客户尾款逾期，超出质保范围，已升级商务处理'),
]
ins('tickets',['id','code','project_id','customer_id','title','level','sla_hours','reported_at','responded_at','resolved_at','owner_id','status','sn_list','is_warranty','note'],tickets)

warranties=[
 (1,'QB-2024-0455',6,5,'2025-11-30','2026-11-30',y(7.80),'待收回',None,'33 天内到期'),
 (2,'QB-2024-0331',7,6,'2025-11-05','2026-11-05',y(18.40),'已逾期',None,'已逾期 120 天'),
 (3,'QB-2025-0108',2,3,'2026-01-21','2029-01-21',y(53.60),'待收回',None,'质保期 3 年'),
 (4,'QB-2025-0212',1,1,'2026-11-30','2028-11-30',y(23.40),'待收回',None,'质保期 2 年'),
]
ins('warranties',['id','code','project_id','contract_id','start_date','end_date','bond_cents','bond_status','bond_back_date','note'],warranties)

w('-- ==============================')
w('-- 审计日志示例')
w('-- ==============================')
logs=[
 (1,4,'张立群','advance','project_node',None,None,None,'note','更新节点「实施」，补充现场照片 3 张','2026-10-27 16:20'),
 (2,6,'陈静','pay','payment_term',2,None,None,'actual_cents','登记回款 93.60 万，到货款部分回款','2026-10-20 09:12'),
 (3,2,'王海涛','update','bid_participant',7,None,None,'relation','标注「郑州蓝川电子」关联风险，转合规核查','2026-10-28 09:40'),
 (4,6,'陈静','pay','agent_fee_payment',1,None,None,'amount_cents','支付过单费 9.65 万，三件套已归档','2026-02-10 15:30'),
 (5,7,'赵磊','create','stock_move',2,None,None,'qty','出库摄像机 80 台，关联 P2025-018','2026-09-18 10:05'),
]
ins('audit_logs',['id','user_id','user_name','action','entity_type','entity_id','old_value','new_value','field','summary','created_at'],logs)

w('-- 编码序列初始化')
ins('code_sequences',['prefix','year','seq'],[('P',2025,18),('P',2026,24),('B',2026,36),('HT',2025,266),('HT',2026,88),('CG',2026,42),('DZ',2025,4),('WO',2026,876),('RK',2026,925),('CK',2026,930),('QB',2024,455)])

print('\n'.join(L))
io.open('db/seed4.sql','w',encoding='utf-8').write('\n'.join(L))
print('WROTE db/seed4.sql')
