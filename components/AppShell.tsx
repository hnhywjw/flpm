"use client";

import { ThemeProvider } from "./ThemeProvider";
import { FORCE_CHANGE_PWD_PATH } from "@/lib/paths";
import { Sidebar } from "./Sidebar";
import { ThemePanel } from "./ThemePanel";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const TITLES: Record<string, string> = {
  "/": "工作台",
  "/projects": "项目管理",
  "/bidding": "投标管理",
  "/agent": "中标管理",
  "/awards": "中标管理",
  "/contracts": "合同管理",
  "/finance": "开票与回款",
  "/changes": "变更与风险",
  "/approvals": "审批中心",
  "/inventory": "出入库管理",
  "/service": "售后服务",
  "/alerts": "待办预警",
  "/settings": "基础数据",
  "/reports": "报表分析",
  "/logs": "操作日志",
};

export function AppShell({
  children,
  initialMenus = null,
  initialMustChangePwd = false,
}: {
  children: React.ReactNode;
  /**
   * 服务端传来的菜单权限（未登录时为 null）
   *
   * 传下来是为了让首帧就按真实权限渲染侧栏。
   * 若为 null 且用户实际已登录，Sidebar 会再请求一次 /api/auth/me 兜底。
   */
  initialMenus?: string[] | null;
  /** 服务端传来的「是否需要改密」标记，避免横幅延迟出现 */
  initialMustChangePwd?: boolean;
}) {
  const pathname = usePathname();

  // 登录页、强制改密页不套外壳
  //
  // 强制改密页尤其不能套：一旦有侧栏和菜单，
  // 用户就能点其它菜单绕过改密要求。
  if (pathname === "/login" || pathname === FORCE_CHANGE_PWD_PATH) {
    return <ThemeProvider>{children}</ThemeProvider>;
  }

  const base = "/" + (pathname.split("/")[1] ?? "");
  const title = TITLES[pathname] ?? TITLES[base] ?? "项目全流程管理";

  return (
    <ThemeProvider>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar initialMenus={initialMenus} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header
            style={{
              height: 60, background: "var(--card)", borderBottom: "1px solid var(--line)",
              display: "flex", alignItems: "center", gap: 14, padding: "0 22px",
              position: "sticky", top: 0, zIndex: 30,
            }}
          >
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              <span className="max-lg:hidden">项目全流程管理 / </span>
              <b style={{ color: "var(--text)", fontSize: 15 }}>{title}</b>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
              <UserBadge />
            </div>
          </header>
          <PasswordWarning initial={initialMustChangePwd} />
          <main style={{ padding: "20px 22px 40px", flex: 1 }}>{children}</main>
        </div>
      </div>
      <ThemePanel />
    </ThemeProvider>
  );
}

/**
 * 初始密码提醒横幅
 *
 * 不做强制拦截（会把人锁死），只做醒目提示 + 一键去改。
 * 用户改完密码后 must_change_pwd 置 0，横幅自动消失。
 */
function PasswordWarning({ initial = false }: { initial?: boolean }) {
  // 初始值来自服务端，首帧就正确，不会「先没有、再冒出来」
  const [need, setNeed] = useState(initial);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let alive = true;

    const check = () => {
      fetch("/api/auth/me", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          // 改完密码后标记变 false，横幅要立刻消失
          setNeed(d?.user?.mustChangePwd === true);
        })
        .catch(() => {});
    };

    // 服务端已给初始值时不必立刻再查一次；
    // 只在「改密事件」触发时重新确认（那条路径必须复查，否则横幅不会消失）
    const onChange = () => check();
    window.addEventListener("pwd-changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("pwd-changed", onChange);
    };
  }, []);

  if (!need || closed) return null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "#fffbeb", borderBottom: "1px solid #fde68a",
      padding: "9px 22px", fontSize: 12.5, color: "#92400e",
    }}>
      <span style={{ fontWeight: 700 }}>⚠ 安全提醒</span>
      <span>你正在使用初始密码（或管理员刚重置的密码），建议立即修改。</span>
      <a
        href="/settings"
        style={{
          marginLeft: "auto", color: "#b45309", fontWeight: 700,
          textDecoration: "underline", whiteSpace: "nowrap",
        }}
      >
        去修改密码
      </a>
      <button
        onClick={() => setClosed(true)}
        style={{
          border: 0, background: "transparent", color: "#b45309",
          cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px",
        }}
        title="本次不再提示"
      >
        ×
      </button>
    </div>
  );
}

function UserBadge() {
  const [me, setMe] = useState<{ user: { name: string; dept: string | null }; roleLabel: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe(d))
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      <div style={{ width: 32, height: 32, borderRadius: "50%",
                    background: "linear-gradient(135deg,var(--brand1),var(--brand2))",
                    color: "#fff", display: "grid", placeItems: "center",
                    fontSize: 12.5, fontWeight: 700 }}>
        {me?.user.name?.slice(0, 1) ?? "?"}
      </div>
      <div className="max-sm:hidden" style={{ lineHeight: 1.2 }}>
        <b style={{ display: "block", fontSize: 13 }}>{me?.user.name ?? "…"}</b>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {me?.roleLabel ?? ""}{me?.user.dept ? ` · ${me.user.dept}` : ""}
        </span>
      </div>
      <button
        onClick={logout}
        title="退出登录"
        style={{
          fontSize: 12, color: "var(--sub)", border: "1px solid var(--line)",
          background: "var(--card)", padding: "5px 10px", borderRadius: 7, cursor: "pointer",
        }}
      >
        退出
      </button>
    </>
  );
}
