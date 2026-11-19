# 任务分解迁移 + 字段缺口分析

日期：2026-10-30

---

## 〇、先澄清两个文件的状态（我核对过审计日志）

之前我担心误删了你的文件，查了 `audit_logs`，**不是我删的**：

```
09:42:55  管理员  上传「百智办公-一本通.pdf」到 bid#2
10:08:05  管理员  删除「百智办公-一本通.pdf」        ← 界面删除

10:08:13  管理员  上传「百智办公-伙伴试用流程说明书.pdf」到 bid#2
10:12:16  管理员  删除「百智办公-伙伴试用流程说明书.pdf」  ← 界面删除
```

操作人都是「管理员」，动作是界面的删除按钮，我的清理脚本没有参与。

**当前仍在的文件：**

```
百智办公-伙伴试用流程说明书.pdf   838.8 KB   投标参与方 4（河南弘毅科技）
```

如果你是在测试上传功能，这两个文件的删除是预期内的。
如果不是，说明有人误操作了 —— 需要的话我可以加「删除附件二次确认 + 回收站」。

---

## 一、投标任务分解迁移

### 迁移前

页面有两套任务体系，位置分散：

```
招标项目 B2026-034
  ├─ 招标文件
  ├─ 投标参与方表格（含「任务进度」列，点开是各家的编标进度）
  └─ 投标任务分解          ← 页面最底部，项目级
```

问题：**同一个概念分成两个入口，用户不知道看哪个。**
「任务进度」列里的 5 项（商务标/技术标/报价/资质/用章）
和底部「投标任务分解」的 4 项（商务标/技术标/报价/用章）
内容高度重叠，但一个按家算、一个按项目算。

### 迁移后

```
投标参与方表格
  └─ 任务进度 [■■■□□] 60%   ← 点开
       ┌──────────────────────────────────┐
       │ 河南弘毅科技 · 投标任务进度         │
       │ 已完成 3/5 项 · 总体 60%           │
       ├──────────────────────────────────┤
       │ 项目任务分解（只对本方显示）        │
       │ ✓ 商务标（资格文件、业绩）王海涛    │
       │ ◐ 技术标（方案、拓扑图）  李慧      │
       │ ◐ 报价文件（成本测算）   王海涛    │
       │ ◐ 用章与法人授权        赵敏      │
       ├──────────────────────────────────┤
       │ 本家投标进度                       │
       │ [商务标      ] 100%  ← 可拖动       │
       │ [技术标      ]  60%                │
       │ [投标报价    ]  40%                │
       └──────────────────────────────────┘
```

**两个分区，职责分明：**

| 分区 | 数据源 | 含义 | 可编辑 |
|---|---|---|---|
| 项目任务分解 | `bid_tasks` | 整个招标要做的事（项目级）| 只读 |
| 本家投标进度 | `bid_participant_tasks` | 这一家做到哪一步 | 可拖滑块 |

### 一个关键设计判断

**项目任务分解只在本方参与方显示。**

```
is_self === 1  →  显示项目任务（我方内部计划）
is_self === 0  →  不显示
```

理由：陪标公司的弹窗里显示我方的内部计划，没有业务意义；
而且「我方报价文件进度 40%」出现在别家公司旁边，容易被误读。

### 总体进度算法不变

```
overall = 本家任务的进度平均  ← 不含项目任务
```

项目任务是「整个项目要做什么」，不该拉高某一家的完成度。

---

## 二、字段缺口分析

### 现有字段盘点

```
bids（24 字段）
  code, name, customer_id, budget_cents,
  bond_cents, bond_status, bond_paid_date, bond_back_date, bond_back_cents, bond_back_voucher,
  deadline, open_date, owner_id, phase, result, fail_reason, win_amount_cents, mode,
  project_id, created_at, deleted_at, deleted_by, version

bid_participants（15 字段）
  company_name, is_self, price_cents, relation, risk_note, status,
  bond_cents, bond_status, result, preparer,
  checked_by, checked_at, updated_at

projects（20 字段）
  code, name, customer_id, project_type, mode, stage, status, owner_id,
  budget_cents, start_date, plan_due, actual_due, progress, remark,
  created_at, updated_at, deleted_at, deleted_by, version
```

### ★ 发现问题一：有字段但界面上看不到

这是最值得优先补的，因为**数据已经在库里，只是没露出来**。

| 字段 | 存在 | 界面 | 影响 |
|---|---|---|---|
| `bids.open_date` 开标日期 | ✓ | ✗ **完全没有** | 开标是投标最重要的时间点，现在只能记在备注里 |
| `bids.bond_paid_date` 保证金缴纳日 | ✓ | ✗ **完全没有** | 退保证金时算不清占用天数 |
| `bids.customer_id` 业主单位 | ✓ | ✗ **投标页没用** | 投标阶段看不到是哪个业主的项目 |
| `bids.bond_back_cents` 退还金额 | ✓ | 只在编辑弹窗 | 卡片上不显示，要打开才知道退了没 |

### ★ 发现问题二：真实业务缺失的字段

#### 投标项目（bids）建议补

| 字段 | 类型 | 为什么需要 |
|---|---|---|
| `bid_no` 招标编号 | 文本 | **和项目编号同理**：招标文件上的编号，现在是系统自动生成 B2026-034，对不上招标文件 |
| `agent_company` 代理机构 | 文本 | 招标代理公司，答疑、保证金退还都要联系他们 |
| `bid_method` 招标方式 | 枚举 | 公开招标/邀请招标/竞争性谈判/单一来源 —— 影响流程和时限 |
| `site_visit_date` 现场踏勘 | 日期 | 很多项目要求踏勘签到，漏了就废标 |
| `qa_deadline` 答疑截止 | 日期 | 晚于这个时间提问无效 |
| `doc_price_cents` 标书费 | 金额 | 购买招标文件的费用，要报销 |
| `bid_open_place` 开标地点 | 文本 | 异地开标要提前安排行程 |

#### 投标参与方（bid_participants）建议补

| 字段 | 类型 | 为什么需要 |
|---|---|---|
| `contact_person` 联系人 | 文本 | 陪标方要联系对接，现在只有公司名 |
| `contact_phone` 联系电话 | 文本 | 同上 |
| `qualification` 资质情况 | 文本 | 这家是否满足招标要求的资质等级 |
| `is_disqualified` 是否废标 | 布尔 | 现在只能靠 `result='废标'`，但「废」和「未中标」在评标里有严格区别 |
| `score` 评标得分 | 数字 | 开标后知道分数，用于复盘「输在哪」 |
| `rank` 排名 | 数字 | 第几名，复盘时很重要 |

#### 项目（projects）建议补

| 字段 | 类型 | 为什么需要 |
|---|---|---|
| `contract_no` 合同编号 | 文本 | 项目立项后签的合同号，和合同模块对账用 |
| `customer_contact` 业主联系人 | 文本 | 现在是 customers 表统一存，但一个项目可能有多个对接人 |
| `site_address` 项目实施地 | 文本 | 实施、售后派工需要 |

### ★ 发现问题三：状态字段语义重叠

```
bids.phase   立项评审/报名/资格审查/待递交/已递交/已开标   ← 流程阶段
bids.result  待开标/中标/未中标/废标                      ← 开标结果

bid_participants.status  编标中/待递交/已递交/未中标/中标/废标
bid_participants.result  待开标/中标/未中标/废标
```

**参与方的 `status` 和 `result` 有重叠**：
`status` 里也有「中标/未中标/废标」，和 `result` 完全重复。

实际含义应该是：

```
status  →  过程状态：编标中 / 待递交 / 已递交 / 已撤回
result  →  最终结果：待开标 / 中标 / 未中标 / 废标
```

现在 status 混进了结果值，会导致：

- 同一家可能出现 status='中标' 但 result='未中标' 的矛盾数据
- 统计「有多少家已递交」时，把已出结果的也数进去

---

## 三、优先级建议

### P0 — 立刻补（字段已有，只缺界面）

```
bids.open_date       开标日期    →  卡片字段网格 + 编辑表单
bids.bond_paid_date  保证金缴纳日 →  编辑表单
bids.customer_id     业主单位    →  卡片显示 + 编辑可选
```

**成本最低、收益最直接**：数据在库里，只是没露出来。

### P1 — 建议补（真实业务需要）

```
bids.bid_no           招标编号（对账必需）
bids.agent_company    招标代理机构
bids.bid_method       招标方式
participants.contact_person / contact_phone  参与方联系人
```

### P2 — 锦上添花

```
bids.site_visit_date / qa_deadline / doc_price_cents  流程细节
participants.score / rank                            复盘分析
projects.contract_no / site_address                  实施需要
```

### 建议先做的一个清理

**统一参与方 status / result 的语义**：

```
status 只留过程值：编标中 / 待递交 / 已递交 / 已撤回
result 只留结果值：待开标 / 中标 / 未中标 / 废标
```

这是一次数据清洗，需要先跑一遍把历史数据里 status 的「中标/未中标/废标」迁到 result。

---

## 四、验证

| 检查项 | 结果 |
|---|---|
| 本方参与方返回项目任务（4 项）| ✓ |
| 陪标参与方不返回项目任务（0 项）| ✓ |
| 页面已无独立「投标任务分解」区块 | ✓ |
| 总体进度只按本家任务算 | ✓ |
| 单元测试 | 303/303（新增 3）|
| 类型检查 | 零错误 |
| 容器 | 双 healthy |

---

## 五、变更清单

```
修改：
  app/api/bids/participants/tasks/route.ts   GET 增加 isSelf + bidTasks
  app/bidding/BidTaskProgress.tsx            弹窗分两区：项目任务 / 本家进度
  app/bidding/BidProjectCard.tsx             删除底部「投标任务分解」区块
  app/bidding/page.tsx                       移除 getBidTasks 预取
  tests/domain.test.mjs                      新增 3 个测试
```
