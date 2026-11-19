import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { all, run, audit } from "@/lib/db";
import { getUpgradeDir } from "@/lib/sysinfo";
import {
  verifyPackage, buildUpgradeScript, sha256File,
} from "@/lib/upgrade-pkg";
import { getVersionInfo } from "@/lib/sysinfo";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function requireAdmin(user: { roles: string[]; role: string }) {
  const roles = user.roles ?? [user.role];
  if (!roles.includes("boss") && !roles.includes("admin")) {
    throw new Error("无权限管理升级包");
  }
}

/** 列出已上传的升级包 */
export async function GET() {
  try {
    const user = await requireUser();
    requireAdmin(user);
    const rows = all(
      `SELECT id, file_name, size_bytes, version, sha256, status, note,
              manifest, verify_ok, verify_errors, created_at
       FROM upgrade_packages ORDER BY id DESC LIMIT 50`
    );
    return NextResponse.json({
      packages: rows,
      currentVersion: getVersionInfo().version,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requireAdmin(user);

    const contentType = req.headers.get("content-type") ?? "";

    // ---------- JSON 操作 ----------
    if (contentType.includes("application/json")) {
      const b = await req.json();

      if (b.action === "delete") {
        const id = Number(b.id);
        const row = all<{ file_name: string }>(
          "SELECT file_name FROM upgrade_packages WHERE id = ?", [id]
        )[0];
        if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
        const p = path.join(getUpgradeDir(), row.file_name);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* 忽略 */ }
        run("DELETE FROM upgrade_packages WHERE id = ?", [id]);
        audit({
          userId: user.id, userName: user.name, action: "delete",
          entityType: "upgrade", entityId: id,
          summary: `删除升级包 ${row.file_name}`,
        });
        return NextResponse.json({ ok: true });
      }

      // 生成升级脚本
      if (b.action === "script") {
        const id = Number(b.id);
        const row = all<{
          file_name: string; version: string | null; manifest: string | null;
          verify_ok: number | null;
        }>(
          `SELECT file_name, version, manifest, verify_ok
           FROM upgrade_packages WHERE id = ?`, [id]
        )[0];
        if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
        if (!row.verify_ok) {
          return NextResponse.json(
            { error: "该升级包未通过校验，不能生成升级脚本" },
            { status: 400 }
          );
        }

        let hasImage = false;
        try {
          const m = row.manifest ? JSON.parse(row.manifest) : null;
          hasImage = !!m?.contents?.image;
        } catch { /* 忽略 */ }

        const cur = getVersionInfo().version;
        const script = buildUpgradeScript({
          pkgFile: "db/upgrade/" + row.file_name,
          version: row.version ?? "unknown",
          currentVersion: cur,
          hasImage,
        });

        audit({
          userId: user.id, userName: user.name, action: "create",
          entityType: "upgrade", entityId: id,
          summary: `生成升级脚本 ${row.file_name}`,
        });

        return new NextResponse(script, {
          headers: {
            "Content-Type": "text/x-shellscript; charset=utf-8",
            "Content-Disposition":
              `attachment; filename="upgrade-${row.version ?? "pkg"}.sh"`,
          },
        });
      }

      return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }

    // ---------- 上传 ----------
    const form = await req.formData();
    const file = form.get("file");
    const note = String(form.get("note") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "未选择文件" }, { status: 400 });
    }
    if (file.size > 500 * 1024 * 1024) {
      return NextResponse.json({ error: "升级包超过 500MB" }, { status: 400 });
    }
    if (!/\.(tar\.gz|tgz)$/i.test(file.name)) {
      return NextResponse.json(
        { error: "只接受 .tar.gz / .tgz 格式（zip 无法保留权限位，不推荐用于升级）" },
        { status: 400 }
      );
    }

    const dir = getUpgradeDir();
    fs.mkdirSync(dir, { recursive: true });

    // 时间戳精确到秒，同一秒内多次上传会重名覆盖，加 4 位随机后缀
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 6);
    const safeName = `pkg-${stamp}-${rand}.tar.gz`;
    const dest = path.join(dir, safeName);

    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(dest, buf);

    // 完整校验（结构、manifest、版本、路径穿越）
    const cur = getVersionInfo().version;
    const v = verifyPackage(dest, cur);
    const sha256 = v.sha256 || sha256File(dest);

    run(
      `INSERT INTO upgrade_packages
       (file_name, size_bytes, version, sha256, status, note, manifest, verify_ok, verify_errors, uploaded_by)
       VALUES (?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?)`,
      [
        safeName, buf.length, v.manifest?.version ?? null, sha256,
        note || file.name,
        v.manifest ? JSON.stringify(v.manifest) : null,
        v.ok ? 1 : 0,
        v.errors.length > 0 ? v.errors.join("；") : null,
        user.id,
      ]
    );

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "upgrade", entityId: 0,
      summary: `上传升级包 ${safeName}（${v.ok ? "校验通过" : "校验失败"}）`,
    });

    return NextResponse.json({
      ok: true,
      file: safeName,
      sizeMB: Math.round((buf.length / 1024 / 1024) * 10) / 10,
      sha256: sha256.slice(0, 16),
      verify: {
        ok: v.ok,
        version: v.manifest?.version ?? null,
        errors: v.errors,
        warnings: v.warnings,
        chainLength: undefined,
        contents: v.manifest?.contents ?? null,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
