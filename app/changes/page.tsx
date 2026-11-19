import { guardPage } from "@/lib/page-guard";
import { getCurrentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { PageHeader, Kpi } from "@/components/ui";
import { fenToWan } from "@/lib/domain";
import { ChangeList } from "./ChangeList";
import { RiskList } from "./RiskList";

export const dynamic = "force-dynamic";

export default async function ChangesPage() {
  await guardPage("changes");
  const user = await getCurrentUser();
  if (!user) return null;

  const changes = all<{
    id: number; code: string; project_code: string; project_name: string;
    title: string; change_type: string; amount_delta_cents: number; days_delta: number;
    status: string; applicant_name: string; created_at: string;
    customer_confirmed: number; approval_id: number | null;
  }>(
    `SELECT c.*, p.code AS project_code, p.name AS project_name
     FROM change_requests c JOIN projects p ON p.id = c.project_id
     ORDER BY c.id DESC LIMIT 100`
  );

  const projects = all<{ id: number; code: string; name: string }>(
    "SELECT id, code, name FROM projects ORDER BY id"
  );

  const pending = changes.filter((c) => c.status === "pending").length;
  const approved = changes.filter((c) => c.status === "approved").length;
  const amountTotal = changes
    .filter((c) => c.status === "approved")
    .reduce((s, c) => s + c.amount_delta_cents, 0);

  return (
    <>
      <PageHeader
        title="变更与风险"
        desc={`变更单 ${changes.length} 个 · 审批中 ${pending} · 已批准 ${approved}`}
        right={<a href="/projects" className="btn">项目列表</a>}
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="变更总数" value={changes.length} unit="个" foot="全部记录" />
        <Kpi label="审批中" value={pending} unit="个" foot="待处理" tone="w" />
        <Kpi label="已批准" value={approved} unit="个" foot="生效" tone="o" />
        <Kpi label="金额影响" value={fenToWan(amountTotal)} unit="万元" foot="已批准合计" tone="v" />
      </div>

      <ChangeList
        changes={changes.map((c) => ({
          id: c.id, code: c.code, project_name: c.project_name, project_code: c.project_code,
          title: c.title, change_type: c.change_type,
          amount: c.amount_delta_cents ? fenToWan(c.amount_delta_cents) : "—",
          amountNum: c.amount_delta_cents,
          days: c.days_delta, status: c.status,
          applicant: c.applicant_name, created_at: c.created_at,
          confirmed: c.customer_confirmed === 1,
        }))}
        projects={projects}
      />

      <RiskList projects={projects} />
    </>
  );
}
