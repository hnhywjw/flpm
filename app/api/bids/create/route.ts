import { NextRequest, NextResponse } from "next/server";
import { run, one, all, audit } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { softDelete, updateRecord } from "@/lib/crud";
import { wanToFen, fenToWan, NODE_CHAIN } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["sales", "boss", "admin"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限新建投标", 403);
    }

    const body = await req.json();
    const {
      name, customerName, budgetWan, bondWan, deadline, mode, ownerId,
      // P1 新增
      bidNo, agentCompany, bidMethod, bidOpenPlace,
      siteVisitDate, qaDeadline, docPriceWan,
      openDate, bondPaidDate,
    } = body;

    if (!name?.trim()) throw new Error("项目名称必填");
    if (!deadline) throw new Error("投标截止日期必填");

    let custId: number | null = null;
    if (customerName?.trim()) {
      const c = one<{ id: number }>("SELECT id FROM customers WHERE name = ?", [customerName.trim()]);
      if (c) custId = c.id;
      else {
        const ir = run("INSERT INTO customers (name) VALUES (?)", [customerName.trim()]);
        custId = Number(ir.lastInsertRowid);
      }
    }

    const year = new Date().getFullYear();
    const row = one<{ seq: number }>("SELECT seq FROM code_sequences WHERE prefix='B' AND year=?", [year]);
    const seq = (row?.seq ?? 0) + 1;
    if (row) run("UPDATE code_sequences SET seq=? WHERE prefix='B' AND year=?", [seq, year]);
    else run("INSERT INTO code_sequences (prefix,year,seq) VALUES ('B',?,?)", [year, seq]);
    const code = `B${year}-${String(seq).padStart(3, "0")}`;

    const info = run(
      `INSERT INTO bids (code, name, customer_id, budget_cents, bond_cents, bond_status,
         deadline, owner_id, phase, result, mode,
         bid_no, agent_company, bid_method, bid_open_place,
         site_visit_date, qa_deadline, doc_price_cents, open_date, bond_paid_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        code, name.trim(), custId,
        budgetWan ? wanToFen(Number(budgetWan)) : null,
        bondWan ? wanToFen(Number(bondWan)) : null,
        "未缴",
        deadline,
        ownerId ? Number(ownerId) : user.id,
        "立项评审", "待开标",
        mode === "agent" ? "agent" : "direct",
        bidNo?.trim() || null,
        agentCompany?.trim() || null,
        bidMethod || "公开招标",
        bidOpenPlace?.trim() || null,
        siteVisitDate || null,
        qaDeadline || null,
        docPriceWan ? wanToFen(Number(docPriceWan)) : null,
        openDate || null,
        bondPaidDate || null,
      ]
    );

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "bid", entityId: Number(info.lastInsertRowid),
      summary: `新建投标 ${code}：${name}（截止 ${deadline}）`,
    });

    return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid), code });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET() {
  try {
    await requireUser();
    const users = all<{ id: number; name: string }>("SELECT id, name FROM users WHERE active = 1");
    // 业主单位列表：新建投标时给下拉参考，也支持直接输新名称
    const customers = all<{ id: number; name: string }>(
      "SELECT id, name FROM customers ORDER BY name"
    );
    return NextResponse.json({ users, customers });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 修改投标 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["sales", "boss", "admin"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限修改投标", 403);
    }
    const b = await req.json();
    const {
      id, name, budgetWan, bondWan, bondStatus, deadline, phase, result,
      failReason, winAmountWan, mode, expectedVersion,
      bondBackDate, bondBackWan, bondBackVoucher,
      // P0：字段早就在库里，这次接出来
      openDate, bondPaidDate, customerName,
      // P1 新增
      bidNo, agentCompany, bidMethod, bidOpenPlace,
      siteVisitDate, qaDeadline, docPriceWan, ownerId,
    } = b;
    if (!id) throw new Error("缺少投标 id");

    // ---- 中标自动立项 ----
    // 业务流：先投标 → 中标 → 立项。
    // 中标时如果还没有关联项目，自动创建一个，并把 bid.project_id 指过去。
    // 这样项目管理里能直接看到「这个中标项目」，不用手工再录一遍。
    const beforeRow = one<{
      id: number; code: string; name: string; customer_id: number | null;
      mode: string; owner_id: number | null; budget_cents: number | null;
      project_id: number | null; result: string | null;
    }>("SELECT id, code, name, customer_id, mode, owner_id, budget_cents, project_id, result FROM bids WHERE id = ?", [Number(id)]);

    // 只在「本次提交把结果改成中标」且「尚未关联项目」时自动立项
    if (beforeRow && result === "中标" && !beforeRow.project_id) {
      const winAmt = winAmountWan !== undefined && winAmountWan !== ""
        ? wanToFen(Number(winAmountWan))
        : beforeRow.budget_cents;

      // 项目编号：优先用招标编号，没有就用投标编号派生（B2026-034 → P2026-034）
      const bidRow = one<{ bid_no: string | null; deadline: string | null }>(
        "SELECT bid_no, deadline FROM bids WHERE id = ?", [Number(id)]
      );
      let projCode = (bidRow?.bid_no ?? "").trim();
      if (!projCode) {
        projCode = "P" + beforeRow.code.replace(/^B/, "");
      }
      // 防重：已存在同编号项目就加后缀
      let suffix = 0;
      let tryCode = projCode;
      while (one<{ id: number }>("SELECT id FROM projects WHERE code = ? AND deleted_at IS NULL", [tryCode])) {
        suffix += 1;
        tryCode = projCode + "-" + suffix;
        if (suffix > 20) break;
      }
      projCode = tryCode;

      const pinfo = run(
        `INSERT INTO projects
           (code, name, customer_id, project_type, mode, stage, status, owner_id, budget_cents, plan_due)
         VALUES (?, ?, ?, ?, ?, '投标', '进行中', ?, ?, ?)`,
        [
          projCode, beforeRow.name, beforeRow.customer_id, "系统集成",
          beforeRow.mode === "agent" ? "agent" : "direct",
          beforeRow.owner_id ?? user.id,
          winAmt ?? null,
          bidRow?.deadline ?? null,
        ]
      );
      const autoProjectId = Number(pinfo.lastInsertRowid);

      // 建 11 个流程节点，和手工新建项目保持一致
      NODE_CHAIN.forEach((n, i) => {
        run(
          `INSERT INTO project_nodes (project_id, node_key, seq, is_parallel, status, require_files)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [autoProjectId, n.key, n.seq, n.isParallel ? 1 : 0, i === 0 ? "cur" : "next",
           n.key === "验收" ? JSON.stringify(["安装配置文档", "到货签收单", "验收报告", "项目资料"]) : null]
        );
      });

      audit({
        userId: user.id, userName: user.name, action: "create",
        entityType: "project", entityId: autoProjectId,
        summary: `投标 ${beforeRow.code} 中标，自动立项 ${projCode} ${beforeRow.name}`,
      });

      // 回写关联，让投标页能显示「已转项目」
      run("UPDATE bids SET project_id = ? WHERE id = ?", [autoProjectId, Number(id)]);
    }

    return NextResponse.json(updateRecord({
      table: "bids",
      id: Number(id),
      user,
      label: "投标",
      expectedVersion: expectedVersion !== undefined ? Number(expectedVersion) : undefined,
      fields: {
        name: name !== undefined ? { value: name } : undefined,
        owner_id: ownerId !== undefined ? { value: ownerId ? Number(ownerId) : null, type: "number" } : undefined,
        customer_id: customerName !== undefined ? { value: await (async () => {
          const n = String(customerName ?? "").trim();
          if (!n) return null;
          const c = one<{ id: number }>("SELECT id FROM customers WHERE name = ?", [n]);
          if (c) return c.id;
          const ir = run("INSERT INTO customers (name) VALUES (?)", [n]);
          return Number(ir.lastInsertRowid);
        })(), type: "number" } : undefined,
        budget_cents: budgetWan !== undefined && budgetWan !== ""
          ? { value: wanToFen(Number(budgetWan)), type: "number" } : undefined,
        bond_cents: bondWan !== undefined && bondWan !== ""
          ? { value: wanToFen(Number(bondWan)), type: "number" } : undefined,
        bond_status: bondStatus !== undefined ? { value: bondStatus } : undefined,
        deadline: deadline !== undefined ? { value: deadline } : undefined,
        phase: phase !== undefined ? { value: phase } : undefined,
        result: result !== undefined ? { value: result } : undefined,
        fail_reason: failReason !== undefined ? { value: failReason } : undefined,
        win_amount_cents: winAmountWan !== undefined && winAmountWan !== ""
          ? { value: wanToFen(Number(winAmountWan)), type: "number" } : undefined,
        mode: mode !== undefined ? { value: mode } : undefined,
        bond_back_date: bondBackDate !== undefined ? { value: bondBackDate } : undefined,
        bond_back_cents: bondBackWan !== undefined && bondBackWan !== ""
          ? { value: wanToFen(Number(bondBackWan)), type: "number" } : undefined,
        bond_back_voucher: bondBackVoucher !== undefined ? { value: bondBackVoucher } : undefined,
        // P0
        open_date: openDate !== undefined ? { value: openDate || null } : undefined,
        bond_paid_date: bondPaidDate !== undefined ? { value: bondPaidDate || null } : undefined,
        // P1
        bid_no: bidNo !== undefined ? { value: bidNo?.trim() || null } : undefined,
        agent_company: agentCompany !== undefined ? { value: agentCompany?.trim() || null } : undefined,
        bid_method: bidMethod !== undefined ? { value: bidMethod } : undefined,
        bid_open_place: bidOpenPlace !== undefined ? { value: bidOpenPlace?.trim() || null } : undefined,
        site_visit_date: siteVisitDate !== undefined ? { value: siteVisitDate || null } : undefined,
        qa_deadline: qaDeadline !== undefined ? { value: qaDeadline || null } : undefined,
        doc_price_cents: docPriceWan !== undefined && docPriceWan !== ""
          ? { value: wanToFen(Number(docPriceWan)), type: "number" } : undefined,
      } as never,
      guard: (_before, after) => {
        if (!after.name || !String(after.name).trim()) return "项目名称不能为空";
        if (after.result === "废标" && !after.fail_reason) return "废标必须填写原因";

        // 保证金退还：状态为「已退」时必须填退还日期和金额
        if (after.bond_status === "已退") {
          if (!after.bond_back_date) return "保证金已退，必须填写退还日期";
          const backAmt = Number(after.bond_back_cents ?? 0);
          const origAmt = Number(after.bond_cents ?? 0);
          if (backAmt <= 0) return "保证金已退，必须填写退还金额";
          if (origAmt > 0 && backAmt > origAmt) {
            return `退还金额不能超过缴纳金额 ${fenToWan(origAmt)} 万元`;
          }
        }
        return null;
      },
    }));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 删除投标 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["boss", "admin"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限删除投标（需要总经理或系统管理员）", 403);
    }
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少投标 id");

    const b = one<{ code: string; name: string; result: string }>(
      "SELECT code, name, result FROM bids WHERE id = ? AND deleted_at IS NULL", [id]
    );
    if (!b) throw new Error("投标不存在或已删除");

    const r = softDelete({ table: "bids", id, user, label: "投标", displayName: `${b.code} ${b.name}` });
    return NextResponse.json(r);
  } catch (e) {
    return errorResponse(e);
  }
}
