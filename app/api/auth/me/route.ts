import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL, ROLE_MENUS } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  // allowPendingPwdChange：前端要知道自己「为何被拦」，
  // 这个接口本身不返回业务数据，放行是安全的
  let u;
  try {
    u = await requireUser({ allowPendingPwdChange: true });
  } catch {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  // 菜单必须用会话里的动态菜单（数据库 user_roles → roles.menus）
  // 之前用 ROLE_MENUS[role] 静态表，只覆盖 7 个内置角色，
  // 自定义角色会返回 undefined，导致前端菜单消失
  return NextResponse.json({
    user: u,
    roleLabel: ROLE_LABEL[u.role] ?? u.role,
    menus: u.menus ?? ROLE_MENUS[u.role] ?? [],
    canSeeAmount: u.canSeeAmount,
  });
}
