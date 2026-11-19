#!/usr/bin/env bash
# ============================================================
#  ProjectFlow — Full Lifecycle Project Management
#  一键部署 / 更新｜严格模式：任何一步失败立即中止
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

ACTION="${1:-deploy}"
RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; NC=$'\033[0m'
ok(){ echo "${GRN}✓${NC} $1"; }
warn(){ echo "${YEL}!${NC} $1"; }
die(){ echo "${RED}✗ $1${NC}"; exit 1; }

case "$ACTION" in
  logs)     docker compose logs -f --tail=100 ;;
  restart)  docker compose restart && docker compose ps ;;
  stop)     docker compose down ;;
  status)
    docker compose ps
    echo
    curl -s -o /dev/null -w "站点状态: HTTP %{http_code}\n" http://127.0.0.1:3000/ || warn "站点无法访问"
    ;;
  backup)
    mkdir -p backup
    STAMP=$(date +%Y%m%d-%H%M%S)
    docker exec projectflow node -e "
      const D=require('/app/node_modules/better-sqlite3');
      const d=new D('/app/db/app.db');
      d.backup('/app/uploads/bk-$STAMP.db').then(()=>{d.close()})
    " || die "备份失败"
    sleep 1
    mv "uploads/bk-$STAMP.db" "backup/app-$STAMP.db" 2>/dev/null || true
    ok "已备份到 backup/app-$STAMP.db"
    ls -lh backup/ | tail -3
    ;;
  deploy|*)
    echo "========================================"
    echo "   ProjectFlow 部署"
    echo "========================================"

    echo "[1/6] 检查环境"
    docker --version || die "Docker 未安装"
    docker compose version || die "Docker Compose 未安装"

    # 密钥文件检查：JOB_TOKEN 缺失会导致定时任务全部失效，
    # 与其部署完发现任务不跑，不如部署前就拦住
    if [ ! -f .env ]; then
      die "缺少 .env 文件。请执行：cp .env.example .env 并填入 JOB_TOKEN"
    fi
    if ! grep -qE "^JOB_TOKEN=.+" .env; then
      die ".env 中 JOB_TOKEN 为空。定时任务需要它鉴权，请先配置"
    fi

    # 初始默认密码：必须是部署时显式配置的，代码里没有兜底值
    #
    # 为什么要拦：
    #   过去写死 "Admin@123"，所有部署开箱同密码，等于公开后门。
    #   现在没配 DEFAULT_PWD 时，新建用户的初始密码会是空的，
    #   而且「是否还在用默认密码」的检测会失效。
    #   compose 层已有 ${DEFAULT_PWD:?...} 兜底（容器起不来），
    #   这里提前检查，是让报错信息更直白、更早出现。
    if ! grep -qE "^DEFAULT_PWD=.+" .env; then
      die ".env 中缺少 DEFAULT_PWD。请在 .env 中添加 DEFAULT_PWD=<初始密码>（至少 8 位），例如：\n  DEFAULT_PWD='YourPwd@2026'"
    fi
    DPWD_LEN=$(grep -E "^DEFAULT_PWD=" .env | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '[:space:]' | wc -c)
    if [ "$DPWD_LEN" -le 8 ]; then
      die "DEFAULT_PWD 至少 8 位（当前约 $((DPWD_LEN-1)) 位）"
    fi
    ok "密钥配置就绪（含 DEFAULT_PWD）"

    echo "[2/6] 准备目录"
    mkdir -p db uploads backup
    chmod -R 777 db uploads 2>/dev/null || true

    echo "[3/6] 构建镜像（严格模式）"
    # 关键：把构建日志同时输出，失败立即退出
    if ! docker compose build 2>&1 | tee /tmp/pf-build.log | tail -20; then
      die "镜像构建失败，详见 /tmp/pf-build.log"
    fi
    # 二次确认：检查日志里是否真的成功
    if grep -qE "returned a non-zero code|Failed to compile|error TS" /tmp/pf-build.log; then
      echo "--- 构建错误摘要 ---"
      grep -E -A8 "Failed to compile|error TS|non-zero code" /tmp/pf-build.log | head -40
      die "构建失败，已中止部署（未使用旧镜像）"
    fi
    ok "镜像构建成功"

    echo "[4/6] 启动容器"
    docker compose up -d --force-recreate || die "容器启动失败"

    echo "[5/6] 等待健康检查"
    for i in $(seq 1 45); do
      ST1=$(docker inspect projectflow --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
      ST2=$(docker inspect projectflow-nginx --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
      if [ "$ST1" = "healthy" ] && [ "$ST2" = "healthy" ]; then ok "应用与网关均健康"; break; fi
      if [ "$ST1" = "unhealthy" ]; then
        docker logs projectflow --tail 30; die "应用健康检查失败"
      fi
      printf "."
      sleep 2
      [ "$i" = "45" ] && { docker logs projectflow-nginx --tail 20; die "健康检查超时"; }
    done

    echo "[6/6] 数据库迁移"
    docker exec projectflow node scripts/init-db.js 2>&1 | grep -E "迁移|外键|就绪|认证" || warn "迁移输出异常"

    echo
    docker compose ps
    echo
    IP=$(hostname -I | awk '{print $1}')
    echo "========================================"
    echo "  部署完成"
    echo "  HTTPS: https://$IP:9443"
    echo "  HTTP : http://$IP:9081  (自动跳转 HTTPS)"
    echo "========================================"
    ;;
esac
