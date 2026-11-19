import { NextRequest } from "next/server";
import { listAgentAgreements, getAgentPayments } from "@/lib/queries";
import { run, one, audit, nextCode } from "@/lib/db";
import { calcAgentFee, wanToFen, fenToWan } from "@/lib/domain";
import type { FeeMethod } from "@/lib/domain";
import { withAuth, withRole } from "@/lib/api-guard";
import { ensureProjectForWonBid } from "@/lib/ensure-won-project";
import { softDelete, updateRecord } from "@/lib/crud";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  return withAuth(async (user) => {
    if (!user.canSeeAmount) return [];
    const agreements = listAgentAgreements();
    if (!id) return agreements;
    const a = agreements.find((x) => x.id === Number(id));
    if (!a) throw new Error("协议不存在");
    return { agreement: a, payments: getAgentPayments(a.id) };
  });
}

export async function POST(req: NextRequest) {
  return withRole(["finance", "boss", "sales"], async (user) => {
    const body = await req.json();
    const {
      projectId, bidId, agreementWith, partyType, feeMethod, feeRate,
      customerAmountWan, invoicedAmountWan, agreeDate, note,
    } = body;

    let partyName = String(agreementWith ?? "").trim();
    if (!partyName && bidId) {
      const won = one<{ company_name: string }>(
        "SELECT company_name FROM bid_participants WHERE bid_id = ? AND result = '中标' ORDER BY is_self DESC, id LIMIT 1",
        [Number(bidId)]
      );
      partyName = won?.company_name ?? "";
    }
    if (!partyName) throw new Error("对方名称必填");

    let linkedProjectId = projectId ? Number(projectId) : null;
    if (!linkedProjectId && bidId) {
      const linked = ensureProjectForWonBid(Number(bidId), user);
      linkedProjectId = linked?.projectId ?? null;
    }
    if (linkedProjectId) {
      const dup = one<{ id: number; code: string }>(
        "SELECT id, code FROM agent_agreements WHERE project_id = ? AND deleted_at IS NULL",
        [linkedProjectId]
      );
      if (dup) throw new Error("该项目已登记过单费（" + dup.code + "），不能重复登记");
    }
    if (!["company", "individual"].includes(partyType))
      throw new Error("partyType 必须为 company 或 individual");
    if (!["diff", "cash"].includes(feeMethod))
      throw new Error("feeMethod 必须为 diff 或 cash");

    const customerCents = wanToFen(Number(customerAmountWan));
    const invoicedCents = wanToFen(Number(invoicedAmountWan || 0));
    if (customerCents <= 0) throw new Error("客户合同额必须大于 0");

    if (feeMethod === "diff" && invoicedCents >= customerCents)
      throw new Error("差价法要求开票额小于客户合同额，否则无差额");
    const rate = feeMethod === "cash" ? Number(feeRate) : null;
    if (feeMethod === "cash" && (!rate || rate <= 0))
      throw new Error("现金方式必须填写过单费率");

    const { fee, formula } = calcAgentFee(
      feeMethod as FeeMethod, customerCents, invoicedCents, rate
    );
    if (fee <= 0) throw new Error("核算出的过单费必须大于 0");

    const code = nextCode("DZ");
    const info = run(
      `INSERT INTO agent_agreements (code, project_id, agreement_with, party_type, fee_method, fee_rate,
         customer_amount_cents, invoiced_amount_cents, fee_cents, fee_formula, agree_date, status, owner_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '执行中', ?, ?)`,
      [code, linkedProjectId, partyName, partyType, feeMethod,
       rate, customerCents, invoicedCents, fee, formula,
       agreeDate ?? null, user.id, note ?? null]
    );

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "agent_agreement", entityId: Number(info.lastInsertRowid),
      summary: `新建代中标协议 ${code}，过单费 ${fenToWan(fee)} 万（${feeMethod === "diff" ? "差价法" : "现金法"}）`,
    });

    return { id: Number(info.lastInsertRowid), code, fee, formula };
  });
}

/** 修改代中标协议（重新核算过单费） */
export async function PATCH(req: NextRequest) {
  return withRole(["finance", "boss"], async (user) => {
    const b = await req.json();
    const { id, agreementWith, partyType, feeMethod, feeRate, customerAmountWan, invoicedAmountWan, note } = b;
    if (!id) throw new Error("缺少协议 id");

    const before = one<{
      customer_amount_cents: number; invoiced_amount_cents: number;
      fee_cents: number; fee_method: string;
    }>("SELECT customer_amount_cents, invoiced_amount_cents, fee_cents, fee_method FROM agent_agreements WHERE id = ? AND deleted_at IS NULL", [Number(id)]);
    if (!before) throw new Error("协议不存在");

    // 已付过单费时不允许改金额
    const paid = one<{ s: number }>(
      "SELECT COALESCE(SUM(amount_cents),0) AS s FROM agent_fee_payments WHERE agreement_id = ? AND deleted_at IS NULL",
      [Number(id)]
    )?.s ?? 0;

    const custCents = customerAmountWan !== undefined && customerAmountWan !== ""
      ? wanToFen(Number(customerAmountWan))
      : before.customer_amount_cents;
    const invCents = invoicedAmountWan !== undefined && invoicedAmountWan !== ""
      ? wanToFen(Number(invoicedAmountWan))
      : before.invoiced_amount_cents;
    const method = feeMethod ?? before.fee_method;

    // 重新核算过单费
    let fee = before.fee_cents;
    let formula = "";
    if (method === "diff") {
      if (invCents >= custCents) throw new Error("差价法要求开票额小于客户合同额");
      fee = custCents - invCents;
      formula = fenToWan(custCents) + " − " + fenToWan(invCents) + " = " + fenToWan(fee);
    } else {
      const rate = Number(feeRate ?? 0);
      if (!rate || rate <= 0) throw new Error("现金法必须填写费率");
      fee = Math.round(custCents * (rate / 100));
      formula = fenToWan(custCents) + " × " + rate.toFixed(2) + "% = " + fenToWan(fee);
    }

    if (paid > fee) {
      throw new Error("新过单费 " + fenToWan(fee) + " 万小于已付 " + fenToWan(paid) + " 万，请先处理付款记录");
    }

    return updateRecord({
      table: "agent_agreements",
      id: Number(id),
      user,
      label: "代中标协议",
      fields: {
        agreement_with: agreementWith !== undefined ? { value: agreementWith } : undefined,
        party_type: partyType !== undefined ? { value: partyType } : undefined,
        fee_method: feeMethod !== undefined ? { value: feeMethod } : undefined,
        fee_rate: method === "diff"
          ? { value: null, type: "number" }
          : feeRate !== undefined && feeRate !== ""
            ? { value: Number(feeRate), type: "number" } : undefined,
        customer_amount_cents: customerAmountWan !== undefined ? { value: custCents, type: "number" } : undefined,
        invoiced_amount_cents: invoicedAmountWan !== undefined ? { value: invCents, type: "number" } : undefined,
        fee_cents: { value: fee, type: "number" },
        fee_formula: { value: formula },
        note: note !== undefined ? { value: note } : undefined,
      } as never,
    });
  });
}

/** 删除代中标协议 */
export async function DELETE(req: NextRequest) {
  return withRole(["boss", "admin", "finance"], async (user) => {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少协议 id");

    const a = one<{ code: string; agreement_with: string }>(
      "SELECT code, agreement_with FROM agent_agreements WHERE id = ? AND deleted_at IS NULL", [id]
    );
    if (!a) throw new Error("协议不存在");

    return softDelete({
      table: "agent_agreements",
      id,
      user,
      label: "代中标协议",
      displayName: a.code + " " + a.agreement_with,
      refs: [{ table: "agent_fee_payments", field: "agreement_id", label: "付款记录", cascade: true }],
      guard: () => {
        const paid = one<{ s: number }>(
          "SELECT COALESCE(SUM(amount_cents),0) AS s FROM agent_fee_payments WHERE agreement_id = ? AND deleted_at IS NULL",
          [id]
        )?.s ?? 0;
        if (paid > 0) {
          return "该协议已有 " + fenToWan(paid) + " 万元付款记录，不能删除";
        }
        return null;
      },
    });
  });
}
