import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { all, one, run, audit } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 可恢复的表（白名单） */
const TABLES: Record<string, { label: string; nameField: string }> = {
  projects: { label: "项目", nameField: "name" },
  bids: { label: "投标", nameField: "name" },
  contracts: { label: "合同", nameField: "party_name" },
  payment_terms: { label: "回款期次", nameField: "name" },
  tickets: { label: "工单", nameField: "title" },
  stock_moves: { label: "出入库单", nameField: "code" },
  change_requests: { label: "变更单", nameField: "title" },
  risk_register: { label: "风险", nameField: "title" },
  agent_agreements: { label: "代中标协议", nameField: "agreement_with" },
  agent_fee_payments: { label: "过单费付款", nameField: "voucher_no" },
};

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user.roles.includes("boss") && !user.roles.includes("admin")) {
      return NextResponse.json({ error: "无权限查看回收站" }, { status: 403 });
    }

    const table = req.nextUrl.searchParams.get("table") ?? "";
    if (table && !TABLES[table]) {
      return NextResponse.json({ error: "不支持的表" }, { status: 400 });
    }

    const targets = table ? [table] : Object.keys(TABLES);
    const out: Record<string, unknown[]> = {};

    for (const t of targets) {
      const meta = TABLES[t];
      const rows = all<Record<string, unknown>>(
        `SELECT id, ${meta.nameField} AS display_name, deleted_at, deleted_by
         FROM ${t} WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC LIMIT 100`
      );
      // 补充删除人姓名
      const withName = rows.map((r) => {
        const u = r.deleted_by
          ? one<{ name: string }>("SELECT name FROM users WHERE id = ?", [r.deleted_by])
          : null;
        return { ...r, deleted_by_name: u?.name ?? "—" };
      });
      if (withName.length > 0) out[t] = withName;
    }

    return NextResponse.json({ tables: TABLES, deleted: out });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 恢复记录 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user.roles.includes("boss") && !user.roles.includes("admin")) {
      return NextResponse.json({ error: "无权限恢复记录" }, { status: 403 });
    }

    const { table, id } = await req.json();
    if (!table || !TABLES[table]) {
      return NextResponse.json({ error: "不支持的表" }, { status: 400 });
    }
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    const row = one<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, [Number(id)]
    );
    if (!row) {
      return NextResponse.json({ error: "记录不存在或未被删除" }, { status: 404 });
    }

    run(`UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL WHERE id = ?`, [Number(id)]);

    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: table, entityId: Number(id),
      summary: `从回收站恢复${TABLES[table].label} #${id}`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 彻底删除（谨慎） */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user.roles.includes("boss")) {
      return NextResponse.json({ error: "仅总经理可彻底删除" }, { status: 403 });
    }
    const table = req.nextUrl.searchParams.get("table") ?? "";
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!TABLES[table] || !id) {
      return NextResponse.json({ error: "参数无效" }, { status: 400 });
    }

    const row = one<{ id: number }>(
      `SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, [id]
    );
    if (!row) return NextResponse.json({ error: "记录不存在或未被删除" }, { status: 404 });

    run(`DELETE FROM ${table} WHERE id = ?`, [id]);

    audit({
      userId: user.id, userName: user.name, action: "delete",
      entityType: table, entityId: id,
      summary: `彻底删除${TABLES[table].label} #${id}（不可恢复）`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
