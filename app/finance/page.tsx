import Link from "next/link";
import { listReceivables, getReceivableSummary, listInvoices, getWarrantyBondPending } from "@/lib/queries";
import { fenToWan } from "@/lib/domain";
import { Badge, PageHeader, Kpi, Bar } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";
import { RegisterPaymentButton } from "./RegisterPaymentButton";
import { RowActions } from "@/components/RowActions";
import { InvoiceButton } from "./InvoiceButton";
import { PaymentStatusBadge, InvoiceStatusBadge } from "@/components/StatusBadges";
import { guardPage } from "@/lib/page-guard";
import { BizFileCard } from "@/components/BizFileCard";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  await guardPage("finance");
  const rows = listReceivables();
  const sum = getReceivableSummary();
  const invoices = listInvoices();
  const warranty = getWarrantyBondPending();

  const overdueRows = rows.filter((r) => r.status === "逾期未收");
  const partialRows = rows.filter((r) => r.status === "部分回款");
  const doneRows = rows.filter((r) => r.status === "已回款");
  const unpaidRows = rows.filter((r) => r.actual_cents <= 0);
  const invoicedRows = rows.filter((r) => (r.invoiced_cents ?? 0) > 0);
  const notInvoicedRows = rows.filter((r) => (r.invoiced_cents ?? 0) <= 0);
  const invoiceTotal = rows.reduce((s2, r) => s2 + (r.invoiced_cents ?? 0), 0);
  const planTotal = rows.reduce((s2, r) => s2 + r.amount_cents, 0);

  // 账龄
  const aging = {
    notDue: rows.filter((r) => r.status === "未到期").reduce((s, r) => s + r.amount_cents, 0),
    d30: overdueRows.filter((r) => (r.overdue ?? 0) <= 30).reduce((s, r) => s + (r.amount_cents - r.actual_cents), 0),
    d90: overdueRows.filter((r) => (r.overdue ?? 0) > 30 && (r.overdue ?? 0) <= 90).reduce((s, r) => s + (r.amount_cents - r.actual_cents), 0),
    d90p: overdueRows.filter((r) => (r.overdue ?? 0) > 90).reduce((s, r) => s + (r.amount_cents - r.actual_cents), 0),
  };

  return (
    <>
      <PageHeader
        title="开票与回款"
        desc={`应收 ${fenToWan(sum.plan)} 万元 · 已回 ${fenToWan(sum.act)} 万元 · 逾期 ${fenToWan(sum.overdue)} 万元`}
        right={
          <>
            <ExportButton type="receivables" label="导出回款台账" />
            <InvoiceButton />
            <RegisterPaymentButton
              terms={rows
                .filter((r) => r.actual_cents < r.amount_cents)
                .map((r) => ({
                  id: r.id,
                  label: `${r.contract_code} · ${r.name} · 待收 ${fenToWan(r.amount_cents - r.actual_cents)} 万`,
                  remaining: r.amount_cents - r.actual_cents,
                }))}
            />
          </>
        }
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="已回款" value={fenToWan(sum.act)} unit="万元"
             foot={`回款率 ${sum.plan ? Math.round(sum.act / sum.plan * 100) : 0}%`} tone="o" />
        <Kpi label="应收余额" value={fenToWan(sum.plan - sum.act)} unit="万元" foot={`${rows.length} 期`} />
        <Kpi label="逾期金额" value={fenToWan(sum.overdue)} unit="万元"
             foot={`${sum.overdueCnt} 笔`} tone="b" />
        <Kpi label="质保金待收" value={fenToWan(warranty)} unit="万元" foot="质保期满可收" tone="w" />
      </div>

      {/* 双维度状态总览 */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 14 }}
           className="max-lg:!grid-cols-1">
        <div className="card">
          <div className="card-h">
            <h3>回款状态</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{rows.length} 个期次</span>
          </div>
          <div style={{ padding: 16 }}>
            <StatusRow label="已付款" count={doneRows.length} total={rows.length}
                       color="var(--ok)" />
            <StatusRow label="部分付款" count={partialRows.length} total={rows.length}
                       color="var(--warn)" />
            <StatusRow label="未付款" count={unpaidRows.length} total={rows.length}
                       color="var(--muted)" />
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line2)",
                          fontSize: 12.5, color: "var(--sub)" }}>
              已收 <b style={{ color: "var(--ok)" }}>{fenToWan(sum.act)}</b> 万 ·
              待收 <b style={{ color: "var(--bad)" }}>{fenToWan(sum.plan - sum.act)}</b> 万
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h3>开票状态</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{rows.length} 个期次</span>
          </div>
          <div style={{ padding: 16 }}>
            <StatusRow label="已开票" count={invoicedRows.filter((r) => (r.invoiced_cents ?? 0) >= r.amount_cents).length}
                       total={rows.length} color="var(--pri)" />
            <StatusRow label="部分开票" count={invoicedRows.filter((r) => (r.invoiced_cents ?? 0) < r.amount_cents).length}
                       total={rows.length} color="var(--violet)" />
            <StatusRow label="未开票" count={notInvoicedRows.length} total={rows.length}
                       color="var(--muted)" />
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line2)",
                          fontSize: 12.5, color: "var(--sub)" }}>
              已开 <b style={{ color: "var(--pri)" }}>{fenToWan(invoiceTotal)}</b> 万 ·
              待开 <b style={{ color: "var(--violet)" }}>{fenToWan(planTotal - invoiceTotal)}</b> 万
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h3>回款计划与实收</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>按合同条款自动生成</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Badge tone="bad">逾期 {overdueRows.length}</Badge>
            <Badge tone="warn">部分 {partialRows.length}</Badge>
            <Badge tone="ok">已回 {doneRows.length}</Badge>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>项目 / 合同</th><th>期次</th><th>比例</th><th>计划金额</th><th>计划日期</th>
                <th>实收</th><th>开票</th><th>逾期</th><th>回款状态</th><th>开票状态</th><th>回款凭证</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.status === "逾期未收" ? { background: "var(--bad-weak)" } : undefined}>
                  <td style={{ whiteSpace: "normal", minWidth: 200 }}>
                    <b>{r.project_name}</b>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {r.contract_code} · {r.customer_name}
                    </div>
                  </td>
                  <td><b>{r.name}</b></td>
                  <td className="num">{r.percent}%</td>
                  <td className="num">{fenToWan(r.amount_cents)} 万</td>
                  <td className="num">{r.plan_date ?? "—"}</td>
                  <td className="num" style={{ color: r.actual_cents >= r.amount_cents ? "var(--ok)" : undefined }}>
                    {fenToWan(r.actual_cents)} 万
                    {r.actual_date && (
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.actual_date}</div>
                    )}
                  </td>
                  <td className="num" style={{ color: (r.invoiced_cents ?? 0) >= r.amount_cents ? "var(--pri)" : undefined }}>
                    {fenToWan(r.invoiced_cents ?? 0)} 万
                    {(r.invoiced_cents ?? 0) > 0 && (r.invoiced_cents ?? 0) < r.amount_cents && (
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {Math.round((r.invoiced_cents ?? 0) / r.amount_cents * 100)}%
                      </div>
                    )}
                  </td>
                  <td>{r.overdue ? <span className="money-out">{r.overdue} 天</span> : "—"}</td>
                  <td><PaymentStatusBadge planCents={r.amount_cents} actualCents={r.actual_cents} /></td>
                  <td><InvoiceStatusBadge planCents={r.amount_cents} invoicedCents={r.invoiced_cents ?? 0} /></td>
                  <td style={{ minWidth: 190 }}>
                    {/* 银行回单 / 收款截图挂在 payment_terms.id 上 */}
                    <BizFileCard
                      entityType="payment"
                      entityId={r.id}
                      label="回款凭证"
                      compact
                    />
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 5 }}>
                      <RowActions
                        id={r.id}
                        label="回款期次"
                        apiPath="/api/payments"
                        deleteHint="回款期次不能删除，只能冲正实收金额为 0。"
                        editTitle="冲正 / 修改回款"
                        editFields={[
                          { key: "actualWan", label: "实收金额（万元）", type: "number",
                            defaultValue: r.actual_cents ? r.actual_cents / 10000 : "",
                            hint: `计划 ${(r.amount_cents / 10000).toFixed(2)} 万，不能超过` },
                          { key: "actualDate", label: "实收日期", type: "date",
                            defaultValue: r.actual_date ?? "" },
                          { key: "status", label: "状态", type: "select", defaultValue: r.status,
                            options: ["未到期", "待收回", "部分回款", "已回款", "逾期未收"].map(v => ({ value: v, label: v })) },
                          { key: "remark", label: "备注", type: "textarea", colSpan: 2,
                            placeholder: "冲正原因等" },
                        ]}
                      />
                      <Link href={`/projects/${r.project_id}`} className="btn btn-sm">明细</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 14 }}
           className="max-lg:!grid-cols-1">
        <div className="card">
          <div className="card-h"><h3>开票记录</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{invoices.length} 张</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th>发票号</th><th>金额</th><th>税率</th><th>依据</th><th>日期</th><th>状态</th><th>发票文件</th></tr>
              </thead>
              <tbody>
                {invoices.map((v) => (
                  <tr key={v.id}>
                    <td className="num">{v.invoice_no ?? "—"}</td>
                    <td className="num">{fenToWan(v.amount_cents)} 万</td>
                    <td>{v.tax_rate}</td>
                    <td><Badge tone={v.basis === "全额开具" ? "vio" : "gray"}>{v.basis}</Badge></td>
                    <td className="num">{v.issue_date ?? "—"}</td>
                    <td><Badge tone={v.status === "已开票" ? "ok" : "warn"}>{v.status}</Badge></td>
                    <td style={{ minWidth: 180 }}>
                      {/* 发票扫描件 / PDF 挂在 invoices.id 上 */}
                      <BizFileCard
                        entityType="invoice"
                        entityId={v.id}
                        label="发票文件"
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>应收账龄</h3><span style={{ fontSize: 12, color: "var(--muted)" }}>万元</span></div>
          <div style={{ padding: 16 }}>
            <AgingRow label="未到期" value={aging.notDue} total={sum.plan} tone="" />
            <AgingRow label="逾期 1-30 天" value={aging.d30} total={sum.plan} tone="warn" />
            <AgingRow label="逾期 31-90 天" value={aging.d90} total={sum.plan} tone="warn" />
            <AgingRow label="逾期 90 天以上" value={aging.d90p} total={sum.plan} tone="bad" />
            {overdueRows.length > 0 && (
              <div className="notice" style={{ marginTop: 8 }}>
                <div>
                  <b>建议动作</b>
                  {overdueRows.map((r) => (
                    <div key={r.id}>
                      {r.project_name} {fenToWan(r.amount_cents - r.actual_cents)} 万已逾期 {r.overdue} 天
                    </div>
                  ))}
                  建议暂停质保范围外的免费服务，并发正式催款函。
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function AgingRow({ label, value, total, tone }: {
  label: string; value: number; total: number; tone: "" | "warn" | "bad";
}) {
  const pct = total ? Math.round(value / total * 100) : 0;
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", fontSize: 12.5, marginBottom: 5 }}>
        <span>{label}</span>
        <span style={{ marginLeft: "auto", color: "var(--sub)" }}>
          <b style={{ color: "var(--text)" }}>{fenToWan(value)}</b> 万 · {pct}%
        </span>
      </div>
      <div className="bar">
        <i style={{ width: pct + "%", background: tone ? `var(--${tone})` : "var(--ok)" }} />
      </div>
    </div>
  );
}


/** 状态分布行：标签 + 进度条 + 数量 */
function StatusRow({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", fontSize: 12.5, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ marginLeft: "auto", color: "var(--sub)", fontWeight: 600 }}>
          {count} / {total}
        </span>
      </div>
      <div style={{ height: 8, background: "var(--line2)", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", background: color, borderRadius: 5 }} />
      </div>
    </div>
  );
}
