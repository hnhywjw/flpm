#!/usr/bin/env node
/**
 * 数据库自动备份
 * 保留最近 30 份，超过自动清理
 */
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || "/app/db/app.db";
const BACKUP_DIR = "/app/db/backup";
const KEEP = 30;

async function backup() {
  if (!fs.existsSync(DB_PATH)) {
    console.error("[backup] 数据库不存在:", DB_PATH);
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `app-${stamp}.db`;
  const target = path.join(BACKUP_DIR, fileName);

  try {
    const db = new Database(DB_PATH, { readonly: true });
    await db.backup(target);
    db.close();

    const size = fs.statSync(target).size;
    console.log(`[backup] 完成 ${fileName} (${(size / 1024).toFixed(0)} KB)`);

    // 记录到数据库
    try {
      const wdb = new Database(DB_PATH);
      wdb.prepare(
        "INSERT INTO backup_log (file_name, file_size, status) VALUES (?, ?, 'ok')"
      ).run(fileName, size);
      wdb.close();
    } catch (e) {
      console.error("[backup] 记录失败:", e.message);
    }

    // 清理旧备份
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("app-") && f.endsWith(".db"))
      .sort();

    if (files.length > KEEP) {
      const toDelete = files.slice(0, files.length - KEEP);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, f));
      }
      console.log(`[backup] 清理旧备份 ${toDelete.length} 份`);
    }
  } catch (e) {
    console.error("[backup] 失败:", e.message);
    try {
      const wdb = new Database(DB_PATH);
      wdb.prepare(
        "INSERT INTO backup_log (file_name, file_size, status, error) VALUES (?, 0, 'failed', ?)"
      ).run(fileName, e.message);
      wdb.close();
    } catch {}
    process.exit(1);
  }
}

backup();
