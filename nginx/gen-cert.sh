#!/usr/bin/env bash
# ============================================================
#  生成自签 SSL 证书（内网用）
#  用法：./nginx/gen-cert.sh [域名或IP]
#  正式证书：把 server.crt / server.key 放到 certs/ 目录覆盖即可
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${1:-127.0.0.1}"
CERT_DIR="certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/server.crt" ] && [ -f "$CERT_DIR/server.key" ]; then
  echo "[!] 证书已存在：$CERT_DIR/server.crt"
  read -p "是否重新生成？(y/N) " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "已取消"; exit 0; }
fi

echo "生成自签证书，有效期 3650 天"
echo "  域名/IP: $HOST"

# 检测是否为 IP
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:$HOST"
else
  SAN="DNS:$HOST"
fi

openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -subj "/C=CN/ST=Henan/L=Zhengzhou/O=Henan Hongyi Technology/OU=IT/CN=$HOST" \
  -addext "subjectAltName=$SAN,DNS:localhost,IP:127.0.0.1" \
  2>/dev/null

chmod 600 "$CERT_DIR/server.key"
chmod 644 "$CERT_DIR/server.crt"

echo ""
echo "✓ 证书生成完成"
echo "  证书: $CERT_DIR/server.crt"
echo "  私钥: $CERT_DIR/server.key"
echo ""
echo "有效期至：$(openssl x509 -enddate -noout -in "$CERT_DIR/server.crt" | cut -d= -f2)"
echo "指纹：$(openssl x509 -fingerprint -noout -in "$CERT_DIR/server.crt" | cut -d= -f2)"
echo ""
echo "下一步：./deploy.sh  然后访问 https://$HOST"
