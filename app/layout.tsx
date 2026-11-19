import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "项目全流程管理 · ProjectFlow",
  description: "ProjectFlow — Full Lifecycle Project Management. 招投标到回款全流程管理：节点、合同、回款、过单费、售后",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * 主题初始化脚本（在首帧绘制前同步执行）
 *
 * 背景：ThemeProvider 用 useEffect 从 localStorage 恢复主题，
 * 但 useEffect 在首次绘制之后才跑 —— 用浅色模式时，
 * 刷新页面会先闪一帧深色侧栏再变浅（FOUC）。
 *
 * 解决：在 <head> 里放一段阻塞式内联脚本，
 * 浏览器解析到这里就同步设好 data-theme / data-side，
 * 等真正绘制时属性已经是对的了，不会闪。
 *
 * 注意：
 *   · 必须内联且不能 defer/async，否则又变成异步
 *   · try/catch 兜底：隐私模式下 localStorage 可能抛异常
 *   · 属性值与 ThemeProvider 的 key 保持一致
 */
const THEME_INIT_SCRIPT = `
(function(){
  try {
    var root = document.documentElement;
    var t = localStorage.getItem("ltc-theme");
    var s = localStorage.getItem("ltc-side");
    var THEMES = ["blue","teal","green","violet","red","gray"];
    if (t && THEMES.indexOf(t) >= 0) root.setAttribute("data-theme", t);
    if (s === "dark" || s === "light") root.setAttribute("data-side", s);
  } catch (e) {}
})();
`;

/**
 * 根布局（服务端组件）
 *
 * ★ 在这里取权限，而不是等客户端 /api/auth/me
 *
 * 踩过的坑：Sidebar 里 `menus` 初始是 null，`canSee` 在 null 时返回 true，
 * 导致服务端和首帧渲染了「全部菜单」，等接口返回后才按权限过滤。
 * 对 admin / 销售 / 项目经理等不含 reports 权限的账号，
 * 「报表分析」会先出现再消失 —— 刷新时能看到它闪一下。
 *
 * 现在改成服务端把真实权限传下去，首帧就是对的，不会闪。
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 未登录时返回 null，交给各页面自己的鉴权逻辑处理
  const user = await getCurrentUser().catch(() => null);

  return (
    <html lang="zh-CN" data-theme="blue" data-side="dark" suppressHydrationWarning>
      <head>
        {/*
          suppressHydrationWarning 在 <html> 上已开启：
          服务端输出 dark，脚本可能改成 light，这个差异是有意为之，不该报警告。
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppShell
          initialMenus={user?.menus ?? null}
          initialMustChangePwd={user?.mustChangePwd ?? false}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
