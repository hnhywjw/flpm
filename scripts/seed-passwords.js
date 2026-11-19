#!/usr/bin/env node
/**
 * 为没有密码的用户设置初始密码
 *
 * 初始密码来自环境变量 DEFAULT_PWD —— 部署时必须配置，代码里不写默认值。
 * 首次登录后会被强制要求修改（页面守卫 + API 守卫双拦截）。
 *
 * 幂等：已有密码的用户不会被覆盖
 */
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "db", "app.db");

// 没配 DEFAULT_PWD 直接退出，绝不使用写死的默认值
const DEFAULT_PWD = process.env.DEFAULT_PWD;
if (!DEFAULT_PWD || !DEFAULT_PWD.trim()) {
  console.error("[认证] ✗ DEFAULT_PWD 未配置，无法设置初始密码。");
  console.error("[认证]   请在 .env 中添加 DEFAULT_PWD=<你的初始密码>，然后重新部署。");
  process.exit(1);
}
if (DEFAULT_PWD.length < 8) {
  console.error("[认证] ✗ DEFAULT_PWD 太短（至少 8 位）。");
  process.exit(1);
}

function hash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  return { hash: derived.toString("hex"), salt };
}

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

// 排除系统账号（id=0, username=__system__）：
// 它是给定时任务写审计日志用的，不该有密码，更不该能登录。
const users = db.prepare(
  "SELECT id, name, username, password_hash FROM users"
).all();
let updated = 0;
const stmt = db.prepare(
  "UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = ? WHERE id = ?"
);

for (const u of users) {
  if (u.password_hash) continue; // 已有密码，跳过
  if (u.username === "__system__") continue; // 系统账号不设密码
  const { hash: h, salt } = hash(DEFAULT_PWD);
  stmt.run(h, salt, 1, u.id);
  updated++;
}

// 不打印密码明文，只打印数量
console.log(`[认证] 已为 ${updated} 个用户设置初始密码（来自 DEFAULT_PWD）`);
console.log(`[认证] 共 ${users.length} 个用户，${users.length - updated} 个已有密码，未覆盖`);

// 统计会话表
try {
  const n = db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n;
  console.log(`[认证] 当前有效会话 ${n} 个`);
} catch { /* 迁移未执行 */ }

db.close();
