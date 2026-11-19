import { NextRequest } from "next/server";
import { run, one, all, audit } from "@/lib/db";
import { canAdvanceToInvoice } from "@/lib/queries";
import { withRole } from "@/lib/api-guard";
import type { NodeStatus } from "@/lib/domain";
import { NODE_TO_STAGE, calcProjectProgress } from "@/lib/domain";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withRole(["pm", "boss", "sales"], async (user) => {
    const body = await req.json();
    const {
      nodeId, action, actualDate, note,
      winNoticeNo, winAmountWan, winDate, implPlan, progressNote,
    } = body;

    const node = one<{
      id: number; project_id: number; node_key: string; seq: number;
      is_parallel: number; status: NodeStatus; plan_date: string | null;
    }>("SELECT * FROM project_nodes WHERE id = ?", [nodeId]);

    if (!node) throw new Error("节点不存在");

    if (action === "advance") {
      const nextNode = one<{ node_key: string }>(
        "SELECT node_key FROM project_nodes WHERE project_id = ? AND seq > ? AND is_parallel = 0 ORDER BY seq LIMIT 1",
        [node.project_id, node.seq]
      );
      if (node.node_key === "验收" && nextNode?.node_key === "开票") {
        const check = canAdvanceToInvoice(node.project_id);
        if (!check.ok) {
          throw new Error(
            `验收资料未齐备（${check.done}/4），缺少：${check.missing.join("、")}，不允许推进到开票`
          );
        }
      }

      if (!actualDate) throw new Error("必须填写实际完成日期");

      run(
        `UPDATE project_nodes SET
           status = 'done', actual_date = ?, note = COALESCE(?, note),
           win_notice_no = COALESCE(?, win_notice_no),
           win_amount_cents = COALESCE(?, win_amount_cents),
           win_date = COALESCE(?, win_date),
           impl_plan = COALESCE(?, impl_plan),
           progress_note = COALESCE(?, progress_note),
           updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [
          actualDate, note ?? null,
          winNoticeNo ?? null,
          winAmountWan !== undefined && winAmountWan !== ""
            ? Math.round(Number(winAmountWan) * 10000) : null,
          winDate ?? null,
          implPlan ?? null,
          progressNote ?? null,
          nodeId,
        ]
      );

      const next = one<{ id: number }>(
        "SELECT id FROM project_nodes WHERE project_id = ? AND seq > ? AND is_parallel = 0 AND status = 'next' ORDER BY seq LIMIT 1",
        [node.project_id, node.seq]
      );
      if (next) run("UPDATE project_nodes SET status = 'cur' WHERE id = ?", [next.id]);

      // 自动同步项目阶段与进度（避免「投标阶段显示 80% 进度」这类矛盾）
      // 必须 ORDER BY seq：下面要取「最后一个已完成主线节点」决定阶段，
      // 不排序的话数据库返回顺序不保证，阶段会跳错
      const nodeList = all<{
        node_key: string; status: string; is_parallel: number;
      }>(
        "SELECT node_key, status, is_parallel FROM project_nodes WHERE project_id = ? ORDER BY seq",
        [node.project_id]
      );

      const newProgress = calcProjectProgress(nodeList);
      const newStage = NODE_TO_STAGE[node.node_key] ?? null;

      // 完成的最后一个主线节点决定阶段
      const doneMain = nodeList
        .filter((n) => n.is_parallel === 0 && (n.status === "done" || n.status === "skip"))
        .map((n) => NODE_TO_STAGE[n.node_key])
        .filter(Boolean);
      const stageCandidate = doneMain.length > 0 ? doneMain[doneMain.length - 1] : newStage;

      run(
        `UPDATE projects SET progress = ?, stage = COALESCE(?, stage),
           updated_at = datetime('now','localtime') WHERE id = ?`,
        [newProgress, stageCandidate, node.project_id]
      );

      // 推进到「质保金」节点时，自动创建质保记录
      let warrantyCreated = false;
      if (node.node_key === "质保金") {
        const exists = one<{ id: number }>(
          "SELECT id FROM warranties WHERE project_id = ?", [node.project_id]
        );
        if (!exists) {
          const proj = one<{ code: string; name: string }>(
            "SELECT code, name FROM projects WHERE id = ?", [node.project_id]
          );
          // 取该项目的客户合同质保期（月），默认 12
          const months = one<{ m: number | null }>(
            `SELECT MAX(warranty_months) AS m FROM contracts
             WHERE project_id = ? AND type = 'customer' AND deleted_at IS NULL`,
            [node.project_id]
          )?.m ?? 12;

          const startDate = actualDate || todayLocal();
          const end = new Date(startDate + "T00:00:00");
          end.setMonth(end.getMonth() + Number(months || 12));

          const year = new Date().getFullYear();
          const seqRow = one<{ seq: number }>(
            "SELECT seq FROM code_sequences WHERE prefix='QB' AND year=?", [year]
          );
          const seq = (seqRow?.seq ?? 0) + 1;
          if (seqRow) run("UPDATE code_sequences SET seq=? WHERE prefix='QB' AND year=?", [seq, year]);
          else run("INSERT INTO code_sequences (prefix,year,seq) VALUES ('QB',?,?)", [year, seq]);
          const wcode = `QB${year}-${String(seq).padStart(4, "0")}`;

          // 质保金金额取该项目的质保金期次
          const bond = one<{ s: number | null }>(
            `SELECT SUM(amount_cents) AS s FROM payment_terms t
             JOIN contracts c ON c.id = t.contract_id
             WHERE c.project_id = ? AND t.term_type = 'warranty' AND t.deleted_at IS NULL`,
            [node.project_id]
          )?.s ?? 0;

          run(
            `INSERT INTO warranties (code, project_id, start_date, end_date, bond_cents, bond_status, note)
             VALUES (?, ?, ?, ?, ?, '待收回', ?)`,
            [
              wcode, node.project_id, startDate,
              todayLocal(undefined, end),
              bond, `质保 ${months} 个月，推进质保金节点时自动创建`,
            ]
          );
          warrantyCreated = true;
        }
      }

      audit({
        userId: user.id, userName: user.name, action: "advance",
        entityType: "project_node", entityId: nodeId,
        summary: `推进节点「${node.node_key}」，实际完成 ${actualDate}；项目进度更新为 ${newProgress}%` +
                 (warrantyCreated ? "；已自动创建质保记录" : ""),
      });

      return { ok: true, progress: newProgress, stage: stageCandidate };
    }

    if (action === "update") {
      run(
        `UPDATE project_nodes SET
           note = COALESCE(?, note),
           plan_date = COALESCE(?, plan_date),
           win_notice_no = COALESCE(?, win_notice_no),
           win_amount_cents = COALESCE(?, win_amount_cents),
           win_date = COALESCE(?, win_date),
           impl_plan = COALESCE(?, impl_plan),
           progress_note = COALESCE(?, progress_note),
           updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [
          note ?? null, actualDate ?? null,
          winNoticeNo ?? null,
          winAmountWan !== undefined && winAmountWan !== ""
            ? Math.round(Number(winAmountWan) * 10000) : null,
          winDate ?? null,
          implPlan ?? null,
          progressNote ?? null,
          nodeId,
        ]
      );
      return { ok: true };
    }

    throw new Error("未知操作");
  });
}
