import { getDashboard } from "@/lib/queries";
import { fenToWan } from "@/lib/domain";
import { Kpi, Badge, Bar, PageHeader } from "@/components/ui";
import Link from "next/link";
import { guardPage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // 用当前登录用户，不能写死姓名
  const me = await guardPage("dashboard");
  let d;
  let error: string | null = null;
  try {
    d = getDashboard();
  } catch (e) {
    error = (e as Error).message;
  }

  if (error || !d) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>数据库未初始化</h2>
        <p style={{ fontSize: 13, color: "var(--sub)", lineHeight: 1.9 }}>
          请先执行：<code style={{ background: "var(--line2)", padding: "2px 6px", borderRadius: 5 }}>npm run db:init</code>
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>{error}</p>
      </div>
    );
  }

  const totalPlan = d.contractTotal;

  return (
    <>
      <PageHeader
        title="工作台"
        desc={
          <>
            {me.name}，今天有 <b style={{ color: "var(--bad)" }}>{d.alerts.length}</b> 项待办需要处理
          </>
        }
        right={
          <>
            <Link href="/projects" className="btn">项目管理</Link>
            <Link href="/alerts" className="btn btn-pri">查看待办</Link>
          </>
        }
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="在手合同额" value={fenToWan(totalPlan)} unit="万元" foot="客户合同合计" />
        <Kpi label="本年累计回款" value={fenToWan(d.receivedTotal)} unit="万元"
             foot={`回款率 ${totalPlan ? Math.round(d.receivedTotal / totalPlan * 100) : 0}%`} tone="o" />
        <Kpi label="逾期应收" value={fenToWan(d.overdueTotal)} unit="万元"
             foot={`${d.overdueCount} 笔逾期`} tone="b" />
        <Kpi label="正在投标" value={d.biddingCount} unit="个"
             foot={`${d.biddingProjects.length} 个在途`} tone="w" />
        <Kpi label="正在实施" value={d.implementingCount} unit="个" foot="含验收阶段" />
        <Kpi label="过单费未付" value={fenToWan(d.feeUnpaid)} unit="万元" foot="代中标台账" tone="v" />
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1.42fr 1fr", marginTop: 14 }}
           className="max-lg:!grid-cols-1">
        {/* 左：投标 + 实施 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="card-h">
              <h3>正在投标的项目</h3>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.biddingProjects.length} 个在途</span>
              <div style={{ marginLeft: "auto" }}>
                <Link href="/bidding" style={{ color: "var(--pri)", fontWeight: 600, fontSize: 12 }}>
                  查看全部 →
                </Link>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>项目</th><th>预算</th><th>截止</th><th>阶段</th><th>模式</th><th>负责人</th>
                  </tr>
                </thead>
                <tbody>
                  {d.biddingProjects.map((b) => (
                    <tr key={b.id}>
                      <td style={{ whiteSpace: "normal", minWidth: 180 }}>
                        <b>{b.name}</b>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {b.code} · {b.customer_name ?? ""}
                        </div>
                      </td>
                      <td className="num">{fenToWan(b.budget_cents)} 万</td>
                      <td>{b.deadline}</td>
                      <td>
                        <Badge tone={b.phase === "待递交" ? "bad" : "info"}>{b.phase}</Badge>
                      </td>
                      <td>
                        <Badge tone={b.mode === "agent" ? "vio" : "gray"}>
                          {b.mode === "agent" ? "代中标" : "直接"}
                        </Badge>
                      </td>
                      <td>{b.owner_name ?? "—"}</td>
                    </tr>
                  ))}
                  {d.biddingProjects.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 26 }}>
                      暂无在途投标
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <h3>正在实施的项目</h3>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.implementingProjects.length} 个</span>
              <div style={{ marginLeft: "auto" }}>
                <Link href="/projects" style={{ color: "var(--pri)", fontWeight: 600, fontSize: 12 }}>
                  查看全部 →
                </Link>
              </div>
            </div>
            <div>
              {d.implementingProjects.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  style={{ display: "flex", gap: 11, padding: "12px 16px",
                           borderBottom: "1px solid var(--line2)", alignItems: "center",
                           textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 9, display: "grid",
                                placeItems: "center", flex: "0 0 34px",
                                background: "var(--pri-weak)", color: "var(--pri)" }}>🏗</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 13, display: "block" }}>{p.name}</b>
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {p.customer_name} · {p.owner_name} · 进度 {p.progress}%
                    </span>
                    <div style={{ marginTop: 6, maxWidth: 420 }}>
                      <Bar pct={p.progress} />
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="num" style={{ fontWeight: 700 }}>{fenToWan(p.budget_cents)} 万</div>
                    <div style={{ marginTop: 6 }}>
                      <Badge tone={p.status === "验收中" ? "info" : "ok"}>{p.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))}
              {d.implementingProjects.length === 0 && (
                <div style={{ textAlign: "center", color: "var(--muted)", padding: 26 }}>暂无实施中项目</div>
              )}
            </div>
          </div>
        </div>

        {/* 右：资金 + 预警 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="card-h"><h3>资金全景</h3>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>四本账</span></div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              <Row label="应收未收" value={fenToWan(totalPlan - d.receivedTotal)} unit="万"
                   sub={`逾期 ${fenToWan(d.overdueTotal)} 万`} color="var(--pri)" />
              <Row label="应付采购" value={fenToWan(d.payablePending)} unit="万"
                   sub="采购合同未付" color="var(--warn)" />
              <Row label="投标保证金占用" value={fenToWan(d.bondPending)} unit="万"
                   sub="已缴未退" color="var(--info)" />
              <Row label="质保金待收" value={fenToWan(d.warrantyPending)} unit="万"
                   sub="质保期满可收" color="var(--violet)" />
              <Row label="过单费未付" value={fenToWan(d.feeUnpaid)} unit="万"
                   sub="代中标应付" color="var(--bad)" />
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <h3>待办与预警</h3>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{d.alerts.length} 项</span>
              <div style={{ marginLeft: "auto" }}>
                <Link href="/alerts" style={{ color: "var(--pri)", fontWeight: 600, fontSize: 12 }}>全部 →</Link>
              </div>
            </div>
            <div>
              {d.alerts.slice(0, 6).map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 11, padding: "12px 16px",
                                      borderBottom: "1px solid var(--line2)", alignItems: "center" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, display: "grid",
                                placeItems: "center", flex: "0 0 34px", fontSize: 15,
                                background: a.level === "bad" ? "var(--bad-weak)" : "var(--warn-weak)",
                                color: a.level === "bad" ? "var(--bad)" : "var(--warn)" }}>!</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 13, display: "block" }}>{a.title}</b>
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.detail}</span>
                  </div>
                  <Badge tone={a.level === "bad" ? "bad" : "warn"}>{a.kind}</Badge>
                </div>
              ))}
              {d.alerts.length === 0 && (
                <div style={{ textAlign: "center", color: "var(--muted)", padding: 26 }}>暂无预警</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, unit, sub, color }: {
  label: string; value: string; unit: string; sub: string; color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: "var(--sub)" }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <span className="num" style={{ fontSize: 18, fontWeight: 750, color }}>{value}</span>
        <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 3 }}>{unit}</span>
      </div>
    </div>
  );
}
