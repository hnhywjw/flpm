import { getCurrentUser } from "@/lib/auth";
import { guardPage } from "@/lib/page-guard";
import { listMyPending, listMyApplied, TEMPLATES } from "@/lib/approval";
import { PageHeader, Kpi, Badge } from "@/components/ui";
import { fenToWan } from "@/lib/domain";
import { ApprovalList } from "./ApprovalList";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  await guardPage("approvals");
  const user = await getCurrentUser();
  if (!user) return null;

  const pending = listMyPending(user.role);
  const applied = listMyApplied(user.id);

  return (
    <>
      <PageHeader
        title="审批中心"
        desc={`待我审批 ${pending.length} 项 · 我发起的 ${applied.length} 项`}
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="待我审批" value={pending.length} unit="项" foot="需要处理" tone="w" />
        <Kpi label="我发起的" value={applied.length} unit="项" foot="全部记录" />
        <Kpi label="审批流程" value={TEMPLATES.length} unit="种" foot="可配置" />
      </div>

      <ApprovalList
        pending={pending.map((p) => ({
          id: p.id, code: p.code, biz_title: p.biz_title,
          template_name: p.template_name ?? "", step_label: p.step_label,
          applicant_name: p.applicant_name ?? "", created_at: p.created_at,
          amount: p.amount_cents ? fenToWan(p.amount_cents) : null,
          status: p.status,
        }))}
        applied={applied.map((a) => ({
          id: a.id, code: a.code, biz_title: a.biz_title,
          template_name: a.template_name ?? "",
          applicant_name: a.applicant_name ?? "", created_at: a.created_at,
          amount: a.amount_cents ? fenToWan(a.amount_cents) : null,
          status: a.status, step: a.current_step, total: a.total_steps,
        }))}
      />
    </>
  );
}
