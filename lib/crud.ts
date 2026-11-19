import { one, run, all, audit } from "./db";
import { AuthError, type SessionUser } from "./auth";

/**
 * 通用编辑 / 删除
 * 统一处理：存在性校验 → 权限校验 → 业务约束 → 软删除 → 审计留痕
 */

/** 检查表是否有某列（结果缓存） */
const columnCache = new Map<string, boolean>();
export function tableHasColumn(table: string, column: string): boolean {
  const key = table + "." + column;
  const hit = columnCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const rows = all<{ name: string }>(`PRAGMA table_info(${table})`);
    const exists = rows.some((r) => r.name === column);
    columnCache.set(key, exists);
    return exists;
  } catch {
    columnCache.set(key, false);
    return false;
  }
}

/** 可删除权限：默认只有 boss / admin 可删，业务模块可放宽 */
export function canDelete(user: SessionUser, allowRoles: string[] = []): boolean {
  if (user.roles.includes("boss") || user.roles.includes("admin")) return true;
  return allowRoles.some((r) => user.roles.includes(r));
}

/** 删除前的引用检查：返回阻止原因 */
export type RefCheck = {
  table: string;
  field: string;
  label: string;
  /** 允许级联删除（同时软删子记录） */
  cascade?: boolean;
};

export interface DeleteOptions {
  table: string;
  id: number;
  user: SessionUser;
  /** 业务名称，用于日志 */
  label: string;
  /** 显示名（查日志用） */
  displayName?: string;
  /** 允许删除的角色（boss/admin 总是允许） */
  allowRoles?: string[];
  /** 引用检查：若有未删除的关联数据则拒绝 */
  refs?: RefCheck[];
  /** 允许删除的前置条件校验，返回错误信息则拒绝 */
  guard?: () => string | null;
}

export function softDelete(opts: DeleteOptions) {
  const { table, id, user, label } = opts;

  if (!canDelete(user, opts.allowRoles)) {
    throw new AuthError(`无权限删除${label}（需要总经理或系统管理员）`, 403);
  }

  const row = one<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id]
  );
  if (!row) throw new Error(`${label}不存在或已删除`);

  // 业务前置校验
  if (opts.guard) {
    const err = opts.guard();
    if (err) throw new Error(err);
  }

  // 引用检查（子表可能没有软删除列，需自动识别）
  if (opts.refs) {
    for (const ref of opts.refs) {
      const hasSoftDelete = tableHasColumn(ref.table, "deleted_at");
      const where = hasSoftDelete
        ? `${ref.field} = ? AND deleted_at IS NULL`
        : `${ref.field} = ?`;

      const cnt = one<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${ref.table} WHERE ${where}`,
        [id]
      )?.c ?? 0;

      if (cnt > 0 && !ref.cascade) {
        throw new Error(`该${label}下还有 ${cnt} 条${ref.label}，请先处理后再删除`);
      }
      if (cnt > 0 && ref.cascade) {
        if (hasSoftDelete) {
          run(
            `UPDATE ${ref.table} SET deleted_at = datetime('now','localtime'), deleted_by = ? WHERE ${ref.field} = ? AND deleted_at IS NULL`,
            [user.id, id]
          );
        } else {
          // 无软删除列的子表（如 project_nodes）直接物理删除
          run(`DELETE FROM ${ref.table} WHERE ${ref.field} = ?`, [id]);
        }
      }
    }
  }

  run(
    `UPDATE ${table} SET deleted_at = datetime('now','localtime'), deleted_by = ? WHERE id = ?`,
    [user.id, id]
  );

  audit({
    userId: user.id, userName: user.name, action: "delete",
    entityType: table, entityId: id,
    summary: `删除${label}${opts.displayName ? "：" + opts.displayName : ""}`,
  });

  return { ok: true };
}

// ---------------- 编辑 ----------------

export interface UpdateOptions {
  table: string;
  id: number;
  user: SessionUser;
  label: string;
  /** 允许修改的字段白名单（防注入） */
  fields: Record<string, { value: unknown; type?: "number" | "string" | "date" | "bool" }>;
  allowRoles?: string[];
  /** 业务校验 */
  guard?: (before: Record<string, unknown>, after: Record<string, unknown>) => string | null;
  /** 不在软删除范围内的表 */
  skipDeletedCheck?: boolean;
  /** 客户端提交的版本号；提供时启用乐观锁 */
  expectedVersion?: number;
}

export function updateRecord(opts: UpdateOptions) {
  const { table, id, user, label } = opts;

  if (opts.allowRoles && opts.allowRoles.length > 0 && !canDelete(user, opts.allowRoles)) {
    throw new AuthError(`无权限修改${label}`, 403);
  }

  const where = opts.skipDeletedCheck
    ? `SELECT * FROM ${table} WHERE id = ?`
    : `SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`;
  const before = one<Record<string, unknown>>(where, [id]);
  if (!before) throw new Error(`${label}不存在或已删除`);

  // 组装更新
  const sets: string[] = [];
  const params: unknown[] = [];
  const changes: string[] = [];

  for (const [key, cfg] of Object.entries(opts.fields)) {
    // 前端只传部分字段时，未提供的字段会是 undefined，直接跳过
    if (!cfg || typeof cfg !== "object" || !("value" in cfg)) continue;
    if (cfg.value === undefined) continue;

    let v = cfg.value;
    if (cfg.type === "number" && v !== null && v !== undefined && v !== "") {
      const n = Number(v);
      if (Number.isNaN(n)) throw new Error(`字段「${key}」必须为数字`);
      v = n;
    }
    if (cfg.type === "bool") v = v ? 1 : 0;
    if (v === undefined || v === null || v === "") v = null;

    sets.push(`${key} = ?`);
    params.push(v);

    const oldV = before[key];
    if (String(oldV ?? "") !== String(v ?? "")) {
      changes.push(key + ": " + (oldV ?? "—") + " → " + (v ?? "—"));
    }
  }

  if (sets.length === 0) throw new Error("没有需要更新的字段");

  // 乐观锁：表有 version 列且客户端带了版本号时校验
  const hasVersion = tableHasColumn(table, "version");
  if (hasVersion && opts.expectedVersion !== undefined) {
    const cur = Number(before.version ?? 1);
    if (cur !== Number(opts.expectedVersion)) {
      throw new Error(
        `该记录已被他人修改（当前版本 ${cur}，你编辑的是 ${opts.expectedVersion}）。` +
        `请刷新页面后重新编辑，避免覆盖他人改动。`
      );
    }
    sets.push("version = version + 1");
  } else if (hasVersion) {
    sets.push("version = version + 1");
  }

  // 业务校验：after 使用与写入完全一致的值（含单位换算）
  if (opts.guard) {
    const after: Record<string, unknown> = { ...before };
    for (const [k, cfg] of Object.entries(opts.fields)) {
      if (!cfg || typeof cfg !== "object" || !("value" in cfg)) continue;
      if (cfg.value === undefined) continue;
      after[k] = cfg.type === "bool" ? (cfg.value ? 1 : 0) : cfg.value;
    }
    const err = opts.guard(before, after);
    if (err) throw new Error(err);
  }

  params.push(id);
  run(
    `UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`,
    params
  );

  if (changes.length > 0) {
    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: table, entityId: id,
      summary: `修改${label}：${changes.slice(0, 5).join("；")}${changes.length > 5 ? ` 等 ${changes.length} 项` : ""}`,
    });
  }

  return { ok: true, changed: changes.length };
}

/** 恢复软删除记录（仅 boss/admin） */
export function restoreRecord(table: string, id: number, user: SessionUser, label: string) {
  if (!user.roles.includes("boss") && !user.roles.includes("admin")) {
    throw new AuthError("无权限恢复记录", 403);
  }
  const row = one<{ id: number }>(
    `SELECT id FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, [id]
  );
  if (!row) throw new Error(`${label}不存在或未被删除`);

  run(`UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL WHERE id = ?`, [id]);
  audit({
    userId: user.id, userName: user.name, action: "update",
    entityType: table, entityId: id,
    summary: `恢复已删除的${label}`,
  });
  return { ok: true };
}

/** 查询已删除记录（管理员用） */
export function listDeleted(table: string, limit = 100) {
  return all<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?`,
    [limit]
  );
}
