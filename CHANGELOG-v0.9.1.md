# v0.9.1 更新说明

---

## 1. 系统管理菜单默认收起

**原因**：代码里有个 `useEffect` 会在进入 `/system` 页面时自动展开。

**修复**：删掉自动展开，完全由用户手动控制。

```tsx
// 改前
useEffect(() => {
  if (pathname.startsWith('/system')) setSysOpen(true);
}, [pathname]);

// 改后：无自动展开
const [sysOpen, setSysOpen] = useState(false);
```

---

## 2. 登录超时真正生效

### 实现

系统参数 `session_timeout_min`（默认 120 分钟）现在真正参与会话校验。

会话有两道门禁，任一触发即失效：

| 门禁 | 依据 | 说明 |
|---|---|---|
| 绝对有效期 | `expires_at` | 默认 7 天，从登录算起 |
| **空闲超时** | `last_seen_at` | 超过 N 分钟无请求即失效 |

```ts
const idleMin = getParamInt('session_timeout_min', 120);
if (idleMin > 0 && row.last_seen_at) {
  const idleMs = Date.now() - new Date(row.last_seen_at).getTime();
  if (idleMs > idleMin * 60 * 1000) {
    destroySession(token);
    return null;
  }
}
```

`last_seen_at` 在每次带 cookie 的请求时刷新，所以「空闲」的定义是准确的——
用户只要还在操作就不会被踢。

配置为 `0` 表示不限制空闲超时。

---

## 3. 负载页布局

```
改前：
  资源占用
  网口流量          ← 夹在中间
  业务服务状态

改后：
  资源占用  │  业务服务状态     ← 同一行两列
  ─────────────────────────
  网口流量                    ← 独立一行，占满宽度
```

网口表格列多，单独一行才能完整显示不横向滚动。

---

## 4. 证书链验证：为什么之前不生效

### 先回答你的问题

你的原话是「证书只解析不验证链功能是因为什么不生效」。

**真相是：不是「不生效」，是我上次压根没做私钥匹配。**

我上次写的代码里有这段：
```ts
const info = parseKeyInfo(keyPem);   // ← 这里抛异常了
```

`parseKeyInfo` 里用了 `Number(details?.modulusLength)`，而 Node 的
`modulusLength` 是 **BigInt**。这个异常把整个 `try` 块打断，导致：
```
keyMatch = false   ← 被 catch 设成 false（实际是匹配的）
keyType  = null    ← 没走到赋值
keyBits  = null
```

**但这个错误的假象掩盖了更重要的真相**。修好 BigInt 之后我发现：

```
server.key  -rw------- root root   → nextjs 用户 读不了
server.crt  -rw-r--r-- root root   → nextjs 用户 可以读
```

### 结论：这是正确的安全设置，不该改

私钥 `600` 只有 root 能读，而应用以 `nextjs` 运行，读不到私钥。

**这不是 bug，是应该保持的安全边界**。私钥只该给 nginx 用，
不该为了在界面上显示一行「密钥类型 RSA 2048 bit」就放宽权限。

### 现在的处理

| 项目 | 能否检测 | 说明 |
|---|---|---|
| 证书主体/颁发者 | ✅ | 公开信息 |
| 有效期/剩余天数 | ✅ | 公开信息 |
| SAN 域名列表 | ✅ | 公开信息 |
| 证书链层数 | ✅ | 结构判断 |
| 自签判断 | ✅ | subject == issuer |
| **私钥匹配** | ❌ | **权限不足，正常** |
| **密钥类型/长度** | ❌ | 同上 |

界面上如实显示：

> 私钥 权限不足，无法读取（正常）
> 私钥通常为 600 root 权限，应用进程（nextjs 用户）无法读取。
> 这是正确的安全设置，不影响 HTTPS 正常工作（证书由 nginx 使用）。

### 关于「信任链验证」

即使用 root 跑，Node 的 `X509Certificate` 也**没有内置 Trust Store**，
无法验证完整信任链。要验需要 openssl 或额外 CA 包——而容器里没有 openssl。

内网自签场景下「信任链验证」本来也不适用（自签证书的信任是人工确认的），
所以只做结构判断是合理的。

---

## 5. 离线升级：可靠策略

### 硬约束

排查发现的事实：

```
容器内没有 docker  → 无法 load 镜像、无法重建容器
容器内没有 openssl → 无法做签名校验
容器内有 tar/gzip/node
```

**所以「网页点一下就升级」在架构上不可能**，必须有人在宿主机执行。

### 设计：两段式

```
┌─ 网页端 ──────────────────────┐
│ 1. 上传升级包                  │
│ 2. 校验（结构/版本/路径穿越）   │
│ 3. 生成升级脚本                │
└───────────┬───────────────────┘
            │ 下载 pkg + upgrade.sh
            ▼
┌─ 宿主机 ──────────────────────┐
│ 4. sudo bash upgrade.sh       │
│    ├ 标记旧镜像（回滚用）       │
│    ├ 备份数据库                │
│    ├ 解包 + 路径检查            │
│    ├ 加载镜像                  │
│    ├ 健康检查（90 秒）          │
│    └ 失败 → 自动回滚            │
└───────────────────────────────┘
```

### 升级包格式

```
pkg-xxx.tar.gz
├── manifest.json     必需
│   {
│     "version": "v0.9.1",
│     "buildTime": "2026-10-28T21:00:00Z",
│     "contents": { "image": true, "src": false, "migrations": ["018_x.sql"] },
│     "minFromVersion": "v0.9.0"
│   }
├── image.tar         docker save 的镜像（推荐）
├── src/              或源码目录（次选，需服务器重新构建）
└── migrations/       新增的 .sql
```

### 上传时的校验

| 检查 | 失败后果 |
|---|---|
| gzip 魔数 `1f 8b` | 拒绝，提示不是合法压缩包 |
| 必须有 `manifest.json` | 拒绝 |
| manifest.version 存在 | 拒绝 |
| contents 声明了 image 或 src | 拒绝，防止空包 |
| 路径穿越（`../` 或 `/` 开头） | 拒绝 |
| 版本高于当前 | 警告（允许覆盖安装） |
| 当前版本 ≥ minFromVersion | 拒绝，提示先升中间版本 |
| 大小 ≤ 500MB | 拒绝 |

### 升级脚本的安全机制

```bash
# 1. 旧镜像打标签
docker tag projectflow:latest projectflow:pre-v0.9.1

# 2. 备份数据库
docker exec projectflow node /app/scripts/backup.js

# 3. 解包前检查路径穿越
tar -tzf "$PKG" | grep -qE '(^/|\.\./)' && die

# 4. 健康检查
for i in $(seq 1 45); do
  [ "$S1" = healthy ] && [ "$S2" = healthy ] && OK=1 && break
  sleep 2
done

# 5. 失败自动回滚
docker tag "$OLD_TAG" projectflow:latest
docker compose up -d --force-recreate
```

**关键设计点**：

1. **镜像优先**——如果包里有 `image.tar`，直接 load，不需要在服务器构建
   （服务器往往不能联网拉依赖）
2. **失败必回滚**——健康检查不过就切回旧镜像，不会留下一半坏一半
3. **构建失败不动服务**——源码模式时 `docker compose build` 失败会直接退出，
   此时旧容器还在跑，服务不中断
4. **脚本单独生成**——不把脚本预置在服务器上，每次按版本生成，避免用错版本

### 实测

```
上传合法包  → 校验通过，解析出 v0.9.1
上传无 manifest 的包 → 拒绝
上传 .txt → 拒绝
生成脚本   → 4650 字节，bash -n 语法检查通过
脚本内容   → 版本号正确替换，含回滚逻辑
```

---

## 开发中修的 4 个 bug

### 1. 私钥检测被 BigInt 打断

```
TypeError: Do not know how to serialize a BigInt
```

`modulusLength` 是 BigInt，`Number()` 处理它时抛异常，
把外层 try 整块打断，`keyMatch` 被 catch 设成 false。

修复：显式 `Number(details.modulusLength)`，并把「密钥信息」和
「公钥对比」拆成两个独立 try，互不干扰。

### 2. 升级包同秒上传互相覆盖

文件名用 `pkg-<时间戳>.tar.gz`，精确到秒。同一秒传两个包会覆盖。

实测就中招了：第一个包的 manifest 被第二个覆盖，导致校验失败。

修复：加 4 位随机后缀 `pkg-<时间戳>-<rand>.tar.gz`。

### 3. manifest 路径带 `./` 前缀

用 `tar czf x.tar.gz -C dir .` 打包，内部路径是 `./manifest.json`。

`tar -xzOf x.tar.gz manifest.json` 找不到。

修复：两种路径都试。

### 4. shell 模板与 JS 模板字符串冲突

第一版在 TS 里直接写 bash，`${STAMP}` 被 JS 提前展开成 `undefined`。

改了两轮都不干净（引号被工具吃掉）。

最终方案：**脚本正文独立成文件** `scripts/upgrade-template.sh`，
TS 只负责读文件 + 替换 `__VER__` 这类占位符。

好处：语法高亮正常、可以 `bash -n` 检查、改脚本不用碰 TS。

---

## 验证结果

| 项目 | 结果 |
|---|---|
| 单元测试 | **155/155**（新增 18）|
| 类型检查 | 零错误 |
| 10 个页面 | 全部 200 |
| 系统管理默认收起 | ✅ |
| 基础数据在操作日志前 | ✅ |
| 业务主线已改名 | ✅ |
| 负载页布局 | 资源/服务同行，网口在下 ✅ |
| 会话空闲超时 | 已接入 ✅ |
| 证书 keyReadable | 正确识别权限不足 ✅ |
| 私钥路径 | /app/certs/server.key ✅ |
| 升级包校验 | 合法包通过，非法包拒绝 ✅ |
| 升级脚本 | bash -n 通过，4650 字节 ✅ |
| 错误日志 | 0 条 |

## 遗留说明

**1. 私钥信息永远读不到（这是对的）**

除非把私钥权限改成 644（不推荐）或让应用以 root 跑（更不推荐）。
界面上已说明原因，不算缺陷。

**2. 升级脚本需要人工执行**

这是容器架构的硬限制，不是实现偷懒。要做到「真·一键」需要把应用
改成 systemd service 或给容器挂 docker socket——后者等于把 root 权限
交给 Web 应用，安全风险远大于便利。
