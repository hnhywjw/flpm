import { one, run, audit } from "./db";
import { NODE_CHAIN } from "./domain";

/**
 * 参与方标成「中标」后，投标必须挂上项目，中标管理才能带出关联项目。
 * 已有 project_id 则直接返回，不重复建。
 */
export function ensureProjectForWonBid(
  bidId: number,
  user: { id: number; name: string },
): { projectId: number; projectCode: string } | null {
  const bid = one<{
    id: number; code: string; name: string; customer_id: number | null;
    mode: string; owner_id: number | null; budget_cents: number | null;
    project_id: number | null; bid_no: string | null; deadline: string | null;
  }>(
    `SELECT id, code, name, customer_id, mode, owner_id, budget_cents, project_id, bid_no, deadline
     FROM bids WHERE id = ? AND deleted_at IS NULL`,
    [bidId],
  );
  if (!bid) return null;
  if (bid.project_id) {
    const p = one<{ code: string }>("SELECT code FROM projects WHERE id = ? AND deleted_at IS NULL", [bid.project_id]);
    if (p) return { projectId: bid.project_id, projectCode: p.code };
  }

  const win = one<{ price_cents: number | null }>(
    "SELECT price_cents FROM bid_participants WHERE bid_id = ? AND result = '中标' ORDER BY is_self DESC, id LIMIT 1",
    [bidId],
  );

  let projCode = (bid.bid_no ?? "").trim() || ("P" + bid.code.replace(/^B/, ""));
  let n = 0;
  let tryCode = projCode;
  while (one<{ id: number }>("SELECT id FROM projects WHERE code = ? AND deleted_at IS NULL", [tryCode])) {
    n += 1;
    tryCode = projCode + "-" + n;
    if (n > 20) break;
  }
  projCode = tryCode;

  const info = run(
    `INSERT INTO projects
       (code, name, customer_id, project_type, mode, stage, status, owner_id, budget_cents, plan_due)
     VALUES (?, ?, ?, '系统集成', ?, '实施', '进行中', ?, ?, ?)`,
    [
      projCode, bid.name, bid.customer_id,
      bid.mode === "agent" ? "agent" : "direct",
      bid.owner_id ?? user.id,
      win?.price_cents ?? bid.budget_cents,
      bid.deadline,
    ],
  );
  const projectId = Number(info.lastInsertRowid);
  NODE_CHAIN.forEach((node, i) => {
    run(
      `INSERT INTO project_nodes (project_id, node_key, seq, is_parallel, status, require_files)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, node.key, node.seq, node.isParallel ? 1 : 0, i === 0 ? "cur" : "next",
       node.key === "验收" ? JSON.stringify(["安装配置文档", "到货签收单", "验收报告", "项目资料"]) : null],
    );
  });
  run("UPDATE bids SET project_id = ?, result = '中标' WHERE id = ?", [projectId, bidId]);
  audit({
    userId: user.id, userName: user.name, action: "create",
    entityType: "project", entityId: projectId,
    summary: `参与方中标，自动立项 ${projCode} ${bid.name}`,
  });
  return { projectId, projectCode: projCode };
}
