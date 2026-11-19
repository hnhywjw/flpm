# HTTPS 部署与证书配置

## 访问地址

| 协议 | 地址 | 说明 |
|---|---|---|
| **HTTPS** | **https://你的服务器IP:9443** | 主入口 |
| HTTP | http://你的服务器IP:9081 | 自动 301 跳转 HTTPS |

> 服务器 80/443/8080/8443/9080 等端口已被现有服务占用，本系统使用 **9443 / 9081**。

---

## 一、自签证书（当前已配置）

已生成自签证书，有效期至 **2036-10-25**。

```bash
cd /home/ltc
./nginx/gen-cert.sh 你的服务器IP   # 重新生成（会提示确认）
```

### 浏览器首次访问警告

自签证书不受信任，浏览器会提示「您的连接不是私密连接」。处理方式：

- **Chrome/Edge**：点击「高级」→「继续前往 你的服务器IP（不安全）」
- **Firefox**：点击「高级」→「接受风险并继续」
- 或点击地址栏「不安全」→ 证书 → 安装到「受信任的根证书颁发机构」

**这是自签证书的正常现象，不影响加密传输。** 内网使用可以接受。

---

## 二、换成正式证书（三种方式）

### 方式 A：已有证书文件（最简单）

```bash
cd /home/ltc
cp /path/to/your.crt certs/server.crt
cp /path/to/your.key certs/server.key
chmod 600 certs/server.key
./deploy.sh restart
```

### 方式 B：内网 CA 签发

```bash
# 生成 CA（只做一次）
openssl req -x509 -newkey rsa:4096 -days 3650 -nodes \
  -keyout ca.key -out ca.crt \
  -subj "/C=CN/O=YourCompany/CN=YourCompany Internal CA"

# 用 CA 签发服务器证书
openssl req -newkey rsa:2048 -nodes \
  -keyout certs/server.key -out server.csr \
  -subj "/C=CN/O=YourCompany/CN=你的服务器IP"

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out certs/server.crt -days 3650 \
  -extfile <(printf "subjectAltName=IP:你的服务器IP,DNS:localhost")

# 把 ca.crt 分发给所有客户端安装到「受信任的根证书」
./deploy.sh restart
```

### 方式 C：Let's Encrypt（需公网域名）

```bash
# 前提：域名已解析到本机，且 80 端口可从公网访问
docker run --rm -v /home/ltc/certs:/etc/letsencrypt \
  -v /home/ltc/nginx/certbot:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d ltc.yourcompany.com --email admin@yourcompany.com --agree-tos

# 软链到 nginx 期望的路径
ln -sf /home/ltc/certs/live/ltc.yourcompany.com/fullchain.pem certs/server.crt
ln -sf /home/ltc/certs/live/ltc.yourcompany.com/privkey.pem certs/server.key
./deploy.sh restart
```

> 用正式证书后，建议在 `nginx/projectflow.conf` 里取消 HSTS 那行的注释。

---

## 三、HTTPS 已做的安全加固

| 项目 | 配置 |
|---|---|
| TLS 版本 | 仅 TLS 1.2 / 1.3（禁用 1.0/1.1） |
| 加密套件 | 仅 ECDHE + AES-GCM / ChaCha20 |
| Session 缓存 | 10MB 共享缓存，1 天超时 |
| Cookie | 自动检测 HTTPS，启用 `Secure` + `HttpOnly` + `SameSite=Lax` |
| 安全响应头 | X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy |
| 代理头 | 正确传递 X-Forwarded-Proto / X-Real-IP / X-Forwarded-For |

Cookie 的 `Secure` 标记是**按协议自动判断**的：HTTPS 访问时自动启用，HTTP 时不启用，避免内网 HTTP 环境无法登录。

---

## 四、架构变化

```
之前：
  客户端 --HTTP:3000--> projectflow

现在：
  客户端 --HTTPS:9443--> projectflow-nginx --HTTP--> projectflow:3000
         --HTTP:9081---> 301 跳转到 HTTPS
```

`projectflow` 不再对外暴露 3000 端口（改为 `expose`），只能通过 Nginx 访问。

---

## 五、验证结果

```
HTTP  → HTTPS 跳转       301 ✓
HTTPS 首页               200 ✓
证书 subject             CN=你的服务器IP ✓
证书有效期               至 2036-10-25 ✓
Cookie Secure 标记       已启用 ✓
15 个页面（HTTPS）        全部 200 ✓
```

---

## 六、常见问题

### Q: 换证书后浏览器仍报错
```bash
./deploy.sh restart   # 必须重启 nginx 才加载新证书
# 检查证书是否被正确读取
docker exec projectflow-nginx nginx -t
```

### Q: 9443 端口访问不了
```bash
ss -tlnp | grep 9443
docker compose ps
docker logs projectflow-nginx --tail 30
# 防火墙
firewall-cmd --add-port=9443/tcp --permanent && firewall-cmd --reload
```

### Q: 想改回 HTTP 直连 3000

修改 `docker-compose.yml`，把 `expose: - "3000"` 改成 `ports: - "3000:3000"`，然后 `./deploy.sh`。

> 但不建议这样做，HTTPS 下 Cookie 的 Secure 标记才有意义。
