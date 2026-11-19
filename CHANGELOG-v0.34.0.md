# 时区统一 + 8 类业务文件落地

日期：2026-10-29

---

## 一、时区

### 1. 原来有 26 处日期 bug

系统里到处写：

```ts
new Date().toISOString().slice(0, 10)
```

`toISOString()` 返回 **UTC**。东八区下：

```
本地 2026-10-29 07:00  →  UTC 2026-10-28 23:00  →  取到 "2026-10-28"
```

**每天凌晨 0:00–8:00 之间，所有「取今天日期」都会记成昨天。**

受影响的功能：

```
合同签署日、回款计划日、开票日、项目节点计划日、
变更生效日、出入库日、验收提交日、逾期天数计算
```

这不是显示问题，是**写进数据库的错误数据**。尤其 `overdueDays()`，
算错直接导致逾期提醒不触发或误触发。

### 2. 修复

新建 `lib/time.ts`，全部按配置时区取日期：

```ts
todayLocal()      // 2026-10-29
nowLocalFull()    // 2026-10-29 23:04:01
tzOffsetMinutes() // 480（东八区）
```

**26 处硬编码全部替换，剩余 0 处。**

### 3. 设置界面

「系统参数」页新增「时区与时间」面板：

```
· 11 个常用时区可选（默认 Asia/Shanghai）
· 实时显示服务器时间（按所选时区）
· 实时显示浏览器时间，自动计算偏差
· 偏差 ≥1 分钟时红色提示「时间不一致」
· 仅总经理 / 系统管理员可修改
```

实测切换：

```
Asia/Shanghai  23:03:09  偏移 +480
UTC            15:03:09  偏移 0      ← 正好差 8 小时
非法时区        HTTP 400             ← 正确拒绝
```

---

## 二、8 类业务文件

### 摸底结果：文件能传，但跟业务无关

改造前只有两处能上传：

| 位置 | 情况 |
|---|---|
| 项目详情页「附件资料」 | 能传任意文件，但都堆在项目下，无分类 |
| 过单费付款 | 有 3 个上传位（个人凭证） |

**验收资料面板只有 4 个下拉框，改了状态没有任何文件。**
**合同、发票完全没有上传入口。**

### 改造后：每类文件都有专属位置

| 业务文件 | 挂载实体 | 位置 |
|---|---|---|
| 招标 / 投标文件 | `bid` | 投标管理表格 |
| 中标通知书 | `award` | 投标管理表格（仅中标时显示）|
| 合同扫描件 | `contract` | 合同管理（客户 + 采购两张表）|
| 实施方案 | `implementation` | 项目详情页专属区块 |
| 验收资料 | `acceptance` | 验收面板每行（四类各一）|
| 发票 | `invoice` | 开票记录表格 |
| 回款凭证 | `payment` | 回款期次表格 |
| 过单费凭证 | `agent_fee_payment` | 付款弹窗（原有）|

### 权限：全部反查项目

每个新类型都在 `resolveProjectId()` 里写清怎么定位到项目：

```
bid/award      → bids.project_id
contract       → contracts.project_id
acceptance     → acceptances.project_id
invoice        → invoices.project_id
payment        → payment_terms.contract_id → contracts.project_id
```

**新增类型必须同时登记到白名单和反查逻辑**，否则默认拒绝 ——
防止以后加业务忘配权限导致越权。

### ★ 验收闸门：没有文件不算齐备

这是本次最重要的改动。

**改造前**：把四个下拉框点成「已提交/已签收/已出具/已齐备」，
一道闸门就全开了 —— 哪怕系统里一个文件都没有。
等真出事（客户拒付、审计要查），才发现「验收报告」根本不存在。

**改造后**：状态齐备 **且** 每项至少一个附件，才算真齐备。

```ts
if (!statusOk) missing.push(docType);
else if (!hasFile) {
  missing.push(docType);
  missingFiles.push(docType);   // 状态完成了但没文件
}
```

`missingFiles` 单独归类，前端会明确提示：
「其中『验收报告』状态已完成但没有任何附件」。

实测：

```
项目6  状态 4/4 完成，有文件 0/4
  → ok: false, done: 0, 缺文件: [全部 4 项]
```

---

## 三、踩过的三个坑

### 坑 1：前后端共用模块导致构建失败

最初 `lib/time.ts` 里写了 `getTimezone()`（读数据库），
前端组件 import 了 `todayLocal`，webpack 顺着：

```
time.ts → db.ts → better-sqlite3 → node:fs
```

一路打进浏览器包，构建报：

```
UnhandledSchemeError: Reading from "node:fs" is not handled by plugins
```

**修复**：拆成两个文件

```
lib/time.ts         纯函数，零依赖，前后端都能用
lib/time-server.ts  会读数据库，只能服务端用
```

### 坑 2：import 路径后缀的两难

`domain.ts` 需要 `todayLocal`，但：

```
写 "./time"    → Next.js 构建 OK，Node ESM 测试报 ERR_MODULE_NOT_FOUND
写 "./time.js" → 测试 OK，Next.js 构建报 Can't resolve './time.js'
```

两者互斥，写哪个另一个就挂。

**修复**：`domain.ts` 不跨文件依赖，直接内联 3 行实现。
`lib/time.ts` 保留完整工具给其他模块用。

### 坑 3：测试编译缓存

改了 `tsconfig.test.json` 的 include 后测试仍报模块找不到 ——
`.test-build/` 是增量编译，旧产物还在。加 `rm -rf .test-build` 才生效。

---

## 四、验证

### 时区

| 测试 | 结果 |
|---|---|
| 服务器时间 Asia/Shanghai | 23:03:09，偏移 +480 |
| 切到 UTC | 15:03:09，偏移 0（差 8 小时）|
| 切回上海 | 23:03:10 |
| 非法时区 | HTTP 400 |
| 凌晨 7 点取日期 | 2026-10-29（旧写法 10-28）|

### 附件（总经理身份实测）

```
bid            HTTP 200
award          HTTP 200
contract       HTTP 200
implementation HTTP 200
acceptance     HTTP 200
invoice        HTTP 200
payment        HTTP 200
```

### 回归

| 项目 | 结果 |
|---|---|
| 单元测试 | 275/275（新增 20）|
| 类型检查 | 零错误 |
| 构建 | 成功 |
| 容器 | 双 healthy |

---

## 五、变更清单

```
新增：
  lib/time.ts                    纯函数时间工具（前后端通用）
  lib/time-server.ts             服务端时间工具（可读数据库时区）
  app/api/system/timezone/route.ts   时区读写接口
  app/settings/TimezonePanel.tsx     时区设置面板
  components/BizFileCard.tsx         业务附件卡片（单文件为主）

修改：
  lib/domain.ts                  内联日期实现，修 overdueDays/daysFromNow
  lib/attachment-acl.ts          扩展为 9 类实体 + 反查项目权限
  lib/queries.ts                 canAdvanceToInvoice 增加「必须有文件」
  lib/jobs.ts                    today/nowLocal 走配置时区
  app/api/attachments/route.ts   白名单同步扩展
  app/settings/page.tsx          接入时区面板

  26 处 toISOString().slice(0,10) 全部替换为 todayLocal()
  （涉及 17 个文件：合同、变更、开票、回款、节点、库存、导出、日志、验收等）

  8 处业务页面接入附件上传：
    app/bidding/page.tsx           招标/投标文件 + 中标通知书
    app/contracts/page.tsx         客户合同 + 采购合同扫描件
    app/finance/page.tsx           发票文件 + 回款凭证
    app/projects/[id]/page.tsx     实施方案专属区块
    app/projects/[id]/AcceptancePanel.tsx  验收四类各一

  tests/domain.test.mjs          新增 20 个测试
```

---

## 六、需要你知道的业务影响

**验收闸门变严了，存量项目会被拦。**

```
项目6  状态 4/4 完成 → 现在 0/4（无任何文件）
项目7  状态 4/4 完成 → 现在 0/4（无任何文件）
```

这两个项目原本可以直接推进到开票，现在必须补齐验收文件。

这是设计意图（拦住假齐备），但如果影响正在执行的项目，
可以考虑加一个「历史项目豁免」开关。需要的话告诉我。
