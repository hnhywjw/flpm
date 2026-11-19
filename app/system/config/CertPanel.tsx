"use client";

import { useState, useEffect } from "react";

interface Cert {
  found: boolean; path: string; subject: string | null; issuer: string | null;
  validFrom: string | null; validTo: string | null;
  daysLeft: number | null; expired: boolean; selfSigned: boolean;
  san: string[]; keyMatch: boolean | null;
  keyReadable: boolean; keyPath: string | null;
  keyType: string | null; keyBits: number | null;
  chainLength: number; trusted: boolean;
  error: string | null;
}

export function CertPanel() {
  const [cert, setCert] = useState<Cert | null>(null);
  const [warnDays, setWarnDays] = useState(30);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/system/cert", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setCert(d.cert);
        setWarnDays(d.warnDays ?? 30);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  const tone = () => {
    if (!cert?.found) return { bg: "#f8fafc", border: "var(--line)", color: "var(--muted)" };
    if (cert.expired) return { bg: "#fef2f2", border: "#fecaca", color: "#dc2626" };
    if ((cert.daysLeft ?? 999) <= warnDays) {
      return { bg: "#fffbeb", border: "#fde68a", color: "#d97706" };
    }
    return { bg: "#f0fdf4", border: "#bbf7d0", color: "#16a34a" };
  };

  const t = tone();

  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`,
      borderRadius: 10, padding: "14px 16px", marginBottom: 16,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
      }}>
        <b style={{ fontSize: 13, color: t.color }}>SSL 证书状态</b>
        <button className="btn btn-sm" onClick={load} disabled={busy} style={{ marginLeft: "auto" }}>
          {busy ? "检测中…" : "重新检测"}
        </button>
      </div>

      {!cert ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>检测中…</div>
      ) : !cert.found ? (
        <div style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.8 }}>
          {cert.error ?? "未找到证书文件"}
          <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--muted)" }}>
            在下方填写「SSL 证书路径」后重新检测。Nginx 通常挂在
            <code style={{ margin: "0 3px" }}>/home/ltc/nginx/certs/server.crt</code>。
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, lineHeight: 1.9, color: "#475569" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>证书路径</span>
            <b style={{ color: "#1e293b", wordBreak: "break-all", textAlign: "right" }}>{cert.path}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>颁发给</span>
            <b style={{
              color: "#1e293b", maxWidth: 320, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={cert.subject ?? ""}>{cert.subject}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>颁发者</span>
            <b style={{
              color: "#1e293b", maxWidth: 320, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }} title={cert.issuer ?? ""}>{cert.issuer}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>有效期</span>
            <b style={{ color: "#1e293b" }}>{cert.validFrom} ~ {cert.validTo}</b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>剩余天数</span>
            <b style={{ color: t.color, fontSize: 14 }}>
              {cert.expired ? "已过期 " + Math.abs(cert.daysLeft ?? 0) + " 天" : cert.daysLeft + " 天"}
              {cert.selfSigned && <span style={{ fontSize: 11, marginLeft: 6 }}>（自签证书）</span>}
            </b>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ flexShrink: 0 }}>私钥</span>
            <b style={{ color: "#1e293b", textAlign: "right" }}>
              {cert.keyReadable ? (
                <>
                  {cert.keyType
                    ? cert.keyType + (cert.keyBits ? " " + cert.keyBits + " bit" : "")
                    : "已读取"}
                  {cert.keyMatch === true && <span style={{ color: "#16a34a", marginLeft: 6 }}>· 与证书匹配</span>}
                  {cert.keyMatch === false && <span style={{ color: "#dc2626", marginLeft: 6 }}>· 与证书不匹配</span>}
                </>
              ) : cert.keyPath ? (
                <span style={{ color: "#d97706", fontSize: 11.5 }}>
                  权限不足，无法读取（正常）
                </span>
              ) : (
                <span style={{ color: "#94a3b8", fontSize: 11.5 }}>未配置密钥路径</span>
              )}
            </b>
          </div>
          {!cert.keyReadable && cert.keyPath && (
            <div style={{
              marginTop: 4, fontSize: 11, color: "var(--muted)", lineHeight: 1.6,
            }}>
              私钥通常为 600 root 权限，应用进程（nextjs 用户）无法读取。
              这是正确的安全设置，不影响 HTTPS 正常工作（证书由 nginx 使用）。
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>证书链</span>
            <b style={{ color: "#1e293b" }}>
              {cert.chainLength} 层
              {cert.chainLength === 1 && cert.selfSigned && (
                <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>（单证书，自签场景正常）</span>
              )}
            </b>
          </div>
          {cert.san.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ flexShrink: 0 }}>适用域名</span>
              <b style={{
                color: "#1e293b", maxWidth: 340, textAlign: "right",
                wordBreak: "break-all", fontSize: 11.5,
              }}>
                {cert.san.join(", ")}
              </b>
            </div>
          )}
          {cert.error && (
            <div style={{ marginTop: 6, color: "#dc2626", fontSize: 11.5 }}>{cert.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
