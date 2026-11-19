#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "========================================"
echo "  ProjectFlow — 项目全流程管理"
echo "========================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装 Node 20 LTS 或以上"
  exit 1
fi
echo "Node.js: $(node -v)"

# 应用依赖 SQLite 的 localtime，必须与业务时区一致
export TZ="${TZ:-Asia/Shanghai}"
echo "时区:   $TZ"

if [ ! -d node_modules ]; then
  echo "[1/3] 安装依赖..."
  npm install
else
  echo "[1/3] 依赖已存在，跳过"
fi

if [ ! -f db/app.db ]; then
  echo "[2/3] 初始化数据库..."
  npm run db:init
else
  echo "[2/3] 数据库已存在，跳过（重建执行 npm run db:reset）"
fi

echo "[3/3] 启动服务..."
echo "    访问 http://<服务器IP>:${PORT:-3000}"
npm run dev
