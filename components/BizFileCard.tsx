"use client";

import { useState, useEffect, useRef } from "react";

/**
 * 业务附件卡片
 *
 * 用于在具体业务单据旁边挂文件：
 *   招标/投标文件、中标通知书、合同扫描件、实施方案、
 *   验收资料、发票、回款/付款凭证。
 *
 * 与 AttachmentPanel 的区别：
 *   AttachmentPanel  整页大列表（项目详情页用，可多选批量传）
 *   本组件           嵌在表格行 / 弹窗里的小卡片，单文件为主，强调「这一格该有文件」
 *
 * 是否必填由 required 控制：必填却没传时显示红色提示，
 * 让「验收四件套齐备但没附件」这种假齐备无处藏身。
 */

interface Att {
  id: number;
  file_name: string;
  file_size: number;
  size_text: string;
  uploaded_by_name: string;
  uploaded_at: string;
  mime_type: string | null;
}

export function BizFileCard({
  entityType,
  entityId,
  label,
  required = false,
  hint,
  compact = false,
}: {
  entityType: string;
  entityId: number;
  label: string;
  required?: boolean;
  hint?: string;
  compact?: boolean;
}) {
  const [list, setList] = useState<Att[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const inputId = "bfc-" + entityType + "-" + entityId;

  async function load() {
    try {
      const res = await fetch(
        "/api/attachments?entityType=" + encodeURIComponent(entityType) +
        "&entityId=" + entityId
      );
      if (res.status === 403) { setDenied(true); setList([]); return; }
      if (res.ok) { setList(await res.json()); setDenied(false); }
    } catch {
      /* 网络异常不阻塞页面 */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [entityType, entityId]);

  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("entityType", entityType);
      fd.append("entityId", String(entityId));
      const res = await fetch("/api/attachments", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "上传失败"); return; }
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  async function remove(id: number, name: string) {
    if (!confirm("确定删除「" + name + "」？删除后无法恢复。")) return;
    const res = await fetch("/api/attachments?id=" + id, { method: "DELETE" });
    const d = await res.json();
    if (!res.ok) setErr(d.error);
    else await load();
  }

  function icon(name: string) {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "🖼";
    if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
    if (["doc", "docx"].includes(ext)) return "📝";
    if (ext === "pdf") return "📕";
    if (ext === "ppt" || ext === "pptx") return "📽";
    return "📄";
  }

  const missing = required && !loading && list.length === 0;

  if (denied) {
    return (
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        {label}：无权查看
      </div>
    );
  }

  const hasFiles = list.length > 0;

  return (
    <div style={{
      border: "1px solid " + (missing ? "var(--bad)" : "var(--line)"),
      background: missing ? "var(--bad-weak)" : "var(--card)",
      borderRadius: 9, padding: compact ? "7px 9px" : "9px 11px",
    }}>
      {/* 一行横排：标签 → 上传按钮 → 文件名（在按钮后面，不在框里） */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: "0 0 auto" }}>
          {label}
        </span>

        {required && !hasFiles && (
          <span style={{
            fontSize: 10, padding: "1px 5px", borderRadius: 4,
            background: "var(--bad-weak)", color: "var(--bad)", fontWeight: 600,
            flex: "0 0 auto",
          }}>
            必传
          </span>
        )}

        <input
          ref={ref}
          id={inputId}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg,.gif,.webp,.bmp"
          onChange={(e) => upload(e.target.files?.[0])}
          style={{ display: "none" }}
        />
        <label
          htmlFor={inputId}
          className="btn btn-sm"
          style={{
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            fontSize: 11, flex: "0 0 auto", padding: "2px 8px",
          }}
        >
          {busy ? "上传中…" : hasFiles ? "重传" : "上传"}
        </label>

        {/* 文件名跟在按钮后面，删除标记紧跟在文件名后（同一行） */}
        {!loading && hasFiles && list.length === 1 && (
          <>
            <a
              href={"/api/attachments/download?id=" + list[0].id}
              style={{
                flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--pri)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
              title={list[0].file_name + " (" + list[0].size_text + ")"}
            >
              {icon(list[0].file_name)} {list[0].file_name}
            </a>
            <button
              type="button"
              onClick={() => remove(list[0].id, list[0].file_name)}
              title={"删除 " + list[0].file_name}
              style={{
                border: "none", background: "transparent", color: "var(--muted)",
                cursor: "pointer", fontSize: 12, padding: "0 3px",
                flex: "0 0 auto", lineHeight: 1,
              }}
            >
              ✕
            </button>
          </>
        )}
        {!loading && hasFiles && list.length > 1 && (
          <span style={{ fontSize: 11, color: "var(--muted)", flex: "0 0 auto" }}>
            {list.length} 个文件
          </span>
        )}
        {!loading && !hasFiles && !missing && (
          <span style={{ fontSize: 11, color: "var(--muted)", flex: "0 0 auto" }}>
            未上传
          </span>
        )}
      </div>

      {loading && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5 }}>加载中…</div>
      )}

      {/* 多个文件时，列表放在下面（单个文件已经在上面一行显示了） */}
      {!loading && list.length > 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
          {list.map((a) => (
            <div key={a.id} style={{
              display: "flex", alignItems: "center", gap: 6, fontSize: 11.5,
              padding: "3px 6px", background: "var(--bg)", borderRadius: 5,
            }}>
              <span>{icon(a.file_name)}</span>
              <a
                href={"/api/attachments/download?id=" + a.id}
                style={{
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", color: "var(--pri)",
                }}
                title={a.file_name}
              >
                {a.file_name}
              </a>
              <span style={{ color: "var(--muted)", fontSize: 10.5 }}>{a.size_text}</span>
              <button
                type="button"
                onClick={() => remove(a.id, a.file_name)}
                title={"删除 " + a.file_name}
                style={{
                  border: "none", background: "transparent", color: "var(--muted)",
                  cursor: "pointer", fontSize: 12, padding: "0 3px",
                  flex: "0 0 auto", lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {missing && (
        <div style={{ fontSize: 11, color: "var(--bad)", marginTop: 5 }}>
          缺少「{label}」文件，请上传后再标记为已完成
        </div>
      )}

      {hint && !err && !missing && (
        <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>{hint}</div>
      )}
      {err && (
        <div style={{ fontSize: 11, color: "var(--bad)", marginTop: 4 }}>{err}</div>
      )}
    </div>
  );
}
