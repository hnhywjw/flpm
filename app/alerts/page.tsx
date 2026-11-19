import Link from "next/link";
import { buildAlerts } from "@/lib/queries";
import { Badge, PageHeader, Kpi } from "@/components/ui";
import { guardPage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  await guardPage("alerts");
  const alerts = buildAlerts();
  const bad = alerts.filter((a) => a.level === "bad").length;
  const warn = alerts.filter((a) => a.level === "warn").length;

  // 按类型分组统计
  const kinds = new Map<string, number>();
  alerts.forEach((a) => kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1));

  return (
    <>
      <PageHeader title="待办与预警" desc={`共 ${alerts.length} 项 · 按紧急度排序`} />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="紧急" value={bad} unit="项" foot="需立即处理" tone="b" />
        <Kpi label="关注" value={warn} unit="项" foot="近期需跟进" tone="w" />
        <Kpi label="合计" value={alerts.length} unit="项" foot="全部待办" />
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", margin: "14px 0" }}>
        <span className="badge b-pri">全部 {alerts.length}</span>
        {Array.from(kinds.entries()).map(([k, n]) => (
          <span key={k} className="badge b-gray">{k} {n}</span>
        ))}
      </div>

      <div className="card">
        <div>
          {alerts.map((a, i) => {
            const href = a.entityType === "project" ? `/projects/${a.entityId}`
              : a.entityType === "bid" ? "/bidding" : "/inventory";
            return (
              <div key={i} style={{ display: "flex", gap: 11, padding: "12px 16px",
                                    borderBottom: "1px solid var(--line2)", alignItems: "center" }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center",
                  flex: "0 0 34px", fontSize: 15,
                  background: a.level === "bad" ? "var(--bad-weak)" : "var(--warn-weak)",
                  color: a.level === "bad" ? "var(--bad)" : "var(--warn)",
                }}>!</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13, display: "block" }}>{a.title}</b>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.detail}</span>
                  <div style={{ marginTop: 6 }}>
                    <Badge tone={a.level === "bad" ? "bad" : "warn"}>{a.kind}</Badge>
                  </div>
                </div>
                <Link href={href} className="btn btn-sm btn-pri">{a.action ?? "查看"}</Link>
              </div>
            );
          })}
          {alerts.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: 34 }}>
              暂无预警，一切正常
            </div>
          )}
        </div>
      </div>

      <div className="notice" style={{ marginTop: 14 }}>
        <div>
          <b>预警规则（当前生效）</b>
          · 节点：超期立即提醒责任人，并计算超期天数<br />
          · 回款：状态为逾期未收即提醒，计算逾期天数<br />
          · 投标：递交截止前 7 天内提醒，3 天内升级为紧急<br />
          · 关联风险：参与方被标注为「关联风险」时立即提示核查<br />
          · 过单费：存在未付余额时提醒财务<br />
          · 质保金：质保期届满前 90 天提示发起收回<br />
          · 库存：低于安全库存时提醒补货
        </div>
      </div>
    </>
  );
}
