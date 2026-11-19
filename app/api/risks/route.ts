import { NextRequest, NextResponse } from "next/server";
import { all, one, run, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { softDelete, updateRecord } from "@/lib/crud";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (projectId) {
      return NextResponse.json(
        all(
          `SELECT r.*, p.code AS project_code, p.name AS project_name
           FROM risk_register r JOIN projects p ON p.id = r.project_id
           WHERE r.project_id = ?
           ORDER BY CASE r.level WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END, r.id DESC`,
          [Number(projectId)]
        )
      );
    }
    return NextResponse.json(
      all(
        `SELECT r.*, p.code AS project_code, p.name AS project_name
         FROM risk_register r JOIN projects p ON p.id = r.project_id
         ORDER BY CASE r.status WHEN 'open' THEN 1 WHEN 'monitoring' THEN 2 ELSE 3 END,
                  CASE r.level WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END
         LIMIT 200`
      )
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { projectId, title, category, level, probability, impactDesc, response, dueDate } = await req.json();

    if (!projectId) return NextResponse.json({ error: "必须指定项目" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "风险标题必填" }, { status: 400 });

    const year = new Date().getFullYear();
    const row = one<{ seq: number }>("SELECT seq FROM code_sequences WHERE prefix = 'RK' AND year = ?", [year]);
    const seq = (row?.seq ?? 0) + 1;
    if (row) run("UPDATE code_sequences SET seq = ? WHERE prefix = 'RK' AND year = ?", [seq, year]);
    else run("INSERT INTO code_sequences (prefix, year, seq) VALUES ('RK', ?, ?)", [year, seq]);
    const code = `RK${year}-${String(seq).padStart(4, "0")}`;

    const info = run(
      `INSERT INTO risk_register
       (code, project_id, title, category, level, probability, impact_desc, response, owner_id, owner_name, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, projectId, title, category ?? "other", level ?? "中", probability ?? "中",
       impactDesc ?? null, response ?? null, user.id, user.name, dueDate ?? null]
    );

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "risk_register", entityId: Number(info.lastInsertRowid),
      summary: `登记风险 ${code}：${title}（${level ?? "中"}风险）`,
    });

    return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid), code });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 更新风险状态 / 关闭 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const { id, status, closeNote, response } = await req.json();
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    const r = one<{ code: string; title: string }>("SELECT code, title FROM risk_register WHERE id = ?", [id]);
    if (!r) return NextResponse.json({ error: "风险不存在" }, { status: 404 });

    if (status === "closed") {
      run(
        "UPDATE risk_register SET status = 'closed', closed_at = datetime('now','localtime'), close_note = ? WHERE id = ?",
        [closeNote ?? null, id]
      );
    } else if (status) {
      run("UPDATE risk_register SET status = ? WHERE id = ?", [status, id]);
    }
    if (response !== undefined) {
      run("UPDATE risk_register SET response = ? WHERE id = ?", [response, id]);
    }

    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: "risk_register", entityId: id,
      summary: `风险 ${r.code} 状态更新为 ${status ?? "(不变)"}`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 修改风险详情 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const b = await req.json();
    const { id, title, category, level, probability, impactDesc, response, dueDate } = b;
    if (!id) throw new Error("缺少风险 id");

    return NextResponse.json(updateRecord({
      table: "risk_register",
      id: Number(id),
      user,
      label: "风险",
      fields: {
        title: title !== undefined ? { value: title } : undefined,
        category: category !== undefined ? { value: category } : undefined,
        level: level !== undefined ? { value: level } : undefined,
        probability: probability !== undefined ? { value: probability } : undefined,
        impact_desc: impactDesc !== undefined ? { value: impactDesc } : undefined,
        response: response !== undefined ? { value: response } : undefined,
        due_date: dueDate !== undefined ? { value: dueDate } : undefined,
      } as never,
      guard: (_b, after) => {
        if (!after.title || !String(after.title).trim()) return "风险标题不能为空";
        if (after.level && !["高", "中", "低"].includes(String(after.level))) {
          return "风险等级必须为 高/中/低";
        }
        return null;
      },
    }));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 删除风险 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少风险 id");

    const r = one<{ code: string; title: string; status: string }>(
      "SELECT code, title, status FROM risk_register WHERE id = ? AND deleted_at IS NULL", [id]
    );
    if (!r) throw new Error("风险不存在");

    return NextResponse.json(
      softDelete({ table: "risk_register", id, user, label: "风险", displayName: r.code + " " + r.title })
    );
  } catch (e) {
    return errorResponse(e);
  }
}
