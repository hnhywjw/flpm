import Link from "next/link";
import { listProjects } from "@/lib/queries";
import { fenToWan } from "@/lib/domain";
import { Badge, Bar, PageHeader, Empty } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";
import { ImportButton } from "@/components/ImportButton";
import { guardPage } from "@/lib/page-guard";
import { RowActions } from "@/components/RowActions";
import { getCurrentUser } from "@/lib/auth";
import { projectScopeFilter, scopeLabel } from "@/lib/scope";
import { NewProjectButton } from "./NewProjectButton";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";

const STAGE_TONE: Record<string, string> = {
  投标: "warn", 实施: "ok", 验收: "info", 质保: "gray", 售后: "bad",
};

export default async function ProjectsPage() {
  await guardPage("projects");
  const user = await getCurrentUser();
  if (!user) return null;
  const scope = projectScopeFilter(user);
  const projects = listProjects(scope);
  const total = projects.reduce((s, p) => s + (p.budget_cents ?? 0), 0);
  const direct = projects.filter((p) => p.mode === "direct").length;
  const agent = projects.filter((p) => p.mode === "agent").length;

  // 新建项目表单需要的下拉数据
  // 注意：customers 表没有 deleted_at（不是软删除表），
  // 早先写成 WHERE deleted_at IS NULL 会直接 no such column 把页面搞崩
  const customers = all<{ id: number; name: string }>(
    "SELECT id, name FROM customers ORDER BY name"
  );
  const users = all<{ id: number; name: string }>(
    "SELECT id, name FROM users WHERE active = 1 AND id > 0 ORDER BY name"
  );

  return (
    <>
      <PageHeader
        title="项目管理"
        desc={`共 ${projects.length} 个项目 · 直接中标 ${direct} / 代中标 ${agent} · 在手合同额 ${fenToWan(total)} 万元`}
        right={
          <>
            <ImportButton />
            <ExportButton type="projects" label="导出 Excel" />
            <Link href="/bidding" className="btn">投标管理</Link>
            <NewProjectButton customers={customers} users={users} />
          </>
        }
      />

      <div className="card">
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>项目名称 / 编号</th><th>业主单位</th><th>中标公司名称</th><th>模式</th><th>合同额</th>
                <th>阶段</th><th>进度</th><th>计划完成</th><th>责任人</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "normal", minWidth: 200, maxWidth: 320 }}>
                    <b>{p.name}</b>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {p.code} · {p.project_type ?? "—"}
                    </div>
                  </td>
                  <td>{p.customer_name ?? "—"}</td>
                  <td>{p.winner_name ?? "—"}</td>
                  <td>
                    <Badge tone={p.mode === "agent" ? "vio" : "gray"}>
                      {p.mode === "agent" ? "代中标" : "直接中标"}
                    </Badge>
                  </td>
                  <td className="num">{p.budget_cents ? formWan(p.budget_cents) : "—"}</td>
                  <td><Badge tone={STAGE_TONE[p.stage] ?? "info"}>{p.stage}</Badge></td>
                  <td style={{ minWidth: 120 }}><Bar pct={p.progress} /></td>
                  <td className="num">{p.plan_due ?? "—"}</td>
                  <td>{p.owner_name ?? "—"}</td>
                  <td><Badge tone={
                    p.status.includes("逾期") ? "bad"
                    : p.status.includes("实施") ? "ok"
                    : p.status.includes("验收") ? "info"
                    : p.status.includes("质保") ? "warn" : "gray"
                  }>{p.status}</Badge></td>
                  <td>
                    <div style={{ display: "flex", gap: 5 }}>
                      <Link href={`/projects/${p.id}`} className="btn btn-sm">详情</Link>
                      <RowActions
                        id={p.id}
                        version={p.version}
                        label="项目"
                        apiPath="/api/projects"
                        deleteHint="有合同的项目无法删除。删除会同时隐藏该项目下所有流程节点。"
                        editFields={[
                          { key: "name", label: "项目名称", required: true, colSpan: 2, defaultValue: p.name },
                          { key: "mode", label: "中标方式", type: "select", defaultValue: p.mode,
                            options: [
                              { value: "direct", label: "直接中标" },
                              { value: "agent", label: "代中标" },
                            ] },
                          { key: "planDue", label: "计划完成", type: "date", defaultValue: p.plan_due ?? "" },
                          { key: "startDate", label: "开始日期", type: "date", defaultValue: p.start_date ?? "" },
                          { key: "contractNo", label: "合同编号",
                            placeholder: "立项后签的合同号",
                            defaultValue: p.contract_no ?? "" },
                          { key: "remark", label: "备注", type: "textarea", colSpan: 2, defaultValue: p.remark ?? "" },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {projects.length === 0 && <Empty>暂无项目，先执行 npm run db:init</Empty>}
        </div>
      </div>
    </>
  );
}

function formWan(fen: number) {
  return fenToWan(fen) + " 万";
}
