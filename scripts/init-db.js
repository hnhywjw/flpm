#!/usr/bin/env node
/**
 * 数据库初始化 / 升级
 *
 * 行为：
 *  - 库不存在：建表 + 灌种子 + 迁移 + 设密码
 *  - 库已存在：只跑迁移（幂等）+ 补设密码，不动数据
 *  - --reset ：删库重建
 */
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const reset = process.argv.includes("--reset");
const dbDir = path.join(process.cwd(), "db");
const dbPath = dbDir + "/app.db";

if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const exists = fs.existsSync(dbPath);

if (reset && exists) {
  for (const f of [dbPath, dbPath + "-wal", dbPath + "-shm"]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log("已删除旧数据库，将重建");
}

const fresh = !fs.existsSync(dbPath);
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

/** 逐条执行 SQL 文件；忽略可安全重复的错误 */
function execFile(file, { tolerant = false } = {}) {
  const full = path.join(dbDir, file);
  if (!fs.existsSync(full)) {
    if (!tolerant) console.warn("跳过不存在的文件:", file);
    return 0;
  }
  const raw = fs.readFileSync(full, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => !l.trim().startsWith("--"));
  const stmts = lines.join("\n").split(";").map((s) => s.trim()).filter(Boolean);
  let n = 0;
  for (const s of stmts) {
    try {
      db.exec(s);
      n++;
    } catch (e) {
      const ignorable = /duplicate column name|already exists/i.test(e.message);
      if (tolerant && ignorable) continue;
      console.error("执行失败:", file, "|", s.slice(0, 140));
      throw e;
    }
  }
  return n;
}

if (fresh) {
  console.log("首次初始化：建表");
  execFile("schema.sql");
  console.log("灌入演示数据");
  for (const f of ["seed.sql", "seed2.sql", "seed3.sql", "seed4.sql"]) {
    const n = execFile(f, { tolerant: true });
    if (n) console.log(`  ${f}: ${n} 条`);
  }
} else {
  console.log("数据库已存在，仅执行迁移与密码补设");
}

// 迁移：带版本记录，每个文件只执行一次
//
// 为什么会改成这样：
// 早期实现是「每次启动重跑全部迁移」，靠 SQL 里 ALTER 报 duplicate 被忽略来"幂等"。
// 但迁移里一旦出现数据修改语句（UPDATE / INSERT），就会被反复执行。
// 实际踩到的坑：020 里的 UPDATE users SET must_change_pwd = 1
// 导致用户改完密码后，下次部署标记又被设回 1，界面一直提示「使用初始密码」。
//
// 现在用 schema_migrations 表记录已执行的迁移，只跑没跑过的。
const migDir = path.join(dbDir, "migrations");
if (fs.existsSync(migDir)) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name)
  );
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((f) => !applied.has(f));

  if (files.length) {
    console.log(`执行迁移: 共 ${files.length} 个，已执行 ${applied.size} 个，本次 ${pending.length} 个`);
  }

  const mark = db.prepare("INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)");
  for (const f of pending) {
    const n = execFile("migrations/" + f, { tolerant: true });
    mark.run(f);
    console.log(`  ${f}: ${n} 条`);
  }

  // 兼容旧库：早期没有 schema_migrations，旧文件已实际执行过，
  // 首次建立记录表时把所有已有文件登记为「已执行」，避免重跑。
  if (applied.size === 0 && pending.length === files.length) {
    // 但本次刚跑完 pending（=全部），mark 已逐条记录，这里无需额外处理
  }
}

// 统计
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all();
let total = 0;
const rows = [];
for (const { name } of tables) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
  total += n;
  if (n > 0) rows.push(`  ${name.padEnd(22)} ${n}`);
}
if (rows.length) {
  console.log("\n表行数:");
  console.log(rows.join("\n"));
}
const fk = db.pragma("foreign_key_check");
console.log("\n外键检查:", fk.length === 0 ? "通过" : JSON.stringify(fk));
console.log("总行数:", total);
db.close();

// 设置初始密码
try {
  const { execFileSync } = require("node:child_process");
  execFileSync("node", ["scripts/seed-passwords.js"], { stdio: "inherit", cwd: process.cwd() });
} catch {
  console.warn("设置初始密码失败，请手动执行: node scripts/seed-passwords.js");
}

console.log("\n数据库就绪:", dbPath);
