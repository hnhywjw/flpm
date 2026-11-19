import { guardPage } from "@/lib/page-guard";
import { all } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ensureProjectForWonBid } from "@/lib/ensure-won-project";
import { PageHeader } from "@/components/ui";
import { AwardList } from "./AwardList";

export const dynamic = "force-dynamic";

export default async function AwardsPage() {
  await guardPage("agent");
  const me = await getCurrentUser();
  if (me) {
    const pending = all<{ bid_id: number }>(`
      SELECT DISTINCT bp.bid_id
      FROM bid_participants bp
      JOIN bids b ON b.id = bp.bid_id AND b.deleted_at IS NULL
      WHERE bp.result = '中标' AND b.project_id IS NULL
    `);
    for (const row of pending) ensureProjectForWonBid(row.bid_id, me);
  }
  const won = all<{
    bidId: number; bidCode: string; bidName: string; companyName: string;
    priceWan: number | null; projectId: number | null; projectCode: string | null; mode: string;
  }>(`
    SELECT b.id AS bidId, b.code AS bidCode, b.name AS bidName, b.mode AS mode,
           bp.company_name AS companyName,
           CASE WHEN bp.price_cents IS NULL THEN NULL ELSE bp.price_cents / 10000.0 END AS priceWan,
           b.project_id AS projectId, p.code AS projectCode
    FROM bid_participants bp
    JOIN bids b ON b.id = bp.bid_id AND b.deleted_at IS NULL
    LEFT JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
    WHERE bp.result = '中标'
      AND NOT EXISTS (
        SELECT 1 FROM agent_agreements a
        WHERE a.deleted_at IS NULL AND a.project_id = b.project_id
      )
    ORDER BY b.id DESC, bp.id
  `);
  return (
    <>
      <PageHeader
        title="中标管理"
        desc="所有已中标项目 · 按「直接中标 / 代中标」区分 · 代中标项目含过单费跟踪"
      />
      <AwardList won={won} />
    </>
  );
}
