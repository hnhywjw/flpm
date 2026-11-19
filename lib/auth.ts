// 本文件仅在 Node Runtime 使用（含 node:crypto / node:fs 依赖）。
// 禁止在客户端组件或 middleware（Edge Runtime）中引入。
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { one, run } from "./db";
import type { Role } from "./domain";
import { ROLE_LABEL } from "./domain";
import { userCanSeeAmount, getUserMenus, getRole, getUserRoles } from "./roles";
import { getParamInt } from "./sysinfo";
import { verifyTotp, consumeRecoveryCode } from "./totp";

export const SESSION_COOKIE = "ltc_session";
const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
  dept: string | null;
  /** 该用户全部角色（多角色） */
  roles: string[];
  /** 可访问菜单（多角色并集，来自数据库） */
  menus: string[];
  /** 是否可见金额 */
  canSeeAmount: boolean;
  /** 必须先修改密码才能使用系统（初始密码 / 管理员重置后） */
  mustChangePwd?: boolean;
}

// ---------------- 密码哈希（scrypt，Node 内置，无第三方依赖）----------------

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return { hash: derived.toString("hex"), salt };
}

/** 密码修改后清除「必须改密」标记 */
export function clearMustChangePwd(userId: number) {
  run("UPDATE users SET must_change_pwd = 0 WHERE id = ?", [userId]);
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const a = Buffer.from(derived.toString("hex"), "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length) return false;
    // 定时安全比较，避免时序攻击
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * 系统初始默认密码
 *
 * 用于两个地方：
 *   1. 新建用户 / 管理员重置密码时的初始密码
 *   2. 兜底判断「当前密码是否仍是默认值」——即使 must_change_pwd 标记
 *      被误清（人工改库 / 代码分支遗漏），只要密码还是它，就仍提示改密。
 *
 * ★ 必须在部署时通过环境变量 DEFAULT_PWD 显式配置，代码里不写默认值。
 *
 * 为什么不再写死 "Admin@123"：
 *   写死意味着所有部署开箱都是同一个密码，等于公开的后门。
 *   现在 docker-compose.yml 用 ${DEFAULT_PWD:?...} 强制要求配置，
 *   没配的话容器根本起不来 —— 问题在部署阶段就暴露，而不是等账号被人登进去。
 *
 * 为什么读到空值不抛错、而是返回空串：
 *   本文件在很多请求路径上被引用，启动期抛错会让整站 500，
 *   连带把「忘记密码申请」这类无需登录的功能也打死。
 *   改成返回空串后，isUsingDefaultPassword 会永远返回 false，
 *   表现为「不再提示默认密码」——功能降级但不崩。
 *   真正的强约束放在 compose 层（起不来）和部署自检里。
 */
function readDefaultPassword(): string {
  const v = process.env.DEFAULT_PWD;
  if (!v || !v.trim()) {
    console.warn(
      "[auth] DEFAULT_PWD 未配置！" +
      "新建用户的初始密码将为空、默认密码检测失效。" +
      "请在 .env 中设置 DEFAULT_PWD 并重启。"
    );
    return "";
  }
  return v;
}

const DEFAULT_PASSWORD = readDefaultPassword();

/**
 * 当前密码是否仍是默认密码
 *
 * 为什么要做这个判断：
 *   must_change_pwd 是「一次性标记」，只表示「被标记过」，
 *   并不代表「密码现在是不是默认值」。一旦标记被误清，
 *   用户继续用默认密码登录，系统也不会再提醒 —— 这是真实发生过的问题
 *   （王经理 must_change_pwd=0 但密码仍是 Admin@123）。
 *
 * 所以在这里加一道实际校验：拿默认密码试一次哈希比对。
 * 代价是一次 scrypt（约 30-50ms），只在登录和取会话时执行，可接受。
 */
export function isUsingDefaultPassword(passwordHash: string | null, passwordSalt: string | null): boolean {
  if (!passwordHash || !passwordSalt) return false;
  // 未配置 DEFAULT_PWD 时不做这项检测（而不是误判为「所有密码都是默认密码」）
  if (!DEFAULT_PASSWORD) return false;
  return verifyPassword(DEFAULT_PASSWORD, passwordHash, passwordSalt);
}

/** 供种子脚本 / 新建用户使用；未配置时抛错，不让空密码流出去 */
export function getDefaultPasswordOrThrow(): string {
  if (!DEFAULT_PASSWORD) {
    throw new Error("DEFAULT_PWD 未配置，无法创建初始密码。请在 .env 中设置后重启。");
  }
  return DEFAULT_PASSWORD;
}


// ---------------- 登录 ----------------

export interface LoginResult {
  ok: boolean;
  error?: string;
  token?: string;
  user?: SessionUser;
  /** 该账号启用了令牌认证，需要二次验证 */
  needTotp?: boolean;
}

export function login(
  name: string,
  password: string,
  ip?: string,
  userAgent?: string,
  totpCode?: string
): LoginResult {
  // 用「用户名」登录（不区分大小写），展示仍用姓名
  const user = one<{
    id: number; name: string; username: string; role: Role | ""; dept: string | null;
    password_hash: string | null; password_salt: string | null;
    active: number; failed_attempts: number; locked_until: string | null;
    reg_status: string | null;
    totp_secret: string | null; totp_enabled: number; totp_recovery: string | null;
  }>("SELECT * FROM users WHERE username = ? COLLATE NOCASE OR (username IS NULL AND name = ?)", [name, name]);

  if (!user) return { ok: false, error: "用户名或密码不正确" };
  // 注册待审批
  if (user.reg_status === "pending") {
    return { ok: false, error: "账号正在审核中，请联系管理员" };
  }
  if (user.reg_status === "rejected") {
    return { ok: false, error: "注册申请未通过，请联系管理员" };
  }
  // 兼容：若用户名列为空（老数据），回填
  if (!user.username) {
    run("UPDATE users SET username = ? WHERE id = ?", [user.name, user.id]);
  }
  if (!user.active) return { ok: false, error: "该账号已停用" };

  // 锁定检查
  if (user.locked_until) {
    const until = new Date(user.locked_until.replace(" ", "T"));
    if (until > new Date()) {
      const mins = Math.ceil((until.getTime() - Date.now()) / 60000);
      return { ok: false, error: `账号已锁定，请 ${mins} 分钟后再试` };
    }
  }

  // 未设置密码的账号不允许登录
  if (!user.password_hash || !user.password_salt) {
    return { ok: false, error: "该账号尚未设置密码，请联系管理员" };
  }

  if (!verifyPassword(password, user.password_hash, user.password_salt)) {
    const attempts = user.failed_attempts + 1;
    if (attempts >= MAX_FAILED) {
      const until = new Date(Date.now() + LOCK_MINUTES * 60000);
      const s = until.toISOString().slice(0, 19).replace("T", " ");
      run("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?", [attempts, s, user.id]);
      return { ok: false, error: `密码错误次数过多，账号锁定 ${LOCK_MINUTES} 分钟` };
    }
    run("UPDATE users SET failed_attempts = ? WHERE id = ?", [attempts, user.id]);
    return { ok: false, error: `用户名或密码不正确（还可尝试 ${MAX_FAILED - attempts} 次）` };
  }

  // 无角色拦截：注册通过但未分配角色的用户不应能进入系统
  // （否则会回退到 users.role 的默认菜单，等于白送权限）
  const roleCount = one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM user_roles WHERE user_id = ?", [user.id]
  )?.c ?? 0;
  const hasFallbackRole = !!user.role && String(user.role).length > 0;
  if (roleCount === 0 && !hasFallbackRole) {
    return { ok: false, error: "账号尚未分配角色，请联系管理员" };
  }

  // ---------- 令牌认证（TOTP 两步验证） ----------
  // 密码已通过，若该账号启用了令牌，必须再验一次动态码
  if (user.totp_enabled === 1 && user.totp_secret) {
    if (!totpCode || !String(totpCode).trim()) {
      // 前端据此弹出令牌输入框；此处不创建会话
      return { ok: false, needTotp: true, error: "请输入令牌验证码" };
    }

    const code = String(totpCode).trim();

    // 1. 优先按 TOTP 校验
    let passed = verifyTotp(user.totp_secret, code);
    let usedRecovery = false;
    let remainingRecovery: string[] | null = null;

    // 2. 不像 6 位数字时，尝试恢复码
    if (!passed && !/^\d{6}$/.test(code)) {
      const r = consumeRecoveryCode(user.totp_recovery, code);
      if (r.ok) {
        passed = true;
        usedRecovery = true;
        remainingRecovery = r.remaining;
      }
    }

    if (!passed) {
      // 令牌错误也计入失败次数，防止暴力破解
      const attempts = user.failed_attempts + 1;
      if (attempts >= MAX_FAILED) {
        const until = new Date(Date.now() + LOCK_MINUTES * 60000);
        const s = until.toISOString().slice(0, 19).replace("T", " ");
        run("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?", [attempts, s, user.id]);
        return {
          ok: false, needTotp: true,
          error: `令牌错误次数过多，账号锁定 ${LOCK_MINUTES} 分钟`,
        };
      }
      run("UPDATE users SET failed_attempts = ? WHERE id = ?", [attempts, user.id]);
      return {
        ok: false, needTotp: true,
        error: `令牌验证码不正确（还可尝试 ${MAX_FAILED - attempts} 次）`,
      };
    }

    // 恢复码用过就作废
    if (usedRecovery && remainingRecovery) {
      run(
        "UPDATE users SET totp_recovery = ? WHERE id = ?",
        [JSON.stringify(remainingRecovery.map((c) => ({ code: c, used: false }))), user.id]
      );
    }
    run(
      "UPDATE users SET totp_last_used = datetime('now','localtime') WHERE id = ?",
      [user.id]
    );
  }

  // 登录成功：清空失败计数
  run(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now','localtime') WHERE id = ?",
    [user.id]
  );

  // 到这里必有角色：优先用 user_roles 的第一个（主角色），
  // 其次回退 users.role（兼容老数据）
  const primaryRole = (getUserRoles(user.id)[0] ?? user.role) as Role;

  const token = createSession(user.id, ip, userAgent);
  return { ok: true, token, user: buildSessionUser(user.id, user.name, primaryRole, user.dept) };
}

/** 组装会话用户（含数据库动态角色权限） */
function buildSessionUser(
  id: number, name: string, role: Role, dept: string | null
): SessionUser {
  const rows = one<{ roles: string | null }>(
    "SELECT GROUP_CONCAT(role_key) AS roles FROM user_roles WHERE user_id = ?", [id]
  );
  const roles = rows?.roles ? rows.roles.split(",") : [role];

  // 两个判据取「或」：
  //   1. must_change_pwd = 1         —— 被标记过（管理员重置 / 初始账号）
  //   2. 密码仍等于系统默认密码        —— 实际校验，防标记被误清
  //
  // 只有第 1 条时，一旦标记被误清就再也不会提醒（真实踩过）；
  // 加上第 2 条后，只要用户还在用默认密码，就一定会看到改密提示。
  const pwd = one<{ m: number; h: string | null; s: string | null }>(
    "SELECT must_change_pwd AS m, password_hash AS h, password_salt AS s FROM users WHERE id = ?",
    [id]
  );
  const flagged = (pwd?.m ?? 0) === 1;
  const stillDefault = !flagged && isUsingDefaultPassword(pwd?.h ?? null, pwd?.s ?? null);

  return {
    id, name, role, dept,
    roles,
    menus: getUserMenus(id, role),
    canSeeAmount: userCanSeeAmount(id, role),
    mustChangePwd: flagged || stillDefault,
  };
}

// ---------------- 会话 ----------------

export function createSession(userId: number, ip?: string, userAgent?: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  const exp = expires.toISOString().slice(0, 19).replace("T", " ");
  run(
    "INSERT INTO sessions (id, user_id, expires_at, ip, user_agent, last_seen_at) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))",
    [token, userId, exp, ip ?? null, userAgent ?? null]
  );
  return token;
}

export function destroySession(token: string) {
  run("DELETE FROM sessions WHERE id = ?", [token]);
}

export function getUserByToken(token: string): SessionUser | null {
  if (!token) return null;
  const row = one<{
    id: number; name: string; role: Role; dept: string | null;
    expires_at: string; last_seen_at: string | null;
  }>(
    `SELECT u.id, u.name, u.role, u.dept, s.expires_at, s.last_seen_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND u.active = 1`,
    [token]
  );
  if (!row) return null;

  // 1. 会话绝对有效期（默认 7 天）
  const exp = new Date(row.expires_at.replace(" ", "T"));
  if (exp <= new Date()) {
    destroySession(token);
    return null;
  }

  // 2. 空闲超时（系统参数 session_timeout_min，0 表示不限制）
  //    基于 last_seen_at：任何一次带 cookie 的请求都会刷新 last_seen_at，
  //    所以「超过 N 分钟没有任何请求」= 空闲超时
  const idleMin = getParamInt("session_timeout_min", 120);
  if (idleMin > 0 && row.last_seen_at) {
    const lastSeen = new Date(row.last_seen_at.replace(" ", "T"));
    const idleMs = Date.now() - lastSeen.getTime();
    if (idleMs > idleMin * 60 * 1000) {
      destroySession(token);
      return null;
    }
  }

  run("UPDATE sessions SET last_seen_at = datetime('now','localtime') WHERE id = ?", [token]);
  return buildSessionUser(row.id, row.name, row.role, row.dept);
}

/** 清理过期会话 */
export function cleanupSessions() {
  run("DELETE FROM sessions WHERE expires_at < datetime('now','localtime')");
}

// ---------------- 服务端取当前用户 ----------------

export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return getUserByToken(token);
  } catch {
    return null;
  }
}

/**
 * 要求已登录，否则抛错（供 API 使用）
 *
 * allowPendingPwdChange：是否允许「必须先改密」的用户继续访问
 *
 *   默认 false —— 也就是说，未改密的用户调用任何业务 API 都会被拦下。
 *   这是强制改密的第二道门（页面守卫是第一道），
 *   否则用户直接敲 API 就能绕过前端跳转。
 *
 *   只有这几个接口需要传 true：
 *     · /api/auth/change-password   （改密本身）
 *     · /api/auth/logout            （退出）
 *     · /api/auth/me                （前端要知道自己为什么被拦）
 */
export async function requireUser(
  opts: { allowPendingPwdChange?: boolean } = {}
): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError("未登录或会话已过期", 401);
  if (u.mustChangePwd && !opts.allowPendingPwdChange) {
    throw new AuthError("请先修改初始密码后再使用系统", 403);
  }
  return u;
}

export class AuthError extends Error {
  status: number;
  constructor(msg: string, status = 401) {
    super(msg);
    this.status = status;
  }
}

/** 要求具备指定角色之一（支持多角色用户） */
export async function requireRole(...roles: string[]): Promise<SessionUser> {
  const u = await requireUser();
  if (roles.length === 0) return u;
  const has = roles.some((r) => u.roles.includes(r));
  if (!has) {
    const need = roles.map((r) => getRole(r)?.name ?? ROLE_LABEL[r as Role] ?? r).join(" / ");
    const mine = u.roles.map((r) => getRole(r)?.name ?? r).join("、") || "无";
    throw new AuthError(`无权限执行该操作（需要「${need}」，当前角色：${mine}）`, 403);
  }
  return u;
}

/** 要求某个菜单权限 */
export async function requireMenu(menuKey: string): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.menus.includes(menuKey)) {
    throw new AuthError(`无权访问该模块`, 403);
  }
  return u;
}
