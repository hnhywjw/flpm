import { NextRequest, NextResponse } from "next/server";
import { all, one, run, audit } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { softDelete, updateRecord } from "@/lib/crud";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const { projectId, title, level, slaHours, snList, isWarranty, note } = body;

    if (!title?.trim()) throw new Error("问题描述必填");
    if (!projectId) throw new Error("必须选择项目");

    const project = one<{ id: number; code: string; name: string; customer_id: number | null }>(
      "SELECT id, code, name, customer_id FROM projects WHERE id = ?", [Number(projectId)]
    );
    if (!project) throw new Error("项目不存在");

    const year = new Date().getFullYear();
    const row = one<{ seq: number }>("SELECT seq FROM code_sequences WHERE prefix='WO' AND year=?", [year]);
    const seq = (row?.seq ?? 0) + 1;
    if (row) run("UPDATE code_sequences SET seq=? WHERE prefix='WO' AND year=?", [seq, year]);
    else run("INSERT INTO code_sequences (prefix,year,seq) VALUES ('WO',?,?)", [year, seq]);
    const code = `WO${year}-${String(seq).padStart(4, "0")}`;

    const lv = level || "一般";
    const sla = Number(slaHours) || (lv === "严重" ? 4 : 24);

    const info = run(
      `INSERT INTO tickets
       (code, project_id, customer_id, title, level, sla_hours, reported_at, owner_id, status, sn_list, is_warranty, note)
       VALUES (?,?,?,?,?,?,datetime('now','localtime'),?,?,?,?,?)`,
      [code, project.id, project.customer_id, title.trim(), lv, sla,
       user.id, "待响应", snList || null, isWarranty ? 1 : 0, note || null]
    );

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "ticket", entityId: Number(info.lastInsertRowid),
      summary: `新建工单 ${code}：${title}（${lv}，SLA ${sla} 小时）`,
    });

    return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid), code });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 更新工单状态 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const { id, status } = body;
    if (!id) throw new Error("缺少工单 id");

    const t = one<{ code: string }>("SELECT code FROM tickets WHERE id = ?", [Number(id)]);
    if (!t) throw new Error("工单不存在");

    // 无 status 时视为字段编辑，转交 updateRecord
    if (!status) {
      return NextResponse.json(updateRecord({
        table: "tickets", id: Number(id), user, label: "工单",
        fields: {
          title: body.title !== undefined ? { value: body.title } : undefined,
          level: body.level !== undefined ? { value: body.level } : undefined,
          sla_hours: body.slaHours !== undefined && body.slaHours !== ""
            ? { value: Number(body.slaHours), type: "number" } : undefined,
          sn_list: body.snList !== undefined ? { value: body.snList } : undefined,
          is_warranty: body.isWarranty !== undefined ? { value: body.isWarranty, type: "bool" } : undefined,
          note: body.note !== undefined ? { value: body.note } : undefined,
          owner_id: body.ownerId !== undefined
            ? { value: body.ownerId === "" || body.ownerId === null ? null : Number(body.ownerId), type: "number" } : undefined,
        } as never,
        guard: (_b, after) => {
          if (!after.title || !String(after.title).trim()) return "问题描述不能为空";
          return null;
        },
      }));
    }

    const ALLOWED = ["待响应", "处理中", "待备件", "已解决", "已关闭", "超时升级"];
    if (!ALLOWED.includes(status)) throw new Error(`status 必须为：${ALLOWED.join("/")}`);

    const resolved = status === "已解决" || status === "已关闭";
    run(
      `UPDATE tickets SET status = ?, resolved_at = ${resolved ? "datetime('now','localtime')" : "resolved_at"}
       WHERE id = ?`,
      [status, Number(id)]
    );

    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: "ticket", entityId: Number(id),
      field: "status", newValue: status,
      summary: `工单 ${t.code} 状态更新为 ${status}`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 项目/客户下拉 */
export async function GET() {
  try {
    await requireUser();
    const projects = all<{ id: number; code: string; name: string }>(
      `SELECT p.id, p.code, p.name FROM projects p
       WHERE p.stage IN ('实施','验收','质保','售后')
       ORDER BY p.id DESC`
    );
    return NextResponse.json({ projects });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 修改工单详情 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const b = await req.json();
    const { id, title, level, slaHours, snList, isWarranty, note, ownerId } = b;
    if (!id) throw new Error("缺少工单 id");

    return NextResponse.json(updateRecord({
      table: "tickets",
      id: Number(id),
      user,
      label: "工单",
      fields: {
        title: title !== undefined ? { value: title } : undefined,
        level: level !== undefined ? { value: level } : undefined,
        sla_hours: slaHours !== undefined && slaHours !== ""
          ? { value: Number(slaHours), type: "number" } : undefined,
        sn_list: snList !== undefined ? { value: snList } : undefined,
        is_warranty: isWarranty !== undefined ? { value: isWarranty, type: "bool" } : undefined,
        note: note !== undefined ? { value: note } : undefined,
        owner_id: ownerId !== undefined
          ? { value: ownerId === "" || ownerId === null ? null : Number(ownerId), type: "number" } : undefined,
      } as never,
      guard: (_b, after) => {
        if (!after.title || !String(after.title).trim()) return "问题描述不能为空";
        return null;
      },
    }));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 删除工单 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少工单 id");

    if (!["boss", "admin", "service"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限删除工单", 403);
    }

    const t = one<{ code: string; title: string }>(
      "SELECT code, title FROM tickets WHERE id = ? AND deleted_at IS NULL", [id]
    );
    if (!t) throw new Error("工单不存在或已删除");

    return NextResponse.json(
      softDelete({ table: "tickets", id, user, label: "工单", displayName: t.code + " " + t.title })
    );
  } catch (e) {
    return errorResponse(e);
  }
}
