@echo off
chcp 65001 >nul
echo ========================================
echo   ProjectFlow - 项目全流程管理
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js
  echo.
  echo 请先安装 Node.js 20 LTS 或以上版本：
  echo    https://nodejs.org/zh-cn/download
  echo.
  echo 安装时请勾选 "Add to PATH"，装完重新打开此窗口。
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo Node.js 版本: %NODEVER%
echo.

if not exist node_modules (
  echo [1/3] 首次运行，安装依赖（可能需要 1-3 分钟）...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
  )
) else (
  echo [1/3] 依赖已安装，跳过
)

if not exist db\app.db (
  echo [2/3] 初始化数据库...
  call npm run db:init
  if errorlevel 1 (
    echo [错误] 数据库初始化失败
    pause
    exit /b 1
  )
) else (
  echo [2/3] 数据库已存在，跳过（如需重建执行 npm run db:reset）
)

echo [3/3] 启动服务...
echo.
echo    浏览器将打开 http://localhost:3000
echo    按 Ctrl+C 停止
echo.
start "" http://localhost:3000
call npm run dev
