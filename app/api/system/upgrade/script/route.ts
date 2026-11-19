import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { all, audit } from "@/lib/db";
import { buildUpgradeScript } from "@/lib/upgrade-pkg";
import { getVersionInfo } from "@/lib/sysinfo";

export const dynamic = "force-dynamic";

/** 生成升级脚本（下载 upgrade.sh） */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const roles = user.roles ?? [user.role];
    if (!roles.includes("boss") && !roles.includes("admin")) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const id = Number(req.nextUrl.searchParams.get("id"));
    const row = all<{
      file_name: string; version: string | null;
      manifest: string | null; verify_ok: number | null;
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

    const script = buildUpgradeScript({
      pkgFile: "db/upgrade/" + row.file_name,
      version: row.version ?? "unknown",
      currentVersion: getVersionInfo().version,
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
  } catch (e) {
    return errorResponse(e);
  }
}
