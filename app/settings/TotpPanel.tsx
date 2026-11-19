"use client";

import { useState, useEffect, useMemo } from "react";
import { qrToSvg } from "@/lib/qrcode";

interface Status {
  userId: number;
  name: string;
  username: string | null;
  enabled: boolean;
  boundAt: string | null;
  lastUsed: string | null;
  recoveryLeft: number;
}

/**
 * 令牌认证管理（TOTP）
 *
 * 绑定流程：
 *   1. 生成密钥 → 显示 otpauth URI（可复制到验证器或扫码）
 *   2. 用户输入验证器显示的 6 位动态码
 *   3. 验证通过 → 启用，并一次性展示 8 个恢复码
 */
export function TotpPanel({ user }: { user: { id: number; name: string } }) {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  // 绑定流程
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);

  async function load() {
    const res = await fetch(`/api/admin/totp?userId=${user.id}`);
    if (res.ok) setSt(await res.json());
  }
  useEffect(() => { load(); }, [user.id]);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, userId: user.id }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ t: "err", m: d.error ?? "操作失败" }); return null; }
      return d;
    } catch (e) {
      setMsg({ t: "err", m: (e as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startSetup() {
    const d = await post({ action: "setup" });
    if (d) {
      setSecret(d.secret);
      setUri(d.uri);
      setCode("");
      setRecovery(null);
      setMsg({ t: "ok", m: "密钥已生成，请用验证器添加后输入动态码确认" });
    }
  }

  async function confirm() {
    if (!code.trim()) { setMsg({ t: "err", m: "请输入动态码" }); return; }
    const d = await post({ action: "confirm", code: code.trim() });
    if (d) {
      setRecovery(d.recoveryCodes);
      setSecret(null);
      setUri(null);
      setCode("");
      setMsg({ t: "ok", m: "令牌认证已启用，请妥善保存恢复码" });
      await load();
    }
  }

  async function disable() {
    const c = prompt("关闭令牌认证需要验证当前动态码（6 位数字）：");
    if (c === null) return;
    const d = await post({ action: "disable", code: c.trim() });
    if (d) {
      setMsg({ t: "ok", m: "令牌认证已关闭" });
      setRecovery(null);
      await load();
    }
  }

  async function resetRecovery() {
    if (!window.confirm("重新生成恢复码？旧的恢复码将全部失效。")) return;
    const d = await post({ action: "resetRecovery" });
    if (d) {
      setRecovery(d.recoveryCodes);
      setMsg({ t: "ok", m: "恢复码已重置" });
      await load();
    }
  }

  // 二维码 SVG：uri 变化时重新生成（uri 含 secret，只在绑定过程中存在）
  const qrSvg = useMemo(() => {
    if (!uri) return "";
    try {
      // margin 必须是 4（标准静区），小于 4 很多扫码器会拒绝识别
      // size 只是目标值，qrToSvg 会向下取整到整数倍，避免模块边缘被抗锯齿糊掉
      return qrToSvg(uri, { size: 220, margin: 4 });
    } catch (e) {
      // 内容超长（极罕见）时不显示二维码，用户仍可手输密钥
      console.warn("二维码生成失败:", e);
      return "";
    }
  }, [uri]);

  const inputStyle: React.CSSProperties = {
    width: "100%", maxWidth: 320, padding: "8px 11px", fontSize: 13,
    border: "1px solid var(--line)", borderRadius: 8,
    background: "var(--card)", color: "var(--text)",
    boxSizing: "border-box", outline: "none",
    fontFamily: "ui-monospace,Consolas,monospace",
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-h">
        <h3>令牌认证</h3>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--muted)" }}>
          {st?.enabled ? "已启用" : "未启用"}
        </span>
      </div>

      <div style={{ padding: 16 }}>
        {msg && (
          <div className={msg.t === "ok" ? "notice ok" : "notice danger"} style={{ marginBottom: 12 }}>
            <div>{msg.m}</div>
          </div>
        )}

        {/* 状态 */}
        {st && (
          <div style={{
            display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12.5,
            marginBottom: 14, color: "var(--sub)",
          }}>
            <span>
              状态：
              {st.enabled
                ? <span className="badge b-ok">已启用</span>
                : <span className="badge b-gray">未启用</span>}
            </span>
            {st.enabled && st.boundAt && (
              <span>绑定于 <b style={{ color: "var(--text)" }}>{st.boundAt}</b></span>
            )}
            {st.enabled && (
              <span>恢复码剩余 <b style={{
                color: st.recoveryLeft <= 2 ? "var(--bad)" : "var(--text)",
              }}>{st.recoveryLeft}</b> 个</span>
            )}
            {st.lastUsed && (
              <span>最近验证 <b style={{ color: "var(--text)" }}>{st.lastUsed}</b></span>
            )}
          </div>
        )}

        {/* 恢复码展示（一次性） */}
        {recovery && (
          <div style={{
            background: "#fffbeb", border: "1px solid #fde68a",
            borderRadius: 10, padding: "14px 16px", marginBottom: 14,
          }}>
            <b style={{ fontSize: 12.5, color: "#d97706", display: "block", marginBottom: 8 }}>
              ⚠ 恢复码（只显示这一次，请立即保存）
            </b>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))",
              gap: 6, fontFamily: "ui-monospace,Consolas,monospace", fontSize: 12.5,
            }}>
              {recovery.map((c) => (
                <code key={c} style={{
                  background: "#fff", padding: "4px 8px", borderRadius: 5,
                  border: "1px solid #fde68a", textAlign: "center",
                }}>{c}</code>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: "#92400e", marginTop: 10, lineHeight: 1.7 }}>
              手机丢失时可用其中任意一个代替动态码登录，每个只能用一次。
              请抄写或打印保存，不要存在同一台设备上。
            </div>
            <button
              className="btn btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => setRecovery(null)}
            >
              我已保存
            </button>
          </div>
        )}

        {/* 绑定中的密钥展示 */}
        {secret && uri && (
          <div style={{
            background: "var(--bg)", border: "1px solid var(--line)",
            borderRadius: 10, padding: "14px 16px", marginBottom: 14,
          }}>
            <b style={{ fontSize: 12.5, display: "block", marginBottom: 10 }}>
              第 1 步：扫码添加账号
            </b>

            {/* 二维码：手机扫描即可添加到验证器，比手输密钥快且不易出错 */}
            <div style={{
              display: "flex", gap: 16, alignItems: "center",
              flexWrap: "wrap", marginBottom: 14,
            }}>
              <div
                style={{
                  background: "#fff", padding: 10, borderRadius: 10,
                  border: "1px solid var(--line)", lineHeight: 0,
                  flexShrink: 0,
                }}
                // qrToSvg 返回的是受控生成的 SVG 字符串（只含 path/rect，无外部输入插值）
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
              <div style={{ flex: 1, minWidth: 160, fontSize: 11.5, color: "var(--sub)", lineHeight: 1.9 }}>
                <div>用手机上的验证器 App <b>扫描左侧二维码</b>，账号会自动添加。</div>
                <div style={{ marginTop: 6, color: "var(--muted)" }}>
                  支持：Google Authenticator、Microsoft Authenticator、
                  1Password、阿里云 App、企业微信等
                </div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--line)", margin: "14px 0" }} />

            <b style={{ fontSize: 12, display: "block", marginBottom: 8, color: "var(--sub)" }}>
              二维码扫不了？手动输入密钥
            </b>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8, lineHeight: 1.7 }}>
              在验证器里选择「手动输入设置密钥」，输入以下内容：
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{
                flex: 1, minWidth: 220, padding: "9px 12px", background: "var(--card)",
                border: "1px solid var(--line)", borderRadius: 8, fontSize: 13,
                letterSpacing: 2, fontFamily: "ui-monospace,Consolas,monospace",
                wordBreak: "break-all",
              }}>
                {secret}
              </code>
              <button
                className="btn btn-sm"
                onClick={() => {
                  navigator.clipboard?.writeText(secret);
                  setMsg({ t: "ok", m: "密钥已复制" });
                }}
              >
                复制
              </button>
            </div>

            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10, lineHeight: 1.7 }}>
              也可以复制以下链接生成二维码：
            </div>
            <code style={{
              display: "block", marginTop: 6, padding: "8px 10px", fontSize: 10.5,
              background: "var(--card)", border: "1px solid var(--line)",
              borderRadius: 6, wordBreak: "break-all", color: "var(--muted)",
            }}>
              {uri}
            </code>

            <b style={{ fontSize: 12.5, display: "block", margin: "16px 0 8px" }}>
              第 2 步：输入验证器显示的 6 位动态码
            </b>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                style={{ ...inputStyle, maxWidth: 160, letterSpacing: 6, textAlign: "center", fontSize: 16 }}
              />
              <button className="btn btn-pri btn-sm" onClick={confirm} disabled={busy}>
                {busy ? "验证中…" : "验证并启用"}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => { setSecret(null); setUri(null); setCode(""); setMsg(null); }}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        {!secret && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!st?.enabled ? (
              <button className="btn btn-pri btn-sm" onClick={startSetup} disabled={busy}>
                {busy ? "处理中…" : "启用令牌认证"}
              </button>
            ) : (
              <>
                <button className="btn btn-sm" onClick={resetRecovery} disabled={busy}>
                  重置恢复码
                </button>
                <button
                  className="btn btn-sm"
                  style={{ color: "var(--bad)" }}
                  onClick={disable}
                  disabled={busy}
                >
                  关闭令牌认证
                </button>
              </>
            )}
          </div>
        )}

        <div style={{
          marginTop: 14, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.8,
        }}>
          启用后，该用户登录时除密码外还需输入验证器中的 6 位动态码。
          这是标准 TOTP 协议（RFC 6238），兼容所有主流身份验证器。
          关闭需验证当前动态码，防止账号被盗后被恶意关闭。
        </div>
      </div>
    </div>
  );
}
