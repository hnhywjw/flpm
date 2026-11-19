import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "./auth";
import { FORCE_CHANGE_PWD_PATH } from "./paths";

export { FORCE_CHANGE_PWD_PATH };

/**
 * 页面级守卫
 *
 * 顺序很重要：
 *   1. 未登录 → 登录页
 *   2. 必须先改密 → 强制改密页（这是硬阻断，不是提示）
 *   3. 无该菜单权限 → 工作台
 *
 * 第 2 步放在权限判断之前：改密是账号级的前置条件，
 * 与具体看哪个页面无关。放在后面会出现「无权限 → 跳工作台 → 再被改密拦截」的绕路。
 */
export async function guardPage(menuKey: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePwd) redirect(FORCE_CHANGE_PWD_PATH);
  if (!user.menus.includes(menuKey)) redirect("/");
  return user;
}

/** 判断菜单可见性 */
export function menuAllowed(user: { menus: string[] }, key: string): boolean {
  return user.menus.includes(key);
}
