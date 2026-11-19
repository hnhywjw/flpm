import { NextRequest } from "next/server";
import { listContracts, getContractTerms, listInvoices } from "@/lib/queries";
import { tx, one, run, nextCode, audit } from "@/lib/db";
import { buildPaymentTerms, wanToFen, fenToWan } from "@/lib/domain";
import { withAuth, withRole } from "@/lib/api-guard";
import { softDelete, updateRecord } from "@/lib/crud";
import { applyAmountMask } from "@/lib/mask";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? undefined;
  const id = req.nextUrl.searchParams.get("id");
  return withAuth(async (user) => {
    if (id) {
      const data = {
        terms: getContractTerms(Number(id)),
        invoices: listInvoices().filter((i) => i.contract_id === Number(id)),
      };
      return applyAmountMask(data, user.canSeeAmount);
    }
    // 合同列表含 amount_cents，必须按权限遮蔽
    return applyAmountMask(listContracts(type), user.canSeeAmount);
  });
}

export async function POST(req: NextRequest) {
  return withRole(["finance", "boss", "sales"], async (user) => {
    const body = await req.json();
    const {
      projectId, type, partyName, title, amountWan, signDate,
      warrantyMonths, invoiceMode, taxRate, paySummary, ownerId,
    } = body;

    if (!partyName) throw new Error("合同相对方必填");
    // 客户合同一个项目只能一份；采购合同允许多份，不要按类型一刀切。
    if (projectId && (type === "customer" || !type)) {
      const dup = one<{ code: string }>(
        "SELECT code FROM contracts WHERE project_id = ? AND type = 'customer' AND deleted_at IS NULL",
        [Number(projectId)]
      );
      if (dup) throw new Error("该项目已有客户合同（" + dup.code + "），不能再加。采购合同可以继续添加");
    }
    if (!amountWan || Number(amountWan) <= 0) throw new Error("合同金额必须大于 0");

    const amountCents = wanToFen(Number(amountWan));
    const code = type === "purchase" ? nextCode("CG") : nextCode("HT");
    const summary = paySummary || "100";

    const result = tx((db) => {
      const info = db.prepare(
        `INSERT INTO contracts (code, project_id, type, party_name, title, amount_cents, sign_date,
           warranty_months, invoice_mode, tax_rate, pay_summary, status, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '执行中', ?)`
      ).run(code, projectId ?? null, type ?? "customer", partyName, title ?? null, amountCents,
            signDate ?? null, warrantyMonths ?? null, invoiceMode ?? "by_payment",
            taxRate ?? "13%", summary, ownerId ?? user.id);

      const cid = Number(info.lastInsertRowid);
      const terms = buildPaymentTerms(amountCents, summary);

      const base = signDate ? new Date(signDate) : new Date();
      const stmt = db.prepare(
        `INSERT INTO payment_terms (contract_id, seq, name, term_type, percent, amount_cents, plan_date, actual_cents, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
      );
      terms.forEach((t, i) => {
        const d = new Date(base);
        d.setDate(d.getDate() + 7 + i * 30);
        const planDate = t.termType === "warranty" && warrantyMonths
          ? (() => { const w = new Date(base); w.setMonth(w.getMonth() + Number(warrantyMonths)); return w; })()
          : d;
        stmt.run(cid, t.seq, t.name, t.termType, t.percent, t.amountFen,
                 todayLocal(undefined, planDate), "未到期");
      });

      return { cid, code, terms: terms.length };
    });

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "contract", entityId: result.cid,
      summary: `新建合同 ${result.code}，金额 ${amountWan} 万，生成 ${result.terms} 期回款计划`,
    });

    return result;
  });
}

/** 修改合同 */
export async function PATCH(req: NextRequest) {
  return withRole(["finance", "boss", "sales"], async (user) => {
    const body = await req.json();
    const { id, partyName, title, amountWan, signDate, warrantyMonths, invoiceMode, taxRate, paySummary, status, remark , expectedVersion } = body;
    if (!id) throw new Error("缺少合同 id");

    const cid = Number(id);
    const beforeRow = one<{
      amount_cents: number; pay_summary: string | null; sign_date: string | null;
      warranty_months: number | null; type: string;
    }>(
      "SELECT amount_cents, pay_summary, sign_date, warranty_months, type FROM contracts WHERE id = ? AND deleted_at IS NULL",
      [cid]
    );
    if (!beforeRow) throw new Error("合同不存在或已删除");

    const result = updateRecord({
      table: "contracts",
      id: cid,
      user,
      label: "合同",
      expectedVersion: expectedVersion !== undefined ? Number(expectedVersion) : undefined,
      fields: {
        party_name: partyName !== undefined ? { value: partyName } : undefined,
        title: title !== undefined ? { value: title } : undefined,
        amount_cents: amountWan !== undefined && amountWan !== ""
          ? { value: wanToFen(Number(amountWan)), type: "number" }
          : undefined,
        sign_date: signDate !== undefined ? { value: signDate } : undefined,
        warranty_months: warrantyMonths !== undefined
          ? { value: warrantyMonths === "" || warrantyMonths === null ? null : Number(warrantyMonths), type: "number" }
          : undefined,
        invoice_mode: invoiceMode !== undefined ? { value: invoiceMode } : undefined,
        tax_rate: taxRate !== undefined ? { value: taxRate } : undefined,
        pay_summary: paySummary !== undefined ? { value: paySummary } : undefined,
        status: status !== undefined ? { value: status } : undefined,
        remark: remark !== undefined ? { value: remark } : undefined,
      } as never,
      guard: (before, after) => {
        if (!after.party_name || !String(after.party_name).trim()) return "合同相对方不能为空";
        const amt = Number(after.amount_cents);
        if (!amt || amt <= 0) return "合同金额必须大于 0";

        // 金额或付款比例被改动时：校验后由外层重建回款计划
        if (Number(before.amount_cents) !== amt) {
          const paid = one<{ s: number }>(
            "SELECT COALESCE(SUM(actual_cents),0) AS s FROM payment_terms WHERE contract_id = ? AND deleted_at IS NULL",
            [Number(id)]
          )?.s ?? 0;
          if (amt < paid) {
            return `合同金额不能小于已回款总额 ${fenToWan(paid)} 万元`;
          }
        }

        // 付款比例变化时校验合计
        if (after.pay_summary) {
          const sum = String(after.pay_summary).split("/").map(Number)
            .reduce((a, b) => a + (isNaN(b) ? 0 : b), 0);
          if (Math.abs(sum - 100) > 0.01) {
            return `付款比例合计必须为 100，当前为 ${sum}`;
          }
        }
        return null;
      },
    });

    // ---- 金额或付款比例变化时，重建回款计划 ----
    const newAmount = amountWan !== undefined && amountWan !== ""
      ? wanToFen(Number(amountWan))
      : beforeRow.amount_cents;
    const newSummary = paySummary !== undefined && paySummary !== ""
      ? String(paySummary)
      : (beforeRow.pay_summary ?? "100");

    const amountChanged = newAmount !== beforeRow.amount_cents;
    const summaryChanged = newSummary !== (beforeRow.pay_summary ?? "100");

    let rebuild: { dropped: number; created: number; kept: number } | null = null;

    if (amountChanged || summaryChanged) {
      rebuild = rebuildPaymentTerms(cid, newAmount, newSummary, {
        signDate: signDate !== undefined ? signDate : beforeRow.sign_date,
        warrantyMonths: warrantyMonths !== undefined
          ? (warrantyMonths === "" || warrantyMonths === null ? null : Number(warrantyMonths))
          : beforeRow.warranty_months,
        contractType: beforeRow.type,
      });

      audit({
        userId: user.id, userName: user.name, action: "update",
        entityType: "contract", entityId: cid,
        summary:
          `合同金额/比例变更，重建回款计划：删除 ${rebuild.dropped} 期、` +
          `保留 ${rebuild.kept} 期已回款、新建 ${rebuild.created} 期`,
      });
    }

    return { ...result, rebuild };
  });
}

/**
 * 重建回款计划
 * 规则：
 *   - 尚未回款的期次 → 删除重建
 *   - 已有回款的期次 → 保留不动（避免破坏账实）
 *   - 新建期次按剩余金额和比例分摊
 */
function rebuildPaymentTerms(
  contractId: number,
  amountCents: number,
  summary: string,
  opts: { signDate: string | null; warrantyMonths: number | null; contractType: string }
): { dropped: number; created: number; kept: number } {
  return tx((db) => {
    // 1. 找出需要保留的期次（已回款 或 已开票）
    const paidTerms = db.prepare(
      `SELECT id, name, percent, amount_cents, actual_cents, term_type, seq
       FROM payment_terms
       WHERE contract_id = ? AND deleted_at IS NULL
         AND (actual_cents > 0 OR COALESCE(invoiced_cents, 0) > 0)
       ORDER BY seq`
    ).all(contractId) as {
      id: number; name: string; percent: number | null; amount_cents: number;
      actual_cents: number; term_type: string; seq: number;
    }[];

    // 保留期次占据的金额（用「计划金额」，不是实收金额）
    // 因为这些期次仍然存在于计划中，会参与合计
    const retainedTotal = paidTerms.reduce((s, t) => s + t.amount_cents, 0);

    // 2. 删除未回款的期次
    // 注意：payment_terms 有 UNIQUE(contract_id, seq) 约束，
    // 软删除的旧记录仍占用 seq，会导致新插入冲突，所以这里必须硬删除。
    // 未回款期次没有财务影响，硬删除安全。
    const dropped = db.prepare(
      `DELETE FROM payment_terms
       WHERE contract_id = ? AND actual_cents = 0 AND COALESCE(invoiced_cents, 0) = 0`
    ).run(contractId).changes;

    // 3. 按新比例生成全部期次
    const allTerms = buildPaymentTerms(amountCents, summary);

    // 4. 剩余金额 = 新合同额 - 保留期次已占用的计划金额
    const remainingAmount = amountCents - retainedTotal;

    // 5. 生成新期次：按原比例，但总额是剩余金额
    const base = opts.signDate ? new Date(opts.signDate) : new Date();
    const ins = db.prepare(
      `INSERT INTO payment_terms
       (contract_id, seq, name, term_type, percent, amount_cents, plan_date, actual_cents, status, invoiced_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`
    );

    let created = 0;
    let allocated = 0;

    if (remainingAmount <= 0) {
      return { dropped, created: 0, kept: paidTerms.length };
    }

    // 保留期次已占用一些 seq，新期次从「最大 seq + 1」开始，避免唯一约束冲突
    const maxSeq = paidTerms.reduce((m, t) => Math.max(m, t.seq), 0);
    let nextSeq = maxSeq;

    allTerms.forEach((t, i) => {
      const isLast = i === allTerms.length - 1;
      const share = isLast
        ? remainingAmount - allocated
        : Math.round(remainingAmount * ((t.percent ?? 0) / 100));

      if (share <= 0) return;
      allocated += share;

      const d = new Date(base);
      d.setDate(d.getDate() + 7 + i * 30);
      const planDate = t.termType === "warranty" && opts.warrantyMonths
        ? (() => {
            const w = new Date(base);
            w.setMonth(w.getMonth() + Number(opts.warrantyMonths));
            return w;
          })()
        : d;

      // 已过期的直接标为待收回
      const todayStr = todayLocal();
      const status = todayLocal(undefined, planDate) < todayStr ? "待收回" : "未到期";

      nextSeq += 1;
      ins.run(
        contractId, nextSeq, t.name, t.termType, t.percent,
        share, todayLocal(undefined, planDate), status
      );
      created++;
    });

    return { dropped, created, kept: paidTerms.length };
  });
}

/** 删除合同（软删除，级联软删回款计划） */
export async function DELETE(req: NextRequest) {
  return withRole(["finance", "boss", "admin", "sales"], async (user) => {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少合同 id");

    const c = one<{ code: string; party_name: string }>(
      "SELECT code, party_name FROM contracts WHERE id = ? AND deleted_at IS NULL", [id]
    );
    if (!c) throw new Error("合同不存在或已删除");

    return softDelete({
      table: "contracts",
      id,
      user,
      label: "合同",
      displayName: `${c.code} ${c.party_name}`,
      refs: [
        { table: "payment_terms", field: "contract_id", label: "回款计划", cascade: true },
      ],
      guard: () => {
        const paid = one<{ s: number }>(
          "SELECT COALESCE(SUM(actual_cents),0) AS s FROM payment_terms WHERE contract_id = ? AND deleted_at IS NULL",
          [id]
        )?.s ?? 0;
        if (paid > 0) {
          return `该合同已有 ${fenToWan(paid)} 万元回款记录，不能删除（可改为「已终止」状态）`;
        }
        return null;
      },
    });
  });
}
