"use client";

import { useState, useEffect } from "react";

interface TableInfo {
  name: string;
  count: number;
  keep: boolean;
}

export function InitPanel() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  // 二次认证弹窗
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<{
    cleared: { table: string; before: number }[];
    failed: string[];
    totalCleared: number;
    backupFile: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/system/init", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setTables(d.tables ?? []);
        setTotal(d.totalBusiness ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/system/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmText }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg({ t: "err", m: d.error ?? "初始化失败" });
        return;
      }
      setResult(d);
      setMsg({ t: "ok", m: `已清空 ${d.totalCleared} 条业务数据` });
      setOpen(false);
      setPassword(""); setConfirmText("");
      await load();
    } catch (e) {
      setMsg({ t: "err", m: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const business = tables.filter((t) => !t.keep && t.count > 0);
  const emptyBusiness = tables.filter((t) => !t.keep && t.count === 0);
  const keep = tables.filter((t) => t.keep);

  const card: React.CSSProperties = {
    background: "var(--card)", border: "1px solid var(--line)",
    borderRadius: 12, padding: 16,
  };

  return (
    <>
      {/* 危险操作警示 */}
      <div style={{
        background: "#fef2f2", border: "1px solid #fecaca",
        borderRadius: 12, padding: "16px 18px", marginBottom: 16,
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
          ⚠ 危险操作
        </div>
        <div style={{ fontSize: 12.5, color: "#7f1d1d", lineHeight: 1.9 }}>
          此操作会<b>永久删除所有业务数据</b>（项目、合同、回款、出入库、售后等），
          且<b>无法撤销</b>。
          <br />
          仅建议在<b>新环境部署</b>时用于清空演示数据。
          <br />
          执行前系统会<b>自动生成一份完整备份</b>，但请务必自行确认备份可用。
        </div>
      </div>

      {msg && (
        <div className={msg.t === "ok" ? "notice ok" : "notice danger"} style={{ marginBottom: 14 }}>
          <div>{msg.m}</div>
        </div>
      )}

      {/* 执行结果 */}
      {result && (
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--ok, #16a34a)" }}>
            初始化完成
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 2, color: "var(--sub)" }}>
            <div>清空记录：<b style={{ color: "var(--text)" }}>{result.totalCleared} 条</b></div>
            <div>涉及表：<b style={{ color: "var(--text)" }}>{result.cleared.length} 张</b></div>
            <div>备份文件：<code style={{ fontSize: 11.5 }}>{result.backupFile}</code></div>
            {result.failed.length > 0 && (
              <div style={{ color: "var(--bad)", marginTop: 6 }}>
                失败 {result.failed.length} 张表：{result.failed.join("; ")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 当前数据量 */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
        }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>当前数据量</span>
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: total > 0 ? "var(--bad)" : "var(--ok, #16a34a)",
          }}>
            业务数据 {total} 条
          </span>
          <button
            className="btn btn-sm"
            style={{ marginLeft: "auto" }}
            onClick={load}
            disabled={loading}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>

        {business.length > 0 ? (
          <div style={{
            display: "grid", gap: 6, marginBottom: 14,
            gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
          }}>
            {business.map((t) => (
              <div key={t.name} style={{
                display: "flex", justifyContent: "space-between",
                padding: "6px 10px", background: "var(--bg)",
                borderRadius: 6, fontSize: 12,
              }}>
                <code style={{ color: "var(--muted)" }}>{t.name}</code>
                <b style={{ color: "var(--bad)" }}>{t.count}</b>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            padding: "20px 0", textAlign: "center",
            color: "var(--ok, #16a34a)", fontSize: 13, marginBottom: 14,
          }}>
            业务数据已清空（{emptyBusiness.length} 张业务表均为 0 条）
          </div>
        )}

        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.8 }}>
          以下表会被保留，不受初始化影响：
          <div style={{
            display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6,
          }}>
            {keep.map((t) => (
              <span key={t.name} className="badge b-ok">
                {t.name}（{t.count}）
              </span>
            ))}
          </div>
        </div>

        <button
          className="btn btn-sm"
          style={{
            background: total > 0 ? "var(--bad)" : "var(--line)",
            color: total > 0 ? "#fff" : "var(--muted)",
            border: 0, fontWeight: 700,
          }}
          disabled={total === 0}
          onClick={() => {
            setMsg(null); setResult(null);
            setPassword(""); setConfirmText("");
            setOpen(true);
          }}
        >
          {total > 0 ? "清空全部业务数据" : "无需清空"}
        </button>
      </div>

      {/* 二次认证弹窗 */}
      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(16,26,48,.6)",
            zIndex: 95, display: "grid", placeItems: "center", padding: 16,
          }}
          onClick={() => !busy && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 440, background: "var(--card)",
              borderRadius: 16, padding: "24px 24px 20px",
              boxShadow: "0 20px 60px rgba(0,0,0,.35)",
            }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--bad)" }}>
              确认清空全部业务数据
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--sub)", lineHeight: 1.8 }}>
              将删除 <b style={{ color: "var(--bad)" }}>{total}</b> 条业务记录。
              系统会先自动备份，但此操作<b>不可撤销</b>。
            </p>

            <label style={{
              display: "block", fontSize: 12.5, fontWeight: 600,
              color: "var(--text)", marginBottom: 6,
            }}>
              当前账号密码（二次认证）
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入你当前的登录密码"
              autoFocus
              style={{
                width: "100%", padding: "9px 11px", fontSize: 13,
                border: "1px solid var(--line)", borderRadius: 8,
                background: "var(--bg)", color: "var(--text)",
                boxSizing: "border-box", outline: "none", marginBottom: 14,
              }}
            />

            <label style={{
              display: "block", fontSize: 12.5, fontWeight: 600,
              color: "var(--text)", marginBottom: 6,
            }}>
              输入确认短语
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="清空全部数据"
              style={{
                width: "100%", padding: "9px 11px", fontSize: 13,
                border: "1px solid var(--line)", borderRadius: 8,
                background: "var(--bg)", color: "var(--text)",
                boxSizing: "border-box", outline: "none", marginBottom: 8,
              }}
            />
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 16 }}>
              请手动输入「清空全部数据」五个字确认
            </div>

            {msg && msg.t === "err" && (
              <div className="notice danger" style={{ marginBottom: 14 }}>
                <div>{msg.m}</div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-sm" onClick={() => setOpen(false)} disabled={busy}>
                取消
              </button>
              <button
                className="btn btn-sm"
                style={{ background: "var(--bad)", color: "#fff", border: 0, fontWeight: 700 }}
                onClick={submit}
                disabled={busy || !password || confirmText.trim() !== "清空全部数据"}
              >
                {busy ? "执行中…" : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
