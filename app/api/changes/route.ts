import { NextRequest, NextResponse } from "next/server";
import { all, one, run, tx, audit } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { startApproval } from "@/lib/approval";
import { softDelete, updateRecord } from "@/lib/crud";
import { changeAmountText, wanToFen, fenToWan } from "@/lib/domain";
import { applyAmountMask } from "@/lib/mask";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

function nextCode(prefix: string, table: string): string {
  const year = new Date().getFullYear();
  const row = one<{ seq: number }>("SELECT seq FROM code_sequences WHERE prefix = ? AND year = ?", [prefix, year]);
  const seq = (row?.seq ?? 0) + 1;
  if (row) run("UPDATE code_sequences SET seq = ? WHERE prefix = ? AND year = ?", [seq, prefix, year]);
  else run("INSERT INTO code_sequences (prefix, year, seq) VALUES (?, ?, ?)", [prefix, year, seq]);
  return `${prefix}${year}-${String(seq).padStart(4, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;
    const projectId = sp.get("projectId");
    const id = sp.get("id");

    // 变更单含 amount_delta_cents（金额影响），需按权限遮蔽
    if (id) {
      const cr = one("SELECT * FROM change_requests WHERE id = ?", [Number(id)]);
      if (!cr) return NextResponse.json({ error: "变更单不存在" }, { status: 404 });
      return NextResponse.json(applyAmountMask(cr, user.canSeeAmount));
    }
    if (projectId) {
      return NextResponse.json(
        applyAmountMask(
          all(
            `SELECT c.*, p.code AS project_code, p.name AS project_name
             FROM change_requests c JOIN projects p ON p.id = c.project_id
             WHERE c.project_id = ? ORDER BY c.id DESC`,
            [Number(projectId)]
          ),
          user.canSeeAmount
        )
      );
    }
    return NextResponse.json(
      applyAmountMask(
        all(
          `SELECT c.*, p.code AS project_code, p.name AS project_name
           FROM change_requests c JOIN projects p ON p.id = c.project_id
           ORDER BY c.id DESC LIMIT 200`
        ),
        user.canSeeAmount
      )
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/** 创建变更单，可选立即发起审批 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const {
      projectId, title, changeType, reason, impact,
      amountDeltaWan, daysDelta, submit,
    } = body;

    if (!projectId) return NextResponse.json({ error: "必须指定项目" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "变更标题必填" }, { status: 400 });

    const project = one<{ name: string }>("SELECT name FROM projects WHERE id = ?", [projectId]);
    if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

    const amountCents = wanToFen(Number(amountDeltaWan || 0));
    const code = nextCode("CR", "change_requests");

    const result = tx((db) => {
      const info = db.prepare(
        `INSERT INTO change_requests
         (code, project_id, title, change_type, reason, impact, amount_delta_cents, days_delta,
          status, applicant_id, applicant_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        code, projectId, title, changeType ?? "other", reason ?? null, impact ?? null,
        amountCents, Number(daysDelta || 0),
        submit ? "pending" : "draft", user.id, user.name
      );
      return Number(info.lastInsertRowid);
    });

    let approvalId: number | null = null;
    if (submit) {
      const ap = startApproval({
        templateKey: "project_change",
        bizId: result,
        bizTitle: `${project.name} · ${title}`,
        amountCents,
        summary: reason ?? undefined,
        applicant: { id: user.id, name: user.name, role: user.role },
      });
      approvalId = ap.id;
      run("UPDATE change_requests SET approval_id = ? WHERE id = ?", [ap.id, result]);
    }

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "change_request", entityId: result,
      summary: `创建变更单 ${code}：${title}（${changeAmountText(amountCents)}，工期 ${daysDelta || 0} 天）`,
    });

    return NextResponse.json({ ok: true, id: result, code, approvalId });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 提交审批 / 标记客户确认 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const { id, action, confirmDate } = await req.json();
    if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    const cr = one<{ id: number; code: string; project_id: number; title: string; status: string; amount_delta_cents: number; reason: string | null; approval_id: number | null }>(
      "SELECT * FROM change_requests WHERE id = ?", [id]
    );
    if (!cr) return NextResponse.json({ error: "变更单不存在" }, { status: 404 });

    if (action === "submit") {
      if (cr.status !== "draft") return NextResponse.json({ error: "只有草稿可以提交审批" }, { status: 400 });
      const project = one<{ name: string }>("SELECT name FROM projects WHERE id = ?", [cr.project_id]);
      const ap = startApproval({
        templateKey: "project_change",
        bizId: cr.id,
        bizTitle: `${project?.name ?? ""} · ${cr.title}`,
        amountCents: cr.amount_delta_cents,
        summary: cr.reason ?? undefined,
        applicant: { id: user.id, name: user.name, role: user.role },
      });
      run("UPDATE change_requests SET status = 'pending', approval_id = ? WHERE id = ?", [ap.id, id]);
      return NextResponse.json({ ok: true, approvalId: ap.id });
    }

    if (action === "customer_confirm") {
      run(
        "UPDATE change_requests SET customer_confirmed = 1, confirm_date = ? WHERE id = ?",
        [confirmDate ?? todayLocal(), id]
      );
      audit({
        userId: user.id, userName: user.name, action: "update",
        entityType: "change_request", entityId: id,
        summary: `变更单 ${cr.code} 客户已确认`,
      });
      return NextResponse.json({ ok: true });
    }

    // 客户确认后，把变更金额同步到合同并重建回款计划
    if (action === "sync_contract") {
      if (cr.status !== "approved") {
        return NextResponse.json({ error: "只有已批准的变更单才能同步到合同" }, { status: 400 });
      }
      if (!cr.amount_delta_cents || cr.amount_delta_cents === 0) {
        return NextResponse.json({ error: "该变更单没有金额影响，无需同步" }, { status: 400 });
      }

      const contractId = req.nextUrl.searchParams.get("contractId")
        ? Number(req.nextUrl.searchParams.get("contractId")) : null;

      // 找该项目的客户合同
      const contracts = all<{ id: number; code: string; amount_cents: number; pay_summary: string | null; warranty_months: number | null; sign_date: string | null }>(
        `SELECT id, code, amount_cents, pay_summary, warranty_months, sign_date
         FROM contracts
         WHERE project_id = ? AND type = 'customer' AND deleted_at IS NULL`,
        [cr.project_id]
      );

      if (contracts.length === 0) {
        return NextResponse.json({ error: "该项目没有客户合同，无法同步" }, { status: 400 });
      }
      if (contracts.length > 1 && !contractId) {
        return NextResponse.json({
          error: `该项目有 ${contracts.length} 份客户合同，请指定要同步的合同`,
          contracts: contracts.map((c) => ({ id: c.id, code: c.code, amount: c.amount_cents })),
        }, { status: 400 });
      }

      const target = contractId
        ? contracts.find((c) => c.id === contractId)
        : contracts[0];
      if (!target) {
        return NextResponse.json({ error: "指定的合同不存在" }, { status: 400 });
      }

      const newAmount = target.amount_cents + cr.amount_delta_cents;
      if (newAmount <= 0) {
        return NextResponse.json({ error: "同步后合同金额将小于等于 0，请检查变更金额" }, { status: 400 });
      }

      // 更新合同金额
      run("UPDATE contracts SET amount_cents = ?, updated_at = datetime('now','localtime') WHERE id = ?",
          [newAmount, target.id]);

      // 重建回款计划（复用合同逻辑思路：删未回款、保留已回款、按比例重分）
      const summary = target.pay_summary ?? "100";
      const paid = one<{ s: number }>(
        "SELECT COALESCE(SUM(actual_cents),0) AS s FROM payment_terms WHERE contract_id = ? AND deleted_at IS NULL",
        [target.id]
      )?.s ?? 0;

      if (newAmount < paid) {
        return NextResponse.json({
          error: `同步后合同金额 ${fenToWan(newAmount)} 万小于已回款 ${fenToWan(paid)} 万`,
        }, { status: 400 });
      }

      // 硬删除未回款期次（表有 UNIQUE(contract_id,seq) 约束，软删除会冲突）
      const dropped = run(
        `DELETE FROM payment_terms
         WHERE contract_id = ? AND actual_cents = 0 AND COALESCE(invoiced_cents, 0) = 0`,
        [target.id]
      ).changes;

      // 保留期次（有回款或已开票）占据的计划金额
      const retained = one<{ s: number | null }>(
        `SELECT COALESCE(SUM(amount_cents),0) AS s FROM payment_terms
         WHERE contract_id = ? AND deleted_at IS NULL
           AND (actual_cents > 0 OR COALESCE(invoiced_cents,0) > 0)`,
        [target.id]
      )?.s ?? 0;

      const remaining = newAmount - retained;
      const pcts = summary.split("/").map((x) => Number(x.trim())).filter((x) => !isNaN(x));
      const base = target.sign_date ? new Date(target.sign_date) : new Date();
      const todayStr = todayLocal();

      // 保留期次占用的 seq 会影响新插入，从最大 seq+1 开始
      const maxSeq = one<{ m: number | null }>(
        "SELECT MAX(seq) AS m FROM payment_terms WHERE contract_id = ?",
        [target.id]
      )?.m ?? 0;
      let nextSeq = maxSeq;

      let allocated = 0;
      let created = 0;
      pcts.forEach((pct, i) => {
        const isLast = i === pcts.length - 1;
        const share = isLast ? remaining - allocated : Math.round(remaining * (pct / 100));
        if (share <= 0) return;
        allocated += share;

        const d = new Date(base);
        d.setDate(d.getDate() + 7 + i * 30);
        const planDate = isLast && target.warranty_months
          ? (() => {
              const w = new Date(base);
              w.setMonth(w.getMonth() + Number(target.warranty_months));
              return w;
            })()
          : d;
        const dateStr = todayLocal(undefined, planDate);

        nextSeq += 1;
        run(
          `INSERT INTO payment_terms
           (contract_id, seq, name, term_type, percent, amount_cents, plan_date, actual_cents, status, invoiced_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0)`,
          [
            target.id, nextSeq,
            `${isLast ? "质保金" : i === 0 ? "首笔款" : "进度款"} ${pct}%`,
            isLast ? "warranty" : i === 0 ? "advance" : "progress",
            pct, share, dateStr,
            dateStr < todayStr ? "待收回" : "未到期",
          ]
        );
        created++;
      });

      audit({
        userId: user.id, userName: user.name, action: "update",
        entityType: "change_request", entityId: id,
        summary: `变更单 ${cr.code} 同步到合同 ${target.code}：` +
                 `金额 ${fenToWan(target.amount_cents)} → ${fenToWan(newAmount)} 万，` +
                 `重建 ${created} 期回款计划`,
      });

      return NextResponse.json({
        ok: true,
        contract: target.code,
        oldAmount: target.amount_cents,
        newAmount,
        dropped,
        created,
      });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 修改变更单（仅草稿或已驳回可改） */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const b = await req.json();
    const { id, title, changeType, reason, impact, amountDeltaWan, daysDelta } = b;
    if (!id) throw new Error("缺少变更单 id");

    const cr = one<{ status: string; code: string }>(
      "SELECT status, code FROM change_requests WHERE id = ? AND deleted_at IS NULL", [Number(id)]
    );
    if (!cr) throw new Error("变更单不存在");
    if (!["draft", "rejected"].includes(cr.status)) {
      throw new Error("只有草稿或已驳回的变更单可以修改，当前状态：" + cr.status);
    }

    return NextResponse.json(updateRecord({
      table: "change_requests",
      id: Number(id),
      user,
      label: "变更单",
      fields: {
        title: title !== undefined ? { value: title } : undefined,
        change_type: changeType !== undefined ? { value: changeType } : undefined,
        reason: reason !== undefined ? { value: reason } : undefined,
        impact: impact !== undefined ? { value: impact } : undefined,
        amount_delta_cents: amountDeltaWan !== undefined && amountDeltaWan !== ""
          ? { value: wanToFen(Number(amountDeltaWan)), type: "number" } : undefined,
        days_delta: daysDelta !== undefined && daysDelta !== ""
          ? { value: Number(daysDelta), type: "number" } : undefined,
      } as never,
      guard: (_b, after) => {
        if (!after.title || !String(after.title).trim()) return "变更标题不能为空";
        return null;
      },
    }));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 删除变更单 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少变更单 id");

    const cr = one<{ code: string; title: string; status: string; approval_id: number | null }>(
      "SELECT code, title, status, approval_id FROM change_requests WHERE id = ? AND deleted_at IS NULL", [id]
    );
    if (!cr) throw new Error("变更单不存在");
    if (cr.status === "approved") {
      throw new Error("已批准的变更单不能删除（已生效），如需撤销请发起反向变更");
    }

    // 若有关联审批，一并撤回
    if (cr.approval_id) {
      run(
        "UPDATE approval_instances SET status = 'cancelled', finished_at = datetime('now','localtime') WHERE id = ? AND status = 'pending'",
        [cr.approval_id]
      );
    }

    return NextResponse.json(
      softDelete({ table: "change_requests", id, user, label: "变更单", displayName: cr.code + " " + cr.title })
    );
  } catch (e) {
    return errorResponse(e);
  }
}
