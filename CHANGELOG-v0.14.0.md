# JOB_TOKEN 配置与定时任务修复

日期：2026-10-29

---

## 一、最重要的发现：定时任务从未执行过

这次配 token，挖出一个隐藏很久的问题。

### 现象链路

```
1. middleware.ts 只检查 ltc_session cookie
2. scheduler.js 是后台进程，没有 cookie，只有 X-Job-Token 头
3. 请求在 middleware 就被 401 拦掉
4. app/api/jobs/route.ts 里的 token 校验逻辑永远执行不到
5. scheduler 拿到 401，但旧代码没检查 res.ok
6. 继续 res.json() → 得到 {error:...} → results 为空
7. 日志打印「执行完成 」后面是空 → 看起来像「跑了，今天没任务」
```

**结论：8 个定时任务（节点超期、回款逾期、投标截止、质保到期、库存预警、审批超时、工单升级、磁盘预警）从来没有真正跑过。**

### 为什么之前没发现

因为错误被静默吞掉了：

```js
// 旧代码
const res = await fetch(API, { method: 'POST', headers, body });
const data = await res.json();        // 401 时这里是 {error}，不抛异常
const summary = (data.results || []).map(...).join(' ');  // 结果是空串
console.log(`[scheduler] ${dateKey} ... 执行完成 ${summary}`);  // 看起来正常
```

日志形如 `[scheduler] 2026-10-29 08:30 执行完成 ` —— 结尾空白，很容易被当成「今天没有需要推送的」.

---

## 二、修复内容

### 1. middleware 放行 job token 通道

```ts
const JOB_PATHS = ["/api/jobs"];

function isJobRequestWithToken(req) {
  const { pathname } = req.nextUrl;
  if (!JOB_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"))) return false;
  const t = req.headers.get("x-job-token");
  return !!t && t.trim().length > 0;   // 空值不放行
}

// 在 cookie 检查之前
if (isJobRequestWithToken(req)) return NextResponse.next();
```

**安全说明**：middleware 只做「放行到下一层」，不做 token 比对。
真正的校验在 `app/api/jobs/route.ts`，那里读 `process.env.JOB_TOKEN` 做精确匹配。
未配置 JOB_TOKEN 时，route 会拒绝所有 token 请求（上一轮改的）。

### 2. scheduler.js 启动自检

```js
async function selfCheck() {
  if (!TOKEN) {
    console.error("[scheduler] ❌ JOB_TOKEN 未配置，定时任务将全部失效！");
    return false;
  }
  const res = await fetch(`${API}/config`, { headers: authHeaders() });
  if (res.ok) {
    console.log(`[scheduler] ✅ 鉴权自检通过 (token ${TOKEN.slice(0,6)}...)`);
  } else {
    console.error(`[scheduler] ❌ 鉴权自检失败：HTTP ${res.status}，请检查 JOB_TOKEN`);
  }
}
```

应用就绪后立即执行一次，配错能立刻看出来，不用等到 08:30。

### 3. scheduler.js 检查响应状态

```js
// 改前：不检查状态码，401/403 也当成成功
const data = await res.json();

// 改后
if (!res.ok) {
  const body = await res.text();
  console.error(`[scheduler] ❌ 任务执行被拒绝 (HTTP ${res.status})：${body.slice(0,120)}`);
  return;   // 不标记已执行，下一轮会重试
}
const data = await res.json();
```

**`return` 很关键**：只有执行成功才设置 `lastRunDate`，否则今天就不会再试了。

### 4. 连续失败告警

```js
authFailStreak++;
// 每 30 分钟最多提示一次，避免刷屏
if (now - lastAuthWarnAt > 30 * 60 * 1000) {
  console.error(`[scheduler] ⚠ 鉴权失败第 ${authFailStreak} 次，定时任务未执行`);
}
```

### 5. docker-compose 强制要求 JOB_TOKEN

```yaml
environment:
  - JOB_TOKEN=${JOB_TOKEN:?JOB_TOKEN 未配置，请先创建 .env 文件}
  - CAPTCHA_SECRET=${CAPTCHA_SECRET:-}
```

`${VAR:?msg}` 是 compose 的语法：变量不存在或为空时**直接报错退出**。
宁可部署失败，也不要用错配置静默运行。

### 6. deploy.sh 前置检查

```bash
if [ ! -f .env ]; then
  die "缺少 .env 文件。请执行：cp .env.example .env 并填入 JOB_TOKEN"
fi
if ! grep -qE "^JOB_TOKEN=.+" .env; then
  die ".env 中 JOB_TOKEN 为空。定时任务需要它鉴权，请先配置"
fi
```

### 7. .gitignore 补 .env

```diff
  .env.local
+ .env
+ .env.*.local
+ .env.projectflow
```

原来只有 `.env.local`，**`.env` 会被提交到 git**，等于把密钥公开。这是严重疏漏。

### 8. 新增 .env.example 模板

新环境部署时有据可循，附了生成随机值的命令。

---

## 三、验证结果

| # | 验证项 | 结果 |
|---|---|---|
| 1 | token 注入容器 | ✅ `Qy_MMhSQ...` |
| 2 | **正确 token 执行任务** | ✅ 200，真实执行 disk_usage |
| 3 | **错误 token 被拒** | ✅ 403「token 无效」|
| 4 | **无 token 仍要登录** | ✅ 401 |
| 5 | config 接口 | ✅ 200 |
| 6 | **scheduler 自检** | ✅「鉴权自检通过」|
| 7 | 浏览器登录 | ✅ 200 |
| 8 | 业务接口 | ✅ 200 |
| 9 | 首页 | ✅ 200 |

第 2 项的实际响应：

```json
{"ok":true,"results":[{"key":"disk_usage","name":"磁盘使用率",
  "sent":0,"detail":"磁盘正常（最高 73%，剩余 32GB）"}]}
```

**这是第一次看到定时任务真正执行并返回结果。**

scheduler 日志：

```
[scheduler] 调度器已启动（时间可配置，默认每天 08:30）
[scheduler] ✅ 鉴权自检通过 (token Qy_MMh...)
```

---

## 四、密钥分发说明

### 生成了两个值

| 变量 | 用途 | 长度 |
|---|---|---|
| `JOB_TOKEN` | 定时任务鉴权（必填）| 43 字符 |
| `CAPTCHA_SECRET` | 验证码签名 | 43 字符 |

### 存放位置

```
/home/ltc/.env              权限 600，root 所有（docker compose 读取）
/home/ltc/.env.projectflow  备份副本，内容相同
```

### 没有写进代码仓库

`.gitignore` 已排除，且 `.env.example` 里是空值模板。

---

## 五、后续注意

### 1. 换 token 的步骤

```bash
cd /home/ltc
# 1. 生成新值
NEW=$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')
# 2. 改 .env
sed -i "s|^JOB_TOKEN=.*|JOB_TOKEN=$NEW|" .env
# 3. 重建容器（环境变量在启动时注入，必须重启）
./deploy.sh
# 4. 看自检日志
docker logs projectflow 2>&1 | grep scheduler
```

**注意**：scheduler.js 和 Next 应用在同一个容器里，用的是同一个环境变量。
所以改一处，两边同步生效，不会出现不一致。

### 2. 如果自检失败怎么查

```bash
# 看容器里的 token
docker exec projectflow printenv JOB_TOKEN
# 看容器里的日志
docker logs projectflow 2>&1 | grep scheduler
```

典型报错：

```
❌ 鉴权自检失败：HTTP 403        → 容器 token 与 .env 不一致，重新 deploy
❌ JOB_TOKEN 未配置               → .env 没被读到，检查文件名和位置
自检无法连接应用                  → 应用还没起来，正常，1 分钟后再看
```

### 3. 定时任务的执行时间

默认每天 **08:30**，可在「基础数据 → 定时任务」里改，存在 `app_settings`。

scheduler 每 2 分钟检查一次，命中 08:30 后的 12 分钟窗口就执行。

---

## 六、这次暴露的管理问题

一个正确的安全加固（token 校验），因为没验证「调用方是否真的能通过」，
反而让功能彻底停摆，而且**没有任何报警**。

三条经验：

**1. 加固后要验证调用方能通过**

改鉴权逻辑时，不能只测「该拒绝的拒绝了」，必须测「该通过的通过了」。

**2. 失败必须可见**

`res.ok` 不检查、`res.json()` 不判断内容，是这次问题被藏住的直接原因。
现在每一步失败都有明确的 error 日志。

**3. 启动时就要验证依赖**

与其等 08:30 才发现 token 错了，不如启动 60 秒后就自检。
这个模式值得推广到其他地方（如数据库连接、目录权限）。

---

## 七、变更清单

```
修改：
  middleware.ts          放行带 X-Job-Token 的 /api/jobs 请求
  scripts/scheduler.js   启动自检 + 检查响应状态 + 失败告警
  docker-compose.yml     JOB_TOKEN 必填校验
  deploy.sh              部署前检查 .env
  .gitignore             排除 .env

新增：
  .env.example           环境变量模板
  .env                   实际密钥（服务器上，不入库）
```

## 八、验证数据

```
单元测试: 216/216 全过
类型检查: 零错误
容器状态: projectflow healthy / nginx healthy
磁盘使用: 73%（剩余 32GB）
```
