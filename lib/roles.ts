import { all, one, run } from "./db";
import type { Role } from "./domain";
import { ROLE_LABEL, ROLE_DESC, ROLE_MENUS, canSeeAmount as defaultCanSeeAmount } from "./domain";

export interface RoleDef {
  key: string;
  name: string;
  description: string | null;
  menus: string[];
  can_see_amount: number;
  is_system: number;
  sort: number;
  active: number;
  user_count?: number;
}

/** 读取全部角色（含用户数） */
export function listRoles(): RoleDef[] {
  const rows = all<{
    key: string; name: string; description: string | null; menus: string;
    can_see_amount: number; is_system: number; sort: number; active: number;
  }>("SELECT * FROM roles ORDER BY sort, key");

  return rows.map((r) => {
    let menus: string[] = [];
    try { menus = JSON.parse(r.menus); } catch { menus = []; }
    const cnt = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM user_roles WHERE role_key = ?", [r.key]
    )?.c ?? 0;
    return { ...r, menus, user_count: cnt };
  });
}

export function getRole(key: string): RoleDef | undefined {
  const r = one<{
    key: string; name: string; description: string | null; menus: string;
    can_see_amount: number; is_system: number; sort: number; active: number;
  }>("SELECT * FROM roles WHERE key = ?", [key]);
  if (!r) return undefined;
  let menus: string[] = [];
  try { menus = JSON.parse(r.menus); } catch { menus = []; }
  return { ...r, menus };
}

/** 某用户的所有角色 */
export function getUserRoles(userId: number): string[] {
  return all<{ role_key: string }>(
    "SELECT role_key FROM user_roles WHERE user_id = ? ORDER BY is_primary DESC", [userId]
  ).map((r) => r.role_key);
}

/** 用户可访问菜单（多个角色取并集） */
export function getUserMenus(userId: number, primaryRole: string): string[] {
  const roleKeys = getUserRoles(userId);
  if (roleKeys.length === 0) {
    // 回退到主角色定义
    const d = getRole(primaryRole);
    return d?.menus ?? ROLE_MENUS[primaryRole as Role] ?? [];
  }
  const set = new Set<string>();
  for (const k of roleKeys) {
    const d = getRole(k);
    if (d && d.active) d.menus.forEach((m) => set.add(m));
  }
  return Array.from(set);
}

/** 用户是否可见金额（任一角色可见即可见） */
export function userCanSeeAmount(userId: number, primaryRole: string): boolean {
  const roleKeys = getUserRoles(userId);
  if (roleKeys.length === 0) {
    const d = getRole(primaryRole);
    if (d) return d.can_see_amount === 1;
    return defaultCanSeeAmount(primaryRole as Role);
  }
  for (const k of roleKeys) {
    const d = getRole(k);
    if (d && d.active && d.can_see_amount === 1) return true;
  }
  return false;
}

/** 用户是否具备某角色（多角色任一匹配） */
export function userHasRole(userId: number, roleKey: string): boolean {
  const keys = getUserRoles(userId);
  if (keys.length === 0) {
    const u = one<{ role: string }>("SELECT role FROM users WHERE id = ?", [userId]);
    return u?.role === roleKey;
  }
  return keys.includes(roleKey);
}

// ---------------- 角色管理 ----------------

export function createRole(input: {
  key: string; name: string; description?: string;
  menus: string[]; canSeeAmount: boolean;
}): RoleDef {
  const key = input.key.trim();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(key)) {
    throw new Error("角色标识只能用小写字母开头，含小写字母/数字/下划线，2-31 位");
  }
  if (!input.name?.trim()) throw new Error("角色名称必填");
  if (getRole(key)) throw new Error(`角色标识「${key}」已存在`);

  run(
    `INSERT INTO roles (key, name, description, menus, can_see_amount, is_system, sort, active)
     VALUES (?, ?, ?, ?, ?, 0, 99, 1)`,
    [key, input.name.trim(), input.description ?? null, JSON.stringify(input.menus), input.canSeeAmount ? 1 : 0]
  );
  return getRole(key)!;
}

export function updateRole(key: string, input: {
  name?: string; description?: string; menus?: string[]; canSeeAmount?: boolean; active?: boolean;
}) {
  const r = getRole(key);
  if (!r) throw new Error("角色不存在");

  if (input.name !== undefined && !input.name.trim()) throw new Error("角色名称不能为空");

  run(
    `UPDATE roles SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       menus = COALESCE(?, menus),
       can_see_amount = COALESCE(?, can_see_amount),
       active = COALESCE(?, active)
     WHERE key = ?`,
    [
      input.name?.trim() ?? null,
      input.description ?? null,
      input.menus ? JSON.stringify(input.menus) : null,
      input.canSeeAmount === undefined ? null : (input.canSeeAmount ? 1 : 0),
      input.active === undefined ? null : (input.active ? 1 : 0),
      key,
    ]
  );
}

export function deleteRole(key: string) {
  const r = getRole(key);
  if (!r) throw new Error("角色不存在");
  if (r.is_system) throw new Error("系统内置角色不能删除");
  const cnt = one<{ c: number }>("SELECT COUNT(*) AS c FROM user_roles WHERE role_key = ?", [key])?.c ?? 0;
  if (cnt > 0) throw new Error(`该角色还有 ${cnt} 个用户，请先移除这些用户的该角色`);
  run("DELETE FROM roles WHERE key = ?", [key]);
}

// ---------------- 用户角色分配 ----------------

export function setUserRoles(userId: number, roleKeys: string[], primaryKey?: string) {
  const u = one<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [userId]);
  if (!u) throw new Error("用户不存在");
  if (roleKeys.length === 0) throw new Error("用户至少需要一个角色");

  for (const k of roleKeys) {
    if (!getRole(k)) throw new Error(`角色「${k}」不存在`);
  }

  const primary = primaryKey && roleKeys.includes(primaryKey) ? primaryKey : roleKeys[0];

  run("DELETE FROM user_roles WHERE user_id = ?", [userId]);
  for (const k of roleKeys) {
    run(
      "INSERT INTO user_roles (user_id, role_key, is_primary) VALUES (?, ?, ?)",
      [userId, k, k === primary ? 1 : 0]
    );
  }
  // 同步 users.role 为主角色（兼容旧代码）
  run("UPDATE users SET role = ? WHERE id = ?", [primary, userId]);
}

/** 用户列表（含角色） */
export function listUsersWithRoles() {
  const users = all<{
    id: number; name: string; username: string | null; role: string; dept: string | null;
    phone: string | null; active: number; last_login_at: string | null;
    reg_status: string | null; reg_at: string | null;
    totp_enabled: number | null;
  }>(`SELECT id, name, username, role, dept, phone, active, last_login_at,
            reg_status, reg_at, totp_enabled
     FROM users
     WHERE (username IS NULL OR username NOT LIKE '__deleted_%')
       AND (username IS NULL OR username != '__system__')
     ORDER BY id`);

  return users.map((u) => {
    const roles = all<{ role_key: string; is_primary: number }>(
      "SELECT role_key, is_primary FROM user_roles WHERE user_id = ? ORDER BY is_primary DESC",
      [u.id]
    );
    return {
      ...u,
      reg_status: u.reg_status ?? "approved",
      totp_enabled: u.totp_enabled ?? 0,
      roles: roles.map((r) => r.role_key),
      primaryRole: roles.find((r) => r.is_primary === 1)?.role_key ?? u.role,
      roleNames: roles.map((r) => getRole(r.role_key)?.name ?? r.role_key),
    };
  });
}

/** 新增用户 */
function validateUsername(u: string): string {
  const v = (u ?? "").trim();
  if (!v) throw new Error("用户名必填");
  if (v.length < 2 || v.length > 32) throw new Error("用户名长度需 2-32 位");
  // 允许中文、字母、数字、下划线、点、短横线，不允许空格
  if (!/^[\w\u4e00-\u9fa5.-]+$/.test(v)) {
    throw new Error("用户名只能包含中文、字母、数字、下划线、点、短横线");
  }
  return v;
}

export function createUser(input: {
  name: string; username: string; dept?: string; phone?: string;
  roleKeys: string[]; primaryRole?: string;
  password: string;
}) {
  const name = input.name?.trim();
  if (!name) throw new Error("姓名必填");

  const username = validateUsername(input.username);
  const dupName = one<{ id: number }>("SELECT id FROM users WHERE name = ?", [name]);
  if (dupName) throw new Error(`姓名「${name}」已存在`);

  const dupUser = one<{ id: number }>(
    "SELECT id FROM users WHERE username = ? COLLATE NOCASE", [username]
  );
  if (dupUser) throw new Error(`用户名「${username}」已被占用`);

  if (input.roleKeys.length === 0) throw new Error("至少选择一个角色");
  if (!input.password || input.password.length < 8) throw new Error("初始密码至少 8 位");

  const primary = input.primaryRole && input.roleKeys.includes(input.primaryRole)
    ? input.primaryRole : input.roleKeys[0];

  const info = run(
    "INSERT INTO users (name, username, role, dept, phone, active, must_change_pwd) VALUES (?, ?, ?, ?, ?, 1, 1)",
    [name, username, primary, input.dept ?? null, input.phone ?? null]
  );
  const uid = Number(info.lastInsertRowid);

  // 密码哈希由调用方处理（需要 node:crypto），此处只建用户与角色
  for (const k of input.roleKeys) {
    run(
      "INSERT INTO user_roles (user_id, role_key, is_primary) VALUES (?, ?, ?)",
      [uid, k, k === primary ? 1 : 0]
    );
  }
  return uid;
}

export function updateUser(userId: number, input: {
  name?: string; username?: string; dept?: string; phone?: string; active?: boolean;
}) {
  const u = one<{ id: number; name: string; username: string | null }>(
    "SELECT id, name, username FROM users WHERE id = ?", [userId]
  );
  if (!u) throw new Error("用户不存在");

  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new Error("姓名不能为空");
    const dup = one<{ id: number }>("SELECT id FROM users WHERE name = ? AND id != ?", [n, userId]);
    if (dup) throw new Error(`姓名「${n}」已被占用`);
  }

  if (input.username !== undefined) {
    const un = validateUsername(input.username);
    const dup = one<{ id: number }>(
      "SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?", [un, userId]
    );
    if (dup) throw new Error(`用户名「${un}」已被占用`);
    if (un !== u.username) {
      run(
        "INSERT INTO username_history (user_id, old_name, new_name, changed_by) VALUES (?, ?, ?, ?)",
        [userId, u.username, un, userId]
      );
      run("UPDATE users SET username = ? WHERE id = ?", [un, userId]);
    }
  }

  run(
    `UPDATE users SET
       name = COALESCE(?, name),
       dept = COALESCE(?, dept),
       phone = COALESCE(?, phone),
       active = COALESCE(?, active)
     WHERE id = ?`,
    [input.name?.trim() ?? null, input.dept ?? null, input.phone ?? null,
     input.active === undefined ? null : (input.active ? 1 : 0), userId]
  );
}

export function resetUserPassword(userId: number, hash: string, salt: string) {
  run(
    "UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?",
    [hash, salt, userId]
  );
  run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}


/** 审核注册申请 */
export function reviewRegistration(userId: number, approve: boolean, reviewerId: number) {
  const u = one<{ id: number; name: string; reg_status: string | null }>(
    "SELECT id, name, reg_status FROM users WHERE id = ?", [userId]
  );
  if (!u) throw new Error("用户不存在");
  if ((u.reg_status ?? "approved") !== "pending") {
    throw new Error("该用户不是待审核状态");
  }

  if (approve) {
    // 通过：启用账号，但角色仍需单独分配
    run(
      "UPDATE users SET active = 1, reg_status = 'approved', reviewed_by = ?, reviewed_at = datetime('now','localtime') WHERE id = ?",
      [reviewerId, userId]
    );
  } else {
    run(
      "UPDATE users SET active = 0, reg_status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now','localtime') WHERE id = ?",
      [reviewerId, userId]
    );
  }
  return { ok: true, name: u.name, status: approve ? "approved" : "rejected" };
}

