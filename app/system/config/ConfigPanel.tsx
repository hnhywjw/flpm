"use client";

import { useState } from "react";

interface Row {
  key: string;
  value: string;
  label: string | null;
  description: string | null;
  updated_at: string;
}

/** 参数分组（按 key 归类，未匹配的归入「其他」） */
const GROUPS: { title: string; desc: string; keys: string[] }[] = [
  {
    title: "基础信息",
    desc: "显示在报表、页面标题等处",
    keys: ["company_name", "system_title"],
  },
  {
    title: "登录与安全",
    desc: "控制台登录超时、密码策略",
    keys: ["session_timeout_min", "session_days", "login_max_fail", "lock_minutes"],
  },
  {
    title: "证书配置",
    desc: "SSL 证书路径与到期提醒（证书状态见上方）",
    keys: ["ssl_cert_path", "ssl_key_path", "ssl_expire_warn_days"],
  },
  {
    title: "业务与运维",
    desc: "分页、SLA、备份保留",
    keys: ["page_size", "sla_hours", "backup_keep"],
  },
  {
    title: "磁盘预警",
    desc: "磁盘使用率超阈值时推送给总经理和系统管理员",
    keys: ["disk_warn_pct", "disk_danger_pct", "disk_min_free_mb"],
  },
];

export function ConfigPanel({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [edit, setEdit] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((r) => [r.key, r.value]))
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  const dirty = rows.some((r) => edit[r.key] !== r.value);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveParams", params: edit }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ t: "err", m: d.error ?? "保存失败" }); return; }

      setMsg({ t: "ok", m: `已保存 ${d.updated} 项参数` });
      setRows((prev) => prev.map((r) => ({ ...r, value: edit[r.key] ?? r.value })));
    } catch (e) {
      setMsg({ t: "err", m: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setEdit(Object.fromEntries(rows.map((r) => [r.key, r.value])));
    setMsg(null);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 12px" }}>
        <button className="btn btn-pri btn-sm" onClick={save} disabled={busy || !dirty}>
          {busy ? "保存中…" : dirty ? "保存修改" : "无修改"}
        </button>
        {dirty && (
          <button className="btn btn-sm" onClick={reset} disabled={busy}>
            撤销
          </button>
        )}
        {dirty && (
          <span style={{ fontSize: 11.5, color: "var(--warn, #d97706)", fontWeight: 600 }}>
            有未保存的修改
          </span>
        )}
      </div>

      {msg && (
        <div className={msg.t === "ok" ? "notice ok" : "notice danger"} style={{ marginBottom: 12 }}>
          <div>{msg.m}</div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            暂无参数（请确认已执行数据库迁移 015）
          </div>
        </div>
      ) : (
        GROUPS.map((g) => {
          const gr = rows.filter((r) => g.keys.includes(r.key));
          if (gr.length === 0) return null;
          const dirtyGroup = gr.some((r) => edit[r.key] !== r.value);
          return (
            <div key={g.title} className="card" style={{ marginBottom: 14 }}>
              <div className="card-h">
                <h3>{g.title}</h3>
                {dirtyGroup && (
                  <span style={{
                    marginLeft: 8, fontSize: 10.5, color: "var(--warn, #d97706)",
                    fontWeight: 700,
                  }}>
                    有修改
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted)" }}>
                  {g.desc}
                </span>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ display: "grid", gap: 16 }}>
                  {gr.map((r) => (
                    <div key={r.key}>
                      <label style={{
                        display: "flex", alignItems: "center", gap: 8,
                        fontSize: 12.5, fontWeight: 600, color: "var(--text)",
                        marginBottom: 6,
                      }}>
                        {r.label ?? r.key}
                        <code style={{
                          fontSize: 10.5, color: "var(--muted)", fontWeight: 400,
                          background: "var(--bg)", padding: "1px 5px", borderRadius: 4,
                        }}>
                          {r.key}
                        </code>
                        {edit[r.key] !== r.value && (
                          <span style={{
                            fontSize: 10.5, color: "var(--warn, #d97706)", fontWeight: 700,
                          }}>
                            已修改
                          </span>
                        )}
                      </label>
                      {r.description && (
                        <div style={{
                          fontSize: 11.5, color: "var(--muted)", marginBottom: 6,
                        }}>
                          {r.description}
                        </div>
                      )}
                      <input
                        value={edit[r.key] ?? ""}
                        onChange={(e) => setEdit({ ...edit, [r.key]: e.target.value })}
                        placeholder={r.key.startsWith("ssl_") && r.key.endsWith("_path")
                          ? "如 /home/ltc/nginx/certs/server.crt" : undefined}
                        style={{
                          width: "100%", maxWidth: 460, padding: "8px 11px",
                          fontSize: 13, border: "1px solid var(--line)", borderRadius: 8,
                          background: "var(--card)", color: "var(--text)",
                          boxSizing: "border-box", outline: "none",
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })
      )}

      <div className="notice" style={{ marginTop: 14 }}>
        <div>
          <b>注意：</b>部分参数（如会话有效期、登录失败上限）在当前版本中读取自代码常量，
          修改此处不会立即生效，需在下一版本接入。当前生效的为
          <b>公司名称</b>、<b>系统标题</b> 等展示类参数。
        </div>
      </div>
    </>
  );
}
