"use client";

import { useState, useEffect } from "react";

interface TZInfo {
  timezone: string;
  options: { value: string; label: string }[];
  serverTime: string;
  serverDate: string;
  offsetMinutes: number;
  serverEpochMs: number;
}

/**
 * 时区设置面板
 *
 * 为什么要显示「服务器时间」和「浏览器时间」对照：
 *   用户电脑时钟经常不准。如果只看服务器时间，用户无法判断
 *   「系统记的日期」和「我以为的日期」差在哪一侧。
 *   两个时间摆在一起，偏差多少一目了然。
 */
export function TimezonePanel() {
  const [info, setInfo] = useState<TZInfo | null>(null);
  const [tz, setTz] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [browser, setBrowser] = useState("");

  // 浏览器本地时间：每秒刷新，方便肉眼比对
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      setBrowser(
        d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
        " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    const res = await fetch("/api/system/timezone");
    if (res.ok) {
      const d: TZInfo = await res.json();
      setInfo(d);
      setTz(d.timezone);
    }
  }
  useEffect(() => { load(); }, []);

  // 服务器时间也要走字，否则用户以为页面卡住了
  const [serverTick, setServerTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setServerTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  function serverNowText(): string {
    if (!info) return "—";
    // 用首次拿到的 epoch + 已流逝时间推算，避免每秒请求
    const elapsed = Date.now() - fetchAt;
    const d = new Date(info.serverEpochMs + elapsed + serverTick * 0);
    // 按配置时区格式化
    try {
      const fmt = new Intl.DateTimeFormat("zh-CN", {
        timeZone: info.timezone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      });
      const p: Record<string, string> = {};
      for (const x of fmt.formatToParts(d)) if (x.type !== "literal") p[x.type] = x.value;
      const hh = p.hour === "24" ? "00" : p.hour;
      return p.year + "-" + p.month + "-" + p.day + " " + hh + ":" + p.minute + ":" + p.second;
    } catch {
      return info.serverTime;
    }
  }

  useEffect(() => { if (info) setFetchAt(Date.now()); }, [info]);
  const [fetchAt, setFetchAt] = useState(0);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/system/timezone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg({ t: "err", m: d.error ?? "保存失败" });
        return;
      }
      setInfo((prev) => (prev ? { ...prev, ...d } : prev));
      setFetchAt(Date.now());
      setMsg({ t: "ok", m: "时区已保存，新录入的日期会按新时区计算" });
    } catch (e) {
      setMsg({ t: "err", m: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // 服务器与浏览器的偏差（分钟）
  let diffMin: number | null = null;
  if (browser && info) {
    const b = new Date(browser.replace(" ", "T"));
    const s = new Date(serverNowText().replace(" ", "T"));
    if (!isNaN(b.getTime()) && !isNaN(s.getTime())) {
      diffMin = Math.round((s.getTime() - b.getTime()) / 60000);
    }
  }

  const offH = info ? (info.offsetMinutes >= 0 ? "+" : "") + (info.offsetMinutes / 60) : "";

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-h">
        <h3>时区与时间</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          影响全系统日期：合同签署、回款计划、开票、节点计划、出入库、验收
        </span>
      </div>
      <div style={{ padding: 16 }}>
        {!info ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>加载中…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ minWidth: 320 }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--sub)",
                                fontWeight: 600, marginBottom: 6 }}>
                  时区
                </label>
                <select
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}
                  disabled={busy}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--line)",
                           borderRadius: 8, fontSize: 13, background: "var(--card)" }}
                >
                  {info.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <button className="btn" onClick={save} disabled={busy || tz === info.timezone}>
                {busy ? "保存中…" : tz === info.timezone ? "已是当前时区" : "保存"}
              </button>
            </div>

            {msg && (
              <div className={`notice ${msg.t === "ok" ? "ok" : "danger"}`}
                   style={{ marginTop: 12 }}>
                <div>{msg.m}</div>
              </div>
            )}

            <table className="tbl" style={{ marginTop: 16 }}>
              <thead>
                <tr><th>项目</th><th>时间</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>服务器时间</b></td>
                  <td className="num" style={{ fontFamily: "monospace" }}>{serverNowText()}</td>
                  <td style={{ fontSize: 12, color: "var(--sub)" }}>按上面选择的时区（UTC{offH}）</td>
                </tr>
                <tr>
                  <td><b>浏览器时间</b></td>
                  <td className="num" style={{ fontFamily: "monospace" }}>{browser}</td>
                  <td style={{ fontSize: 12, color: "var(--sub)" }}>你当前设备的本地时间</td>
                </tr>
              </tbody>
            </table>

            {diffMin !== null && Math.abs(diffMin) >= 1 && (
              <div className="notice danger" style={{ marginTop: 12 }}>
                <div>
                  <b>时间不一致：相差 {Math.abs(diffMin)} 分钟</b>
                  {diffMin > 0
                    ? "（服务器比你的设备快）"
                    : "（服务器比你的设备慢）"}
                  <br />
                  如果这个偏差超过几分钟，建议校正服务器或本机时钟 ——
                  否则同一条业务记录的日期可能对不上。
                </div>
              </div>
            )}

            <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
              <div>· 时区改动<b>只影响之后新录入的日期</b>，历史数据不会被改写。</div>
              <div>· 系统所有「今天」都按此时区计算，与数据库 <code>date(&apos;now&apos;,&apos;localtime&apos;)</code> 保持一致。</div>
              <div>· 仅总经理与系统管理员可修改。</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
