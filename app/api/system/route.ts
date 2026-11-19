import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { run, audit, all, getDb } from "@/lib/db";
import {
  getLoadInfo, getServices, listBackups, getParams, getVersionInfo, getBackupDir,
  getNetInfo, getProcesses,
} from "@/lib/sysinfo";
import { getDiskInfo } from "@/lib/disk";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/** 只有 boss / admin 能看系统管理 */
function requireAdmin(user: { roles: string[]; role: string }) {
  const roles = user.roles ?? [user.role];
  if (!roles.includes("boss") && !roles.includes("admin")) {
    throw new Error("无权限访问系统管理（需要总经理或系统管理员）");
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    requireAdmin(user);

    const t = req.nextUrl.searchParams.get("type") ?? "all";

    if (t === "load") return NextResponse.json(getLoadInfo());
    if (t === "net") return NextResponse.json(getNetInfo());
    if (t === "disk") return NextResponse.json(getDiskInfo());
    if (t === "procs") return NextResponse.json({ procs: getProcesses() });
    if (t === "services") return NextResponse.json({ services: getServices() });
    if (t === "backups") return NextResponse.json({ backups: listBackups() });
    if (t === "params") return NextResponse.json({ params: getParams() });
    if (t === "version") return NextResponse.json(getVersionInfo());

    return NextResponse.json({
      load: getLoadInfo(),
      net: getNetInfo(),
      disk: getDiskInfo(),
      procs: getProcesses(),
      services: getServices(),
      backups: listBackups(),
      params: getParams(),
      version: getVersionInfo(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requireAdmin(user);
    const b = await req.json();

    switch (b.action) {
      // ---- 参数配置 ----
      case "saveParams": {
        const items = b.params as Record<string, string>;
        if (!items || typeof items !== "object") {
          return NextResponse.json({ error: "参数格式错误" }, { status: 400 });
        }
        let n = 0;
        for (const [k, v] of Object.entries(items)) {
          const existed = all("SELECT key FROM system_params WHERE key = ?", [k]);
          if (existed.length > 0) {
            run(
              "UPDATE system_params SET value = ?, updated_at = datetime('now','localtime'), updated_by = ? WHERE key = ?",
              [String(v), user.id, k]
            );
          } else {
            run(
              "INSERT INTO system_params (key, value, updated_by) VALUES (?, ?, ?)",
              [k, String(v), user.id]
            );
          }
          n++;
        }
        audit({
          userId: user.id, userName: user.name, action: "update",
          entityType: "system_params", entityId: 0,
          summary: `修改系统参数 ${n} 项`,
        });
        return NextResponse.json({ ok: true, updated: n });
      }

      // ---- 数据备份 ----
      case "backup": {
        const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "db", "app.db");
        // 备份放在 db/backup（与 scripts/backup.js 一致，该目录 nextjs 用户可写）
        const dir = getBackupDir();
        fs.mkdirSync(dir, { recursive: true });

        const stamp = new Date()
          .toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const name = `app-${stamp}.db`;
        const dest = path.join(dir, name);

        if (!fs.existsSync(dbPath)) {
          return NextResponse.json({ error: "数据库文件不存在" }, { status: 500 });
        }

        // 用 SQLite 的 VACUUM INTO 做一致性快照（比直接 copy 安全）
        // 注意：VACUUM 不能走 prepare，必须用 exec
        getDb().exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);

        const st = fs.statSync(dest);

        // 记录到 backup_log（与自动备份保持同一份台账）
        try {
          run(
            "INSERT INTO backup_log (file_name, file_size, status) VALUES (?, ?, 'ok')",
            [name, st.size]
          );
        } catch { /* 表不存在时忽略 */ }

        audit({
          userId: user.id, userName: user.name, action: "create",
          entityType: "backup", entityId: 0,
          summary: `创建数据备份 ${name}`,
        });

        return NextResponse.json({
          ok: true,
          file: name,
          sizeMB: Math.round((st.size / 1024 / 1024) * 10) / 10,
        });
      }

      // ---- 删除备份 ----
      case "deleteBackup": {
        const f = String(b.file ?? "");
        if (!/^[\w.-]+\.(db|sqlite|zip|sql)$/.test(f)) {
          return NextResponse.json({ error: "文件名不合法" }, { status: 400 });
        }
        const p = path.join(getBackupDir(), f);
        if (!fs.existsSync(p)) {
          return NextResponse.json({ error: "文件不存在" }, { status: 404 });
        }
        fs.unlinkSync(p);
        audit({
          userId: user.id, userName: user.name, action: "delete",
          entityType: "backup", entityId: 0,
          summary: `删除备份 ${f}`,
        });
        return NextResponse.json({ ok: true });
      }

      // ---- 检查更新 ----
      case "checkUpdate": {
        const v = getVersionInfo();
        return NextResponse.json({
          ok: true,
          current: v.version,
          latest: v.version,
          upToDate: true,
          note: "当前为内网部署，升级需在服务器执行 deploy.sh",
        });
      }

      default:
        return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
