"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 强制改密表单
 *
 * 这个页面没有侧栏和菜单，用户只能做两件事：
 *   1. 改密码（成功后自动进系统）
 *   2. 退出登录
 *
 * 校验规则与 /api/auth/change-password 保持一致，
 * 前端先拦一道，减少无效请求。
 */
export function ForceChangeForm({ userName }: { userName: string }) {
  const router = useRouter();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const rules = [
    { ok: newPwd.length >= 8, text: "至少 8 位" },
    { ok: /[a-zA-Z]/.test(newPwd), text: "含字母" },
    { ok: /[0-9]/.test(newPwd), text: "含数字" },
    { ok: newPwd !== "" && newPwd !== oldPwd, text: "不同于原密码" },
    { ok: newPwd !== "" && newPwd === confirm, text: "两次一致" },
  ];
  const allOk = rules.every((r) => r.ok);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!oldPwd) {
      setMsg({ type: "err", text: "请输入原密码" });
      return;
    }
    if (!allOk) {
      setMsg({ type: "err", text: "新密码不满足要求" });
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
      setMsg({ type: "ok", text: "密码已修改，正在进入系统…" });
      // 用整页跳转而不是 router.push：
      // 服务端要重新渲染、重新读 mustChangePwd，客户端路由可能命中缓存
      setTimeout(() => {
        window.location.href = "/";
      }, 700);
    } catch (err) {
      setMsg({ type: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", fontSize: 13.5,
    border: "1px solid var(--line)", borderRadius: 8, outline: "none",
    background: "var(--card)", color: "var(--text)",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, color: "var(--sub)",
    fontWeight: 600, marginBottom: 6,
  };

  return (
    <div style={{
      minHeight: "100vh", display: "grid", placeItems: "center",
      background: "var(--bg)", padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 420, background: "var(--card)",
        borderRadius: 16, padding: "28px 28px 24px",
        boxShadow: "0 20px 60px rgba(16,24,40,.12)",
        border: "1px solid var(--line)",
      }}>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
          项目全流程管理系统
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: 19, fontWeight: 800, color: "var(--text)" }}>
          请先修改登录密码
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 12.5, color: "var(--sub)", lineHeight: 1.8 }}>
          {userName}，你正在使用<b style={{ color: "var(--text)" }}>初始密码</b>
          或管理员重置的密码。为保障账号安全，修改后才能进入系统。
        </p>

        <form onSubmit={submit}>
          <label style={labelStyle}>原密码</label>
          <input
            type="password"
            value={oldPwd}
            onChange={(e) => setOldPwd(e.target.value)}
            placeholder="当前使用的密码"
            autoComplete="current-password"
            autoFocus
            style={{ ...inputStyle, marginBottom: 14 }}
          />

          <label style={labelStyle}>新密码</label>
          <input
            type="password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="设置一个新密码"
            autoComplete="new-password"
            style={{ ...inputStyle, marginBottom: 8 }}
          />

          <div style={{
            display: "flex", flexWrap: "wrap", gap: "6px 12px",
            marginBottom: 14, fontSize: 11.5,
          }}>
            {rules.slice(0, 4).map((r) => (
              <span key={r.text} style={{
                color: r.ok ? "var(--ok, #16a34a)" : "var(--muted)",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <span style={{ fontSize: 10 }}>{r.ok ? "✓" : "○"}</span>
                {r.text}
              </span>
            ))}
          </div>

          <label style={labelStyle}>确认新密码</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="再次输入新密码"
            autoComplete="new-password"
            style={{ ...inputStyle, marginBottom: 14 }}
          />

          {msg && (
            <div
              className={msg.type === "ok" ? "notice ok" : "notice danger"}
              style={{ marginBottom: 14 }}
            >
              {msg.text}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-pri"
            disabled={busy || !allOk || !oldPwd}
            style={{
              width: "100%",
              padding: "10px 0",
              fontSize: 13.5,
              // .btn 默认是 inline-flex + 左对齐，撑满宽度后文字仍在左侧，
              // 这里显式居中
              justifyContent: "center",
            }}
          >
            {busy ? "提交中…" : "修改并进入系统"}
          </button>
        </form>

        <div style={{
          marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)",
          textAlign: "center",
        }}>
          <button
            onClick={logout}
            style={{
              border: 0, background: "transparent", color: "var(--muted)",
              fontSize: 12, cursor: "pointer",
            }}
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
