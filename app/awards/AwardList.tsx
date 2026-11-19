"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { NewAgentButton, type WonCompany } from "./NewAgentButton";
import { PayFeeButton } from "./PayFeeButton";
import { RowActions } from "@/components/RowActions";
import { invoicedWanFromFeeRate } from "@/lib/domain";

interface Award {
  id: number;
  code: string;
  name: string;
  mode: "direct" | "agent";
  stage: string;
  status: string;
  owner_name: string | null;
  customer_name: string | null;
  bid_code: string | null;
  contractTotal: number | null;
  receivedTotal: number | null;
  purchaseTotal: number | null;
  profit: number | null;
  profitRate?: number;
  fee: number | null;
  feePaid: number | null;
  unpaid: number | null;
  invoicedAmount: number | null;
  agreedAmount: number | null;
  agent: {
    id: number;
    code: string;
    party: string;
    partyType: "company" | "individual";
    feeMethod: "diff" | "cash";
    feeRate?: number | null;
  } | null;
}

interface Summary {
  total: number;
  directCount: number;
  agentCount: number;
  contractTotal?: number;
  receivedTotal?: number;
  profitTotal?: number;
  feeTotal?: number;
  feePaid?: number;
  feeUnpaid?: number;
}

const W = 10000;
const wan = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : (v / W).toFixed(2);

export function AwardList({ won }: { won: WonCompany[] }) {
  const [data, setData] = useState<{ list: Award[]; summary: Summary; canAmount: boolean } | null>(null);
  const [mode, setMode] = useState<"all" | "direct" | "agent">("all");
  const [kw, setKw] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/awards?mode=${mode}&kw=${encodeURIComponent(kw)}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [mode]);

  const list = data?.list ?? [];
  const s = data?.summary;
  const canAmount = data?.canAmount ?? false;

  // 按模式分组统计（用于顶部筛选条的角标）
  const counts = useMemo(() => {
    const direct = list.filter((x) => x.mode !== "agent").length;
    const agent = list.filter((x) => x.agent).length;
    return { all: direct + agent, direct, agent };
  }, [list]);

  const inputStyle: React.CSSProperties = {
    padding: "7px 11px", fontSize: 13, border: "1px solid var(--line)",
    borderRadius: 8, background: "var(--card)", width: 220,
  };

  return (
    <>
      {/* 汇总卡片 */}
      {s && canAmount && (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginBottom: 14 }}>
          <Kpi label="中标项目" value={s.total} unit="个" foot={`直接 ${s.directCount} / 代中标 ${s.agentCount}`} />
          <Kpi label="合同总额" value={wan(s.contractTotal)} unit="万元" foot="已签合同，未签则取中标金额" />
          <Kpi label="已回款" value={wan(s.receivedTotal)} unit="万元"
               foot={`回款率 ${s.contractTotal ? Math.round((s.receivedTotal ?? 0) / s.contractTotal * 100) : 0}%`} tone="o" />
          <Kpi label="过单费已付" value={wan(s.feePaid)} unit="万元" foot="全部协议已付合计" tone="o" />
          <Kpi label="过单费未付" value={wan(s.feeUnpaid)} unit="万元"
               foot={`应付合计 ${wan(s.feeTotal)} 万`} tone={(s.feeUnpaid ?? 0) > 0 ? "b" : ""} />
        </div>
      )}

      {/* 筛选条 */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {([
          ["all", "全部中标", counts.all],
          ["direct", "直接中标", counts.direct],
          ["agent", "代中标", counts.agent],
        ] as const).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            style={{
              padding: "6px 13px", fontSize: 12.5, borderRadius: 8, cursor: "pointer",
              border: `1px solid ${mode === k ? "var(--pri)" : "var(--line)"}`,
              background: mode === k ? "var(--pri-weak)" : "var(--card)",
              color: mode === k ? "var(--pri-2)" : "var(--sub)",
              fontWeight: mode === k ? 700 : 400,
            }}
          >
            {label} {n}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <NewAgentButton won={won} />
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(); }}
          placeholder="搜索项目 / 编号 / 客户 / 中标公司"
          style={inputStyle}
        />
        <button className="btn btn-sm" onClick={load}>搜索</button>
      </div>

      {/* 两种模式的说明 */}
      <div className="notice pri" style={{ marginBottom: 14 }}>
        <div>
          <b>直接中标</b>：我方独立投标并中标，无过单费，按标准流程执行。
          <br />
          <b>代中标</b>：通过合作公司名义投标并中标，需结算过单费。过单费有两种方式——
          <b style={{ display: "inline" }}>差价法</b>（客户合同额 − 中标公司开票额，差额留存）、
          <b style={{ display: "inline" }}>现金法</b>（按费率现金支付，需凭证三件套）。
        </div>
      </div>

      {/* 直接中标列表。代中标只在下方过单费明细里出现，避免同一项目列两遍 */}
      {(() => {
        const directList = list.filter((x) => x.mode !== "agent");
        if (loading) {
          return <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>加载中…</div>;
        }
        if (directList.length === 0) return null;
        return (
      <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>项目 / 编号</th>
                  <th>客户</th>
                  <th>中标方式</th>
                  {canAmount && <th>合同额</th>}
                  {canAmount && <th>已回款</th>}
                  {canAmount && <th>毛利</th>}
                  <th>过单费</th>
                  <th>阶段</th>
                  <th>负责人</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {directList.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: "normal", minWidth: 200, maxWidth: 300 }}>
                      <b>{a.name}</b>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        {a.code}
                        {a.bid_code ? ` · ${a.bid_code}` : ""}
                      </div>
                    </td>
                    <td>{a.customer_name ?? "—"}</td>
                    <td>
                      {a.mode === "agent" ? (
                        <span className="badge b-vio">代中标</span>
                      ) : (
                        <span className="badge b-ok">直接中标</span>
                      )}
                    </td>
                    {canAmount && <td className="num">{wan(a.contractTotal)} 万</td>}
                    {canAmount && (
                      <td className="num">
                        {wan(a.receivedTotal)} 万
                        {a.contractTotal ? (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {Math.round((a.receivedTotal ?? 0) / a.contractTotal * 100)}%
                          </div>
                        ) : null}
                      </td>
                    )}
                    {canAmount && (
                      <td className="num" style={{ color: (a.profit ?? 0) >= 0 ? "var(--ok)" : "var(--bad)", fontWeight: 600 }}>
                        {wan(a.profit)} 万
                        {a.profitRate !== undefined && (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{a.profitRate.toFixed(1)}%</div>
                        )}
                      </td>
                    )}
                    <td>
                      {a.mode === "agent" && a.agent ? (
                        <div style={{ fontSize: 12 }}>
                          <div style={{ color: "var(--violet)", fontWeight: 600 }}>
                            {canAmount ? `${wan(a.fee)} 万` : "已登记"}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            {a.agent.feeMethod === "diff" ? "差价法" : "现金法"}
                            {a.agent.partyType === "individual" ? " · 个人" : ""}
                          </div>
                          {canAmount && (a.unpaid ?? 0) > 0 && (
                            <div style={{ fontSize: 11, color: "var(--bad)" }}>
                              未付 {wan(a.unpaid)} 万
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td><span className="badge b-gray">{a.stage}</span></td>
                    <td>{a.owner_name ?? "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        <Link href={`/projects/${a.id}`} className="btn btn-sm">详情</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </div>
        );
      })()}

      {/* 代中标明细区 */}
      {canAmount && list.some((x) => x.mode === "agent" && x.agent) && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-h">
            <h3>代中标项目过单费明细</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {list.filter((x) => x.mode === "agent" && x.agent).length} 个项目
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>项目</th><th>中标公司/个人</th><th>结算方式</th>
                  <th>客户合同额</th><th>开票额</th><th>过单费</th>
                  <th>已付</th><th>未付</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.filter((x) => x.mode === "agent" && x.agent).map((a) => (
                  <tr key={`ag-${a.id}`} style={(a.unpaid ?? 0) > 0 ? { background: "var(--bad-weak)" } : undefined}>
                    <td style={{ whiteSpace: "normal", minWidth: 160 }}>
                      <b>{a.name}</b>
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.code}</div>
                    </td>
                    <td style={{ whiteSpace: "normal", maxWidth: 200 }}>
                      {a.agent!.party}
                      {a.agent!.partyType === "individual" && (
                        <span className="badge b-warn" style={{ marginLeft: 5 }}>个人</span>
                      )}
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>{a.agent!.code}</div>
                    </td>
                    <td>
                      <span className={"badge " + (a.agent!.feeMethod === "diff" ? "b-pri" : "b-vio")}>
                        {a.agent!.feeMethod === "diff" ? "差价法" : "现金+全额发票"}
                      </span>
                    </td>
                    <td className="num">{wan(a.agreedAmount)} 万</td>
                    <td className="num">{wan(a.invoicedAmount)} 万</td>
                    <td className="num" style={{ color: "var(--violet)", fontWeight: 600 }}>{wan(a.fee)} 万</td>
                    <td className="num" style={{ color: "var(--ok)" }}>{wan(a.feePaid)} 万</td>
                    <td className="num" style={{ color: (a.unpaid ?? 0) > 0 ? "var(--bad)" : undefined }}>
                      {wan(a.unpaid)} 万
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        {(a.unpaid ?? 0) > 0 && a.agent ? (
                          <PayFeeButton
                            agreementId={a.agent.id}
                            label="支付"
                            unpaidWan={(a.unpaid ?? 0) / W}
                            partyType={a.agent.partyType}
                            onDone={() => load()}
                          />
                        ) : null}
                        {a.agent ? (
                          <RowActions
                            id={a.agent.id}
                            label="代中标协议"
                            apiPath="/api/agent"
                            deleteHint="有付款记录的协议不能删除。"
                            editTitle="修改代中标协议（自动重新核算）"
                            onDone={() => load()}
                            editFields={[
                              { key: "agreementWith", label: "中标公司/个人", colSpan: 2,
                                defaultValue: a.agent.party },
                              { key: "partyType", label: "对方类型", type: "select",
                                defaultValue: a.agent.partyType,
                                options: [
                                  { value: "company", label: "公司" },
                                  { value: "individual", label: "个人" },
                                ] },
                              { key: "feeMethod", label: "结算方式", type: "select",
                                defaultValue: a.agent.feeMethod,
                                options: [
                                  { value: "diff", label: "差价法" },
                                  { value: "cash", label: "现金法" },
                                ] },
                              { key: "customerAmountWan", label: "客户合同额（万元）", type: "number",
                                defaultValue: (a.contractTotal ?? 0) / W },
                              { key: "feeRate", label: "过单费率（%）", type: "number",
                                defaultValue: a.agent.feeMethod === "cash" ? (a.agent.feeRate ?? "") : "",
                                when: (vals) => String(vals.feeMethod) === "cash",
                                hint: "只用于现金法。填写后自动算出开票额：客户合同额 × (1 − 费率/100)" },
                              { key: "invoicedAmountWan", label: "开票额（万元）", type: "number",
                                defaultValue: (a.invoicedAmount ?? 0) / W,
                                hint: "差价法请手填；现金法填写费率后自动带出，仍可手改" },
                            ]}
                            onFieldChange={(key, value, vals) => {
                              const patch: Record<string, string | boolean> = {};
                              if (key === "feeMethod" && value !== "cash") patch.feeRate = "";
                              const next = { ...vals, ...patch };
                              if (String(next.feeMethod) !== "cash") return Object.keys(patch).length ? patch : undefined;
                              if (key !== "feeRate" && key !== "customerAmountWan" && key !== "feeMethod") {
                                return Object.keys(patch).length ? patch : undefined;
                              }
                              const invoiced = invoicedWanFromFeeRate(next.customerAmountWan, next.feeRate);
                              if (invoiced != null) patch.invoicedAmountWan = String(invoiced);
                              return Object.keys(patch).length ? patch : undefined;
                            }}
                          />
                        ) : null}
                        <Link href={`/projects/${a.id}`} className="btn btn-sm">核算</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, unit, foot, tone }: {
  label: string; value: string | number; unit: string; foot: string; tone?: "" | "w" | "b" | "o" | "v";
}) {
  return (
    <div className={"kpi " + (tone ?? "")}>
      <div className="lb">{label}</div>
      <div className="vl">
        {value}
        <small>{unit}</small>
      </div>
      <div className="ft">{foot}</div>
    </div>
  );
}
