"use client";

import { useState } from "react";
import { THEMES, useTheme } from "./ThemeProvider";

export function ThemePanel() {
  const { theme, side, setTheme, setSide } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        title="界面风格"
        style={{
          position: "fixed", right: 22, bottom: 22, width: 46, height: 46, borderRadius: "50%",
          background: "var(--pri)", color: "#fff", fontSize: 19, zIndex: 60,
          boxShadow: "0 8px 24px rgba(37,87,214,.4)", border: 0, cursor: "pointer",
        }}
      >
        ◑
      </button>

      {open && (
        <div style={{
          position: "fixed", right: 22, bottom: 80, width: 296, background: "var(--card)",
          border: "1px solid var(--line)", borderRadius: 14, padding: 16, zIndex: 60,
          boxShadow: "0 20px 50px rgba(16,24,40,.18)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 13, display: "flex" }}>
            界面风格
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted)", fontWeight: 400 }}>
              实时预览
            </span>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 7 }}>主题配色</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7 }}>
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTheme(t.key)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                    padding: "7px 3px", fontSize: 11, cursor: "pointer",
                    border: `1px solid ${theme === t.key ? "var(--pri)" : "var(--line)"}`,
                    borderRadius: 9, background: theme === t.key ? "var(--pri-weak)" : "var(--card)",
                    color: theme === t.key ? "var(--pri-2)" : "var(--sub)",
                    fontWeight: theme === t.key ? 700 : 400,
                  }}
                >
                  <i style={{ width: 24, height: 14, borderRadius: 4, background: t.color, display: "block" }} />
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 7 }}>侧边栏</div>
            <div style={{ display: "flex", gap: 7 }}>
              {(["dark", "light"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  style={{
                    flex: 1, padding: 6, fontSize: 12, cursor: "pointer",
                    border: `1px solid ${side === s ? "var(--pri)" : "var(--line)"}`,
                    borderRadius: 8, background: side === s ? "var(--pri-weak)" : "var(--card)",
                    color: side === s ? "var(--pri-2)" : "var(--sub)", fontWeight: side === s ? 700 : 400,
                  }}
                >
                  {s === "dark" ? "深色" : "浅色"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.7,
                        borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            6 套配色 × 深/浅侧栏 = 12 种组合。选择会保存在本机。
          </div>
        </div>
      )}
    </>
  );
}
