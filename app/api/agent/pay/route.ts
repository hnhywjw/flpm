import { NextRequest } from "next/server";
import { run, one, audit } from "@/lib/db";
import { isVoucherComplete, wanToFen, fenToWan } from "@/lib/domain";
import { withRole } from "@/lib/api-guard";
import { softDelete, updateRecord } from "@/lib/crud";

export const dynamic = "force-dynamic";

/** 过单费付款：仅财务与总经理可操作 */
export async function POST(req: NextRequest) {
  return withRole(["finance", "boss"], async (user) => {
    const body = await req.json();
    const {
      agreementId, amountWan, payDate, payMethod, payeeName, payeeIdTail,
      payeePhone, voucherNo, docAgreement, docVoucher, docConfirm, remark,
    } = body;

    const agreement = one<{
      id: number; code: string; party_type: string; fee_cents: number;
      fee_method: string; agreement_with: string;
    }>("SELECT id, code, party_type, fee_cents, fee_method, agreement_with FROM agent_agreements WHERE id = ?", [agreementId]);

    if (!agreement) throw new Error("代中标协议不存在");

    const paidRow = one<{ n: number }>(
      "SELECT COALESCE(SUM(amount_cents),0) AS n FROM agent_fee_payments WHERE agreement_id = ?",
      [agreementId]
    );
    const paid = paidRow?.n ?? 0;
    const remaining = agreement.fee_cents - paid;
    const amountCents = wanToFen(Number(amountWan));

    // 统一校验
    const errors: string[] = [];
    if (!amountCents || amountCents <= 0) errors.push("付款金额必须大于 0");
    if (amountCents > remaining)
      errors.push(`付款金额超过未付余额 ${fenToWan(remaining)} 万元`);

    if (agreement.party_type === "individual") {
      if (!docAgreement) errors.push("缺少代中标协议扫描件");
      if (!docVoucher) errors.push("缺少付款凭证（银行回单/现金签收单）");
      if (!docConfirm) errors.push("缺少收款确认单");
      if (!payeeName) errors.push("必须填写收款人姓名");
      if (!voucherNo) errors.push("必须填写凭证编号");
    }

    if (errors.length > 0) {
      const msg = errors.join("；");
      const err = new Error(msg);
      (err as Error & { details?: string[] }).details = errors;
      throw err;
    }

    const complete = isVoucherComplete({
      doc_agreement: docAgreement, doc_voucher: docVoucher, doc_confirm: docConfirm,
    });

    const info = run(
      `INSERT INTO agent_fee_payments (agreement_id, amount_cents, pay_date, pay_method, payee_name,
         payee_id_tail, payee_phone, voucher_no, doc_agreement, doc_voucher, doc_confirm,
         docs_complete, paid_by, approved_by, approved_at, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)`,
      [agreementId, amountCents, payDate ?? null, payMethod ?? "现金", payeeName ?? null,
       payeeIdTail ?? null, payeePhone ?? null, voucherNo ?? null,
       docAgreement ?? null, docVoucher ?? null, docConfirm ?? null,
       complete ? 1 : 0, user.id, user.id, remark ?? null]
    );

    const paymentId = Number(info.lastInsertRowid);

    // 凭证附件原本挂在草稿实体下，付款成功后归属到真实付款记录
    const docIds = [docAgreement, docVoucher, docConfirm].filter(
      (v) => v !== null && v !== undefined && v !== ""
    );
    if (docIds.length > 0) {
      for (const raw of docIds) {
        const aid = Number(raw);
        if (Number.isNaN(aid)) continue;
        run(
          "UPDATE attachments SET entity_type = 'agent_fee_payment', entity_id = ? WHERE id = ?",
          [paymentId, aid]
        );
      }
    }

    const newPaid = paid + amountCents;
    if (newPaid >= agreement.fee_cents) {
      run("UPDATE agent_agreements SET status = '已结清' WHERE id = ?", [agreementId]);
    }

    audit({
      userId: user.id, userName: user.name, action: "pay",
      entityType: "agent_fee_payment", entityId: Number(info.lastInsertRowid),
      field: "amount_cents", newValue: String(amountCents),
      summary: `支付过单费 ${fenToWan(amountCents)} 万给 ${agreement.agreement_with}（${agreement.party_type === "individual" ? "个人，凭证" + (complete ? "三件套齐备" : "不齐") : "公司"}）`,
    });

    return {
      ok: true,
      id: Number(info.lastInsertRowid),
      paid: newPaid,
      remaining: agreement.fee_cents - newPaid,
    };
  });
}

/** 修改付款记录（仅备注/凭证，金额不可改） */
export async function PATCH(req: NextRequest) {
  return withRole(["finance", "boss"], async (user) => {
    const b = await req.json();
    const { id, remark, voucherNo, docAgreement, docVoucher, docConfirm, payeeName, payeeIdTail } = b;
    if (!id) throw new Error("缺少付款记录 id");

    return updateRecord({
      table: "agent_fee_payments",
      id: Number(id),
      user,
      label: "过单费付款记录",
      fields: {
        remark: remark !== undefined ? { value: remark } : undefined,
        voucher_no: voucherNo !== undefined ? { value: voucherNo } : undefined,
        doc_agreement: docAgreement !== undefined ? { value: docAgreement } : undefined,
        doc_voucher: docVoucher !== undefined ? { value: docVoucher } : undefined,
        doc_confirm: docConfirm !== undefined ? { value: docConfirm } : undefined,
        payee_name: payeeName !== undefined ? { value: payeeName } : undefined,
        payee_id_tail: payeeIdTail !== undefined ? { value: payeeIdTail } : undefined,
      } as never,
      guard: (_b, after) => {
        // 三件套齐全性重算
        const complete = Boolean(after.doc_agreement && after.doc_voucher && after.doc_confirm);
        run("UPDATE agent_fee_payments SET docs_complete = ? WHERE id = ?", [complete ? 1 : 0, Number(id)]);
        return null;
      },
    });
  });
}

/** 删除付款记录（冲正），并回退协议状态 */
export async function DELETE(req: NextRequest) {
  return withRole(["boss"], async (user) => {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少付款记录 id");

    const f = one<{ agreement_id: number; amount_cents: number; voucher_no: string }>(
      "SELECT agreement_id, amount_cents, voucher_no FROM agent_fee_payments WHERE id = ? AND deleted_at IS NULL", [id]
    );
    if (!f) throw new Error("付款记录不存在");

    const r = softDelete({
      table: "agent_fee_payments",
      id,
      user,
      label: "过单费付款记录",
      displayName: f.voucher_no,
    });

    // 回退协议状态：若不再结清则改回执行中
    const left = one<{ s: number }>(
      "SELECT COALESCE(SUM(amount_cents),0) AS s FROM agent_fee_payments WHERE agreement_id = ? AND deleted_at IS NULL",
      [f.agreement_id]
    )?.s ?? 0;
    const total = one<{ fee: number }>(
      "SELECT fee_cents AS fee FROM agent_agreements WHERE id = ?", [f.agreement_id]
    )?.fee ?? 0;

    run(
      "UPDATE agent_agreements SET status = ? WHERE id = ?",
      [left >= total ? "已结清" : "执行中", f.agreement_id]
    );

    return r;
  });
}
