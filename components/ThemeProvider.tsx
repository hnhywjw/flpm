"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const THEMES = [
  { key: "blue", name: "商务蓝", color: "#2557d6" },
  { key: "teal", name: "科技青", color: "#0e7c86" },
  { key: "green", name: "稳健绿", color: "#0f7a5a" },
  { key: "violet", name: "雅致紫", color: "#5b3fd6" },
  { key: "red", name: "中国红", color: "#b8282a" },
  { key: "gray", name: "商务灰", color: "#3d4759" },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];
export type SideMode = "dark" | "light";

interface ThemeCtx {
  theme: ThemeKey;
  side: SideMode;
  setTheme: (t: ThemeKey) => void;
  setSide: (s: SideMode) => void;
}

const Ctx = createContext<ThemeCtx>({
  theme: "blue",
  side: "dark",
  setTheme: () => {},
  setSide: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 初始值：优先读 layout 内联脚本已经设好的 DOM 属性
  //
  // 为什么不在 useEffect 里恢复：
  // 那样 state 会先保持默认（blue/dark），随后被下面两个 effect 写回 DOM，
  // 造成「已设好的属性被覆盖成默认值，再改回来」的二次闪烁。
  // 直接以 DOM 属性为准，首帧 state 就与实际显示一致。
  const [theme, setThemeState] = useState<ThemeKey>(() => {
    if (typeof document === "undefined") return "blue";
    const v = document.documentElement.getAttribute("data-theme") as ThemeKey | null;
    return v && THEMES.some((x) => x.key === v) ? v : "blue";
  });

  const [side, setSideState] = useState<SideMode>(() => {
    if (typeof document === "undefined") return "dark";
    const v = document.documentElement.getAttribute("data-side");
    return v === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("ltc-theme", theme); } catch { /* 隐私模式 */ }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-side", side);
    try { localStorage.setItem("ltc-side", side); } catch { /* 隐私模式 */ }
  }, [side]);

  return (
    <Ctx.Provider value={{ theme, side, setTheme: setThemeState, setSide: setSideState }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
