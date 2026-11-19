#!/usr/bin/env bash
# ============================================================
#  ProjectFlow 离线升级脚本（自动生成，请勿手工修改）
#  升级版本：__CUR__ -> __VER__
#  升级包：__PKG__
#
#  执行方式（在服务器 /home/ltc 目录执行）：
#    sudo bash upgrade-__VER__.sh
#
#  安全机制：
#    1. 升级前标记旧镜像 + 备份数据库
#    2. 解包做路径穿越防护
#    3. 健康检查（最多 90 秒）
#    4. 失败自动回滚到旧镜像
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

CUR="__CUR__"
VER="__VER__"
PKG="__PKG__"
OLD_TAG="projectflow:pre-$VER"
NEW_TAG="projectflow:$VER"
STAMP=$(date +%Y%m%d-%H%M%S)

ok(){   echo "[OK]   $1"; }
warn(){ echo "[WARN] $1"; }
die(){  echo "[FAIL] $1"; exit 1; }

echo "=============================================="
echo " ProjectFlow 离线升级 $CUR -> $VER"
echo " 时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

# ---------- 1. 前置检查 ----------
[ -f "$PKG" ] || die "升级包不存在: $PKG（请放到 db/upgrade/ 目录）"
docker --version >/dev/null 2>&1 || die "Docker 未安装"

# ---------- 2. 标记旧镜像（用于回滚） ----------
echo "[1/7] 标记当前镜像"
if docker image inspect projectflow:latest >/dev/null 2>&1; then
  docker tag projectflow:latest "$OLD_TAG"
  ok "旧镜像标记为 $OLD_TAG"
else
  warn "未找到 projectflow:latest，将无法自动回滚"
fi

# ---------- 3. 备份数据库 ----------
echo "[2/7] 备份数据库"
if docker ps --format '{{.Names}}' | grep -q '^projectflow$'; then
  docker exec projectflow node /app/scripts/backup.js >/dev/null 2>&1 \
    && ok "数据库已备份（见 db/backup/）" \
    || warn "数据库备份失败（继续升级）"
else
  warn "容器未运行，跳过数据库备份"
fi

# ---------- 4. 解包 ----------
echo "[3/7] 解包"
TMP="/tmp/pf-upgrade-$STAMP"
rm -rf "$TMP"
mkdir -p "$TMP"

if tar -tzf "$PKG" | grep -qE '(^/|\.\./)'; then
  die "升级包含可疑路径，已中止"
fi
tar -xzf "$PKG" -C "$TMP" --no-same-owner --no-same-permissions \
  || die "解包失败"
ok "已解包到 $TMP"

# ---------- 5. 应用新内容 ----------
if [ -f "$TMP/image.tar" ]; then
  echo "[4/7] 加载新镜像"
  docker load -i "$TMP/image.tar" || die "镜像加载失败"
  docker tag projectflow:latest "$NEW_TAG" 2>/dev/null || true
  ok "新镜像已加载"
  NEED_BUILD=0
elif [ -d "$TMP/src" ]; then
  echo "[4/7] 同步源码（需重新构建）"
  cp -a "$TMP/src/." ./ || die "源码同步失败"
  ok "源码已同步"
  NEED_BUILD=1
else
  die "包内既无 image.tar 也无 src/"
fi

# ---------- 6. 迁移文件 ----------
echo "[5/7] 就位数据库迁移"
if [ -d "$TMP/migrations" ]; then
  mkdir -p db/migrations
  cp -n "$TMP/migrations/"*.sql db/migrations/ 2>/dev/null || true
  ok "迁移文件已就位"
else
  warn "包内无 migrations/"
fi

# ---------- 7. 重启 + 健康检查 ----------
echo "[6/7] 重启服务"
if [ "$NEED_BUILD" = "1" ]; then
  docker compose build || die "镜像构建失败（旧镜像未动，服务仍在运行）"
fi
docker compose up -d --force-recreate || die "容器启动失败"

echo "[7/7] 健康检查（最多 90 秒）"
OK=0
for i in $(seq 1 45); do
  S1=$(docker inspect projectflow --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  S2=$(docker inspect projectflow-nginx --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  if [ "$S1" = "healthy" ] && [ "$S2" = "healthy" ]; then
    OK=1
    break
  fi
  sleep 2
done

if [ "$OK" = "1" ]; then
  docker exec projectflow node scripts/init-db.js >/dev/null 2>&1 \
    || warn "数据库迁移输出异常，请手动确认"
  echo
  echo "=============================================="
  echo " 升级成功: $CUR -> $VER"
  echo "=============================================="
  rm -rf "$TMP"
  exit 0
fi

# ---------- 失败：自动回滚 ----------
echo
echo "=============================================="
echo " 健康检查失败，开始回滚"
echo "=============================================="
docker logs projectflow --tail 40 || true

if docker image inspect "$OLD_TAG" >/dev/null 2>&1; then
  echo "回滚到 $OLD_TAG ..."
  docker tag "$OLD_TAG" projectflow:latest
  docker compose up -d --force-recreate || die "回滚失败，需人工介入"
  warn "已回滚到升级前版本"
else
  echo "[FAIL] 没有可用旧镜像，无法自动回滚！"
  echo "请检查日志: docker logs projectflow"
fi

exit 1
