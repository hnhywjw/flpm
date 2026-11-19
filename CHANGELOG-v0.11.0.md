# v0.11.0 更新说明

本轮 5 项，其中 2 项是 bug 修复（令牌面板位置、进程关联遗漏）。

---

## 5. 令牌功能没起作用 —— 根因与修复

### 现象

「设置」页面里完全看不到令牌认证，登录也不会要求输入动态码。

### 排查过程

先确认后端没问题：

```
数据库字段 totp_secret / totp_enabled  → 存在 ✅
登录 API 接受 totpCode 参数            → 正常 ✅
生成密钥 / 确认绑定 / 恢复码           → 全部可用 ✅
```

再查前端：

```bash
curl /settings | grep 令牌
# 结果：找不到
```

但检查打包产物：

```bash
grep 令牌认证 .next/static/chunks/app/settings/*.js
# 结果：page-feed731c88a2d086.js -> 令牌认证, 修改密码, 启用令牌认证, 恢复码
```

**代码明明打包进去了，为什么不显示？**

### 根因：JSX 插错了位置

上一轮我用脚本自动插入 `TotpPanel`，插入点是「`<div className="card">` 之前」，
但文件里有两处同样的 `<div className="card">`——脚本匹配到了**第一个**，
也就是「**角色配置**」那一块。

结果：

```
角色配置 tab
  ├ 角色列表
  └ TotpPanel  ← 插错位置

人员管理 tab
  └ 人员列表（令牌面板不在这里）
```

而「人员管理」是 `tab === "users"` 才渲染的，角色区的 `TotpPanel` 依赖 `editUser`，
进入设置页时 `editUser` 为空 → 不渲染 → 页面里完全没有。

### 修复

把 `TotpPanel` 移到人员 tab 的编辑表单之后（正确的上下文），
同时去掉保存后的 `setEditUser(null)`——否则保存一次编辑，令牌面板就消失了。

### 这个 bug 的教训

用脚本做「按文本匹配插入代码」时，**目标文本必须唯一**。
当时 `'<div className="card">'` 出现了两次，脚本静默插到了第一处。

现在补了验证手段：直接检查打包产物里有没有关键字符串。

---

## 4. 进程状态不完整 —— 根因与修复

### 现象

「相关进程状态」只显示 6 个进程，和「业务服务状态」对不上。

### 排查

直接列容器内所有进程：

```
TOTAL PIDS: 7
1   | entrypoint.sh        | 1.6MB
12  | npm exec next s      | 79.3MB
30  | sh                   | 0.9MB
31  | next-server (v15.1.0)| 188.1MB
84  | node scheduler.js    | 43.8MB
85  | node backup-scheduler| 43.7MB
122 | node (临时测试脚本)   | 43.6MB
```

**容器里总共只有 7 个进程**——不是采集漏了，是我们关联逻辑有盲区。

### 两个问题

**问题 1：启动链路没关联全**

Web 服务实际由 4 个进程串起来：

```
entrypoint.sh → npm exec next start → sh -c next start → next-server
```

原来的 `servicesForProcess` 只认 `next-server`，中间三个都返回 `null`。
结果：Web 服务只显示 1 个进程，另外 3 个孤零零列在下面。

**问题 2：旧的 12 条上限**

```ts
slice(0, 12)   // 之前：最多 12 个
```

对 7 个进程的容器没影响，但容器一旦跑多进程就会截断。

### 修复

```ts
// 关联规则补全整个启动链路
if (c.includes("next-server")) return "web";
if (/\bnext\b\s+start/.test(c)) return "web";
if (c.includes("entrypoint.sh")) return "web";
if (p.pid === 1) return "web";

// 上限放宽到 60，且优先按「有服务关联」排序
return out.sort((a, b) => {
  const sa = a.serviceKey ? 1 : 0;
  const sb = b.serviceKey ? 1 : 0;
  if (sa !== sb) return sb - sa;   // 有服务关联的排前面
  return b.rssMB - a.rssMB;
}).slice(0, 60);
```

### 修复后

```
PID 31   next-server       svc=web   应用服务
PID 12   npm exec next s   svc=web   应用服务
PID 30   sh                svc=web   应用服务
PID 1    entrypoint.sh     svc=web   容器主进程
PID 86   node              svc=jobs  任务调度
PID 87   node              svc=jobs  备份调度

未关联服务的进程: 0
```

服务级聚合也对了：

```
Web 服务    250.7MB   pids=[31, 12, 1, 30]
定时任务     87.7MB   pids=[86, 87]
```

---

## 1. 系统初始化（清空业务数据）

### 位置

```
系统管理 → 系统初始化
```

### 安全设计（四层）

```
1. 权限      → 仅 boss / admin
2. 密码二次认证 → 必须输入**当前登录账号**的密码
3. 确认短语  → 必须手输「清空全部数据」五个字
4. 自动备份  → 清空前 VACUUM INTO 完整备份，失败则中止
```

### 清空范围

| 处理 | 表 |
|---|---|
| **清空**（30 张） | projects, project_nodes, bids, contracts, payment_terms,
|  | invoices, acceptances, agent_*, stock*, items, warehouses,
|  | tickets, warranties, attachments, changes, risk_register,
|  | approval_*, customers, notifications, audit_logs 等 |
| **保留**（8 张） | users, roles, user_roles, app_settings,
|  | system_params, notify_config, code_sequences, backup_log |

保留账号和配置，是因为「新环境部署」后还要能登录进去。

### 界面

会实时显示每张表的记录数：

```
当前数据量  业务数据 422 条

  projects        12    contracts      8
  payment_terms   34    customers     11
  stock           56    tickets        3
  ...

以下表会被保留：
  users(10) roles(7) user_roles(10) app_settings(5) ...
```

### 执行后

```
初始化完成
清空记录：422 条
涉及表：30 张
备份文件：pre-init-20261029095700.db
```

---

## 2. 基础数据 tab 数量显示 0

### 原因

```ts
// 改前：每次只请求当前选中的 tab
async function load(t = tab) {
  fetch(`/api/base-data?type=${t}`)
}
```

只有当前 tab 有数据，其他两个 tab 的 `data[t]` 一直是 `undefined` → 显示 0。

### 修复

```ts
// 改后：一次性加载全部三类
fetch('/api/base-data')   // 不传 type，后端返回全部
```

现在三个 tab 都显示真实数量：客户 11、物料 5、仓库 2。

---

## 3. 修改密码位置调整

```
改前：基础数据页底部有个「修改密码」卡片（只能改自己的）
改后：人员管理 → 每个用户操作列 → 「修改密码」按钮 → 弹窗
```

弹窗校验：

| 检查 | 提示 |
|---|---|
| 少于 8 位 | 密码至少 8 位 |
| 无字母 | 密码必须包含字母 |
| 无数字 | 密码必须包含数字 |
| 两次不一致 | 两次输入的密码不一致 |

改成功后该用户所有会话强制失效，需用新密码重新登录。

---

## 验证结果

| 项目 | 结果 |
|---|---|
| 单元测试 | **202/202**（新增 12）|
| 类型检查 | 零错误 |
| 令牌面板已打包 | ✅ 4 个关键字命中 |
| 修改密码按钮已打包 | ✅ |
| 基础数据三类数量 | 11 / 5 / 2 ✅ |
| 进程关联 | **0 个未关联** ✅ |
| Web 服务聚合 | 4 进程 / 250.7MB ✅ |
| 初始化预览 | 422 条业务数据 / 30 张表 ✅ |
| 错误短语被拒 | ✅ 400 |
| 错误密码被拒 | ✅ 401 |
| 7 个页面 | 全部 200 |

## 关于「curl 看不到令牌面板」

这不是 bug。设置页是客户端组件，默认 `tab = "roles"`，
服务端渲染 HTML 里只有「角色配置」的内容。

点「人员管理」tab 后才由 React 渲染出令牌面板和修改密码按钮。

验证方式是查打包产物（已确认 4 个关键字都在）。
