"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";

// 输入框图标
const IconUser = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 22c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);

const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

const IconShield = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M9 3v18" />
  </svg>
);

export function LoginForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaImg, setCaptchaImg] = useState("");
  // 令牌认证（TOTP）：needTotp 为 true 时才显示输入框
  const [needTotp, setNeedTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [fUser, setFUser] = useState("");
  const [fContact, setFContact] = useState("");
  const [fNote, setFNote] = useState("");

  // 注册
  const [showReg, setShowReg] = useState(false);
  const [regBusy, setRegBusy] = useState(false);
  const [regMsg, setRegMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [regCaptchaImg, setRegCaptchaImg] = useState("");
  const [rUser, setRUser] = useState("");
  const [rPwd, setRPwd] = useState("");
  const [rName, setRName] = useState("");
  const [rPhone, setRPhone] = useState("");
  const [rDept, setRDept] = useState("");
  const [rCaptcha, setRCaptcha] = useState("");
  const pwdRef = useRef<HTMLInputElement>(null);

  // 加载验证码
  async function loadCaptcha() {
    try {
      const res = await fetch("/api/auth/captcha", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setCaptchaImg(d.image);
        setCaptcha("");
      }
    } catch { /* 忽略 */ }
  }

  async function loadRegCaptcha() {
    try {
      const res = await fetch("/api/auth/captcha", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setRegCaptchaImg(d.image);
        setRCaptcha("");
      }
    } catch { /* 忽略 */ }
  }

  useEffect(() => {
    loadCaptcha();
    // 记住用户名
    try {
      const saved = localStorage.getItem("ltc_remember_user");
      if (saved) {
        setName(saved);
        setRemember(true);
        setTimeout(() => pwdRef.current?.focus(), 100);
      }
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShake(false), 500);
    return () => clearTimeout(t);
  }, [shake]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);

    if (!name.trim()) { setErr("请输入用户名"); return; }
    if (!password) { setErr("请输入密码"); return; }
    if (!captcha.trim()) { setErr("请输入验证码"); return; }
    if (needTotp && !totpCode.trim()) { setErr("请输入令牌验证码"); return; }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          password,
          captcha: captcha.trim(),
          totpCode: totpCode.trim() || undefined,
        }),
      });
      const d = await res.json();

      if (!res.ok) {
        setErr(d.error ?? "登录失败");
        setShake(true);
        // 账号启用了令牌认证 → 切换到令牌输入
        if (d.needTotp) {
          setNeedTotp(true);
          setTotpCode("");
        } else {
          await loadCaptcha();  // 失败必须刷新验证码
        }
        return;
      }

      // 记住用户名
      try {
        if (remember) localStorage.setItem("ltc_remember_user", name.trim());
        else localStorage.removeItem("ltc_remember_user");
      } catch { /* 忽略 */ }

      const params = new URLSearchParams(window.location.search);
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setShake(true);
      await loadCaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    if (forgotBusy) return;
    setForgotMsg(null);
    if (!fUser.trim()) { setForgotMsg("请输入用户名"); return; }

    setForgotBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: fUser.trim(),
          contact: fContact.trim(),
          note: fNote.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setForgotMsg(d.error); return; }
      setForgotMsg(d.message);
      setFUser(""); setFContact(""); setFNote("");
    } catch (e) {
      setForgotMsg((e as Error).message);
    } finally {
      setForgotBusy(false);
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (regBusy) return;
    setRegMsg(null);

    setRegBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: rUser.trim(),
          password: rPwd,
          name: rName.trim(),
          phone: rPhone.trim(),
          dept: rDept.trim(),
          captcha: rCaptcha.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setRegMsg({ t: "err", m: d.error ?? "注册失败" });
        await loadRegCaptcha();
        return;
      }
      setRegMsg({ t: "ok", m: d.message });
      setRUser(""); setRPwd(""); setRName(""); setRPhone("");
      setRDept(""); setRCaptcha("");
    } catch (e) {
      setRegMsg({ t: "err", m: (e as Error).message });
      await loadRegCaptcha();
    } finally {
      setRegBusy(false);
    }
  }

  const inputGroup: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 9,
    background: "#f5f7fa",
    border: "1px solid #e5e7eb",
    borderRadius: 7,
    height: 46,
    padding: "0 12px",
    marginBottom: 10,
    transition: "border-color .2s, box-shadow .2s, background .2s",
  };

  const inputInner: React.CSSProperties = {
    flex: 1,
    border: 0,
    outline: "none",
    background: "transparent",
    fontSize: 13,
    color: "#1e293b",
    minWidth: 0,
  };

  const focusOn = (e: React.FocusEvent<HTMLDivElement>) => {
    e.currentTarget.style.borderColor = "#2563eb";
    e.currentTarget.style.background = "#fff";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(37,99,235,.1)";
  };
  const focusOff = (e: React.FocusEvent<HTMLDivElement>) => {
    e.currentTarget.style.borderColor = "#e5e7eb";
    e.currentTarget.style.background = "#f5f7fa";
    e.currentTarget.style.boxShadow = "none";
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(135deg, #eff6ff 0%, #e0e7ff 50%, #ede9fe 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 背景光斑 */}
      <div aria-hidden style={{
        position: "absolute", width: 520, height: 520, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(59,130,246,.18) 0%, transparent 68%)",
        top: "-16%", left: "-10%", pointerEvents: "none",
      }} />
      <div aria-hidden style={{
        position: "absolute", width: 460, height: 460, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,.15) 0%, transparent 68%)",
        bottom: "-14%", right: "-8%", pointerEvents: "none",
      }} />

      <div style={{ width: "min(440px, 100%)", position: "relative", zIndex: 1 }}>
        <div
          style={{
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            borderRadius: 20,
            border: "1px solid rgba(148,163,184,0.15)",
            boxShadow:
              "0 8px 32px rgba(15,23,42,.1), 0 2px 8px rgba(15,23,42,.06), inset 0 1px 0 rgba(255,255,255,.6)",
            padding: "32px 32px 28px",
            animation: shake ? "loginShake .45s" : undefined,
          }}
        >
          {/* 品牌区：Logo 左，右侧两行等宽 */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
            <div style={{
              flexShrink: 0, lineHeight: 0,
              animation: "logoFloat 3s ease-in-out infinite",
              filter: "drop-shadow(0 5px 12px rgba(37,99,235,0.26))",
              transformStyle: "preserve-3d",
            }}>
              <Logo size={68} onDark={false} />
            </div>

            <div style={{
              height: 68,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 3,
              width: "fit-content",
            }}>
              <div style={{
                fontSize: 17.5,
                fontWeight: 800,
                letterSpacing: 0.3,
                lineHeight: 1.28,
                whiteSpace: "nowrap",
                background:
                  "linear-gradient(135deg, #1e40af 0%, #3b82f6 35%, #60a5fa 65%, #1d4ed8 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 2px 4px rgba(37,99,235,0.26))",
              }}>
                项目全流程管理系统
                <span style={{ opacity: 0.5, margin: "0 5px" }}>·</span>
                ProjectFlow
              </div>

              <div style={{
                fontSize: 11.5,
                fontWeight: 600,
                lineHeight: 1.3,
                color: "#64748b",
                display: "flex",
                justifyContent: "space-between",
                whiteSpace: "nowrap",
              }}>
                {"Full Lifecycle Project Management".split("").map((ch, i) => (
                  <span key={i}>{ch === " " ? "\u00A0" : ch}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Tab */}
          <div style={{
            display: "flex",
            gap: 24,
            borderBottom: "1px solid #e5e7eb",
            margin: "16px 0 16px",
          }}>
            <span style={{
              paddingBottom: 9,
              fontSize: 14,
              color: "#2563eb",
              borderBottom: "2px solid #2563eb",
              fontWeight: 600,
              cursor: "default",
            }}>
              账号登录
            </span>
          </div>

          <form onSubmit={submit}>
            {/* 用户名 */}
            <div style={inputGroup} onFocus={focusOn} onBlur={focusOff}>
              <span style={{ color: "#94a3b8", flexShrink: 0, display: "flex" }}>
                <IconUser />
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="用户名，如 王经理"
                autoComplete="username"
                autoFocus
                style={inputInner}
              />
            </div>

            {/* 密码 */}
            <div style={{ ...inputGroup, marginBottom: 3 }} onFocus={focusOn} onBlur={focusOff}>
              <span style={{ color: "#94a3b8", flexShrink: 0, display: "flex" }}>
                <IconLock />
              </span>
              <input
                ref={pwdRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
                style={inputInner}
              />
            </div>

            {/* 忘记密码 / 注册账号 */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginTop: 2, marginBottom: 12,
            }}>
              <button
                type="button"
                onClick={() => { setShowForgot(true); setForgotMsg(null); setFUser(name); }}
                style={{
                  background: "none", border: 0, padding: 0, cursor: "pointer",
                  fontSize: 12.5, color: "#64748b", fontFamily: "inherit",
                  lineHeight: 1.4,
                }}
              >
                忘记密码？
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReg(true);
                  setRegMsg(null);
                  setRUser(name);
                  loadRegCaptcha();
                }}
                style={{
                  background: "none", border: 0, padding: 0, cursor: "pointer",
                  fontSize: 12.5, color: "#64748b", fontFamily: "inherit",
                  lineHeight: 1.4,
                }}
              >
                注册账号
              </button>
            </div>

            {/* 验证码 + 记住用户名 */}
            <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 16 }}>
              <div style={{ ...inputGroup, width: 120, height: 40, marginBottom: 0, flexShrink: 0, padding: "0 9px" }}
                   onFocus={focusOn} onBlur={focusOff}>
                <span style={{ color: "#94a3b8", flexShrink: 0, display: "flex" }}>
                  <IconShield />
                </span>
                <input
                  value={captcha}
                  onChange={(e) => setCaptcha(e.target.value.toUpperCase())}
                  placeholder="验证码"
                  maxLength={4}
                  autoComplete="off"
                  style={{
                    ...inputInner,
                    textAlign: "center",
                    letterSpacing: 3,
                    fontSize: 13,
                    textTransform: "uppercase",
                  }}
                />
              </div>

              {/* 验证码图片 */}
              <div
                role="button"
                tabIndex={0}
                aria-label="点击刷新验证码"
                title="看不清？点击刷新"
                onClick={loadCaptcha}
                onKeyDown={(e) => { if (e.key === "Enter") loadCaptcha(); }}
                style={{
                  height: 40,
                  width: 96,
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#f8fafc",
                  cursor: "pointer",
                  flexShrink: 0,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {captchaImg ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={captchaImg} alt="验证码" style={{ width: "100%", height: "100%", display: "block", objectFit: "fill" }} />
                ) : (
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>加载中</span>
                )}
              </div>

              <label style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12.5,
                color: "#64748b",
                cursor: "pointer",
                whiteSpace: "nowrap",
                userSelect: "none",
              }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  style={{ width: 14, height: 14, margin: 0, cursor: "pointer", accentColor: "#2563eb" }}
                />
                记住用户名
              </label>
            </div>

            {/* 令牌验证码：账号启用令牌认证时出现 */}
            {needTotp && (
              <div style={{ marginBottom: 14 }}>
                <div style={inputGroup} onFocus={focusOn} onBlur={focusOff}>
                  <span style={{ color: "#94a3b8", flexShrink: 0, display: "flex" }}>
                    <IconShield />
                  </span>
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="令牌验证码（6 位数字或恢复码）"
                    maxLength={32}
                    autoComplete="one-time-code"
                    autoFocus
                    style={{
                      ...inputInner,
                      letterSpacing: 2,
                      fontSize: 13,
                    }}
                  />
                </div>
                <div style={{
                  fontSize: 11.5, color: "#64748b", lineHeight: 1.6,
                  marginTop: -4, marginBottom: 8,
                }}>
                  该账号已启用令牌认证。请输入身份验证器（如 Google Authenticator）
                  中的 6 位动态码，或使用一次性的恢复码。
                </div>
              </div>
            )}

            {err && (
              <div style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#dc2626",
                fontSize: 12.5,
                padding: "10px 12px",
                borderRadius: 8,
                marginBottom: 14,
                lineHeight: 1.5,
              }}>
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                padding: "11px",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 1,
                color: "#fff",
                background: busy
                  ? "#93c5fd"
                  : "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)",
                border: 0,
                borderRadius: 8,
                cursor: busy ? "not-allowed" : "pointer",
                boxShadow: "0 4px 14px rgba(37,99,235,.28)",
                transition: "transform .12s, box-shadow .18s",
              }}
              onMouseDown={(e) => { if (!busy) e.currentTarget.style.transform = "translateY(1px)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = "none"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
            >
              {busy ? "登录中…" : "登录"}
            </button>
          </form>

          <div style={{
            marginTop: 20, paddingTop: 16, borderTop: "1px solid #f1f5f9",
            fontSize: 11.5, color: "#94a3b8", textAlign: "center", lineHeight: 1.7,
          }}>
            © 2026 ProjectFlow · All rights reserved.
          </div>
        </div>
      </div>

      {/* 忘记密码弹窗 */}
      {showForgot && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(16,26,48,.5)",
            zIndex: 90, display: "grid", placeItems: "center", padding: 16,
          }}
          onClick={() => setShowForgot(false)}
        >
          <form
            onSubmit={submitForgot}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 400, background: "#fff",
              borderRadius: 16, padding: "24px 24px 20px",
              boxShadow: "0 20px 60px rgba(0,0,0,.28)",
            }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
              找回密码
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "#64748b", lineHeight: 1.6 }}>
              提交后管理员会核实身份并重置密码。
              <br />
              为避免账号被盗，本系统不提供自助重置。
            </p>

            <label style={{ display: "block", fontSize: 12.5, color: "#475569", fontWeight: 600, marginBottom: 6 }}>
              用户名
            </label>
            <input
              value={fUser}
              onChange={(e) => setFUser(e.target.value)}
              placeholder="请输入用户名"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 13.5,
                border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 12,
                boxSizing: "border-box", outline: "none", background: "#f5f7fa",
              }}
            />

            <label style={{ display: "block", fontSize: 12.5, color: "#475569", fontWeight: 600, marginBottom: 6 }}>
              联系方式（便于管理员联系）
            </label>
            <input
              value={fContact}
              onChange={(e) => setFContact(e.target.value)}
              placeholder="手机号或内线"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 13.5,
                border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 12,
                boxSizing: "border-box", outline: "none", background: "#f5f7fa",
              }}
            />

            <label style={{ display: "block", fontSize: 12.5, color: "#475569", fontWeight: 600, marginBottom: 6 }}>
              说明（可选）
            </label>
            <textarea
              value={fNote}
              onChange={(e) => setFNote(e.target.value)}
              rows={2}
              placeholder="如：忘记密码 / 账号被锁"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 13.5,
                border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 14,
                boxSizing: "border-box", outline: "none", background: "#f5f7fa",
                resize: "vertical", fontFamily: "inherit",
              }}
            />

            {forgotMsg && (
              <div style={{
                background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af",
                fontSize: 12.5, padding: "10px 12px", borderRadius: 8, marginBottom: 14,
                lineHeight: 1.6,
              }}>
                {forgotMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowForgot(false)}
                style={{
                  padding: "9px 18px", fontSize: 13, borderRadius: 8,
                  border: "1px solid #e5e7eb", background: "#fff",
                  color: "#475569", cursor: "pointer",
                }}
              >
                关闭
              </button>
              <button
                type="submit"
                disabled={forgotBusy}
                style={{
                  padding: "9px 18px", fontSize: 13, borderRadius: 8, border: 0,
                  background: forgotBusy ? "#93c5fd" : "#2563eb",
                  color: "#fff", fontWeight: 600,
                  cursor: forgotBusy ? "not-allowed" : "pointer",
                }}
              >
                {forgotBusy ? "提交中…" : "提交申请"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 注册账号弹窗 */}
      {showReg && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(16,26,48,.5)",
            zIndex: 90, display: "grid", placeItems: "center", padding: 16,
            overflowY: "auto",
          }}
          onClick={() => setShowReg(false)}
        >
          <form
            onSubmit={submitRegister}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 420, background: "#fff",
              borderRadius: 16, padding: "24px 24px 20px",
              boxShadow: "0 20px 60px rgba(0,0,0,.28)",
              maxHeight: "90vh", overflowY: "auto",
            }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
              注册账号
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "#64748b", lineHeight: 1.6 }}>
              提交后需管理员审核并分配角色，通过后即可登录。
            </p>

            {(() => {
              const lbl: React.CSSProperties = {
                display: "block", fontSize: 12, color: "#475569",
                fontWeight: 600, marginBottom: 5,
              };
              const inp: React.CSSProperties = {
                width: "100%", padding: "9px 11px", fontSize: 13,
                border: "1px solid #e5e7eb", borderRadius: 7, marginBottom: 11,
                boxSizing: "border-box", outline: "none", background: "#f5f7fa",
                color: "#1e293b", fontFamily: "inherit",
              };
              const req = <span style={{ color: "#dc2626" }}> *</span>;

              return (
                <>
                  <label style={lbl}>账号{req}</label>
                  <input value={rUser} onChange={(e) => setRUser(e.target.value)}
                         placeholder="登录用，如 zhangsan" style={inp} />

                  <label style={lbl}>密码{req}</label>
                  <input type="password" value={rPwd} onChange={(e) => setRPwd(e.target.value)}
                         placeholder="至少 8 位，含字母和数字" style={inp} />

                  <label style={lbl}>姓名{req}</label>
                  <input value={rName} onChange={(e) => setRName(e.target.value)}
                         placeholder="真实姓名，用于显示" style={inp} />

                  <label style={lbl}>手机号{req}</label>
                  <input value={rPhone} onChange={(e) => setRPhone(e.target.value)}
                         placeholder="11 位手机号" maxLength={11} style={inp} />

                  <label style={lbl}>部门</label>
                  <input value={rDept} onChange={(e) => setRDept(e.target.value)}
                         placeholder="选填，如 项目管理部" style={inp} />

                  <label style={lbl}>验证码{req}</label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
                    <input value={rCaptcha}
                           onChange={(e) => setRCaptcha(e.target.value.toUpperCase())}
                           placeholder="验证码" maxLength={4} autoComplete="off"
                           style={{
                             ...inp, width: 110, marginBottom: 0, textAlign: "center",
                             letterSpacing: 3, textTransform: "uppercase",
                           }} />
                    <div
                      role="button" tabIndex={0} title="点击刷新"
                      onClick={loadRegCaptcha}
                      onKeyDown={(e) => { if (e.key === "Enter") loadRegCaptcha(); }}
                      style={{
                        height: 38, width: 92, borderRadius: 7,
                        border: "1px solid #d1d5db", background: "#f8fafc",
                        cursor: "pointer", flexShrink: 0, overflow: "hidden",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {regCaptchaImg ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={regCaptchaImg} alt="验证码"
                             style={{ width: "100%", height: "100%", display: "block" }} />
                      ) : (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>加载中</span>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}

            {regMsg && (
              <div style={{
                background: regMsg.t === "ok" ? "#eff6ff" : "#fef2f2",
                border: "1px solid " + (regMsg.t === "ok" ? "#bfdbfe" : "#fecaca"),
                color: regMsg.t === "ok" ? "#1e40af" : "#dc2626",
                fontSize: 12.5, padding: "10px 12px", borderRadius: 8,
                marginBottom: 14, lineHeight: 1.6,
              }}>
                {regMsg.m}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowReg(false)}
                style={{
                  padding: "9px 18px", fontSize: 13, borderRadius: 7,
                  border: "1px solid #e5e7eb", background: "#fff",
                  color: "#475569", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                关闭
              </button>
              <button
                type="submit"
                disabled={regBusy}
                style={{
                  padding: "9px 18px", fontSize: 13, borderRadius: 7, border: 0,
                  background: regBusy ? "#93c5fd" : "#2563eb",
                  color: "#fff", fontWeight: 600,
                  cursor: regBusy ? "not-allowed" : "pointer", fontFamily: "inherit",
                }}
              >
                {regBusy ? "提交中…" : "提交申请"}
              </button>
            </div>
          </form>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes logoFloat {
          0%, 100% { transform: translateY(0) rotateY(0deg); }
          50% { transform: translateY(-4px) rotateY(6deg); }
        }
        @keyframes loginShake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-7px); }
          40% { transform: translateX(7px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
        input::placeholder { color: #cbd5e1; }
      ` }} />
    </div>
  );
}
