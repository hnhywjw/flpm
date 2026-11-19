import { NextRequest } from "next/server";
import { listReceivables, getReceivableSummary } from "@/lib/queries";
import { fenToWan, wanToFen } from "@/lib/domain";
import { run, one, audit } from "@/lib/db";
import { withAuth, withRole } from "@/lib/api-guard";
import { updateRecord } from "@/lib/crud";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  return withAuth(async (user) => {
    if (!user.canSeeAmount) return { rows: [], summary: null, masked: true };
    return { rows: listReceivables(), summary: getReceivableSummary() };
  });
}

export async function POST(req: NextRequest) {
  return withRole(["finance", "boss"], async (user) => {
    const { termId, amountWan, actualDate, remark } = await req.json();

    const term = one<{ id: number; amount_cents: number; actual_cents: number; name: string }>(
      "SELECT id, amount_cents, actual_cents, name FROM payment_terms WHERE id = ?", [termId]
    );
    if (!term) throw new Error("回款期次不存在");

    // 用统一工具换算，不要手写 10000（项目约定）
    const add = wanToFen(amountWan);
    if (!add || add <= 0) throw new Error("回款金额必须大于 0");

    const newActual = term.actual_cents + add;
    if (newActual > term.amount_cents) {
      throw new Error(
        `累计回款 ${fenToWan(newActual)} 万超过计划金额 ${fenToWan(term.amount_cents)} 万`
      );
    }

    const status = newActual >= term.amount_cents ? "已回款" : "部分回款";
    run(
      "UPDATE payment_terms SET actual_cents = ?, actual_date = ?, status = ?, remark = COALESCE(?, remark) WHERE id = ?",
      [newActual, actualDate ?? todayLocal(), status, remark ?? null, termId]
    );

    audit({
      userId: user.id, userName: user.name, action: "pay",
      entityType: "payment_term", entityId: termId,
      field: "actual_cents", oldValue: String(term.actual_cents), newValue: String(newActual),
      summary: `登记回款 ${fenToWan(add)} 万（${term.name}），累计 ${fenToWan(newActual)} 万`,
    });

    return { ok: true, actual: newActual, status };
  });
}

/** 冲正/修改回款（财务专用） */
export async function PATCH(req: NextRequest) {
  return withRole(["finance", "boss"], async (user) => {
    const body = await req.json();
    const { id, actualWan, actualDate, status, remark } = body;
    if (!id) throw new Error("缺少期次 id");

    const term = one<{ amount_cents: number; actual_cents: number; name: string }>(
      "SELECT amount_cents, actual_cents, name FROM payment_terms WHERE id = ? AND deleted_at IS NULL",
      [Number(id)]
    );
    if (!term) throw new Error("回款期次不存在");

    return updateRecord({
      table: "payment_terms",
      id: Number(id),
      user,
      label: "回款期次",
      fields: {
        actual_cents: actualWan !== undefined && actualWan !== ""
          ? { value: wanToFen(actualWan as number | string), type: "number" } : undefined,
        actual_date: actualDate !== undefined ? { value: actualDate } : undefined,
        status: status !== undefined ? { value: status } : undefined,
        remark: remark !== undefined ? { value: remark } : undefined,
      } as never,
      guard: (_b, after) => {
        const act = Number(after.actual_cents ?? 0);
        if (act < 0) return "实收金额不能为负数";
        if (act > Number(term.amount_cents)) {
          return "实收金额不能超过计划金额 " + fenToWan(Number(term.amount_cents)) + " 万元";
        }
        return null;
      },
    });
  });
}
