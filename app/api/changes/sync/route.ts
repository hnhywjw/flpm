import { NextRequest, NextResponse } from "next/server";
import { one, run, all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * 同步审批结果到变更单状态
 * 审批通过 -> 变更单 approved；驳回 -> rejected
 * 由前端在审批后调用，或在查询变更单时惰性同步
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const list = all<{ id: number; approval_id: number; status: string }>(
      "SELECT id, approval_id, status FROM change_requests WHERE status = 'pending' AND approval_id IS NOT NULL"
    );

    let synced = 0;
    for (const cr of list) {
      const ap = one<{ status: string }>(
        "SELECT status FROM approval_instances WHERE id = ?", [cr.approval_id]
      );
      if (!ap) continue;
      if (ap.status === "approved") {
        run("UPDATE change_requests SET status = 'approved', finished_at = datetime('now','localtime') WHERE id = ?", [cr.id]);
        synced++;
      } else if (ap.status === "rejected") {
        run("UPDATE change_requests SET status = 'rejected', finished_at = datetime('now','localtime') WHERE id = ?", [cr.id]);
        synced++;
      } else if (ap.status === "cancelled") {
        run("UPDATE change_requests SET status = 'cancelled', finished_at = datetime('now','localtime') WHERE id = ?", [cr.id]);
        synced++;
      }
    }
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    return errorResponse(e);
  }
}
