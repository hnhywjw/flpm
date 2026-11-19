import { NextRequest, NextResponse } from "next/server";
import { requireUser, verifyPassword } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { one, all, run, getDb, audit } from "@/lib/db";
import { getDiskInfo } from "@/lib/disk";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * 系统初始化（清空业务数据）
 *
 * 用途：新环境部署时清空演示/测试数据，保留账号与配置。
 *
 * 安全设计：
 *   1. 仅 boss / admin 可调用
 *   2. 必须二次输入**当前登录账号的密码**验证
 *   3. 必须输入确认短语「清空全部数据」
 *   4. 清空前自动做一次完整数据库备份
 *   5. 全程记审计日志
 */

/** 会被清空的业务表（保留用户、角色、系统配置） */
const BUSINESS_TABLES = [
  "project_nodes",
  "projects",
  "bid_participants",
  "bid_tasks",
  "bids",
  "payment_terms",
  "invoices",
  "acceptances",
  "agent_fee_payments",
  "agent_agreements",
  "contracts",
  "stock_moves",
  "stock",
  "item_serials",
  "items",
  "warehouses",
  "tickets",
  "warranties",
  "attachments",
  "change_requests",
  "risk_register",
  "approval_steps",
  "approval_instances",
  "customers",
  "notifications",
  "notify_sent_log",
  "job_runs",
  "audit_logs",
  "upgrade_packages",
  "captcha_used",
];

/** 保留的表（账号、权限、系统设置） */
const KEEP_TABLES = [
  "users", "roles", "user_roles", "app_settings", "system_params",
  "notify_config", "code_sequences", "backup_log",
];

function requireAdmin(user: { roles: string[]; role: string }) {
  const roles = user.roles ?? [user.role];
  if (!roles.includes("boss") && !roles.includes("admin")) {
    throw new Error("无权限执行系统初始化（需要总经理或系统管理员）");
  }
}

/** 预览：各表当前记录数 */
export async function GET() {
  try {
    const me = await requireUser();
    requireAdmin(me);

    const tables: { name: string; count: number; keep: boolean }[] = [];
    const db = getDb();

    for (const t of BUSINESS_TABLES) {
      let c = 0;
      try {
        const hasDeletedAt = all<{ name: string }>(
          `PRAGMA table_info(${t})`
        ).some((col) => (col as unknown as { name: string }).name === "deleted_at");
        const sql = hasDeletedAt
          ? `SELECT COUNT(*) AS c FROM ${t} WHERE deleted_at IS NULL`
          : `SELECT COUNT(*) AS c FROM ${t}`;
        c = one<{ c: number }>(sql)?.c ?? 0;
      } catch { c = 0; }
      tables.push({ name: t, count: c, keep: false });
    }
    for (const t of KEEP_TABLES) {
      let c = 0;
      try {
        c = one<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`)?.c ?? 0;
      } catch { c = 0; }
      tables.push({ name: t, count: c, keep: true });
    }

    const totalBusiness = tables.filter((t) => !t.keep).reduce((s, t) => s + t.count, 0);

    return NextResponse.json({
      tables,
      totalBusiness,
      businessTables: BUSINESS_TABLES.length,
      keepTables: KEEP_TABLES.length,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    requireAdmin(me);

    const b = await req.json();
    const password = String(b.password ?? "");
    const confirmText = String(b.confirmText ?? "");

    // 1. 确认短语
    if (confirmText.trim() !== "清空全部数据") {
      return NextResponse.json(
        { error: "确认短语不正确，请输入「清空全部数据」" },
        { status: 400 }
      );
    }

    // 2. 密码二次认证（校验当前登录账号的密码）
    const u = one<{ id: number; name: string; password_hash: string | null; password_salt: string | null }>(
      "SELECT id, name, password_hash, password_salt FROM users WHERE id = ?", [me.id]
    );
    if (!u) return NextResponse.json({ error: "当前账号不存在" }, { status: 400 });
    if (!u.password_hash || !u.password_salt) {
      return NextResponse.json({ error: "当前账号未设置密码，无法验证" }, { status: 400 });
    }
    if (!verifyPassword(password, u.password_hash, u.password_salt)) {
      audit({
        userId: me.id, userName: me.name, action: "delete",
        entityType: "system", entityId: 0,
        summary: "尝试系统初始化，密码验证失败",
      });
      return NextResponse.json({ error: "密码不正确，初始化已取消" }, { status: 401 });
    }

    // 3. 自动备份（失败则中止，避免无备份清库）
    let backupFile = "";
    try {
      const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "db", "app.db");
      const dir = path.join(process.cwd(), "db", "backup");
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      backupFile = `pre-init-${stamp}.db`;
      const dest = path.join(dir, backupFile);
      getDb().exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
      const st = fs.statSync(dest);
      try {
        run(
          "INSERT INTO backup_log (file_name, file_size, status) VALUES (?, ?, 'ok')",
          [backupFile, st.size]
        );
      } catch { /* 忽略 */ }
    } catch (e) {
      return NextResponse.json(
        { error: "清空前备份失败，已中止：" + (e as Error).message },
        { status: 500 }
      );
    }

    // 4. 清空业务表（事务内执行）
    const cleared: { table: string; before: number }[] = [];
    const failed: string[] = [];

    const db = getDb();
    db.pragma("foreign_keys = OFF");
    try {
      const tx = db.transaction(() => {
        for (const t of BUSINESS_TABLES) {
          try {
            const before = one<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`)?.c ?? 0;
            db.prepare(`DELETE FROM ${t}`).run();
            // 重置自增序列
            try {
              db.prepare("DELETE FROM sqlite_sequence WHERE name = ?").run(t);
            } catch { /* 表无自增时忽略 */ }
            cleared.push({ table: t, before });
          } catch (e) {
            failed.push(t + ": " + (e as Error).message);
          }
        }
      });
      tx();
    } finally {
      db.pragma("foreign_keys = ON");
    }

    const totalCleared = cleared.reduce((s, c) => s + c.before, 0);

    audit({
      userId: me.id, userName: me.name, action: "delete",
      entityType: "system", entityId: 0,
      summary: `系统初始化：清空 ${totalCleared} 条业务数据，备份于 ${backupFile}`,
    });

    return NextResponse.json({
      ok: true,
      cleared,
      failed,
      totalCleared,
      backupFile,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
