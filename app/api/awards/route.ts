import { NextRequest, NextResponse } from "next/server";
import { all, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * 中标管理
 * 统一列出所有「已中标」项目，用 mode 区分为 直接中标 / 代中标
 * 代中标项目额外返回过单费信息
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;
    const mode = sp.get("mode"); // direct | agent | all
    const kw = (sp.get("kw") ?? "").trim();

    const canAmount = user.canSeeAmount;

    let sql = `
      SELECT
        p.id, p.code, p.name, p.mode, p.stage, p.status, p.owner_id, p.budget_cents,
        u.name AS owner_name,
        c.name AS customer_name,
        (SELECT COALESCE(SUM(amount_cents),0) FROM contracts WHERE project_id=p.id AND type='customer') AS contract_total,
        (SELECT COALESCE(SUM(amount_cents),0) FROM contracts WHERE project_id=p.id AND type='purchase') AS purchase_total,
        (SELECT COALESCE(SUM(actual_cents),0) FROM payment_terms t JOIN contracts cc ON cc.id=t.contract_id
           WHERE cc.project_id=p.id AND cc.type='customer') AS received_total,
        a.id AS agent_id, a.code AS agent_code, a.agreement_with, a.party_type,
        a.fee_method, a.fee_rate, a.fee_cents, a.invoiced_amount_cents, a.customer_amount_cents,
        (SELECT COALESCE(SUM(amount_cents),0) FROM agent_fee_payments WHERE agreement_id=a.id AND deleted_at IS NULL) AS fee_paid,
        b.code AS bid_code, b.win_amount_cents, b.result
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      LEFT JOIN customers c ON c.id = p.customer_id
      LEFT JOIN agent_agreements a ON a.project_id = p.id AND a.deleted_at IS NULL
      LEFT JOIN bids b ON b.project_id = p.id AND b.result = '中标'
      WHERE p.stage NOT IN ('投标')
    `;
    const params: unknown[] = [];

    if (mode === "direct" || mode === "agent") {
      sql += " AND p.mode = ?";
      params.push(mode);
    }
    if (kw) {
      sql += " AND (p.name LIKE ? OR p.code LIKE ? OR c.name LIKE ? OR a.agreement_with LIKE ?)";
      params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    sql += " ORDER BY p.mode, p.id DESC";

    const rows = all<Record<string, unknown>>(sql, params);

    const list = rows.map((r) => {
      const fee = Number(r.fee_cents ?? 0);
      const paid = Number(r.fee_paid ?? 0);
      const signed = Number(r.contract_total ?? 0);
      const winAmount = Number(r.win_amount_cents ?? 0);
      const agreed = Number(r.customer_amount_cents ?? 0);
      const budget = Number(r.budget_cents ?? 0);
      // 还没签客户合同时，用中标金额，避免合同总额一直是 0
      const contractTotal = signed > 0 ? signed : (winAmount || agreed || budget);
      const purchaseTotal = Number(r.purchase_total ?? 0);
      const profit = contractTotal - purchaseTotal - fee;

      const base = {
        id: r.id, code: r.code, name: r.name,
        mode: r.mode, stage: r.stage, status: r.status,
        owner_name: r.owner_name, customer_name: r.customer_name,
        bid_code: r.bid_code,
      };

      // 无金额权限：只返回业务字段
      if (!canAmount) {
        return {
          ...base,
          contractTotal: null, receivedTotal: null, purchaseTotal: null,
          profit: null, fee: null, feePaid: null, unpaid: null,
          agent: r.agent_id ? { id: Number(r.agent_id), code: r.agent_code, party: r.agreement_with, partyType: r.party_type, feeMethod: r.fee_method, feeRate: r.fee_rate } : null,
        };
      }

      return {
        ...base,
        contractTotal,
        receivedTotal: Number(r.received_total ?? 0),
        purchaseTotal,
        profit,
        profitRate: contractTotal > 0 ? (profit / contractTotal) * 100 : 0,
        fee: r.agent_id ? fee : null,
        feePaid: r.agent_id ? paid : null,
        unpaid: r.agent_id ? fee - paid : null,
        invoicedAmount: r.agent_id ? Number(r.invoiced_amount_cents ?? 0) : null,
        agreedAmount: r.agent_id ? Number(r.customer_amount_cents ?? 0) : null,
        agent: r.agent_id
          ? {
              id: Number(r.agent_id),
              code: r.agent_code,
              party: r.agreement_with,
              partyType: r.party_type,
              feeMethod: r.fee_method,
              feeRate: r.fee_rate,
              feeFormula: null,
            }
          : null,
      };
    });

    // 汇总（仅金额权限者）
    const summary = canAmount
      ? {
          directCount: list.filter((x) => x.mode !== "agent").length,
          agentCount: list.filter((x) => x.agent).length,
          total: list.filter((x) => x.mode !== "agent" || x.agent).length,
          contractTotal: list.reduce((s, x) => s + (x.contractTotal ?? 0), 0),
          receivedTotal: list.reduce((s, x) => s + (x.receivedTotal ?? 0), 0),
          profitTotal: list.reduce((s, x) => s + (x.profit ?? 0), 0),
          feeTotal: list.reduce((s, x) => s + (x.fee ?? 0), 0),
          feePaid: list.reduce((s, x) => s + (x.feePaid ?? 0), 0),
          feeUnpaid: list.reduce((s, x) => s + (x.unpaid ?? 0), 0),
        }
      : { total: list.length, directCount: 0, agentCount: 0 };

    return NextResponse.json({ list, summary, canAmount });
  } catch (e) {
    return errorResponse(e);
  }
}
