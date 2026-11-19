"use client";

import { useState, useEffect } from "react";

interface Run {
  id: number; job_key: string; run_date: string; status: string;
  detail: string | null; items_sent: number; error: string | null; started_at: string;
}
interface Cfg { enabled: boolean; hour: number; minute: number }

const JOB_NAMES: Record<string, string> = {
  node_overdue: "节点超期",
  payment_overdue: "回款逾期",
  bid_deadline: "投标截止",
  warranty_expiry: "质保到期",
  stock_alert: "库存预警",
  approval_timeout: "审批超时",
  sla_escalate: "工单超时升级",
  disk_usage: "磁盘使用率",
  orphan_cleanup: "孤儿附件清理",
};

const JOB_TARGETS: Record<string, string> = {
  node_overdue: "项目经理、销售、节点责任人",
  payment_overdue: "财务、销售、项目经理、总经理",
  bid_deadline: "商务、销售",
  warranty_expiry: "售后、销售、项目经理",
  stock_alert: "库管、财务、总经理",
  approval_timeout: "总经理",
  sla_escalate: "售后、总经理、责任人",
  disk_usage: "总经理、系统管理员",
  orphan_cleanup: "总经理、系统管理员（仅清理时通知）",
};

export function JobsPanel() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [r1, r2] = await Promise.all([
      fetch("/api/jobs"),
      fetch("/api/jobs/config"),
    ]);
    if (r1.ok) setRuns((await r1.json()).runs ?? []);
    if (r2.ok) setCfg((await r2.json()).config);
  }
  useEffect(() => { load(); }, []);

  async function saveCfg(next: Cfg) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveConfig", config: next }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error); return; }
      setCfg(next);
      setMsg("配置已保存，调度器会在下次检查时生效（约 2 分钟内）");
    } finally { setBusy(false); }
  }

  async function trigger() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error); return; }
      const total = (d.results ?? []).reduce((s: number, r: { sent: number }) => s + r.sent, 0);
      setMsg(`执行完成，共推送 ${total} 条`);
      await load();
    } finally { setBusy(false); }
  }

  const inputStyle: React.CSSProperties = {
    padding: "6px 10px", fontSize: 13, border: "1px solid var(--line)",
    borderRadius: 7, background: "var(--card)", color: "var(--text)", width: 80,
  };

  return (
    <div style={{ padding: 16 }}>
      {/* 时间配置 */}
      {cfg && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "12px 14px", background: "var(--bg)", borderRadius: 9,
          border: "1px solid var(--line)", marginBottom: 14,
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={cfg.enabled}
                   onChange={(e) => saveCfg({ ...cfg, enabled: e.target.checked })}
                   disabled={busy} />
            启用自动执行
          </label>

          <span style={{ fontSize: 13, color: "var(--sub)" }}>每天</span>
          <input type="number" min={0} max={23} value={cfg.hour}
                 onChange={(e) => setCfg({ ...cfg, hour: Number(e.target.value) })}
                 onBlur={() => saveCfg(cfg)}
                 disabled={busy || !cfg.enabled}
                 style={inputStyle} />
          <span style={{ fontSize: 13, color: "var(--sub)" }}>时</span>
          <input type="number" min={0} max={59} value={cfg.minute}
                 onChange={(e) => setCfg({ ...cfg, minute: Number(e.target.value) })}
                 onBlur={() => saveCfg(cfg)}
                 disabled={busy || !cfg.enabled}
                 style={inputStyle} />
          <span style={{ fontSize: 13, color: "var(--sub)" }}>分</span>

          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn btn-sm btn-pri" disabled={busy} onClick={trigger}>
              {busy ? "执行中…" : "立即执行一次"}
            </button>
          </span>
        </div>
      )}

      {msg && <div className="notice ok" style={{ marginBottom: 12 }}><div>{msg}</div></div>}

      {/* 任务说明 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: "var(--sub)", fontWeight: 600, marginBottom: 7 }}>
          任务与推送对象
        </div>
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
          {Object.entries(JOB_NAMES).map(([k, name]) => (
            <div key={k} style={{
              display: "flex", gap: 8, fontSize: 12.5,
              padding: "7px 10px", background: "var(--bg)", borderRadius: 7,
            }}>
              <b style={{ minWidth: 70 }}>{name}</b>
              <span style={{ color: "var(--muted)" }}>{JOB_TARGETS[k]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 执行记录 */}
      {runs.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          暂无执行记录
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>执行时间</th><th>任务</th><th>结果</th>
                <th>推送数</th><th>详情</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td className="num" style={{ fontSize: 12 }}>{r.started_at}</td>
                  <td>{JOB_NAMES[r.job_key] ?? r.job_key}</td>
                  <td>
                    <span className={"badge " + (r.status === "ok" ? "b-ok" : "b-bad")}>
                      {r.status === "ok" ? "成功" : "失败"}
                    </span>
                  </td>
                  <td className="num">{r.items_sent}</td>
                  <td style={{ fontSize: 12, whiteSpace: "normal", maxWidth: 300 }}>
                    {r.error ?? r.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
