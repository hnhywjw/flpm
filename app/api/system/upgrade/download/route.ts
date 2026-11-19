import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { all } from "@/lib/db";
import { getUpgradeDir } from "@/lib/sysinfo";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/** 下载升级包（便于从测试环境拷到生产环境） */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const roles = user.roles ?? [user.role];
    if (!roles.includes("boss") && !roles.includes("admin")) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const id = Number(req.nextUrl.searchParams.get("id"));
    const row = all<{ file_name: string }>(
      "SELECT file_name FROM upgrade_packages WHERE id = ?", [id]
    )[0];
    if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

    const dir = getUpgradeDir();
    const full = path.join(dir, row.file_name);
    const realDir = fs.realpathSync(dir);
    const realFile = fs.realpathSync(full);
    if (!realFile.startsWith(realDir + path.sep)) {
      return NextResponse.json({ error: "路径不合法" }, { status: 400 });
    }
    if (!fs.existsSync(realFile)) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const buf = fs.readFileSync(realFile);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(row.file_name)}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
