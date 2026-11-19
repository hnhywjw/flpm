import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/queries";
import { withAuth } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  return withAuth(async (user) => {
    const d = getDashboard();
    // 不涉及金额的角色（管理员/库管）隐藏金额字段
    if (!user.canSeeAmount) {
      return {
        ...d,
        contractTotal: 0,
        receivedTotal: 0,
        overdueTotal: 0,
        feeUnpaid: 0,
        warrantyPending: 0,
        bondPending: 0,
        payablePending: 0,
        masked: true,
      };
    }
    return d;
  });
}
