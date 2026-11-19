import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ForceChangeForm } from "./ForceChangeForm";

export const dynamic = "force-dynamic";

/**
 * 强制改密页
 *
 * 什么时候会进来：
 *   用户 mustChangePwd 为 true（管理员重置过密码 / 还在用默认密码），
 *   访问任何业务页面都会被 guardPage 重定向到这里。
 *
 * 设计要点：
 *   · 不套 AppShell 外壳 —— 没有侧栏和菜单，用户无法绕过
 *   · 已改完密（mustChangePwd 变 false）就自动放行去工作台
 *   · 允许退出登录（万一不是本人）
 */
export default async function ForceChangePasswordPage() {
  const user = await getCurrentUser();

  // 未登录交给 middleware，这里兜底
  if (!user) redirect("/login");

  // 已经不需要改密了（比如别的标签页改完了），直接进系统
  if (!user.mustChangePwd) redirect("/");

  return <ForceChangeForm userName={user.name} />;
}
