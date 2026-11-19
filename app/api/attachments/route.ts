import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { all, one, run, audit } from "@/lib/db";
import { validateFile, validateMagic, saveFile, humanSize } from "@/lib/storage";
import { canAccessEntity, isValidEntityType } from "@/lib/attachment-acl";
import { errorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
// 上传需要 Node Runtime（文件系统）
export const runtime = "nodejs";

/** 列出附件 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const entityType = req.nextUrl.searchParams.get("entityType") ?? "";
    const entityId = Number(req.nextUrl.searchParams.get("entityId"));
    if (!entityType || !entityId) {
      return NextResponse.json({ error: "缺少 entityType / entityId" }, { status: 400 });
    }

    // 关键：必须校验对该业务实体的访问权限
    // 之前只 requireUser()，任何登录用户都能拉任意项目/付款的附件清单
    if (!canAccessEntity(user, entityType, entityId)) {
      return NextResponse.json({ error: "无权访问该附件列表" }, { status: 403 });
    }

    const rows = all<{
      id: number; file_name: string; file_path: string; file_size: number;
      mime_type: string; uploaded_by: number; uploaded_by_name: string; uploaded_at: string; remark: string;
    }>(
      `SELECT a.*, u.name AS uploaded_by_name
       FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.entity_type = ? AND a.entity_id = ?
       ORDER BY a.uploaded_at DESC`,
      [entityType, entityId]
    );

    // 不返回 file_path（服务器内部路径），前端用不到
    return NextResponse.json(
      rows.map((r) => {
        const { file_path: _omit, ...rest } = r;
        void _omit;
        return { ...rest, size_text: humanSize(r.file_size ?? 0) };
      })
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/** 上传附件（multipart/form-data） */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();

    const form = await req.formData();
    const file = form.get("file");
    const entityType = String(form.get("entityType") ?? "");
    const entityId = Number(form.get("entityId"));
    const remark = form.get("remark") ? String(form.get("remark")) : null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "未选择文件" }, { status: 400 });
    }
    if (!entityType || !entityId) {
      return NextResponse.json({ error: "缺少 entityType / entityId" }, { status: 400 });
    }

    // 实体类型白名单：防止把附件挂到任意 entity_type 上绕过权限判断
    if (!isValidEntityType(entityType)) {
      return NextResponse.json({ error: "不支持的附件归属类型" }, { status: 400 });
    }

    // 上传前也要校验目标实体权限 —— 否则可以把文件塞进别人的项目
    if (!canAccessEntity(user, entityType, entityId)) {
      return NextResponse.json({ error: "无权向该记录上传附件" }, { status: 403 });
    }

    // 1. 扩展名 + 大小
    const err = validateFile(file.name, file.size);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());

    // 2. 文件内容与扩展名是否匹配（防改扩展名上传可执行文件）
    const magicErr = validateMagic(file.name, buf);
    if (magicErr) return NextResponse.json({ error: magicErr }, { status: 400 });

    const { relPath } = saveFile(entityType, entityId, file.name, buf);

    const info = run(
      `INSERT INTO attachments (entity_type, entity_id, file_name, file_path, file_size, mime_type, uploaded_by, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityType, entityId, file.name, relPath, file.size, file.type || null, user.id, remark]
    );

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "attachment", entityId: Number(info.lastInsertRowid),
      summary: `上传附件「${file.name}」到 ${entityType}#${entityId}（${humanSize(file.size)}）`,
    });

    return NextResponse.json({
      ok: true,
      id: Number(info.lastInsertRowid),
      name: file.name,
      size: humanSize(file.size),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 删除附件 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    const row = one<{ id: number; file_name: string; file_path: string; uploaded_by: number }>(
      "SELECT id, file_name, file_path, uploaded_by FROM attachments WHERE id = ?", [id]
    );
    if (!row) return NextResponse.json({ error: "附件不存在" }, { status: 404 });

    // 只有上传者本人或总经理可删
    if (row.uploaded_by !== user.id && !user.roles.includes("boss") && !user.roles.includes("admin")) {
      throw new AuthError("只能删除自己上传的附件", 403);
    }

    const { deleteFile } = await import("@/lib/storage");
    deleteFile(row.file_path);
    run("DELETE FROM attachments WHERE id = ?", [id]);

    audit({
      userId: user.id, userName: user.name, action: "delete",
      entityType: "attachment", entityId: id,
      summary: `删除附件「${row.file_name}」`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
