import Link from "next/link";
import { listContracts } from "@/lib/queries";
import { all } from "@/lib/db";
import { fenToWan, INVOICE_MODE_LABEL } from "@/lib/domain";
import { Badge, PageHeader, Kpi } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";
import { NewContractButton } from "./NewContractButton";
import { RowActions } from "@/components/RowActions";
import { guardPage } from "@/lib/page-guard";
import { BizFileCard } from "@/components/BizFileCard";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  await guardPage("contracts");
  const customers = listContracts("customer");
  const purchases = listContracts("purchase");
  const projectList = all<{
    id: number; code: string; name: string; customerName: string | null; winCents: number | null;
  }>(`
    SELECT p.id, p.code, p.name, c.name AS customerName,
      COALESCE(
        (SELECT bp.price_cents FROM bid_participants bp
           JOIN bids b ON b.id = bp.bid_id AND b.deleted_at IS NULL
          WHERE b.project_id = p.id AND bp.result = '中标'
          ORDER BY bp.id LIMIT 1),
        (SELECT b.win_amount_cents FROM bids b
          WHERE b.project_id = p.id AND b.deleted_at IS NULL AND b.result = '中标'
          LIMIT 1),
        p.budget_cents
      ) AS winCents
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE p.deleted_at IS NULL
    ORDER BY p.id DESC
  `);
  const usedProjects = all<{ project_id: number; type: string }>(
    "SELECT project_id, type FROM contracts WHERE deleted_at IS NULL AND project_id IS NOT NULL"
  );
  const cTotal = customers.reduce((s, c) => s + c.amount_cents, 0);
  const pTotal = purchases.reduce((s, c) => s + c.amount_cents, 0);
  const feeTotal = all<{ s: number }>(
    "SELECT COALESCE(SUM(fee_cents),0) AS s FROM agent_agreements WHERE deleted_at IS NULL"
  )[0]?.s ?? 0;
  const profit = cTotal - pTotal - feeTotal;

  return (
    <>
      <PageHeader
        title="合同管理"
        desc={`客户合同 ${customers.length} 份 · 采购合同 ${purchases.length} 份 · 合同总额 ${fenToWan(cTotal)} 万元`}
        right={
          <>
            <ExportButton type="contracts" label="导出合同清单" />
            <NewContractButton projects={projectList} used={usedProjects} />
          </>
        }
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="客户合同总额" value={fenToWan(cTotal)} unit="万元" foot={`${customers.length} 份`} />
        <Kpi label="采购合同总额" value={fenToWan(pTotal)} unit="万元" foot={`${purchases.length} 份`} tone="w" />
        <Kpi label="预计毛利" value={fenToWan(profit)} unit="万元" foot="客户合同 − 采购 − 过单费" tone="v" />
        <Kpi label="客户合同全额开票" value={customers.filter((c) => c.invoice_mode === "full").length}
             unit="份" foot="代中标常用" tone="v" />
        <Kpi label="客户合同按比例开票" value={customers.filter((c) => c.invoice_mode === "by_payment").length}
             unit="份" foot="与回款联动" tone="o" />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h3>客户合同</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            收入侧 · 一个项目可有多份（主合同 + 补充协议）
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>合同编号</th><th>合同名称</th><th>关联项目</th><th>金额</th>
                <th>签订日期</th><th>付款比例</th><th>质保期</th><th>开票方式</th><th>状态</th><th>合同文件</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="num">{c.code}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 180 }}>
                    <b>{c.title ?? "—"}</b>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.party_name}</div>
                  </td>
                  <td style={{ whiteSpace: "normal", maxWidth: 180, fontSize: 12 }}>
                    {c.project_id ? (
                      <Link href={`/projects/${c.project_id}`} style={{ color: "var(--pri)" }}>
                        {c.project_name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="num">{fenToWan(c.amount_cents)} 万</td>
                  <td className="num">{c.sign_date ?? "—"}</td>
                  <td>
                    <span style={{ background: "var(--line2)", padding: "1px 6px",
                                   borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
                      {c.pay_summary ?? "—"}
                    </span>
                  </td>
                  <td>{c.warranty_months ? c.warranty_months + " 个月" : "—"}</td>
                  <td>
                    <Badge tone={c.invoice_mode === "full" ? "vio" : "ok"}>
                      {INVOICE_MODE_LABEL[c.invoice_mode]}
                    </Badge>
                  </td>
                  <td><Badge tone={
                    (c.status ?? "").includes("逾期") ? "bad"
                    : c.status === "执行中" ? "ok" : "info"
                  }>{c.status}</Badge></td>
                  <td style={{ minWidth: 190 }}>
                    {/* 合同扫描件挂在 contracts.id 上 */}
                    <BizFileCard
                      entityType="contract"
                      entityId={c.id}
                      label="合同扫描件"
                      compact
                    />
                  </td>
                  <td>
                    <RowActions
                      id={c.id}
                      version={c.version}
                      label="合同"
                      apiPath="/api/contracts"
                      deleteHint="有回款记录的合同无法删除，可改为「已终止」状态。"
                      editFields={[
                        { key: "partyName", label: "相对方名称", required: true, colSpan: 2,
                          defaultValue: c.party_name },
                        { key: "title", label: "合同名称", colSpan: 2, defaultValue: c.title ?? "" },
                        { key: "amountWan", label: "金额（万元）", type: "number", required: true,
                          defaultValue: c.amount_cents / 10000 },
                        { key: "signDate", label: "签订日期", type: "date", defaultValue: c.sign_date ?? "" },
                        { key: "warrantyMonths", label: "质保期（月）", type: "number",
                          defaultValue: c.warranty_months ?? "" },
                        { key: "taxRate", label: "税率", type: "select", defaultValue: c.tax_rate ?? "13%",
                          options: ["13%", "9%", "6%", "0%"].map(v => ({ value: v, label: v })) },
                        { key: "status", label: "合同状态", type: "select", defaultValue: c.status,
                          options: ["执行中", "已结算", "已终止", "逾期"].map(v => ({ value: v, label: v })) },
                        { key: "paySummary", label: "付款比例", defaultValue: c.pay_summary ?? "" },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h3>采购合同</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>成本侧 · 分包与供货</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>合同编号</th><th>供应商</th><th>关联项目</th><th>金额</th>
                <th>付款比例</th><th>签订日期</th><th>状态</th><th>合同文件</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((c) => (
                <tr key={c.id}>
                  <td className="num">{c.code}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 180 }}><b>{c.party_name}</b></td>
                  <td style={{ whiteSpace: "normal", maxWidth: 180, fontSize: 12 }}>
                    {c.project_id ? (
                      <Link href={`/projects/${c.project_id}`} style={{ color: "var(--pri)" }}>
                        {c.project_name}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="num">{fenToWan(c.amount_cents)} 万</td>
                  <td>{c.pay_summary ?? "—"}</td>
                  <td className="num">{c.sign_date ?? "—"}</td>
                  <td><Badge tone={c.status === "已结算" ? "ok" : "info"}>{c.status}</Badge></td>
                  <td style={{ minWidth: 190 }}>
                    <BizFileCard
                      entityType="contract"
                      entityId={c.id}
                      label="采购合同扫描件"
                      compact
                    />
                  </td>
                  <td>
                    <RowActions
                      id={c.id}
                      version={c.version}
                      label="采购合同"
                      apiPath="/api/contracts"
                      deleteHint="有付款记录的合同无法删除。"
                      editFields={[
                        { key: "partyName", label: "供应商", required: true, colSpan: 2,
                          defaultValue: c.party_name },
                        { key: "title", label: "合同名称", colSpan: 2, defaultValue: c.title ?? "" },
                        { key: "amountWan", label: "金额（万元）", type: "number", required: true,
                          defaultValue: c.amount_cents / 10000 },
                        { key: "signDate", label: "签订日期", type: "date", defaultValue: c.sign_date ?? "" },
                        { key: "status", label: "合同状态", type: "select", defaultValue: c.status,
                          options: ["执行中", "已结算", "已终止"].map(v => ({ value: v, label: v })) },
                        { key: "paySummary", label: "付款比例", defaultValue: c.pay_summary ?? "" },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="notice" style={{ marginTop: 14 }}>
        <div>
          <b>关键设计</b>
          合同关键条款以结构化字段录入（付款比例、质保期、开票方式），系统据此自动生成回款计划与到期提醒，
          而不是只存一个 PDF。开票方式决定后续节奏：全额开具一次性开票，按比例开具与每期回款绑定。
        </div>
      </div>
    </>
  );
}
