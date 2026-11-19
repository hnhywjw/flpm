import { NextResponse } from "next/server";
import { requireUser, requireRole, AuthError, type SessionUser } from "./auth";
import type { Role } from "./domain";

/**
 * 错误分类：
 * - AuthError      -> 按其 status（401/403）
 * - 业务规则错误    -> 400
 * - 权限/角色不符  -> 403
 * - 其他           -> 500
 */
/**
 * ★ 显式业务异常（推荐）
 *
 * 原来只能靠下面的关键词正则猜「这句报错是不是业务规则」，
 * 猜不中就返回 500「服务器处理失败」——用户完全不知道哪里填错了。
 *
 * 实例：「请填写项目编号」不含任何关键词 → 500，
 *       用户看到「服务器处理失败」，以为系统坏了。
 *
 * 新代码统一 throw new BizError("...")，一定返回 400 并带原话。
 */
export class BizError extends Error {
  status: number;
  details?: string[];
  constructor(message: string, status = 400, details?: string[]) {
    super(message);
    this.name = "BizError";
    this.status = status;
    this.details = details;
  }
}

/** 兼容老代码：仍保留关键词匹配，但只作为兜底 */
const BIZ_ERROR_PATTERNS = [
  /必须/, /不能/, /不允许/, /超过/, /未齐备/, /已通过/, /已驳回/, /已撤回/,
  /不存在/, /缺少/, /无效/, /不一致/, /尚未/, /已结束/, /无差额/,
  /库存不足/, /不足/, /已被占用/, /必填/, /格式/,
  /请填写/, /请先/, /已存在/, /重复/,
];

const PERM_PATTERNS = [/需「.+」审批/, /只有上传者/, /只能撤回自己/, /无权限/];

export function errorResponse(e: unknown) {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }

  // 显式业务异常：原样返回，一定 400（或指定状态码）
  if (e instanceof BizError) {
    return NextResponse.json(
      { error: e.message, ...(e.details ? { details: e.details } : {}) },
      { status: e.status }
    );
  }

  const msg = (e as Error)?.message ?? "服务器内部错误";

  // 权限类 → 403
  if (PERM_PATTERNS.some((p) => p.test(msg))) {
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  // 业务规则类 → 400
  if (BIZ_ERROR_PATTERNS.some((p) => p.test(msg))) {
    const extra = (e as Error & { details?: string[] }).details;
    return NextResponse.json({ error: msg, ...(extra ? { details: extra } : {}) }, { status: 400 });
  }

  // 其余视为服务端错误，不暴露 SQL 细节
  console.error("[api]", msg);
  const safe = /SQLITE|no such|syntax error|UNIQUE constraint/i.test(msg)
    ? "数据处理失败，请检查输入"
    : "服务器处理失败";
  return NextResponse.json({ error: safe }, { status: 500 });
}

/** 需要登录 */
export async function withAuth<T>(fn: (user: SessionUser) => Promise<T>): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const data = await fn(user);
    return NextResponse.json(data as object);
  } catch (e) {
    return errorResponse(e);
  }
}

/** 需要指定角色 */
export async function withRole<T>(
  roles: Role[],
  fn: (user: SessionUser) => Promise<T>
): Promise<NextResponse> {
  try {
    const user = roles.length ? await requireRole(...roles) : await requireUser();
    const data = await fn(user);
    return NextResponse.json(data as object);
  } catch (e) {
    return errorResponse(e);
  }
}
