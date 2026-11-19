"use client";

import { useState, useEffect } from "react";

const CHANNELS = [
  { key: "dingtalk", label: "钉钉群机器人", hint: "钉钉群 → 群设置 → 机器人 → 自定义" },
  { key: "wecom", label: "企业微信群机器人", hint: "企微群 → 群设置 → 群机器人 → 添加" },
  { key: "webhook", label: "通用 Webhook", hint: "POST JSON 到你自己的服务" },
];

export function NotifyConfig() {
  const [channel, setChannel] = useState("dingtalk");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [hasSecret, setHasSecret] = useState(false);
  const [urlMasked, setUrlMasked] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  async function load() {
    const res = await fetch("/api/notifications?config=1");
    if (!res.ok) return;
    const d = await res.json();
    setChannel(d.channel || "dingtalk");
    setEnabled(d.enabled);
    setHasSecret(d.hasSecret);
    setUrlMasked(d.urlMasked || "");
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const payload: Record<string, unknown> = { channel, enabled };
      // 只有用户改动了才提交，避免把掩码写回
      if (url && !url.includes("****")) payload.url = url;
      if (secret && !secret.includes("****")) payload.secret = secret;

      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ t: "err", m: d.error }); return; }
      setMsg({ t: "ok", m: "配置已保存" });
      setUrl(""); setSecret("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const d = await res.json();
      if (d.ok) setMsg({ t: "ok", m: "测试消息已发送，请查看群消息" });
      else setMsg({ t: "err", m: "发送失败：" + (d.error ?? "未知错误") });
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid var(--line)",
    borderRadius: 8, background: "var(--card)", color: "var(--text)", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, color: "var(--sub)", fontWeight: 600, marginBottom: 6,
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {CHANNELS.map((c) => (
          <button key={c.key} onClick={() => setChannel(c.key)}
            style={{
              padding: "7px 13px", fontSize: 12.5, borderRadius: 8, cursor: "pointer",
              border: `1px solid ${channel === c.key ? "var(--pri)" : "var(--line)"}`,
              background: channel === c.key ? "var(--pri-weak)" : "var(--card)",
              color: channel === c.key ? "var(--pri-2)" : "var(--sub)",
              fontWeight: channel === c.key ? 700 : 400,
            }}>
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", maxWidth: 760 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>
            Webhook 地址
            {urlMasked && <span style={{ color: "var(--muted)", fontWeight: 400 }}>（已保存：{urlMasked}）</span>}
          </label>
          <input value={url} onChange={(e) => setUrl(e.target.value)}
                 placeholder={urlMasked || "https://oapi.dingtalk.com/robot/send?access_token=..."}
                 style={inputStyle} />
        </div>
        {channel === "dingtalk" && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>
              加签密钥（可选）
              {hasSecret && <span style={{ color: "var(--muted)", fontWeight: 400 }}>（已设置）</span>}
            </label>
            <input value={secret} onChange={(e) => setSecret(e.target.value)}
                   placeholder={hasSecret ? "已设置，留空则不修改" : "SEC 开头的密钥"}
                   style={inputStyle} />
          </div>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            启用消息推送（审批待办、逾期预警、节点超期等）
          </label>
        </div>
      </div>

      {msg && (
        <div className={msg.t === "ok" ? "notice ok" : "notice danger"} style={{ marginTop: 12, maxWidth: 760 }}>
          <div>{msg.m}</div>
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button className="btn btn-pri" disabled={busy} onClick={save}>
          {busy ? "保存中…" : "保存配置"}
        </button>
        <button className="btn" disabled={busy || !enabled} onClick={test}>发送测试消息</button>
      </div>

      <div className="notice" style={{ marginTop: 14, maxWidth: 760 }}>
        <div>
          <b>获取 Webhook 地址</b>
          {CHANNELS.find((c) => c.key === channel)?.hint}
          <br />
          推送内容包含审批待办、节点超期、回款逾期、投标截止、质保金到期等提醒。
          配置保存在数据库，重启不丢失。
        </div>
      </div>
    </div>
  );
}
