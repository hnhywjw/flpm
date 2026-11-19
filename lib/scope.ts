import { all } from "./db";
import type { SessionUser } from "./auth";

/**
 * 数据权限（行级）
 *
 * 规则：
 *  - boss / admin / finance：看全部数据
 *  - sales：看自己负责的项目 + 自己发起的投标/合同
 *  - pm：看自己负责的项目
 *  - service：看全部项目（售后需要跨项目查设备），但只看工单
 *  - warehouse：看全部项目（备件领用需要），但只看物资
 */
export type DataScope = "all" | "own" | "dept";

export function getDataScope(user: SessionUser): DataScope {
  const roles = user.roles;
  if (roles.includes("boss") || roles.includes("admin") || roles.includes("finance")) return "all";
  return "own";
}

/** 返回项目 ID 过滤条件（SQL 片段 + 参数） */
export function projectScopeFilter(user: SessionUser): { sql: string; params: unknown[] } {
  const scope = getDataScope(user);
  if (scope === "all") return { sql: "1=1", params: [] };

  // 自己负责的项目 + （若为商务）自己参与的投标关联项目
  if (user.roles.includes("sales")) {
    return {
      sql: `(p.owner_id = ? OR p.id IN (
              SELECT b.project_id FROM bids b WHERE b.owner_id = ? AND b.project_id IS NOT NULL
            ))`,
      params: [user.id, user.id],
    };
  }
  return { sql: "p.owner_id = ?", params: [user.id] };
}

/** 判断用户能否访问某项目 */
export function canAccessProject(user: SessionUser, projectId: number): boolean {
  const scope = getDataScope(user);
  if (scope === "all") return true;

  const filter = projectScopeFilter(user);
  const rows = all<{ id: number }>(
    `SELECT p.id FROM projects p WHERE p.id = ? AND ${filter.sql}`,
    [projectId, ...filter.params]
  );
  return rows.length > 0;
}

/** 投标数据过滤 */
export function bidScopeFilter(user: SessionUser): { sql: string; params: unknown[] } {
  const scope = getDataScope(user);
  if (scope === "all") return { sql: "1=1", params: [] };
  return { sql: "b.owner_id = ?", params: [user.id] };
}

/** 可见性提示文案 */
export function scopeLabel(user: SessionUser): string {
  const scope = getDataScope(user);
  if (scope === "all") return "全部数据";
  if (user.roles.includes("sales")) return "本人负责及参与的项目";
  return "本人负责的项目";
}
