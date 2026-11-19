import { NextRequest, NextResponse } from "next/server";
import { all, one, run, audit, nextCode } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { wanToFen, fenToWan } from "@/lib/domain";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * 开票登记
 * 规则：
 *   - 开票金额不能超过期次计划金额
 *   - 累计开票不能超过期次金额
 *   - 验收四件套未齐备时，客户合同不允许开票（可强制说明原因）
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["finance", "boss", "admin"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限登记开票（需要财务或总经理）", 403);
    }

    const b = await req.json();
    const { termId, invoiceNo, amountWan, taxRate, invoiceType, issueDate, remark } = b;

    if (!termId) throw new Error("必须选择回款期次");
    const amt = wanToFen(Number(amountWan));
    if (!amt || amt <= 0) throw new Error("开票金额必须大于 0");

    const term = one<{
      id: number; contract_id: number; name: string; amount_cents: number;
      invoiced_cents: number; seq: number;
    }>(
      `SELECT id, contract_id, name, amount_cents, invoiced_cents, seq
       FROM payment_terms WHERE id = ? AND deleted_at IS NULL`,
      [Number(termId)]
    );
    if (!term) throw new Error("回款期次不存在");

    const already = term.invoiced_cents ?? 0;
    if (already + amt > term.amount_cents) {
      throw new Error(
        `开票金额超过期次余额：计划 ${fenToWan(term.amount_cents)} 万，` +
        `已开 ${fenToWan(already)} 万，本次最多 ${fenToWan(term.amount_cents - already)} 万`
      );
    }

    const contract = one<{ id: number; project_id: number; type: string; code: string }>(
      "SELECT id, project_id, type, code FROM contracts WHERE id = ? AND deleted_at IS NULL",
      [term.contract_id]
    );
    if (!contract) throw new Error("关联合同不存在");

    // 验收四件套卡点（仅客户合同）
    if (contract.type === "customer" && contract.project_id) {
      const DONE = ["已提交", "已签收", "已出具", "已齐备"];
      const required = ["安装配置文档", "到货签收单", "验收报告", "项目资料"];
      const rows = all<{ doc_type: string; status: string }>(
        "SELECT doc_type, status FROM acceptances WHERE project_id = ? AND deleted_at IS NULL",
        [contract.project_id]
      );
      const map = new Map(rows.map((r) => [r.doc_type, r.status]));
      const missing = required.filter((d) => !DONE.includes(map.get(d) ?? ""));
      if (missing.length > 0) {
        throw new Error(
          `验收资料未齐备，不能开票（缺：${missing.join("、")}）。请先在项目详情上传齐全`
        );
      }
    }

    const code = nextCode("INV");
    const info = run(
      `INSERT INTO invoices (contract_id, project_id, invoice_no, amount_cents, tax_rate,
         invoice_type, basis, term_id, issue_date, status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '已开票', ?)`,
      [
        contract.id, contract.project_id, invoiceNo?.trim() || code,
        amt, taxRate ?? "13%", invoiceType ?? "增值税专用发票",
        "按付款比例", Number(termId),
        issueDate || todayLocal(),
        remark ?? null,
      ]
    );

    // 同步更新期次开票额
    run(
      "UPDATE payment_terms SET invoiced_cents = invoiced_cents + ?, invoice_date = ? WHERE id = ?",
      [amt, issueDate || todayLocal(), Number(termId)]
    );

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "invoice", entityId: Number(info.lastInsertRowid),
      summary: `开票 ${invoiceNo || code}：${fenToWan(amt)} 万元（期次 ${term.name}）`,
    });

    return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid), code });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 可选期次（含开票余额） */
export async function GET() {
  try {
    await requireUser();
    const terms = all<{
      id: number; label: string; amount_cents: number; invoiced_cents: number;
      actual_cents: number; contract_code: string; project_name: string;
    }>(`
      SELECT t.id,
             c.code || ' · ' || t.name AS label,
             t.amount_cents, COALESCE(t.invoiced_cents,0) AS invoiced_cents, t.actual_cents,
             c.code AS contract_code, p.name AS project_name
      FROM payment_terms t
      JOIN contracts c ON c.id = t.contract_id
      LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.type = 'customer'
        AND t.deleted_at IS NULL AND c.deleted_at IS NULL
        AND COALESCE(t.invoiced_cents,0) < t.amount_cents
      ORDER BY c.code, t.seq
    `);
    return NextResponse.json({ terms });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 红冲发票 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["finance", "boss"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限红冲发票", 403);
    }
    const { id, action, remark } = await req.json();
    if (!id) throw new Error("缺少发票 id");
    if (action !== "void") throw new Error("仅支持 action=void（红冲）");

    const inv = one<{ invoice_no: string; amount_cents: number; term_id: number | null; status: string }>(
      "SELECT invoice_no, amount_cents, term_id, status FROM invoices WHERE id = ? AND deleted_at IS NULL",
      [Number(id)]
    );
    if (!inv) throw new Error("发票不存在");
    if (inv.status === "已红冲") throw new Error("该发票已红冲");

    run("UPDATE invoices SET status = '已红冲', remark = COALESCE(?, remark) WHERE id = ?",
        [remark ?? "红冲", Number(id)]);

    if (inv.term_id) {
      run(
        "UPDATE payment_terms SET invoiced_cents = MAX(0, invoiced_cents - ?) WHERE id = ?",
        [inv.amount_cents, inv.term_id]
      );
    }

    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: "invoice", entityId: Number(id),
      summary: `红冲发票 ${inv.invoice_no}（${fenToWan(inv.amount_cents)} 万元）`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
