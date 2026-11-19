import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "db", "app.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(
      `数据库不存在: ${DB_PATH}\n请先执行: npm run db:init`
    );
  }
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  return _db;
}

/** 只读查询 */
export function all<T = unknown>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function one<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/** 写操作 */
export function run(sql: string, params: unknown[] = []): Database.RunResult {
  return getDb().prepare(sql).run(...params);
}

/** 事务 */
export function tx<T>(fn: (db: Database.Database) => T): T {
  const db = getDb();
  const wrapped = db.transaction(fn);
  return wrapped(db);
}

/** 生成下一个业务编码 */
export function nextCode(prefix: string, year = new Date().getFullYear()): string {
  const db = getDb();
  const row = db
    .prepare("SELECT seq FROM code_sequences WHERE prefix = ? AND year = ?")
    .get(prefix, year) as { seq: number } | undefined;
  const seq = (row?.seq ?? 0) + 1;
  if (row) {
    db.prepare("UPDATE code_sequences SET seq = ? WHERE prefix = ? AND year = ?").run(seq, prefix, year);
  } else {
    db.prepare("INSERT INTO code_sequences (prefix, year, seq) VALUES (?, ?, ?)").run(prefix, year, seq);
  }
  const pad = prefix === "HT" || prefix === "CG" || prefix === "WO" || prefix === "RK" || prefix === "CK" || prefix === "QB" ? 4 : 3;
  return `${prefix}${year}-${String(seq).padStart(pad, "0")}`;
}

/**
 * 写审计日志
 *
 * ★ 关于 user_id 的防御（踩过的坑）
 *
 * audit_logs.user_id 有外键指向 users(id)，而 foreign_keys = ON。
 * 原来 lib/jobs.ts 里写死了 userId: 0 表示「系统」，
 * 但数据库里根本没有 id=0 的用户，导致：
 *
 *   FOREIGN KEY constraint failed
 *   → 整个 jobSlaEscalate 任务抛异常
 *   → job_runs 记一条 failed
 *   → 「定时任务」状态变成告警
 *
 * 更糟的是这个异常发生在写完工单状态之后、任务返回之前，
 * 于是任务既改了数据又报失败，重试还会再改一次。
 *
 * 现在在 audit() 内部做兜底：user_id 不存在时降级为 NULL，
 * user_name 保留「系统」字样，审计信息不丢，但不会炸掉调用方。
 * 这样以后任何地方再传错 id 都只是丢一个外键，不会拖垮业务流程。
 */
export function audit(params: {
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  summary: string;
  ip?: string | null;
}) {
  // 外键兜底：userId 不是数据库里真实存在的用户时置 NULL
  let safeUserId = params.userId;
  if (safeUserId !== null && safeUserId !== undefined) {
    const exists = getDb()
      .prepare("SELECT 1 FROM users WHERE id = ?")
      .get(safeUserId);
    if (!exists) safeUserId = null;
  }

  run(
    `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, field, old_value, new_value, summary, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      safeUserId,
      params.userName,
      params.action,
      params.entityType,
      params.entityId,
      params.field ?? null,
      params.oldValue ?? null,
      params.newValue ?? null,
      params.summary,
      params.ip ?? null,
    ]
  );
}
