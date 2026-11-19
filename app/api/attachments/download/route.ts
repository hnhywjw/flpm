import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { one } from "@/lib/db";
import { resolveFile } from "@/lib/storage";
import { canAccessAttachment } from "@/lib/attachment-acl";
import { errorResponse } from "@/lib/api-guard";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    // ★ 高危漏洞修复
    //
    // 原来这里只有 requireUser()，等于「登录就能下载」。
    // 任何销售账号只要遍历 id，就能拿到全公司的合同、发票、验收单。
    //
    // 现在按附件挂靠的业务实体反查权限：
    //   上传者本人 → 允许
    //   项目附件   → 走项目数据权限
    //   过单费附件 → 反查协议 → 项目 → 同样权限
    if (!canAccessAttachment(user, id)) {
      return NextResponse.json({ error: "无权下载该附件" }, { status: 403 });
    }

    const row = one<{ file_name: string; file_path: string; mime_type: string | null }>(
      "SELECT file_name, file_path, mime_type FROM attachments WHERE id = ?", [id]
    );
    if (!row) return NextResponse.json({ error: "附件不存在" }, { status: 404 });

    const abs = resolveFile(row.file_path);
    if (!abs) return NextResponse.json({ error: "文件已丢失" }, { status: 404 });

    const buf = fs.readFileSync(abs);
    // 中文文件名需要 RFC 5987 编码
    const encoded = encodeURIComponent(row.file_name);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": row.mime_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
