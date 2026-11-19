"use client";

import { useState } from "react";

export function ChangePassword() {
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPwd !== confirm) {
      setMsg({ type: "err", text: "两次输入的新密码不一致" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "修改失败" });
        return;
      }
      setMsg({ type: "ok", text: "密码已修改，其他设备的登录已失效" });
      setOldPwd(""); setNewPwd(""); setConfirm("");
      // 通知顶部的「初始密码」提醒横幅立即重新检查并消失
      window.dispatchEvent(new Event("pwd-changed"));
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 11px", fontSize: 13,
    border: "1px solid var(--line)", borderRadius: 8, outline: "none",
    background: "var(--card)", color: "var(--text)", boxSizing: "border-box",
  };

  return (
    <form onSubmit={submit} style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--sub)",
                        fontWeight: 600, marginBottom: 6 }}>原密码</label>
        <input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)}
               autoComplete="current-password" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--sub)",
                        fontWeight: 600, marginBottom: 6 }}>新密码</label>
        <input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
               autoComplete="new-password" placeholder="至少 8 位，需含字母和数字" style={inputStyle} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--sub)",
                        fontWeight: 600, marginBottom: 6 }}>确认新密码</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
               autoComplete="new-password" style={inputStyle} />
      </div>

      {msg && (
        <div className={`notice ${msg.type === "ok" ? "ok" : "danger"}`} style={{ marginBottom: 12 }}>
          <div>{msg.text}</div>
        </div>
      )}

      <button type="submit" className="btn btn-pri"
              disabled={busy || !oldPwd || !newPwd || !confirm}
              style={{ width: "100%", justifyContent: "center" }}>
        {busy ? "提交中…" : "修改密码"}
      </button>
      <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.7 }}>
        修改成功后，除当前设备外的其他登录会话将立即失效。
      </p>
    </form>
  );
}
