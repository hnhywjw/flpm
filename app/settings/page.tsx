import { guardPage } from "@/lib/page-guard";
import { getCurrentUser } from "@/lib/auth";
import { listRoles } from "@/lib/roles";
import { NODE_CHAIN, CODE_PREFIX } from "@/lib/domain";
import { PageHeader, Badge } from "@/components/ui";

import { RoleAdmin } from "./RoleAdmin";
import { NotifyConfig } from "./NotifyConfig";
import { RecycleBin } from "./RecycleBin";
import { JobsPanel } from "./JobsPanel";
import { TimezonePanel } from "./TimezonePanel";
import { BaseDataPanel } from "./BaseDataPanel";

export const dynamic = "force-dynamic";

const CERT_PLACEHOLDER = [
  { name: "营业执照", no: "91410100MAxxxxxx", end: "长期", ok: true },
  { name: "ISO9001 质量管理体系", no: "00122Q3xxxxR0M", end: "2026-12-15", ok: false },
  { name: "信息系统集成及服务资质 三级", no: "ITSS-2024-xxxx", end: "2027-06-30", ok: true },
  { name: "安防工程企业资质 二级", no: "AF-2023-xxxx", end: "2026-03-01", ok: false },
  { name: "安全生产许可证", no: "(豫)JZ安许证字xxxx", end: "2027-08-20", ok: true },
];

export default async function SettingsPage() {
  await guardPage("settings");
  const user = await getCurrentUser();
  const roles = listRoles();
  const isAdmin = !!user && (user.roles.includes("boss") || user.roles.includes("admin"));

  return (
    <>
      <PageHeader
        title="基础数据"
        desc={`角色 ${roles.length} 个 · 节点链 ${NODE_CHAIN.length} 个 · 由角色决定菜单与金额权限`}
      />

      {/* 角色与人员 */}
      {isAdmin ? (
        <RoleAdmin />
      ) : (
        <div className="notice" style={{ marginTop: 14 }}>
          <div>角色与人员配置需要「总经理」或「系统管理员」权限。</div>
        </div>
      )}

      {/* 节点链 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h3>节点链模板</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            新建项目时自动生成，共 {NODE_CHAIN.length} 个节点
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <div className="flow">
            {NODE_CHAIN.map((n) => (
              <div key={n.key} className={`fnode ${n.isParallel ? "cur" : "done"}`}
                   style={{ flex: "1 0 96px" }}>
                <div className="st">{n.seq}{n.isParallel ? " · 并行" : ""}</div>
                <div className="nn">{n.key}</div>
                <div className="dd" style={{ whiteSpace: "normal", fontSize: 10,
                                             lineHeight: 1.3, padding: "0 2px" }}>
                  {n.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", marginTop: 14 }}
           className="max-lg:!grid-cols-1">
        {/* 资质证照 */}
        <div className="card">
          <div className="card-h"><h3>资质证照库</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>投标资格审查依据</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>证照名称</th><th>编号</th><th>有效期至</th><th>状态</th></tr></thead>
              <tbody>
                {CERT_PLACEHOLDER.map((c) => (
                  <tr key={c.name} style={!c.ok ? { background: "var(--warn-weak)" } : undefined}>
                    <td><b>{c.name}</b></td>
                    <td className="num" style={{ fontSize: 11.5 }}>{c.no}</td>
                    <td className="num">{c.end}</td>
                    <td><Badge tone={c.ok ? "ok" : "warn"}>{c.ok ? "有效" : "需关注"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 编码规则 */}
        <div className="card">
          <div className="card-h"><h3>编码规则</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>统一生成</span></div>
          <div style={{ padding: 16 }}>
            <dl style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: "9px 12px", fontSize: 13 }}>
              {[
                ["项目", CODE_PREFIX.project],
                ["投标", CODE_PREFIX.bid],
                ["客户合同", CODE_PREFIX.customerContract],
                ["采购合同", CODE_PREFIX.purchaseContract],
                ["代中标", CODE_PREFIX.agent],
                ["工单", CODE_PREFIX.ticket],
                ["入库/出库", CODE_PREFIX.stockIn + " / " + CODE_PREFIX.stockOut],
                ["质保", CODE_PREFIX.warranty],
                ["审批", "AP"],
                ["变更", "CR"],
                ["风险", "RK"],
              ].map(([label, prefix]) => (
                <div key={String(label)} style={{ display: "contents" }}>
                  <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>{label}</dt>
                  <dd className="num">{prefix}{"{YYYY}-序号"}</dd>
                </div>
              ))}
              <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>金额存储</dt>
              <dd>整数「分」，展示按万元</dd>
            </dl>
          </div>
        </div>
      </div>

      {/* 时区与时间：影响全系统日期，放在基础数据前面 */}
      {isAdmin && <TimezonePanel />}

      {/* 基础数据维护 */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>基础数据维护</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              客户 / 物料 / 仓库
            </span>
          </div>
          <BaseDataPanel />
        </div>
      )}

      {/* 消息推送 */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>消息推送</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              钉钉 / 企业微信 / 通用 Webhook
            </span>
          </div>
          <NotifyConfig />
        </div>
      )}

      {/* 定时任务 */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>定时任务与预警推送</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              节点超期 / 回款逾期 / 投标截止 / 质保到期 / 库存预警 / 审批超时
            </span>
          </div>
          <JobsPanel />
        </div>
      )}

      {/* 回收站 */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>回收站</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>已删除的记录可恢复</span>
          </div>
          <RecycleBin />
        </div>
      )}

    </>
  );
}
