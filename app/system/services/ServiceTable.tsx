"use client";

import { useState, useEffect, useCallback } from "react";
import type { ServiceStatus, ProcInfo } from "@/lib/sysinfo";

function fmtSec(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + "天" + h + "h";
  if (h > 0) return h + "h" + m + "m";
  return m + "m";
}

export function ServiceTable({ initial }: { initial: ServiceStatus[] }) {
  const [services, setServices] = useState(initial);
  const [procs, setProcs] = useState<ProcInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [ts, setTs] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/system?type=services", { cache: "no-store" }),
        fetch("/api/system?type=procs", { cache: "no-store" }),
      ]);
      if (r1.ok) {
        const d = await r1.json();
        setServices(d.services ?? []);
      }
      if (r2.ok) {
        const d = await r2.json();
        setProcs(d.procs ?? []);
      }
      setTs(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 自动刷新 15 秒
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [auto, refresh]);

  const badge = (s: ServiceStatus["status"]) => {
    if (s === "ok") return { cls: "badge b-ok", text: "正常" };
    if (s === "warn") return { cls: "badge b-warn", text: "警告" };
    return { cls: "badge b-bad", text: "异常" };
  };

  const stateLabel = (s: string) =>
    s === "R" ? "运行" : s === "S" ? "睡眠" : s === "D" ? "不可中断" :
    s === "Z" ? "僵尸" : s === "T" ? "停止" : s;

  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        margin: "4px 0 12px", fontSize: 12.5, flexWrap: "wrap",
      }}>
        <button
          onClick={() => setAuto(!auto)}
          style={{
            padding: "5px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer",
            border: `1px solid ${auto ? "var(--pri)" : "var(--line)"}`,
            background: auto ? "var(--pri-weak)" : "var(--card)",
            color: auto ? "var(--pri-2)" : "var(--sub)",
            fontWeight: auto ? 700 : 400, fontFamily: "inherit",
          }}
        >
          {auto ? "● 自动刷新 15s" : "○ 自动刷新已关"}
        </button>
        <button className="btn btn-sm" onClick={refresh} disabled={busy}>
          {busy ? "检测中…" : "立即刷新"}
        </button>
        {ts && <span style={{ color: "var(--muted)", fontSize: 11.5 }}>更新于 {ts}</span>}
      </div>

      {/* 服务状态 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <h3>业务服务状态</h3>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            {services.filter((s) => s.status === "ok").length} / {services.length} 正常
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>服务</th>
                <th>状态</th>
                <th>详情</th>
                <th>指标</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => {
                const b = badge(s.status);
                return (
                  <tr key={s.key}>
                    <td><b>{s.name}</b></td>
                    <td><span className={b.cls}>{b.text}</span></td>
                    <td style={{ fontSize: 12.5, color: "var(--sub)" }}>{s.detail}</td>
                    <td className="num" style={{ fontSize: 12 }}>{s.metric ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 相关进程 */}
      <div className="card">
        <div className="card-h">
          <h3>相关进程状态</h3>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            共 {procs.length} 个进程
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>PID</th>
                <th>进程</th>
                <th>角色</th>
                <th>状态</th>
                <th>内存</th>
                <th>CPU 时间</th>
                <th>运行时长</th>
              </tr>
            </thead>
            <tbody>
              {procs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                    {busy ? "读取中…" : "当前环境不支持进程读取（需 Linux /proc）"}
                  </td>
                </tr>
              ) : (
                procs.map((p) => (
                  <tr key={p.pid}>
                    <td className="num" style={{ fontSize: 12 }}>{p.pid}</td>
                    <td>
                      <b style={{ fontSize: 12.5 }}>{p.name}</b>
                      {p.cmd && (
                        <div style={{
                          fontSize: 10.5, color: "var(--muted)",
                          maxWidth: 260, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }} title={p.cmd}>
                          {p.cmd}
                        </div>
                      )}
                    </td>
                    <td>
                      {p.role ? (
                        <span className="badge b-pri">{p.role}</span>
                      ) : (
                        <span className="badge b-gray">—</span>
                      )}
                    </td>
                    <td>
                      <span className={p.state === "R" ? "badge b-ok" : "badge b-gray"}>
                        {stateLabel(p.state)}
                      </span>
                    </td>
                    <td className="num">{p.rssMB} MB</td>
                    <td className="num" style={{ fontSize: 12 }}>{p.cpuSec}s</td>
                    <td className="num" style={{ fontSize: 12 }}>{fmtSec(p.uptimeSec)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="notice" style={{ marginTop: 14 }}>
        <div>
          <b>说明：</b>服务检测与进程读取均为只读操作，不影响业务。
          进程列表仅显示本系统相关进程（应用、备份调度、任务调度）及常驻内存 50MB 以上的进程。
        </div>
      </div>
    </>
  );
}
