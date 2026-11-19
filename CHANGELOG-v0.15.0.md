# 定时任务手动触发验证报告

日期：2026-10-29 13:23

---

## 一、结论

手动触发全部 8 个任务，**发现并修复 3 个隐藏 bug**。现在 8 个任务全部正常执行。

| 任务 | 修复前 | 修复后 |
|---|---|---|
| 节点超期 | 正常 | ✅ 推送 1 |
| 回款逾期 | 正常 | ✅ 检查 2 笔 |
| 投标截止 | 正常 | ✅ 推送 2 |
| 质保到期 | 正常 | ✅ 推送 1 |
| 库存预警 | 正常 | ✅ 推送 1 |
| 审批超时 | **潜在崩溃** | ✅ 已修复 |
| SLA 超时升级 | **崩溃** | ✅ 已修复 |
| 磁盘使用率 | 正常 | ✅ 正常 |

---

## 二、发现的 3 个 Bug

### Bug 1：SLA 任务查了不存在的列

```
error: no such column: updated_at
```

```sql
-- 错误代码
UPDATE tickets SET status='超时升级', updated_at=datetime('now','localtime') WHERE id=?
                      ^^^^^^^^^^^ tickets 表没有这一列
```

`tickets` 实际只有 `reported_at` / `responded_at` / `resolved_at`。

**为什么之前没暴露**：任务从没成功执行过，这个错误永远不会被触发。

### Bug 2：SLA 审计写入触发外键失败

修完 Bug 1 后立刻暴露第二个：

```
error: FOREIGN KEY constraint failed
```

根因：

```sql
-- audit_logs 有外键指向 users
audit_logs.user_id → users.id

-- 但代码写的是
audit({ userId: 0, userName: '系统', ... })
-- users 表里没有 id=0 的记录
```

**为什么之前没暴露**：只有在「有工单需要升级」时才走 `audit()`。
而那 2 个工单在早前测试中已被升级，状态不再是待响应，所以循环进不去。

### Bug 3：审批超时任务查了不存在的列

```sql
SELECT role_required, role_label FROM approval_steps ...
                      ^^^^^^^^^^ approval_steps 没有 role_label
```

**为什么还没崩**：当前没有超时审批（`rows` 为空，循环不执行）。
**一旦有审批挂起超过 2 天，这个任务立刻失败。**

属于「定时炸弹」，这次顺手拆了。

---

## 三、修复方案

### 1. tickets 去掉 updated_at

```sql
-- 改前
UPDATE tickets SET status='超时升级', updated_at=datetime(...) WHERE id=?

-- 改后
UPDATE tickets SET status='超时升级' WHERE id=?
```

没有加列，因为状态变更本身已由 `audit_logs` 完整记录，
加一个 `updated_at` 只是冗余，且要改表结构。

### 2. 建立系统账号（id=0）

```sql
INSERT OR IGNORE INTO users
  (id, name, username, role, active, password_hash, password_salt)
VALUES
  (0, '系统', '__system__', 'admin', 0, NULL, NULL);
```

| 字段 | 值 | 含义 |
|---|---|---|
| `active = 0` | 停用 | 无法登录 |
| `password_hash` / `salt` | NULL | 任何密码都校验失败 |
| `username = __system__` | | 人员列表显式排除 |

**为什么不把外键改成可空**：外键保证审计记录一定指向真实用户，
改可空会削弱完整性约束。建一个真实的系统账号更干净。

### 3. approval_steps 用 ROLE_LABEL 映射

```ts
// 改前
SELECT role_required, role_label FROM approval_steps ...

// 改后
SELECT role_required FROM approval_steps ...
const stepLabel = ROLE_LABEL[step.role_required as Role] ?? step.role_required;
```

### 4. 顺带修：seed-passwords 给系统账号设了密码

验证时发现系统账号 `password_hash` 不为空。

原因：`scripts/seed-passwords.js` 会给「所有没有密码的账号」设默认密码；
系统账号建出来后密码为空，正好被扫到，设成了 `Admin@123`。

虽然 `active=0` 登不进去，但有密码就是隐患。已修：

```js
for (const u of users) {
  if (u.password_hash) continue;
  if (u.username === '__system__') continue;  // 新增：系统账号不设密码
  ...
}
```

迁移里也加了强制清理：

```sql
UPDATE users SET password_hash=NULL, password_salt=NULL WHERE username='__system__';
UPDATE users SET active=0 WHERE username='__system__';
```

---

## 四、验证过程

### 阶段 1：首次触发（发现问题）

```
HTTP=200  耗时 111ms
node_overdue       sent=0  检查 1 个，推送 0 个
payment_overdue    sent=0  检查 2 笔，推送 0 笔
bid_deadline       sent=2  检查 3 个，推送 2 个
warranty_expiry    sent=1  检查 4 个，推送 1 个
stock_alert        sent=1  2 种物料不足
approval_timeout   sent=0  0 个超时
sla_escalate       sent=0  失败  ← error: no such column: updated_at
disk_usage         sent=0  磁盘正常
```

数据库变化：通知 5→22（+17），任务记录 66→74（+8），去重 9→14（+5）

### 阶段 2：修完 SQL 问题后

```
sla_escalate      失败：FOREIGN KEY constraint failed  ← 第二个 bug
```

### 阶段 3：建系统账号后（最终）

清空去重记录，重新触发：

```
任务                 sent   详情
--------------------------------------------------------------
节点超期                1   检查 1 个，推送 1 个
回款逾期                0   检查 2 笔，推送 0 笔
投标截止                2   检查 3 个，推送 2 个
质保到期                1   检查 4 个，推送 1 个
库存预警                1   2 种物料不足
审批超时                0   0 个超时
SLA 超时升级            0   检查 0 个，升级 0 个
磁盘使用率              0   磁盘正常（最高 74%，剩余 30GB）
```

**8 个任务全部成功，零错误。**

### 阶段 4：SLA 全链路验证

因为当时没有真正超时的工单（唯一一个待响应的还要等到 15:59），
手动造了一个超时场景：

```
把 WO2026-0880 的 reported_at 改到 2026-10-26 08:00（3 天前）
→ 匹配数 1
→ 触发 SLA 任务
```

结果：

```
任务结果: {ok:true, results:[{name:'SLA 超时升级', sent:1, detail:'检查 1 个，升级 1 个'}]}

审计日志: user_id=0 [系统] SLA 超时自动升级：WO2026-0880（超时约 77 小时）
          ↑ 外键写入成功，不再报错

工单状态: WO2026-0880 → 超时升级
sla 通知: 2 条
```

**端到端链路完整：查超时 → 改状态 → 写审计 → 发通知。**

测试后已还原工单状态和时间。

---

## 五、为什么这些 bug 一直没被发现

三个原因叠加：

**1. 任务从未真正执行**

上一轮才发现 middleware 拦掉了 scheduler 的请求。任务代码从上线起就没跑过，
里面的 SQL 错误自然也不会暴露。

**2. 错误被静默处理**

`runAllJobs` 里 `catch` 后记 `job_runs.status='failed'`，但没人看这张表。
接口返回 200，前端显示「执行完成」，看起来一切正常。

**3. 部分分支需要特定数据才触发**

`approval_timeout` 的 `role_label` 错误，只有在「有超时审批」时才执行到；
`sla_escalate` 的外键错误，只有在「有超时工单」时才执行到。
平时没有这类数据，代码路径根本走不到。

---

## 六、改进措施

### 已做

1. 错误返回带中文任务名 + 具体原因（不再只显示英文 key）
2. `detail` 里带错误信息，一眼能看出失败原因

```ts
// 改前：name 是英文 key，detail 只写「失败」
results.push({ key: j.key, name: j.key, sent: 0, detail: '失败', error: err });

// 改后
results.push({
  key: j.key, name: JOB_LABELS[j.key] ?? j.key,
  sent: 0, detail: '失败：' + err, error: err,
});
```

### 建议后续做

**1. 任务失败要告警**

现在失败只写 `job_runs`，没人知道。建议连续失败 3 次就推送给管理员。

**2. 加一个「任务健康」看板**

在系统管理页面显示每个任务最近执行时间、状态、成功/失败次数。
现在要去数据库查才知道。

**3. 定时任务加冒烟测试**

在 CI 里造数据跑一遍全部任务，确保 SQL 不会因为表结构变化而失效。
这次的 3 个 bug 都能被这种测试抓到。

---

## 七、验证结果汇总

| 项目 | 结果 |
|---|---|
| 8 个任务全部执行 | ✅ 零错误 |
| 实际推送通知 | ✅ 5 条（节点/投标/质保/库存）|
| SLA 全链路 | ✅ 状态+审计+通知 |
| 系统账号不可登录 | ✅ active=0, 无密码 |
| 系统账号不在列表 | ✅ |
| 单元测试 | ✅ 216/216 |
| 类型检查 | ✅ 零错误 |

## 八、当前数据

```
工单: 已关闭 1 / 待响应 1 / 待备件 1 / 超时升级 2
磁盘: 74% (剩余 30GB)
容器: projectflow healthy / nginx healthy
```

## 九、变更清单

```
修改：
  lib/jobs.ts                   SLA 去掉 updated_at、审批用 ROLE_LABEL、错误带中文名
  lib/roles.ts                  人员列表排除 __system__
  scripts/seed-passwords.js     跳过系统账号

新增：
  db/migrations/021_system_user.sql   系统账号 + 强制清理密码
```
