import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProject, getProjectNodes, getProjectTerms, getProjectCustomerContracts,
  getProjectPurchaseContracts, getProjectAcceptances, getProjectInvoices,
  getProjectStockMoves, getAgentAgreementByProject, getAgentPayments,
  canAdvanceToInvoice,
} from "@/lib/queries";
import { fenToWan, INVOICE_MODE_LABEL } from "@/lib/domain";
import { Badge, Bar } from "@/components/ui";
import { NodeFlow } from "./NodeFlow";
import { AcceptancePanel } from "./AcceptancePanel";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { BizFileCard } from "@/components/BizFileCard";
import { guardPage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  await guardPage("projects");
  const { id } = await params;
  const pid = Number(id);
  const project = getProject(pid);
  if (!project) notFound();

  const nodes = getProjectNodes(pid);
  const contracts = getProjectCustomerContracts(pid);
  const purchases = getProjectPurchaseContracts(pid);
  const terms = getProjectTerms(pid);
  const acceptances = getProjectAcceptances(pid);
  const invoices = getProjectInvoices(pid);
  const moves = getProjectStockMoves(pid);
  const agent = getAgentAgreementByProject(pid);
  const agentPayments = agent ? getAgentPayments(agent.id) : [];
  const gate = canAdvanceToInvoice(pid);

  const contractTotal = contracts.reduce((s, c) => s + c.amount_cents, 0);
  const received = terms.reduce((s, t) => s + t.actual_cents, 0);
  const planTotal = terms.reduce((s, t) => s + t.amount_cents, 0);
  const purchaseTotal = purchases.reduce((s, c) => s + c.amount_cents, 0);
  const feeCents = agent?.fee_cents ?? 0;
  const grossProfit = contractTotal - purchaseTotal - feeCents;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href="/projects" className="btn btn-sm">← 返回项目列表</Link>
      </div>

      {/* 头部 */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 19, fontWeight: 700 }}>{project.name}</h2>
          <Badge tone={project.status.includes("逾期") ? "bad" : "ok"}>{project.status}</Badge>
          <Badge tone="pri">{project.stage}</Badge>
          <Badge tone={project.mode === "agent" ? "vio" : "gray"}>
            {project.mode === "agent" ? "代中标" : "直接中标"}
          </Badge>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 9,
                      fontSize: 12.5, color: "var(--sub)" }}>
          <span>编号：<b style={{ color: "var(--text)" }}>{project.code}</b></span>
          <span>客户：<b style={{ color: "var(--text)" }}>{project.customer_name ?? "—"}</b></span>
          <span>类型：<b style={{ color: "var(--text)" }}>{project.project_type ?? "—"}</b></span>
          <span>项目经理：<b style={{ color: "var(--text)" }}>{project.owner_name ?? "—"}</b></span>
          <span>计划完成：<b style={{ color: "var(--text)" }}>{project.plan_due ?? "—"}</b></span>
          {agent && <span>中标公司：<b style={{ color: "var(--text)" }}>{agent.agreement_with}</b></span>}
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 16, paddingTop: 16,
                      borderTop: "1px dashed var(--line)", flexWrap: "wrap" }}>
          <Metric label="客户合同额" value={contractTotal ? fenToWan(contractTotal) : "—"} unit="万"
                  note={`${contracts.length} 份合同`} />
          <Metric label="已回款" value={fenToWan(received)} unit="万"
                  note={`回款率 ${planTotal ? Math.round(received / planTotal * 100) : 0}%`} color="var(--ok)" />
          <Metric label="未回款" value={fenToWan(Math.max(0, planTotal - received))} unit="万"
                  note={`计划 ${fenToWan(planTotal)} 万`} />
          <Metric label="采购成本" value={fenToWan(purchaseTotal)} unit="万"
                  note={`${purchases.length} 份采购合同`} />
          {agent && (
            <Metric label="过单费" value={fenToWan(feeCents)} unit="万"
                    note={agent.fee_method === "diff" ? "差价法" : "现金法"} color="var(--violet)" />
          )}
          <Metric
            label="预计毛利"
            value={contractTotal ? fenToWan(grossProfit) : "—"}
            unit="万"
            note={contractTotal ? `毛利率 ${(grossProfit / contractTotal * 100).toFixed(1)}%` : "—"}
            color="var(--pri)"
          />
          <Metric label="整体进度" value={String(project.progress)} unit="%" note="—" />
        </div>
      </div>

      {/* 节点流 */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h3>流程节点</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            招标 → 投标 → 中标 → 合同 → 实施 → 验收 → 开票 → 回款 → 保证金返还 → 质保金 → 售后
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <NodeFlow nodes={nodes} projectId={pid} gate={gate} />
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10 }}>
            <span style={{ background: "var(--line2)", padding: "1px 6px", borderRadius: 5,
                           fontWeight: 600, marginRight: 6 }}>说明</span>
            蓝色=当前节点，绿色=已完成，红色=超期；
            <span className="badge b-vio" style={{ fontSize: 10, marginLeft: 6 }}>并行</span>
            表示保证金返还与回款可同时进行，不阻塞主线。
            {!gate.ok && (
              <span style={{ color: "var(--bad)", marginLeft: 8 }}>
                验收资料 {gate.done}/4 齐备，未齐备不允许推进到「开票」
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 合同 */}
      <Section title="客户合同" note={`${contracts.length} 份 · 一个项目可有多份合同`}>
        {contracts.length === 0 ? (
          <div style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>
            尚未签订客户合同。中标后在此录入，付款比例将自动生成回款计划。
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>合同编号</th><th>名称</th><th>金额</th><th>签订日期</th>
                <th>付款比例</th><th>质保期</th><th>开票方式</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td className="num">{c.code}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 160 }}>{c.title ?? "—"}</td>
                  <td className="num">{fenToWan(c.amount_cents)} 万</td>
                  <td className="num">{c.sign_date ?? "—"}</td>
                  <td><span style={{ background: "var(--line2)", padding: "1px 6px",
                                     borderRadius: 5, fontSize: 11, fontWeight: 600 }}>
                    {c.pay_summary ?? "—"}
                  </span></td>
                  <td>{c.warranty_months ? c.warranty_months + " 个月" : "—"}</td>
                  <td>
                    <Badge tone={c.invoice_mode === "full" ? "vio" : "ok"}>
                      {INVOICE_MODE_LABEL[c.invoice_mode]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 采购合同 */}
      {purchases.length > 0 && (
        <Section title="采购合同" note={`${purchases.length} 份 · 成本侧`}>
          <table className="tbl">
            <thead>
              <tr><th>合同编号</th><th>供应商</th><th>金额</th><th>签订日期</th><th>付款比例</th><th>状态</th></tr>
            </thead>
            <tbody>
              {purchases.map((c) => (
                <tr key={c.id}>
                  <td className="num">{c.code}</td>
                  <td style={{ whiteSpace: "normal" }}>{c.party_name}</td>
                  <td className="num">{fenToWan(c.amount_cents)} 万</td>
                  <td className="num">{c.sign_date ?? "—"}</td>
                  <td>{c.pay_summary ?? "—"}</td>
                  <td><Badge tone={c.status === "已结算" ? "ok" : "info"}>{c.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* 回款 */}
      <Section title="回款计划与实收" note={`${terms.length} 期 · 按合同条款生成`}>
        <table className="tbl">
          <thead>
            <tr>
              <th>合同</th><th>期次</th><th>比例</th><th>计划金额</th>
              <th>计划日期</th><th>实收</th><th>实收日期</th><th>逾期</th><th>状态</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((t) => (
              <tr key={t.id} style={t.status === "逾期未收" ? { background: "var(--bad-weak)" } : undefined}>
                <td className="num">{t.contract_code}</td>
                <td><b>{t.name}</b></td>
                <td className="num">{t.percent}%</td>
                <td className="num">{fenToWan(t.amount_cents)} 万</td>
                <td className="num">{t.plan_date ?? "—"}</td>
                <td className="num" style={{ color: t.actual_cents >= t.amount_cents ? "var(--ok)" : undefined }}>
                  {fenToWan(t.actual_cents)} 万
                  {t.actual_cents > 0 && t.actual_cents < t.amount_cents && (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {Math.round(t.actual_cents / t.amount_cents * 100)}%
                    </div>
                  )}
                </td>
                <td className="num">{t.actual_date ?? "—"}</td>
                <td>{t.overdue ? <span className="money-out">{t.overdue} 天</span> : "—"}</td>
                <td><Badge tone={
                  t.status === "已回款" ? "ok"
                  : t.status === "逾期未收" ? "bad"
                  : t.status === "部分回款" ? "warn" : "gray"
                }>{t.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* 验收资料 */}
      <Section title="验收四件套" note="四项齐备才允许推进到开票">
        <AcceptancePanel projectId={pid} acceptances={acceptances} gate={gate} />
      </Section>

      {/* 实施方案：单独一格，别让它埋在综合附件里 */}
      <Section title="实施方案" note="实施计划、进度安排、技术方案">
        <div style={{ padding: 16 }}>
          <BizFileCard
            entityType="implementation"
            entityId={pid}
            label="实施方案文档"
            hint="支持 PDF / Word / Excel / 图片，单文件最大 20MB"
          />
        </div>
      </Section>

      {/* 附件资料：其余零散文件 */}
      <Section title="其他附件" note="不属于上面任何专项的补充材料">
        <AttachmentPanel entityType="project" entityId={pid} title="其他附件" />
      </Section>

      {/* 代中标 */}
      {agent && (
        <Section title="代中标 / 过单费" note={agent.fee_method === "diff" ? "差价法" : "现金 + 全额发票"}>
          <div style={{ padding: 16, display: "grid", gap: 20,
                        gridTemplateColumns: "1fr 1fr" }} className="max-lg:!grid-cols-1">
            <div>
              <dl style={{ display: "grid", gridTemplateColumns: "110px 1fr",
                           gap: "9px 12px", fontSize: 13 }}>
                <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>协议编号</dt>
                <dd className="num">{agent.code}</dd>
                <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>对方</dt>
                <dd>
                  <b>{agent.agreement_with}</b>{" "}
                  <Badge tone={agent.party_type === "individual" ? "warn" : "gray"}>
                    {agent.party_type === "individual" ? "个人（不开票）" : "公司"}
                  </Badge>
                </dd>
                <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>结算方式</dt>
                <dd><Badge tone={agent.fee_method === "diff" ? "pri" : "vio"}>
                  {agent.fee_method === "diff" ? "差价法" : "现金 + 全额发票"}
                </Badge></dd>
                <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>客户合同额</dt>
                <dd className="num">{fenToWan(agent.customer_amount_cents)} 万</dd>
                <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>开票额</dt>
                <dd className="num">{fenToWan(agent.invoiced_amount_cents)} 万</dd>
                <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>过单费</dt>
                <dd className="num"><b style={{ color: "var(--pri)", fontSize: 15 }}>
                  {fenToWan(agent.fee_cents)} 万
                </b></dd>
                <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>已付 / 未付</dt>
                <dd className="num">
                  <span className="money-in">{fenToWan(agent.paid_cents ?? 0)}</span> /{" "}
                  <span className={(agent.unpaid_cents ?? 0) > 0 ? "money-out" : ""}>
                    {fenToWan(agent.unpaid_cents ?? 0)}
                  </span> 万
                </dd>
                <dt style={{ color: "var(--muted)", fontSize: 12.5 }}>状态</dt>
                <dd><Badge tone={agent.status === "已结清" ? "ok" : "warn"}>{agent.status}</Badge></dd>
              </dl>
            </div>

            <div>
              <div className="calc">
                <div className="row"><span>核算公式</span><b>{agent.fee_method === "diff" ? "客户合同额 − 开票额" : "客户合同额 × 费率"}</b></div>
                <div className="row"><span>=</span><b style={{ color: "var(--pri)" }}>{agent.fee_formula}</b></div>
              </div>

              {agent.party_type === "individual" && (
                <div className="notice danger" style={{ marginTop: 12 }}>
                  <div>
                    <b>个人收款 · 对方不开票</b>
                    付款凭证是唯一凭据，必须三件套齐备：代中标协议、付款凭证、收款确认单。
                    系统在登记付款时强制校验，缺一不可。
                  </div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>
                  付款记录
                </div>
                {agentPayments.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--muted)" }}>暂无付款记录</div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr><th>日期</th><th>金额</th><th>收款人</th><th>凭证</th><th>三件套</th></tr>
                    </thead>
                    <tbody>
                      {agentPayments.map((p) => (
                        <tr key={p.id}>
                          <td className="num">{p.pay_date ?? "—"}</td>
                          <td className="num">{fenToWan(p.amount_cents)} 万</td>
                          <td>{p.payee_name ?? "—"}{p.payee_id_tail ? ` (${p.payee_id_tail})` : ""}</td>
                          <td className="num" style={{ fontSize: 11.5 }}>{p.voucher_no ?? "—"}</td>
                          <td>
                            <Badge tone={p.docs_complete ? "ok" : "bad"}>
                              {p.docs_complete ? "3/3 齐备" : "不齐"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* 物资 */}
      {moves.length > 0 && (
        <Section title="物资领用" note={`${moves.length} 条`}>
          <table className="tbl">
            <thead>
              <tr><th>单号</th><th>物料</th><th>数量</th><th>类型</th><th>日期</th><th>经办</th></tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className="num">{m.code}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    {m.item_name}
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{m.sku}</div>
                  </td>
                  <td className="num">{m.qty}</td>
                  <td><Badge tone={m.direction === "in" ? "ok" : "pri"}>
                    {m.direction === "in" ? "入库" : "出库"}
                  </Badge></td>
                  <td className="num">{m.move_date ?? "—"}</td>
                  <td>{m.operator_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* 发票 */}
      {invoices.length > 0 && (
        <Section title="开票记录" note={`${invoices.length} 张`}>
          <table className="tbl">
            <thead>
              <tr><th>发票号</th><th>金额</th><th>税率</th><th>依据</th><th>开票日期</th><th>状态</th></tr>
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
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}

function Metric({ label, value, unit, note, color }: {
  label: string; value: string; unit: string; note: string; color?: string;
}) {
  return (
    <div style={{ minWidth: 100 }}>
      <span style={{ fontSize: 11.5, color: "var(--muted)", display: "block" }}>{label}</span>
      <b className="num" style={{ fontSize: 16, display: "block", marginTop: 3, color }}>
        {value}<span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)", marginLeft: 2 }}>{unit}</span>
      </b>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>
    </div>
  );
}

function Section({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <h3>{title}</h3>
        {note && <span style={{ fontSize: 12, color: "var(--muted)" }}>{note}</span>}
      </div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}
