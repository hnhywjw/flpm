import { NextRequest } from "next/server";
import {
  listProjects, getProject, getProjectNodes, getProjectTerms,
  getProjectCustomerContracts, getProjectPurchaseContracts,
  getProjectAcceptances, getProjectInvoices, getProjectStockMoves,
  getAgentAgreementByProject, getAgentPayments, canAdvanceToInvoice,
} from "@/lib/queries";
import { run, one, nextCode, audit } from "@/lib/db";
import { NODE_CHAIN } from "@/lib/domain";
import { withAuth, BizError } from "@/lib/api-guard";
import { softDelete, updateRecord, restoreRecord } from "@/lib/crud";
import { applyAmountMask } from "@/lib/mask";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  return withAuth(async (user) => {
    const mask = !user.canSeeAmount;
    // 列表页也要遮蔽金额（之前漏了，库管能读到 budget_cents）
    if (!id) return applyAmountMask(listProjects(), user.canSeeAmount);

    const pid = Number(id);
    const project = getProject(pid);
    if (!project) throw new Error("项目不存在");

    const agent = getAgentAgreementByProject(pid);
    const data = {
      project,
      nodes: getProjectNodes(pid),
      customerContracts: getProjectCustomerContracts(pid),
      purchaseContracts: getProjectPurchaseContracts(pid),
      terms: getProjectTerms(pid),
      invoices: getProjectInvoices(pid),
      acceptances: getProjectAcceptances(pid),
      stockMoves: getProjectStockMoves(pid),
      agent,
      agentPayments: agent ? getAgentPayments(agent.id) : [],
      invoiceReady: canAdvanceToInvoice(pid),
    };

    if (mask) {
      return {
        ...data,
        project: { ...data.project, budget_cents: null },
        customerContracts: [], purchaseContracts: [], terms: [], invoices: [],
        agent: null, agentPayments: [],
        masked: true,
      };
    }
    return data;
  });
}

export async function POST(req: NextRequest) {
  return withAuth(async (user) => {
    const body = await req.json();
    const {
      name, code: rawCode, customerId, projectType, mode, ownerId,
      budgetWan, startDate, planDue,
      // P1 新增
      contractNo, siteAddress,
    } = body;

    if (!name) throw new BizError("项目名称必填");
    if (!["direct", "agent"].includes(mode)) throw new BizError("中标方式只能是 direct 或 agent");

    // ★ 项目编号改为「招标文件提供的编号」，由业务人员手工录入
    //
    // 原来用 nextCode("P") 自动生成 P2026-018，但那个号是我方内部流水号，
    // 和招标文件上的项目编号对不上 —— 对账、查档时找不到依据。
    // 现在必须由用户照招标文件填，系统只做唯一性校验。
    const code = String(rawCode ?? "").trim();
    if (!code) throw new BizError("请填写项目编号（照招标文件上的编号录入）");

    const dup = one<{ id: number }>(
      "SELECT id FROM projects WHERE code = ? AND deleted_at IS NULL", [code]
    );
    if (dup) throw new BizError(`项目编号「${code}」已存在`);

    const info = run(
      `INSERT INTO projects (code, name, customer_id, project_type, mode, stage, status, owner_id,
         budget_cents, start_date, plan_due, contract_no, site_address)
       VALUES (?, ?, ?, ?, ?, '投标', '进行中', ?, ?, ?, ?, ?, ?)`,
      [code, name, customerId ?? null, projectType ?? null, mode, ownerId ?? user.id,
       budgetWan ? Math.round(Number(budgetWan) * 10000) : null, startDate ?? null, planDue ?? null,
       contractNo?.trim() || null, siteAddress?.trim() || null]
    );
    const pid = Number(info.lastInsertRowid);

    NODE_CHAIN.forEach((n, i) => {
      run(
        `INSERT INTO project_nodes (project_id, node_key, seq, is_parallel, status, require_files)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pid, n.key, n.seq, n.isParallel ? 1 : 0, i === 0 ? "cur" : "next",
         n.key === "验收" ? JSON.stringify(["安装配置文档", "到货签收单", "验收报告", "项目资料"]) : null]
      );
    });

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "project", entityId: pid,
      summary: `新建项目 ${code} ${name}`,
    });

    return { id: pid, code };
  });
}

/** 修改项目 */
export async function PATCH(req: NextRequest) {
  return withAuth(async (user) => {
    const body = await req.json();
    const {
      id, name, customerId, projectType, mode, ownerId,
      budgetWan, startDate, planDue, remark, expectedVersion,
      contractNo, siteAddress,
    } = body;
    if (!id) throw new Error("缺少项目 id");

    return updateRecord({
      table: "projects",
      id: Number(id),
      user,
      label: "项目",
      expectedVersion: expectedVersion !== undefined ? Number(expectedVersion) : undefined,
      allowRoles: ["pm", "sales"],
      fields: {
        name: name !== undefined ? { value: name } : undefined,
        customer_id: customerId !== undefined ? { value: customerId, type: "number" } : undefined,
        project_type: projectType !== undefined ? { value: projectType } : undefined,
        contract_no: contractNo !== undefined ? { value: contractNo?.trim() || null } : undefined,
        site_address: siteAddress !== undefined ? { value: siteAddress?.trim() || null } : undefined,
        mode: mode !== undefined ? { value: mode } : undefined,
        owner_id: ownerId !== undefined ? { value: ownerId, type: "number" } : undefined,
        budget_cents: budgetWan !== undefined
          ? { value: budgetWan === "" || budgetWan === null ? null : Math.round(Number(budgetWan) * 10000), type: "number" }
          : undefined,
        start_date: startDate !== undefined ? { value: startDate } : undefined,
        plan_due: planDue !== undefined ? { value: planDue } : undefined,
        remark: remark !== undefined ? { value: remark } : undefined,
      } as never,
      guard: (_before, after) => {
        if (after.mode && !["direct", "agent"].includes(String(after.mode))) {
          return "项目模式必须为 direct 或 agent";
        }
        if (!after.name || !String(after.name).trim()) return "项目名称不能为空";
        return null;
      },
    });
  });
}

/** 删除项目（软删除，级联软删节点） */
export async function DELETE(req: NextRequest) {
  return withAuth(async (user) => {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少项目 id");

    const p = one<{ name: string; code: string; stage: string }>(
      "SELECT name, code, stage FROM projects WHERE id = ? AND deleted_at IS NULL", [id]
    );
    if (!p) throw new Error("项目不存在或已删除");

    return softDelete({
      table: "projects",
      id,
      user,
      label: "项目",
      displayName: `${p.code} ${p.name}`,
      refs: [
        { table: "project_nodes", field: "project_id", label: "流程节点", cascade: true },
        { table: "acceptances", field: "project_id", label: "验收资料", cascade: true },
      ],
      guard: () => {
        // 有回款或合同的执行中项目不允许删除
        const c = one<{ n: number }>(
          "SELECT COUNT(*) AS n FROM contracts WHERE project_id = ? AND deleted_at IS NULL", [id]
        )?.n ?? 0;
        if (c > 0) return `该项目下还有 ${c} 份合同，请先删除合同`;
        return null;
      },
    });
  });
}
