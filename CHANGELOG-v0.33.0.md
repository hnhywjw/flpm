# 定时任务告警：根因与修复

日期：2026-10-29

---

## 一、告警的直接原因

今天的 `job_runs` 里有 2 次失败，`sla_escalate` 任务：

```
id=73  11:51:56  failed  "no such column: updated_at"
id=97  13:15:57  failed  "FOREIGN KEY constraint failed"
```

而状态判定逻辑是：

```ts
status: failedRuns > 0 ? "warn" : okRun ? "ok" : "warn"
```

`failedRuns` 统计的是**今天失败次数**，只要今天挂过一次，
**接下来一整天都显示告警**，哪怕后面已经恢复了。

---

## 二、两个真实 bug

### Bug 1：审计日志写死 userId: 0，触发外键失败

`lib/jobs.ts` 里：

```ts
audit({ userId: 0, userName: "系统", ... })
```

但 `audit_logs.user_id` 有外键指向 `users(id)`，且 `foreign_keys = ON`。
数据库里**没有 id=0 的用户**（后来才手动补了一个 `active=0` 的「系统」）。

结果：

```
插入 audit_logs(user_id=0)
  → FOREIGN KEY constraint failed
  → 整个 jobSlaEscalate 抛异常
  → job_runs 记 failed
  → 定时任务显示告警
```

**更麻烦的是**：这个异常发生在「工单状态已改完」之后、任务返回之前。
于是任务既改了数据又报失败，下次重试还会再改一次。

### Bug 2：开始时间和结束时间差 8 小时

```ts
const started = new Date().toISOString().slice(0, 19).replace("T", " ");  // UTC
// finished_at 用的是 datetime('now','localtime')                        // 本地
```

同一行记录里：

```
started_at  : 2026-10-29 05:22:52   ← UTC
finished_at : 2026-10-29 13:22:52   ← 本地
```

看起来像每个任务都跑了 8 个小时。

---

## 三、修复

### 1. audit() 内部做外键兜底（根治）

不只是在 jobs.ts 改 `0 → null`，而是让 audit 本身不再可能炸：

```ts
// userId 不是数据库里真实存在的用户时，降级为 NULL
let safeUserId = params.userId;
if (safeUserId !== null && safeUserId !== undefined) {
  const exists = getDb().prepare("SELECT 1 FROM users WHERE id = ?").get(safeUserId);
  if (!exists) safeUserId = null;
}
```

这样以后任何调用方再传错 id，只会丢一个外键，**不会拖垮业务流程**。

同时把 jobs.ts 里的 `userId: 0` 改成 `null`（系统行为本来就没有操作人）。

### 2. 统一用本地时间

新增 `nowLocal()` 辅助函数，替代 `toISOString()`：

```ts
function nowLocal(): string {
  // 返回 "YYYY-MM-DD HH:mm:ss"，与 SQLite 的 localtime 对齐
}
```

### 3. 状态判定改为「看当前是否真的有问题」

```ts
// 修复前：今日失败次数 > 0 就告警
// 修复后：看每个任务「最近一次执行」的结果
const latestByJob = all(`
  SELECT j.job_key, j.status, j.finished_at
  FROM job_runs j
  JOIN (SELECT job_key, MAX(id) AS max_id FROM job_runs GROUP BY job_key) m
    ON m.max_id = j.id`);
const brokenJobs = latestByJob.filter((j) => j.status !== "ok");
const status = brokenJobs.length > 0 ? "warn" : !okRun ? "warn" : "ok";
```

并且详情里区分显示：

```
最近执行 sla_escalate（成功）于 2026-10-29 22:39:53，今日 52 次执行
（今日历史失败 2 次，均已恢复）
```

新增检查项「未恢复任务」，直接告诉运维到底哪个任务还没爬起来。

### 4. 逐条容错

单个工单处理失败不再连累整批：

```ts
try {
  run("UPDATE tickets SET status = '超时升级' WHERE id = ?", [r.id]);
} catch (e) {
  audit({ ... summary: `SLA 升级失败：${r.code}（${e.message}）` });
  failed++;
  continue;
}
```

返回值会带 `失败 N 个`。

---

## 四、验证

### 触发全部任务（用内部 JOB_TOKEN）

```json
{ "ok": true, "results": [
  { "key": "node_overdue",     "detail": "检查 1 个，推送 0 个" },
  { "key": "payment_overdue",  "detail": "检查 1 笔，推送 0 笔" },
  { "key": "bid_deadline",     "detail": "检查 3 个，推送 0 个" },
  { "key": "warranty_expiry",  "detail": "检查 3 个，推送 0 个" },
  { "key": "stock_alert",      "detail": "今日已推送" },
  { "key": "approval_timeout", "detail": "0 个超时" },
  { "key": "sla_escalate",     "detail": "检查 0 个，升级 0 个" },
  { "key": "disk_usage",       "detail": "1 个分区告警，最高 81%（/app/db）" },
  { "key": "orphan_cleanup",   "detail": "扫描 0 个文件，无孤儿" }
] }
```

**9 个任务全部成功，包括新加的孤儿清理。**

### 时间戳一致性

```
id=125 orphan_cleanup ok  started=22:39:53  finished=22:39:53  同分钟=是
id=124 disk_usage     ok  started=22:39:53  finished=22:39:53  同分钟=是
id=123 sla_escalate   ok  started=22:39:53  finished=22:39:53  同分钟=是
```

### 状态判定

```
latestByJob: 8 个任务全部 ok
brokenJobs: 0
failedRuns: 2（历史，已恢复）
→ 计算出的状态: ok
```

---

## 五、回归

| 项目 | 结果 |
|---|---|
| 单元测试 | 265/265（新增 10）|
| 类型检查 | 零错误 |
| 全部任务实跑 | 9/9 成功 |
| 时间戳一致性 | 通过 |
| 状态判定 | 计算为 ok |
| 容器 | 双 healthy |

---

## 六、顺带发现（与本次无关）

**服务器根分区已用 86%（118G/145G），剩余 20G。**

不是本应用造成的：

```
/home/ltc/db        17M（其中 backup 17M）
/home/ltc/uploads   44K
```

应用总共占不到 20MB。这是服务器上其他东西占的。
磁盘任务已经在 81% 阈值持续告警，建议找运维看看 118G 都去哪了。

---

## 七、变更清单

```
修改：
  lib/db.ts        audit() 增加外键兜底（userId 不存在时降级 NULL）
  lib/jobs.ts      userId: 0 → null
                   新增 nowLocal()，started_at 不再用 toISOString()
                   sla_escalate 逐条 try/catch，返回值带失败数
  lib/sysinfo.ts   状态判定改为「看每个任务最近一次结果」
                   新增「未恢复任务」检查项
                   详情区分「当前故障」与「历史失败已恢复」
  tests/domain.test.mjs  新增 10 个测试
```
