import Link from "next/link";
import { listTickets, listWarranties } from "@/lib/queries";
import { fenToWan } from "@/lib/domain";
import { Badge, PageHeader, Kpi } from "@/components/ui";
import { ExportButton } from "@/components/ExportButton";
import { NewTicketButton } from "./NewTicketButton";
import { RowActions } from "@/components/RowActions";
import { guardPage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function ServicePage() {
  await guardPage("service");
  const tickets = listTickets();
  const warranties = listWarranties();
  const open = tickets.filter((t) => ["待响应", "处理中", "待备件", "超时升级"].includes(t.status));
  const overdue = tickets.filter((t) => t.status === "超时升级");
  const bondPending = warranties.filter((w) => w.bond_status !== "已收回")
    .reduce((s, w) => s + (w.bond_cents ?? 0), 0);

  return (
    <>
      <PageHeader
        title="售后服务"
        desc={`在办工单 ${open.length} 个 · SLA 超时 ${overdue.length} 个 · 质保期项目 ${warranties.length} 个`}
        right={
          <>
            <ExportButton type="tickets" label="导出工单" />
            <NewTicketButton />
          </>
        }
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="在办工单" value={open.length} unit="个" foot="含超时升级" tone="w" />
        <Kpi label="SLA 超时" value={overdue.length} unit="个" foot="需立即升级" tone="b" />
        <Kpi label="本月已解决" value={tickets.filter((t) => t.status === "已关闭").length}
             unit="个" foot="已关闭" tone="o" />
        <Kpi label="质保金待收" value={fenToWan(bondPending)} unit="万元"
             foot={`${warranties.filter((w) => w.bond_status !== "已收回").length} 个项目`} />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h"><h3>服务工单</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>按紧急度排序</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>工单号</th><th>客户 / 问题</th><th>级别</th><th>设备 SN</th>
                <th>报修时间</th><th>SLA</th><th>处理人</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} style={t.status === "超时升级" ? { background: "var(--bad-weak)" } : undefined}>
                  <td className="num">{t.code}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 200 }}>
                    <b>{t.title}</b>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {t.customer_name} · {t.project_name}
                    </div>
                  </td>
                  <td><Badge tone={t.level === "严重" ? "bad" : "info"}>{t.level}</Badge></td>
                  <td className="num" style={{ fontSize: 11.5 }}>{t.sn_list ?? "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.reported_at ?? "—"}</td>
                  <td>{t.sla_hours} 小时</td>
                  <td>{t.owner_name ?? "—"}</td>
                  <td><Badge tone={
                    t.status === "超时升级" ? "bad" : t.status === "已关闭" ? "ok"
                    : t.status === "待备件" ? "warn" : "pri"
                  }>{t.status}</Badge></td>
                  <td>
                    <RowActions
                      id={t.id}
                      label="工单"
                      apiPath="/api/tickets"
                      deleteHint="删除后工单不再出现在列表，统计数据会相应减少。"
                      editFields={[
                        { key: "title", label: "问题描述", required: true, colSpan: 2, defaultValue: t.title },
                        { key: "level", label: "级别", type: "select", defaultValue: t.level,
                          options: ["严重", "一般", "咨询"].map(v => ({ value: v, label: v })) },
                        { key: "slaHours", label: "SLA（小时）", type: "number", defaultValue: t.sla_hours },
                        { key: "snList", label: "设备 SN", colSpan: 2, defaultValue: t.sn_list ?? "" },
                        { key: "isWarranty", label: "在质保期内", type: "checkbox",
                          defaultValue: Boolean(t.is_warranty) },
                        { key: "status", label: "状态", type: "select", defaultValue: t.status,
                          options: ["待响应", "处理中", "待备件", "已解决", "已关闭", "超时升级"].map(v => ({ value: v, label: v })) },
                        { key: "note", label: "备注", type: "textarea", colSpan: 2, defaultValue: t.note ?? "" },
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
          <h3>质保期台账</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>质保到期 = 质保金可收回，提前 90 天提醒</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr><th>质保单号</th><th>项目</th><th>质保到期</th><th>剩余</th><th>质保金</th><th>状态</th><th></th></tr>
            </thead>
            <tbody>
              {warranties.map((w) => (
                <tr key={w.id} style={w.bond_status === "已逾期" ? { background: "var(--bad-weak)" } : undefined}>
                  <td className="num">{w.code}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 180 }}><b>{w.project_name}</b></td>
                  <td className="num">{w.end_date}</td>
                  <td style={w.daysLeft < 0 ? { color: "var(--bad)", fontWeight: 700 } : undefined}>
                    {w.daysLeft < 0 ? `已逾期 ${-w.daysLeft} 天` : `剩 ${w.daysLeft} 天`}
                  </td>
                  <td className="num">{fenToWan(w.bond_cents)} 万</td>
                  <td><Badge tone={
                    w.bond_status === "已逾期" ? "bad"
                    : w.bond_status === "已收回" ? "ok" : "warn"
                  }>{w.bond_status}</Badge></td>
                  <td>
                    {w.project_id && (
                      <Link href={`/projects/${w.project_id}`} className="btn btn-sm">资料</Link>
                    )}
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
