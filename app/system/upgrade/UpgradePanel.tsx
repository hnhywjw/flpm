"use client";

import { useState, useRef } from "react";

interface Pkg {
  id: number; file_name: string; size_bytes: number;
  version: string | null; sha256: string | null; status: string;
  note: string | null; manifest: string | null;
  verify_ok: number | null; verify_errors: string | null;
  created_at: string;
}

function fmtSize(b: number): string {
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}

export function UpgradePanel({
  version,
  initialPackages,
}: {
  version: { version: string; nodeVersion: string; nextVersion: string; buildDate: string | null };
  initialPackages: Pkg[];
}) {
  const [packages, setPackages] = useState(initialPackages);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [lastVerify, setLastVerify] = useState<{
    ok: boolean; version: string | null;
    errors: string[]; warnings: string[];
    contents: { image?: boolean; src?: boolean; migrations?: string[] } | null;
  } | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    const res = await fetch("/api/system/upgrade", { cache: "no-store" });
    if (res.ok) {
      const d = await res.json();
      setPackages(d.packages ?? []);
    }
  }

  async function upload(f: File) {
    setUploading(true); setMsg(null); setLastVerify(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("note", note);
      const res = await fetch("/api/system/upgrade", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { setMsg({ t: "err", m: d.error ?? "上传失败" }); return; }

      setLastVerify(d.verify ?? null);
      if (d.verify?.ok) {
        setMsg({
          t: "ok",
          m: `上传成功：${d.file}（${d.sizeMB} MB）版本 ${d.verify.version ?? "未知"}，校验通过`,
        });
      } else {
        setMsg({ t: "err", m: `上传完成但校验未通过，不能用于升级` });
      }
      setNote("");
      await reload();
    } catch (e) {
      setMsg({ t: "err", m: (e as Error).message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function del(id: number, name: string) {
    if (!confirm(`删除升级包「${name}」？`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/system/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ t: "err", m: d.error ?? "删除失败" }); return; }
      setMsg({ t: "ok", m: "已删除" });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = {
    background: "var(--card)", border: "1px solid var(--line)",
    borderRadius: 12, padding: 16,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 11px", fontSize: 13,
    border: "1px solid var(--line)", borderRadius: 8,
    background: "var(--card)", color: "var(--text)",
    boxSizing: "border-box", outline: "none",
  };

  return (
    <>
      {/* 版本卡 */}
      <div style={{
        display: "grid", gap: 12, marginBottom: 16,
        gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
      }}>
        {[
          { label: "当前版本", value: version.version },
          { label: "Node 运行时", value: version.nodeVersion },
          { label: "Next.js", value: version.nextVersion },
          { label: "构建时间", value: version.buildDate ?? "—" },
        ].map((k) => (
          <div key={k.label} style={card}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>{k.label}</div>
            <div style={{
              fontSize: 16, fontWeight: 800, color: "var(--text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {msg && (
        <div className={msg.t === "ok" ? "notice ok" : "notice danger"} style={{ marginBottom: 12 }}>
          <div>{msg.m}</div>
        </div>
      )}

      {/* 校验结果 */}
      {lastVerify && (
        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            校验结果
            <span style={{
              marginLeft: 8, fontSize: 11.5, fontWeight: 700,
              color: lastVerify.ok ? "var(--ok, #16a34a)" : "var(--bad)",
            }}>
              {lastVerify.ok ? "通过" : "未通过"}
            </span>
          </div>

          <div style={{
            display: "grid", gap: 8, fontSize: 12.5, marginBottom: 10,
            gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          }}>
            <div>版本：<b>{lastVerify.version ?? "—"}</b></div>
            <div>
              内容：
              <b>
                {[
                  lastVerify.contents?.image ? "镜像" : null,
                  lastVerify.contents?.src ? "源码" : null,
                  lastVerify.contents?.migrations?.length
                    ? `迁移 ${lastVerify.contents.migrations.length} 个` : null,
                ].filter(Boolean).join(" + ") || "—"}
              </b>
            </div>
          </div>

          {lastVerify.errors.length > 0 && (
            <div style={{
              background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626",
              borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.7,
            }}>
              {lastVerify.errors.map((e, i) => <div key={i}>• {e}</div>)}
            </div>
          )}
          {lastVerify.warnings.length > 0 && (
            <div style={{
              background: "#fffbeb", border: "1px solid #fde68a", color: "#d97706",
              borderRadius: 8, padding: "10px 12px", fontSize: 12, lineHeight: 1.7,
              marginTop: 8,
            }}>
              {lastVerify.warnings.map((w, i) => <div key={i}>• {w}</div>)}
            </div>
          )}
        </div>
      )}

      {/* 上传 */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>上传升级包</div>

        <div style={{ marginBottom: 12 }}>
          <label style={{
            display: "block", fontSize: 12, color: "var(--sub)",
            fontWeight: 600, marginBottom: 5,
          }}>
            说明（选填）
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="如 修复回款计划重建"
            style={{ ...inputStyle, maxWidth: 420 }}
          />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-pri btn-sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "上传并校验中…" : "选择升级包并上传"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".tar.gz,.tgz"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            必须是含 manifest.json 的 .tar.gz，最大 500MB
          </span>
        </div>

        <div style={{
          marginTop: 12, background: "var(--bg)", border: "1px solid var(--line)",
          borderRadius: 8, padding: "12px 14px", fontSize: 11.5,
          color: "var(--sub)", lineHeight: 1.8,
        }}>
          <b style={{ color: "var(--text)" }}>升级包结构（tar.gz 根目录）：</b>
          <pre style={{
            margin: "6px 0 0", fontSize: 11, fontFamily: "ui-monospace,Consolas,monospace",
            color: "var(--muted)", whiteSpace: "pre-wrap",
          }}>{`manifest.json   必需，声明版本与内容
image.tar       可选，docker save 的镜像
src/            可选，源码目录
migrations/     可选，新增的 .sql 迁移`}</pre>
        </div>
      </div>

      {/* 包列表 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <h3>已上传的升级包</h3>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            共 {packages.length} 个
          </span>
        </div>
        {packages.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            暂无升级包
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>文件</th>
                  <th>版本</th>
                  <th>大小</th>
                  <th>校验</th>
                  <th>状态</th>
                  <th>上传时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id}>
                    <td className="num" style={{ fontSize: 12 }}>
                      {p.file_name}
                      {p.note && (
                        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{p.note}</div>
                      )}
                    </td>
                    <td>{p.version ?? "—"}</td>
                    <td className="num">{fmtSize(p.size_bytes)}</td>
                    <td>
                      {p.verify_ok ? (
                        <span className="badge b-ok">通过</span>
                      ) : (
                        <span className="badge b-bad" title={p.verify_errors ?? ""}>未通过</span>
                      )}
                    </td>
                    <td>
                      <span className={p.status === "applied" ? "badge b-ok" : "badge b-gray"}>
                        {p.status === "applied" ? "已应用" : "待应用"}
                      </span>
                    </td>
                    <td className="num" style={{ fontSize: 12 }}>{p.created_at}</td>
                    <td>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {p.verify_ok ? (
                          <a
                            className="btn btn-sm btn-pri"
                            href={`/api/system/upgrade?action=script&id=${p.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              window.location.href =
                                `/api/system/upgrade/script?id=${p.id}`;
                            }}
                            style={{ textDecoration: "none" }}
                          >
                            下载升级脚本
                          </a>
                        ) : (
                          <button className="btn btn-sm" disabled title={p.verify_errors ?? ""}>
                            脚本
                          </button>
                        )}
                        <a
                          className="btn btn-sm"
                          href={`/api/system/upgrade/download?id=${p.id}`}
                          style={{ textDecoration: "none" }}
                        >
                          下载
                        </a>
                        <button
                          className="btn btn-sm"
                          style={{ color: "var(--bad)" }}
                          disabled={busy}
                          onClick={() => del(p.id, p.file_name)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 升级步骤 */}
      <div className="card">
        <div className="card-h"><h3>离线升级流程</h3></div>
        <div style={{ padding: 16 }}>
          <div style={{
            background: "var(--bg)", border: "1px solid var(--line)",
            borderRadius: 10, padding: "14px 16px", fontSize: 12.5, lineHeight: 2,
          }}>
            <ol style={{ margin: 0, paddingLeft: 20, color: "var(--sub)" }}>
              <li>在<b>能联网的机器</b>上构建，生成升级包（含 <code>manifest.json</code>）</li>
              <li>在本页<b>上传</b>，系统自动校验结构与版本</li>
              <li>点击<b>「下载升级脚本」</b>，得到 <code>upgrade.sh</code></li>
              <li>把<b>升级包 + 脚本</b>一起拷到服务器 <code>/home/ltc</code>（包放 <code>db/upgrade/</code>）</li>
              <li>服务器执行：<code>sudo bash upgrade-xxx.sh</code></li>
            </ol>
          </div>

          <div style={{
            marginTop: 14, background: "var(--bg)", border: "1px solid var(--line)",
            borderRadius: 10, padding: "14px 16px", fontSize: 12.5, lineHeight: 1.9,
          }}>
            <b style={{ display: "block", marginBottom: 8 }}>脚本内置的安全机制</b>
            <table className="tbl" style={{ fontSize: 12 }}>
              <tbody>
                <tr>
                  <td style={{ width: 130 }}>旧镜像标记</td>
                  <td>升级前把当前镜像标记为 <code>projectflow:pre-&lt;版本&gt;</code></td>
                </tr>
                <tr>
                  <td>数据库备份</td>
                  <td>自动生成 <code>pre-upgrade-&lt;时间&gt;.db</code></td>
                </tr>
                <tr>
                  <td>解包防护</td>
                  <td><code>--exclude='*..*'</code> 拒绝路径穿越</td>
                </tr>
                <tr>
                  <td>健康检查</td>
                  <td>最多等 90 秒，应用和网关都 healthy 才算成功</td>
                </tr>
                <tr>
                  <td>自动回滚</td>
                  <td>健康检查失败 → 自动切回 <code>pre-&lt;版本&gt;</code> 镜像</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="notice" style={{ marginTop: 14 }}>
            <div>
              <b>为什么必须到服务器执行脚本？</b>
              <div style={{ marginTop: 5, fontSize: 12.5, color: "var(--sub)", lineHeight: 1.7 }}>
                应用跑在容器里，容器内<b>没有 docker 命令</b>，无法加载镜像、不能重建容器。
                网页能做的是「管理升级包 + 生成可信脚本」，真正的切换必须由宿主机的
                docker 完成。这样设计既保留了网页端的便利（上传、校验、版本比对），
                又保证了切换过程的原子性和可回滚性。
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
