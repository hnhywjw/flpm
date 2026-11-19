import { guardPage } from "@/lib/page-guard";
import { all, getDb } from "@/lib/db";
import { PageHeader, Kpi } from "@/components/ui";
import { fenToWan } from "@/lib/domain";
import { ExportButton } from "@/components/ExportButton";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await guardPage("reports");

  // ---------- 中标率漏斗 ----------
  const bidStats = all<{ result: string; cnt: number; amt: number | null }>(
    `SELECT result, COUNT(*) AS cnt, SUM(win_amount_cents) AS amt
     FROM bids GROUP BY result`
  );
  const get = (r: string) => bidStats.find((b) => b.result === r);
  const totalBids = bidStats.reduce((s, b) => s + b.cnt, 0);
  const won = get("中标")?.cnt ?? 0;
  const lost = get("未中标")?.cnt ?? 0;
  const failed = get("废标")?.cnt ?? 0;
  const pending = get("待开标")?.cnt ?? 0;
  const decided = won + lost + failed;
  const winRate = decided > 0 ? (won / decided) * 100 : 0;
  const wonAmount = get("中标")?.amt ?? 0;

  // 未中标原因
  const failReasons = all<{ reason: string; cnt: number }>(
    `SELECT COALESCE(fail_reason, '未填写原因') AS reason, COUNT(*) AS cnt
     FROM bids WHERE result = '废标' GROUP BY reason ORDER BY cnt DESC`
  );

  // ---------- 项目毛利 ----------
  const margins = all<{
    id: number; code: string; name: string; customer_name: string | null;
    stage: string; revenue: number | null; purchase: number | null; fee: number | null;
  }>(
    `SELECT p.id, p.code, p.name, c.name AS customer_name, p.stage,
       (SELECT COALESCE(SUM(amount_cents),0) FROM contracts WHERE project_id=p.id AND type='customer') AS revenue,
       (SELECT COALESCE(SUM(amount_cents),0) FROM contracts WHERE project_id=p.id AND type='purchase') AS purchase,
       (SELECT COALESCE(SUM(fee_cents),0) FROM agent_agreements WHERE project_id=p.id) AS fee
     FROM projects p LEFT JOIN customers c ON c.id = p.customer_id
     ORDER BY revenue DESC`
  );

  const marginRows = margins
    .filter((m) => (m.revenue ?? 0) > 0)
    .map((m) => {
      const rev = m.revenue ?? 0;
      const cost = (m.purchase ?? 0) + (m.fee ?? 0);
      const profit = rev - cost;
      return { ...m, rev, cost, profit, rate: rev > 0 ? (profit / rev) * 100 : 0 };
    });

  const totalRev = marginRows.reduce((s, m) => s + m.rev, 0);
  const totalProfit = marginRows.reduce((s, m) => s + m.profit, 0);
  const avgRate = totalRev > 0 ? (totalProfit / totalRev) * 100 : 0;

  // ---------- 回款分布 ----------
  const recvStats = all<{ status: string; cnt: number; amt: number }>(
    `SELECT t.status, COUNT(*) AS cnt, SUM(t.amount_cents - t.actual_cents) AS amt
     FROM payment_terms t JOIN contracts c ON c.id=t.contract_id
     WHERE c.type='customer' GROUP BY t.status`
  );

  return (
    <>
      <PageHeader
        title="报表分析"
        desc="中标率漏斗 · 项目毛利 · 回款分布"
        right={<ExportButton type="projects" label="导出项目数据" />}
      />

      {/* KPI */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="中标率" value={winRate.toFixed(1)} unit="%"
             foot={`${won}/${decided} 已开标`} tone="o" />
        <Kpi label="中标金额" value={fenToWan(wonAmount)} unit="万元" foot="累计" />
        <Kpi label="整体毛利率" value={avgRate.toFixed(1)} unit="%"
             foot={`毛利 ${fenToWan(totalProfit)} 万`} tone={avgRate > 20 ? "o" : "w"} />
        <Kpi label="逾期未收" value={fenToWan(recvStats.find((r) => r.status === "逾期未收")?.amt ?? 0)}
             unit="万元" foot="需催收" tone="b" />
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 14 }}
           className="max-lg:!grid-cols-1">

        {/* 中标漏斗 */}
        <div className="card">
          <div className="card-h"><h3>投标漏斗</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>共 {totalBids} 个投标</span></div>
          <div style={{ padding: 18 }}>
            <FunnelRow label="参与投标" value={totalBids} max={totalBids} color="var(--info)" />
            <FunnelRow label="已开标" value={decided} max={totalBids} color="var(--pri)" />
            <FunnelRow label="中标" value={won} max={totalBids} color="var(--ok)" />
            <div style={{ display: "flex", gap: 16, marginTop: 16, paddingTop: 14,
                          borderTop: "1px solid var(--line2)", fontSize: 12.5 }}>
              <span>中标 <b style={{ color: "var(--ok)" }}>{won}</b></span>
              <span>未中标 <b style={{ color: "var(--sub)" }}>{lost}</b></span>
              <span>废标 <b style={{ color: "var(--bad)" }}>{failed}</b></span>
              <span>待开标 <b style={{ color: "var(--warn)" }}>{pending}</b></span>
            </div>
            {failReasons.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>废标原因</div>
                {failReasons.map((f) => (
                  <div key={f.reason} style={{ fontSize: 12, color: "var(--sub)", lineHeight: 1.9 }}>
                    · {f.reason}（{f.cnt} 个）
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 回款分布 */}
        <div className="card">
          <div className="card-h"><h3>回款状态分布</h3></div>
          <div style={{ padding: 18 }}>
            {recvStats.map((r) => {
              const total = recvStats.reduce((s, x) => s + x.cnt, 0);
              const pct = total > 0 ? (r.cnt / total) * 100 : 0;
              const tone = r.status === "逾期未收" ? "var(--bad)"
                : r.status === "部分回款" ? "var(--warn)"
                : r.status === "已回款" ? "var(--ok)" : "var(--muted)";
              return (
                <div key={r.status} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", fontSize: 12.5, marginBottom: 5 }}>
                    <span>{r.status}</span>
                    <span style={{ marginLeft: "auto", color: "var(--sub)" }}>
                      {r.cnt} 期 · {fenToWan(r.amt)} 万
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{ width: pct + "%", background: tone }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 毛利排行 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h3>项目毛利排行</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            毛利 = 客户合同 − 采购合同 − 过单费
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>项目</th><th>阶段</th><th>合同额</th><th>采购成本</th>
                <th>过单费</th><th>毛利</th><th>毛利率</th>
              </tr>
            </thead>
            <tbody>
              {marginRows.map((m) => (
                <tr key={m.id}>
                  <td style={{ whiteSpace: "normal", minWidth: 200 }}>
                    <b>{m.name}</b>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {m.code} · {m.customer_name ?? "—"}
                    </div>
                  </td>
                  <td><span className="badge b-gray">{m.stage}</span></td>
                  <td className="num">{fenToWan(m.rev)} 万</td>
                  <td className="num">{fenToWan(m.purchase ?? 0)} 万</td>
                  <td className="num" style={{ color: m.fee ? "var(--violet)" : undefined }}>
                    {m.fee ? fenToWan(m.fee) + " 万" : "—"}
                  </td>
                  <td className="num" style={{ color: m.profit >= 0 ? "var(--ok)" : "var(--bad)", fontWeight: 700 }}>
                    {fenToWan(m.profit)} 万
                  </td>
                  <td>
                    <span className={"badge " + (m.rate >= 25 ? "b-ok" : m.rate >= 15 ? "b-warn" : "b-bad")}>
                      {m.rate.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function FunnelRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", fontSize: 12.5, marginBottom: 5 }}>
        <span>{label}</span>
        <span style={{ marginLeft: "auto", fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 22, background: "var(--line2)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{
          width: pct + "%", height: "100%", background: color,
          borderRadius: 6, transition: "width .3s",
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          paddingRight: pct > 12 ? 8 : 0, color: "#fff", fontSize: 11, fontWeight: 700,
        }}>
          {pct > 12 ? pct.toFixed(0) + "%" : ""}
        </div>
      </div>
    </div>
  );
}
