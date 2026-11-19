# 孤儿附件清理 + 金额换算规范化

日期：2026-10-29

---

## 一、孤儿附件清理

### 你特别强调的：不要删有用的文件

这个需求我按**「宁可漏删，绝不错删」**来做。

### 五重保护

| # | 保护 | 说明 |
|---|---|---|
| 1 | 宽限期 7 天 | 只处理修改时间早于 7 天前的文件。刚上传还没写库的瞬间绝不会被误伤 |
| 2 | 目录白名单 | 只扫描 project / agent_fee_payment。其他目录一律不碰 |
| 3 | 数据库双查 | 文件相对路径必须不在 attachments.file_path 里（精确匹配，不做模糊） |
| 4 | 只删文件不删目录 | 空目录留着，成本极低，避免误删有用途的目录层次 |
| 5 | 全程留痕 | 返回明细清单，写入 job_runs，可追溯谁什么时候删了什么 |

### 实测验证（构造 4 种场景）

```
新文件（刚建，无DB记录）       → 保留 ✓
老孤儿（8天，无DB记录）        → 删除 ✓
老文件但DB有记录（30天）       → 保留 ✓
未知目录下的老文件（30天）     → 完全不扫描 ✓
```

真实执行一次的结果：

```
{
  removed: 1,        ← 只删了该删的那一个
  keptRef: 1,        ← 有记录的老文件保住了
  keptFresh: 1,      ← 新文件保住了
  failed: 0,
  samples: ["project/999/orphan_old.txt"]
}
```

清理后目录：

```
orphan_fresh.txt     ✓ 还在
referenced_old.txt   ✓ 还在
unknown_dir/old.txt  ✓ 完全没碰
```

### 执行频率

跟随现有定时任务，**每 10 分钟检查一次**（scheduler 统一调度）。

因为只处理 7 天前的孤儿，重复运行是安全的（幂等）。

### 通知策略

- **没删东西**：不通知（避免每天一条噪音）
- **删了东西**：通知总经理 + 系统管理员，写明数量、释放空间、文件样例

---

## 二、金额换算规范化

### 问题

你指出 payments 里有两处硬编码 `/ 10000`。我全库扫了一遍，
**实际有 7 个文件、23 处硬编码**：

```
app/api/agent/route.ts              9 处
app/api/changes/route.ts            4 处
app/api/invoices/route.ts           4 处
app/api/agent/pay/route.ts          2 处
app/api/contracts/route.ts          2 处
app/api/bids/create/route.ts        1 处
app/api/import/projects/route.ts    1 处
（另 payments 已单独修）
```

### 修复

全部改为统一工具函数：

```ts
// 之前
Math.round(Number(amountWan) * 10000)
(amount / 10000).toFixed(2)

// 之后
wanToFen(Number(amountWan))
fenToWan(amount)
```

合计替换 **40 处**（含 payments）。

### 等价性验证

改换算函数最怕行为变化。我做了 4000+ 用例对比：

```
wanToFen(x)  vs  Math.round(x * 10000)      2009 用例，0 差异
fenToWan(x)  vs  (x / 10000).toFixed(2)     2005 用例，0 差异
```

覆盖边界值（0、负数、0.0001、1e6）和 2000 个随机值。
**行为完全不变，只是写法规范了。**

### 过程中修掉的一个自伤

批量替换脚本误伤了 3 处**百分比**计算的 `Math.round`
（`Math.round(x * 100)` 不涉及金额换算），
被改成了 `Math.roundX`，类型检查立刻报错：

```
error TS2551: Property 'roundX' does not exist on type 'Math'
```

已全部还原。这正是「批量改动必须过类型检查 + 逐行核对」的价值。

---

## 三、按你的决定保留现状

| 事项 | 你的决定 | 落地 |
|---|---|---|
| 附件删除 | 硬删除 | 保持 `DELETE FROM attachments` + 删文件 |
| 强制改密双重判据 | 保持现状 | 不改 |

---

## 四、回归

| 项目 | 结果 |
|---|---|
| 单元测试 | 255/255（新增 8）|
| 类型检查 | 零错误 |
| 孤儿清理场景实测 | 4/4 |
| 真实清理执行 | 精确删除 1 个，0 误删 |
| 金额换算等价性 | 4000+ 用例 0 差异 |
| 容器 | 双 healthy |

---

## 五、变更清单

```
新增：
  lib/orphan-cleanup.ts   孤儿清理核心逻辑（五重保护）

修改：
  lib/jobs.ts             新增任务 9「孤儿附件清理」
  app/api/agent/route.ts            wanToFen/fenToWan（9 处）
  app/api/changes/route.ts          wanToFen/fenToWan（5 处）
  app/api/invoices/route.ts         wanToFen/fenToWan（6 处）
  app/api/agent/pay/route.ts        wanToFen/fenToWan（3 处）
  app/api/contracts/route.ts        wanToFen/fenToWan（5 处）
  app/api/bids/create/route.ts      wanToFen/fenToWan（7 处）
  app/api/import/projects/route.ts  wanToFen（1 处）
  app/api/payments/route.ts         wanToFen/fenToWan（4 处）
  tests/domain.test.mjs             新增 8 个测试
```
