import { NextRequest } from "next/server";
import { listBids, getBid, getBidParticipants, getBidTasks, getRiskParticipants } from "@/lib/queries";
import { run, audit } from "@/lib/db";
import { withAuth, withRole } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  return withAuth(async () => {
    if (!id) return { bids: listBids(), risks: getRiskParticipants() };
    const bid = getBid(Number(id));
    if (!bid) throw new Error("投标不存在");
    return {
      bid,
      participants: getBidParticipants(Number(id)),
      tasks: getBidTasks(Number(id)),
    };
  });
}

/** 标注关联关系：商务/法务/总经理 */
export async function PATCH(req: NextRequest) {
  return withRole(["sales", "boss"], async (user) => {
    const { participantId, relation, riskNote } = await req.json();
    if (!participantId || !relation) throw new Error("缺少参数");

    const ALLOWED = ["本方", "未知", "已核查无关联", "关联风险"];
    if (!ALLOWED.includes(relation))
      throw new Error(`relation 必须为：${ALLOWED.join(" / ")}`);
    if (relation === "关联风险" && !riskNote)
      throw new Error("标注关联风险必须填写具体说明");

    run(
      "UPDATE bid_participants SET relation = ?, risk_note = ?, checked_by = ?, checked_at = datetime('now','localtime') WHERE id = ?",
      [relation, riskNote ?? null, user.id, participantId]
    );

    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: "bid_participant", entityId: participantId,
      field: "relation", newValue: relation,
      summary: `标注参与方关联关系为「${relation}」${riskNote ? "：" + riskNote : ""}`,
    });

    return { ok: true };
  });
}
