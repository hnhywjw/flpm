# 部署与运维（已在实际服务器验证）

## 当前部署状态

| 项目 | 信息 |
|---|---|
| 服务器 | 部署机（Linux，需已安装 Docker） |
| 部署目录 | `/home/ltc` |
| 访问地址 | **https://服务器IP:9443**（HTTP 9081 会跳转到 HTTPS） |
| 容器名 | `projectflow` |
| 镜像 | `projectflow:latest` |
| 数据库 | `/home/ltc/db/app.db`（挂载持久化） |
| 时区 | `Asia/Shanghai`（容器内已验证 CST） |
| 健康状态 | healthy，内存占用约 92 MB |

> 服务器 80 和 8080 端口已被 monkeyai、koala-qa、panda-wiki 等现有服务占用，本系统使用 **3000**。

---

## 一、日常运维命令

```bash
cd /home/ltc

./deploy.sh status     # 查看状态 + 站点可用性
./deploy.sh logs       # 实时日志
./deploy.sh restart    # 重启
./deploy.sh stop       # 停止
./deploy.sh backup     # 备份数据库
```

---

## 二、更新代码后重新部署

```bash
cd /home/ltc
# 把新代码覆盖到本目录后：
./deploy.sh
```

脚本会自动：构建镜像 → 重启容器 → 等待健康检查 → 输出访问地址。

数据库在 `./db` 挂载卷里，**重新部署不会丢数据**（已实测验证）。

---

## 三、数据备份

```bash
./deploy.sh backup
# 输出：backup/app-20261028-121500.db
```

每日自动备份（crontab）：

```bash
crontab -e
# 加入：
0 2 * * * cd /home/ltc && ./deploy.sh backup >> backup/cron.log 2>&1
```

> ⚠️ **不要直接 `cp db/app.db`**。SQLite 开着 WAL 模式，正在写入时直接复制会拿到不一致的快照，必须用 `.backup` 命令（脚本已处理）。

---

## 四、镜像源说明（重要）

服务器**无法访问 Docker Hub**（`registry-1.docker.io` 超时），因此：

- 基础镜像走 **`docker.m.daocloud.io`** 镜像站
- npm 包走 **`registry.npmmirror.com`**

Dockerfile 里已固定这些源，无需手动配置。如果哪天镜像站失效，改 Dockerfile 第一行的 `ARG NODE_IMAGE` 即可：

```dockerfile
ARG NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim
# 备选：docker.1ms.run/library/node:22-bookworm-slim
```

---

## 五、部署中已解决的技术问题

以下都是实际踩到并修复的，供后续维护参考：

| 问题 | 原因 | 解决方案 |
|---|---|---|
| `npm install` 编译 better-sqlite3 失败 | 纯 node 镜像缺 python3/make/g++ | 依赖层 `apt-get install python3 make g++` |
| `Unable to locate package su-exec` | 该包只有 Alpine 有 | Debian 改用 `gosu` |
| `chown: can't find uid for user nodejs` | `--chown` 只能用构建阶段的用户，`nodejs` 是运行阶段创建的 | 改用数字 `1001:1001` |
| `SQLITE_CANTOPEN` 容器无限重启 | 宿主机 `db/` 属 root，容器内以 nextjs(1001) 运行无法写入 | entrypoint 以 root 启动，`chown` 后再 `gosu` 降权 |
| 时间差 8 小时 | 容器默认 UTC | 装 `tzdata` + `TZ=Asia/Shanghai` + 软链 `/etc/localtime` |
| 外部访问不到 | `next start` 默认只监听 localhost | 加 `-H 0.0.0.0` |

---

## 六、验证结果

### 页面（全部 HTTP 200）

```
/                 工作台          45.6 KB
/projects         项目管理        29.7 KB
/projects/1       项目详情        62.8 KB
/bidding          投标管理        37.7 KB
/agent            代中标管理      28.9 KB
/contracts        合同管理        37.9 KB
/finance          开票与回款      63.9 KB
/inventory        出入库          31.3 KB
/service          售后服务        28.0 KB
/alerts           待办预警        35.5 KB
/settings         基础数据        48.8 KB
```

### API（全部 200，返回真实数据）

```
/api/dashboard    /api/projects     /api/contracts
/api/agent        /api/payments     /api/bids
/api/overview
```

### 业务规则拦截（实测）

| 测试 | 预期 | 实际结果 |
|---|---|---|
| 个人过单费付款缺三件套 | 拒绝 | ✅ 400，列出缺哪三件 |
| 过单费付款超未付余额 | 拒绝 | ✅ 400「超过未付余额 6.43 万元」 |
| 验收 2/4 时推进到开票 | 拒绝 | ✅ 409，列出缺「验收报告、项目资料」 |
| 回款金额超计划 | 拒绝 | ✅ 400「超过计划金额 117.00 万」 |
| 差价法开票额 ≥ 合同额 | 拒绝 | ✅ 400「无差额」 |

### 环境验证

- 容器时区：`Wed Oct 28 12:11:56 CST 2026` ✅
- 数据持久化：容器 restart 后数据完整 ✅
- 重启策略：`unless-stopped`（服务器重启后自动恢复） ✅
- 资源占用：CPU 0.08%，内存 92 MB ✅

---

## 七、反向代理（可选）

若想用域名或 80 端口访问，**不要占用现有 nginx**，另起一个：

```nginx
server {
    listen 8888;
    server_name ltc.local;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 八、故障排查

```bash
# 1. 容器反复重启
docker logs projectflow --tail=50

# 2. 数据库权限问题（最常见）
ls -la /home/ltc/db/
chmod -R 777 /home/ltc/db   # 然后 ./deploy.sh restart

# 3. 站点打不开
curl -I http://127.0.0.1:3000/
ss -tlnp | grep 3000

# 4. 从零重建（数据会丢！）
./deploy.sh backup
docker compose down -v
rm -f db/app.db db/app.db-*
./deploy.sh
```
