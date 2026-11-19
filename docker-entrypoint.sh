#!/bin/sh
# 容器启动脚本：处理挂载卷权限 + 首次建库 + 启动调度器与备份，然后降权运行
set -e

echo "[entrypoint] 时区: $(date)  TZ=${TZ:-unset}"

# 挂载的 ./db 宿主机属主可能是 root，容器内 nextjs(1001) 需要写权限
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/db /app/uploads /app/db/backup
  chown -R 1001:1001 /app/db /app/uploads
  echo "[entrypoint] 已修正 /app/db /app/uploads 权限"
fi

# 首次启动若无数据库则初始化
if [ ! -f /app/db/app.db ]; then
  echo "[entrypoint] 数据库不存在，开始初始化..."
  if [ "$(id -u)" = "0" ]; then
    gosu nextjs node /app/scripts/init-db.js
  else
    node /app/scripts/init-db.js
  fi
else
  echo "[entrypoint] 数据库已存在，跳过初始化"
fi

echo "[entrypoint] 启动 Next.js..."
if [ "$(id -u)" = "0" ]; then
  gosu nextjs npx next start -H 0.0.0.0 -p 3000 &
else
  npx next start -H 0.0.0.0 -p 3000 &
fi
APP_PID=$!

# 等应用就绪再启动后台任务
sleep 15

if [ "$(id -u)" = "0" ]; then
  gosu nextjs node /app/scripts/scheduler.js &
  gosu nextjs node /app/scripts/backup-scheduler.js &
else
  node /app/scripts/scheduler.js &
  node /app/scripts/backup-scheduler.js &
fi

echo "[entrypoint] 定时任务与备份调度器已启动"

# 转发信号，优雅退出
trap "kill $APP_PID 2>/dev/null; exit 0" TERM INT
wait $APP_PID
