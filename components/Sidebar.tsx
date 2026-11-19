"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { LogoBrand } from "./Logo";
import { Icon, type IconName } from "./Icon";
import { APP_VERSION } from "@/lib/version";

/** 二级菜单项（系统管理用） */
export interface NavItem {
  key: string;
  label: string;
  /** 图标名，对应 components/Icon.tsx 里的矢量图标 */
  icon: IconName;
  href: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
  /** 二级菜单：有 children 时点击展开而不是跳转 */
  children?: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: "业务",
    items: [
      { key: "dashboard", label: "工作台", icon: "dashboard", href: "/" },
      { key: "projects", label: "项目管理", icon: "projects", href: "/projects" },
      { key: "bidding", label: "投标管理", icon: "bidding", href: "/bidding" },
      { key: "agent", label: "中标管理", icon: "awards", href: "/awards" },
      { key: "contracts", label: "合同管理", icon: "contracts", href: "/contracts" },
      { key: "finance", label: "开票与回款", icon: "finance", href: "/finance" },
      { key: "changes", label: "变更与风险", icon: "changes", href: "/changes" },
      { key: "inventory", label: "出入库", icon: "inventory", href: "/inventory" },
      { key: "service", label: "售后服务", icon: "service", href: "/service" },
    ],
  },
  {
    group: "协作",
    items: [
      { key: "approvals", label: "审批中心", icon: "approvals", href: "/approvals" },
      { key: "alerts", label: "待办预警", icon: "alerts", href: "/alerts" },
      { key: "reports", label: "报表分析", icon: "reports", href: "/reports" },
    ],
  },
  {
    group: "管理",
    items: [
      { key: "settings", label: "基础数据", icon: "database", href: "/settings" },
      { key: "logs", label: "操作日志", icon: "logs", href: "/logs" },
    ],
  },
];

/** 系统管理二级菜单（放在导航最上方，独立分组） */
export const SYSTEM_MENU: NavItem = {
  key: "system",
  label: "系统管理",
  icon: "system",
  href: "/system",
};

export const SYSTEM_CHILDREN: NavItem[] = [
  { key: "system", label: "系统负载", icon: "load", href: "/system" },
  { key: "system-services", label: "服务状态", icon: "services", href: "/system/services" },
  { key: "system-upgrade", label: "软件升级", icon: "upgrade", href: "/system/upgrade" },
  { key: "system-backup", label: "数据备份", icon: "backup", href: "/system/backup" },
  { key: "system-config", label: "参数配置", icon: "config", href: "/system/config" },
  { key: "system-init", label: "系统初始化", icon: "reset", href: "/system/init" },
];

export function Sidebar({ initialMenus = null }: { initialMenus?: string[] | null } = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // 初始值来自服务端，首帧就按真实权限渲染
  const [menus, setMenus] = useState<string[] | null>(initialMenus);
  const [alertCount, setAlertCount] = useState(0);
  // 系统管理展开状态：默认收起，完全由用户手动控制
  // （不在 /system 页面自动展开，避免一进系统页就铺开一长串子菜单）
  const [sysOpen, setSysOpen] = useState(false);

  useEffect(() => {
    // 服务端已给权限时不必再请求，避免多余的一次往返
    if (initialMenus === null) {
      fetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setMenus(d.menus))
        .catch(() => {});
    }
    fetch("/api/alerts/count")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAlertCount(d.count))
      .catch(() => {});
  }, [initialMenus]);

  /**
   * 菜单可见性
   *
   * menus 为 null 表示「权限未知」（未登录，或服务端没取到）。
   * 这种情况下一律不放行 —— 宁可少显示、由服务端兜底，
   * 也不能先显示全部再过滤（那会闪，用户能看见）。
   *
   * 登录后服务端一定会传 menus 下来，所以正常使用不受影响。
   */
  const canSee = (key: string) => {
    if (menus === null) return false;
    return menus.includes(key);
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <>
      <button
        className="lg:hidden"
        onClick={() => setOpen(!open)}
        style={{ position: "fixed", left: 14, top: 16, zIndex: 55, fontSize: 18,
                 background: "none", border: 0, cursor: "pointer", color: "var(--sub)" }}
      >
        ☰
      </button>

      <aside
        className={`w-[228px] shrink-0 flex flex-col h-screen sticky top-0 ${open ? "" : "max-lg:-translate-x-full"} max-lg:fixed max-lg:z-50 max-lg:transition-transform`}
        style={{ background: "var(--side-bg)", color: "var(--side-text)",
                 boxShadow: open ? "0 0 40px rgba(0,0,0,.3)" : "none" }}
      >
        {/* 品牌区：Logo + 中文名 + ProjectFlow */}
        <LogoBrand />

        {/*
          品牌区分割线

          和其他三条分组线用完全相同的样式（中心微亮→两端淡出），
          靠位置区分层级，不靠亮度。

          曾经这里用过更强的版本（更亮 + 外发光），
          结果它比下面三条明显扎眼，整个侧栏看起来不是一套东西。
        */}
        <div className="side-divider-glow" />

        <nav className="side-nav" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "4px 10px 14px" }}>
          {/* 系统管理：可展开的二级菜单 */}
          {canSee("system") && (
            <div style={{ marginBottom: 2 }}>
              <div style={{
                fontSize: 10.5, color: "var(--side-dim)", padding: "10px 10px 5px",
                letterSpacing: 1.2, textTransform: "uppercase",
              }}>
                系统
              </div>

              <button
                onClick={() => setSysOpen(!sysOpen)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "7px 11px", borderRadius: 9,
                  fontSize: 13.5, marginBottom: 1, border: 0, cursor: "pointer",
                  fontFamily: "inherit", textAlign: "left",
                  color: pathname.startsWith("/system") && !sysOpen ? "#fff" : "var(--side-text)",
                  background: pathname.startsWith("/system") && !sysOpen
                    ? "linear-gradient(90deg,var(--pri),var(--pri-2))"
                    : "transparent",
                }}
              >
                <span style={{
                  width: 18, display: "inline-flex",
                  alignItems: "center", justifyContent: "center",
                  opacity: 0.92,
                }}>
                  <Icon name={SYSTEM_MENU.icon} size={16} />
                </span>
                系统管理
                <span style={{
                  marginLeft: "auto", fontSize: 9, opacity: 0.7,
                  transition: "transform .2s",
                  transform: sysOpen ? "rotate(90deg)" : "none",
                  display: "inline-block",
                }}>
                  ▶
                </span>
              </button>

              {sysOpen && (
                <div style={{ paddingLeft: 10, marginTop: 1, marginBottom: 4 }}>
                  {SYSTEM_CHILDREN.map((c) => {
                    const active = pathname === c.href;
                    return (
                      <Link
                        key={c.key}
                        href={c.href}
                        onClick={() => setOpen(false)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "5px 11px", borderRadius: 7, fontSize: 12.5,
                          marginBottom: 1, textDecoration: "none",
                          color: active ? "var(--pri)" : "var(--side-text)",
                          background: active ? "rgba(59,130,246,.14)" : "transparent",
                          fontWeight: active ? 700 : 400,
                        }}
                      >
                        <span style={{
                          width: 16, display: "inline-flex",
                          alignItems: "center", justifyContent: "center",
                          opacity: 0.8,
                        }}>
                          <Icon name={c.icon} size={14} />
                        </span>
                        {c.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/*
            分组标题的上边线：除了「整个侧栏的第一个可见分组」，其余都画。

            ★ 这里出过两次错，记下来：

            错误一（最初）：
              每个分组无条件加 borderTop。
              没有 system 权限的用户（如销售）看不到「系统」组，
              「业务」成了第一组，它的 borderTop 与品牌区下面那条线
              几乎贴在一起 —— 视觉上是两条平行线。

            错误二（第一次修复时）：
              只检查 NAV_GROUPS 里前面有没有可见分组，
              却忘了「系统」块是独立渲染、不在 NAV_GROUPS 里的。
              结果有 system 权限的用户（如王经理）：
                「系统」组是第一个 → 不画线（正确）
                「业务」组的判断没算上「系统」→ 也当成第一个 → 不画线（错误）
              于是系统管理菜单下面缺了那条分隔线。

            正确做法：把「系统块是否可见」作为初始条件参与判断。
          */}
          {NAV_GROUPS.map((g, gi) => {
            const items = g.items.filter((it) => canSee(it.key));
            if (items.length === 0) return null;

            // 侧栏最上方是独立的「系统」块（不在 NAV_GROUPS 中）
            // 它能显示时，「业务」等分组就不再是第一个
            const systemBlockVisible = canSee("system");

            const isFirstVisible =
              !systemBlockVisible &&
              !NAV_GROUPS.slice(0, gi).some((prev) =>
                prev.items.some((it) => canSee(it.key))
              );
            return (
              <div key={g.group}>
                <div
                  className={isFirstVisible ? undefined : "side-divider-soft"}
                  style={{
                    fontSize: 10.5, color: "var(--side-dim)", padding: "10px 10px 5px",
                    letterSpacing: 1.2, textTransform: "uppercase",
                    marginTop: isFirstVisible ? 0 : 5,
                  }}
                >
                  {g.group}
                </div>
                {items.map((it) => {
                  const active = isActive(it.href);
                  const showBadge = it.key === "alerts" && alertCount > 0;
                  return (
                    <Link
                      key={it.key}
                      href={it.href}
                      onClick={() => setOpen(false)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "7px 11px",
                        borderRadius: 9, fontSize: 13.5, marginBottom: 1, textDecoration: "none",
                        color: active ? "#fff" : "var(--side-text)",
                        background: active
                          ? "linear-gradient(90deg,var(--pri),var(--pri-2))"
                          : "transparent",
                        boxShadow: active ? "0 4px 12px rgba(37,87,214,.3)" : "none",
                      }}
                    >
                      <span style={{
                        width: 18, display: "inline-flex",
                        alignItems: "center", justifyContent: "center",
                        opacity: 0.92,
                      }}>
                        <Icon name={it.icon} size={16} />
                      </span>
                      {it.label}
                      {showBadge && (
                        <span style={{
                          marginLeft: "auto", background: "var(--bad)", color: "#fff",
                          fontSize: 11, padding: "0 6px", borderRadius: 9,
                          fontWeight: 700, lineHeight: "17px",
                        }}>{alertCount}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* 底部：版本号 + 版权（居中） */}
        <div className="side-divider-soft" style={{
          padding: "12px 16px 14px",
          fontSize: 11, color: "var(--side-dim)", lineHeight: 1.7,
          textAlign: "center",
        }}>
          <div>当前版本：{APP_VERSION}</div>
          <div className="side-foot-en" style={{ fontSize: 10.5, opacity: 0.82 }}>
            © 2026 ProjectFlow. All rights reserved.
          </div>
        </div>
      </aside>

      {open && (
        <div className="lg:hidden" onClick={() => setOpen(false)}
             style={{ position: "fixed", inset: 0, background: "rgba(16,26,48,.45)", zIndex: 40 }} />
      )}
    </>
  );
}
