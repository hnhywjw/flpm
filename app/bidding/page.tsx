import { listBids, getRiskParticipants, getBidParticipants } from "@/lib/queries";
import { fenToWan, daysFromNow } from "@/lib/domain";
import { Badge, Bar, PageHeader, Kpi } from "@/components/ui";
import { NewBidButton } from "./NewBidButton";
import { BidProjectCard } from "./BidProjectCard";
import { getCurrentUser } from "@/lib/auth";
import { bidScopeFilter } from "@/lib/scope";
import { guardPage } from "@/lib/page-guard";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 投标管理
 *
 * ★ 结构改版说明
 *
 * 原来是「一张大表格 + 页面最底部只显示一个 focus 项目的参与方」。
 * 问题：
 *   1. 参与方只能看一个项目，想看别的项目得靠 focus 逻辑猜
 *   2. 招标文件和各投标人的投标文件混在同一个 bid 附件里
 *   3. 参与方信息在页面底部，和上面的项目表格断开，要来回滚动
 *
 * 现在改成「招标项目 → 展开 → 参与方」两层：
 *   每个项目一行，点开就展开该项目的完整信息：
 *     · 招标文件（项目级，所有参与方共用）
 *     · 投标参与方列表，每家带自己的投标文件
 *     · 投标任务分解
 *
 * 一次只展开一个，避免页面过长；默认展开有风险或临期的那个。
 */
export default async function BiddingPage() {
  await guardPage("bidding");
  const user = await getCurrentUser();
  const bids = user ? listBids(bidScopeFilter(user)) : listBids();
  const risks = getRiskParticipants();
  const inFlight = bids.filter((b) => b.result === "待开标");
  const year = String(new Date().getFullYear());
  const participants = bids.length
    ? all<{ bond_cents: number | null; result: string | null; won_at: string | null }>(
        "SELECT bp.bond_cents, bp.result, COALESCE(b.open_date, b.deadline, b.created_at) AS won_at " +
        "FROM bid_participants bp JOIN bids b ON b.id = bp.bid_id " +
        "WHERE bp.bid_id IN (" + bids.map(() => "?").join(",") + ")",
        bids.map((b) => b.id),
      )
    : [];
  const bondUsed = participants.reduce((s, p) => s + (p.bond_cents ?? 0), 0);
  const lostCount = participants.filter((p) => p.result === "废标" || p.result === "未中标").length;
  const wonThisYear = participants.filter((p) => p.result === "中标" && String(p.won_at ?? "").startsWith(year)).length;

  // 每个项目的参与方数量（一次查完，避免 N+1）
  const partCounts = new Map<number, number>();
  if (bids.length > 0) {
    const ph = bids.map(() => "?").join(",");
    const rows = all<{ bid_id: number; n: number }>(
      `SELECT bid_id, COUNT(*) AS n FROM bid_participants
       WHERE bid_id IN (${ph}) GROUP BY bid_id`,
      bids.map((b) => b.id)
    );
    for (const r of rows) partCounts.set(r.bid_id, r.n);
  }

  const riskByBid = new Map<number, number>();
  for (const r of risks) {
    riskByBid.set(r.bid_id, (riskByBid.get(r.bid_id) ?? 0) + 1);
  }

  // 默认展开：优先带关联风险的，其次 7 天内截止的，再其次第一个在途项目
  const defaultOpenId =
    inFlight.find((b) => (riskByBid.get(b.id) ?? 0) > 0)?.id ??
    inFlight.find((b) => {
      const d = daysFromNow(b.deadline);
      return d >= 0 && d <= 7;
    })?.id ??
    inFlight[0]?.id;

  // 为保证点开时数据是实的，服务端预先取好（页面最多几十个投标，代价可控）
  //
  // 注：项目级任务（getBidTasks）不再在这里取 ——
  // 已并入参与方「任务进度」弹窗，由 /api/bids/participants/tasks 按需返回。
  const detail = new Map<number, ReturnType<typeof getBidParticipants>>();
  for (const b of bids) {
    detail.set(b.id, getBidParticipants(b.id));
  }

  const upcoming = inFlight.filter((b) => {
    const d = daysFromNow(b.deadline);
    return d >= 0 && d <= 7;
  }).length;

  return (
    <>
      <PageHeader
        title="投标管理"
        desc={`在途 ${inFlight.length} 个 · 保证金占用 ${fenToWan(bondUsed)} 万元 · 关联风险 ${risks.length} 项`}
        right={
          <>
            <button className="btn">导出</button>
            <NewBidButton />
          </>
        }
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="在途投标" value={inFlight.length} unit="个"
             foot={`${upcoming} 个 7 天内截止`} tone="w" />
        <Kpi label="保证金占用" value={fenToWan(bondUsed)} unit="万元" foot="全部参与方保证金合计" />
        <Kpi label="本年中标" value={wonThisYear} unit="家"
             foot="今年开标的参与方" tone="o" />
        <Kpi label="废标/未中标" value={lostCount} unit="家"
             foot="全部参与方" tone="b" />
      </div>

      <div className="notice pri" style={{ marginTop: 14 }}>
        <div>
          <b>参与方留痕与合规</b>
          系统只记录每家参与方的名称、报价、关联关系标注与时间，用于事后审计与风险提示；
          不提供报价协调、陪标编排等功能。发现关联关系异常时提示核查，由合规负责人判定是否继续参与。
        </div>
      </div>

      {/* 关联风险汇总 */}
      {risks.length > 0 && (
        <div className="notice danger" style={{ marginTop: 12 }}>
          <div>
            <b>发现 {risks.length} 项关联关系需要核查</b>
            {risks.slice(0, 5).map((r) => (
              <div key={r.id} style={{ marginTop: 4 }}>
                · {r.bid_code} {r.bid_name} —「{r.company_name}」：{r.risk_note ?? "未填写说明"}
              </div>
            ))}
            {risks.length > 5 && <div>…还有 {risks.length - 5} 项</div>}
          </div>
        </div>
      )}

      {/* 招标项目列表（可展开） */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h3>招标项目</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            点击项目展开：招标文件 · 投标参与方 · 投标任务
          </span>
        </div>
        <div style={{ padding: 14 }}>
          {bids.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              暂无招标项目
            </div>
          ) : (
            bids.map((b) => {
              const d = detail.get(b.id);
              return (
                <BidProjectCard
                  key={b.id}
                  bid={{
                    id: b.id,
                    code: b.code,
                    name: b.name,
                    budget_cents: b.budget_cents,
                    bond_cents: b.bond_cents,
                    bond_status: b.bond_status,
                    deadline: b.deadline,
                    phase: b.phase,
                    result: b.result,
                    owner_name: b.owner_name,
                    owner_id: b.owner_id,
                    mode: b.mode,
                    daysLeft: daysFromNow(b.deadline),
                    // P0 / P1 新增字段
                    open_date: b.open_date,
                    bond_paid_date: b.bond_paid_date,
                    customer_name: b.customer_name,
                    bid_no: b.bid_no,
                    agent_company: b.agent_company,
                    bid_method: b.bid_method,
                    bid_open_place: b.bid_open_place,
                    site_visit_date: b.site_visit_date,
                    qa_deadline: b.qa_deadline,
                    doc_price_cents: b.doc_price_cents,
                    project_id: b.project_id,
                    project_code: b.project_code,
                    project_name: b.project_name,
                  }}
                  participants={d ?? []}
                  riskCount={riskByBid.get(b.id) ?? 0}
                  defaultOpen={b.id === defaultOpenId}
                />
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
