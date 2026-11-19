import { NextRequest } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { listProjects, listReceivables, listAgentAgreements, listContracts, listTickets } from "@/lib/queries";
import { toCsv, csvResponse } from "@/lib/csv";
import { fenToWan, CHANGE_STATUS_LABEL } from "@/lib/domain";
import { errorResponse } from "@/lib/api-guard";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

const DATE = todayLocal();

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const type = req.nextUrl.searchParams.get("type") ?? "projects";

    // 金额敏感数据：用动态角色权限判断（支持自定义角色与多角色）
    const canAmount = user.canSeeAmount;

    if (type === "projects") {
      const rows = listProjects();
      const csv = toCsv(
        ["项目编号", "项目名称", "客户", "模式", "阶段", "状态", "负责人", "合同额(万元)", "进度%", "计划完成"],
        rows.map((p) => [
          p.code, p.name, p.customer_name ?? "", p.mode === "agent" ? "代中标" : "直接中标",
          p.stage, p.status, p.owner_name ?? "",
          canAmount && p.budget_cents ? fenToWan(p.budget_cents) : "—",
          p.progress, p.plan_due ?? "",
        ])
      );
      return csvResponse(csv, `项目清单_${DATE}.csv`);
    }

    if (type === "receivables") {
      if (!canAmount) throw new AuthError("当前角色无权导出回款数据", 403);
      const rows = listReceivables();
      const csv = toCsv(
        ["合同编号", "项目", "客户", "期次", "比例%", "计划金额(万元)", "计划日期",
         "实收金额(万元)", "实收日期", "逾期天数", "状态"],
        rows.map((r) => [
          r.contract_code, r.project_name, r.customer_name ?? "", r.name, r.percent,
          fenToWan(r.amount_cents), r.plan_date ?? "",
          fenToWan(r.actual_cents), r.actual_date ?? "",
          r.overdue ?? 0, r.status,
        ])
      );
      return csvResponse(csv, `回款台账_${DATE}.csv`);
    }

    if (type === "agents") {
      if (!canAmount) throw new AuthError("当前角色无权导出过单费数据", 403);
      const rows = listAgentAgreements();
      const csv = toCsv(
        ["协议编号", "项目", "对方", "类型", "结算方式", "客户合同额(万元)",
         "开票额(万元)", "过单费(万元)", "已付(万元)", "未付(万元)", "状态"],
        rows.map((a) => [
          a.code, a.project_name ?? "", a.agreement_with,
          a.party_type === "individual" ? "个人" : "公司",
          a.fee_method === "diff" ? "差价法" : "现金+全额发票",
          fenToWan(a.customer_amount_cents), fenToWan(a.invoiced_amount_cents),
          fenToWan(a.fee_cents), fenToWan(a.paid_cents ?? 0), fenToWan(a.unpaid_cents ?? 0),
          a.status ?? "",
        ])
      );
      return csvResponse(csv, `过单费台账_${DATE}.csv`);
    }

    if (type === "contracts") {
      if (!canAmount) throw new AuthError("当前角色无权导出合同数据", 403);
      const rows = listContracts();
      const csv = toCsv(
        ["合同编号", "类型", "相对方", "合同名称", "金额(万元)", "签订日期",
         "付款比例", "质保月数", "开票方式", "状态"],
        rows.map((c) => [
          c.code, c.type === "customer" ? "客户合同" : c.type === "purchase" ? "采购合同" : "分包",
          c.party_name, c.title ?? "", fenToWan(c.amount_cents), c.sign_date ?? "",
          c.pay_summary ?? "", c.warranty_months ?? "",
          c.invoice_mode === "full" ? "全额一次性" : "按付款比例", c.status ?? "",
        ])
      );
      return csvResponse(csv, `合同清单_${DATE}.csv`);
    }

    if (type === "tickets") {
      const rows = listTickets();
      const csv = toCsv(
        ["工单号", "客户", "项目", "问题", "级别", "SLA(小时)", "报修时间",
         "处理人", "状态", "设备SN"],
        rows.map((t) => [
          t.code, t.customer_name ?? "", t.project_name ?? "", t.title,
          t.level, t.sla_hours ?? "", t.reported_at ?? "",
          t.owner_name ?? "", t.status, t.sn_list ?? "",
        ])
      );
      return csvResponse(csv, `售后工单_${DATE}.csv`);
    }

    throw new Error("未知的导出类型");
  } catch (e) {
    return errorResponse(e);
  }
}
