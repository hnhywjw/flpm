"use client";

import { useState, useEffect, useRef } from "react";

interface Att {
  id: number;
  file_name: string;
  file_size: number;
  size_text: string;
  uploaded_by_name: string;
  uploaded_at: string;
  mime_type: string;
}

export function AttachmentPanel({
  entityType,
  entityId,
  title = "附件资料",
  compact = false,
}: {
  entityType: string;
  entityId: number;
  title?: string;
  compact?: boolean;
}) {
  const [list, setList] = useState<Att[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`/api/attachments?entityType=${entityType}&entityId=${entityId}`);
    if (res.ok) setList(await res.json());
  }

  useEffect(() => { load(); }, [entityType, entityId]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg(null);
    let okCount = 0;
    const errs: string[] = [];

    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("entityType", entityType);
      fd.append("entityId", String(entityId));
      try {
        const res = await fetch("/api/attachments", { method: "POST", body: fd });
        const data = await res.json();
        if (res.ok) okCount++;
        else errs.push(`${f.name}: ${data.error}`);
      } catch (e) {
        errs.push(`${f.name}: ${(e as Error).message}`);
      }
    }

    if (okCount) setMsg({ t: "ok", m: `成功上传 ${okCount} 个文件` });
    if (errs.length) setMsg({ t: "err", m: errs.join("；") });

    if (inputRef.current) inputRef.current.value = "";
    await load();
    setBusy(false);
  }

  async function remove(id: number, name: string) {
    if (!confirm(`确定删除「${name}」？`)) return;
    const res = await fetch(`/api/attachments?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) setMsg({ t: "err", m: data.error });
    else { setMsg({ t: "ok", m: "已删除" }); await load(); }
  }

  function fileIcon(mime: string | null, name: string) {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "🖼";
    if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
    if (["doc", "docx"].includes(ext)) return "📝";
    if (["zip", "rar", "7z"].includes(ext)) return "🗜";
    if (ext === "pdf") return "📕";
    return "📄";
  }

  return (
    <div style={compact ? undefined : { padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>
          {title}（{list.length}）
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input
            ref={inputRef}
            type="file"
            multiple
            // 与后端白名单保持一致，避免用户选了不支持的类型才报错
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg,.gif,.webp,.bmp"
            onChange={(e) => upload(e.target.files)}
            style={{ display: "none" }}
            id={`att-${entityType}-${entityId}`}
          />
          <label
            htmlFor={`att-${entityType}-${entityId}`}
            className="btn btn-sm"
            style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "上传中…" : "+ 上传附件"}
          </label>
        </div>
      </div>

      {msg && (
        <div className={`notice ${msg.t === "ok" ? "ok" : "danger"}`} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12 }}>{msg.m}</div>
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "14px 0" }}>
          暂无附件。支持 PDF、Word、Excel、图片、压缩包，单个不超过 20MB。
        </div>
      ) : (
        <div style={{ border: "1px solid var(--line)", borderRadius: 9, overflow: "hidden" }}>
          {list.map((a, i) => (
            <div
              key={a.id}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                borderTop: i === 0 ? "none" : "1px solid var(--line2)",
              }}
            >
              <span style={{ fontSize: 15 }}>{fileIcon(a.mime_type, a.file_name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.file_name}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {a.size_text} · {a.uploaded_by_name ?? "—"} · {a.uploaded_at?.slice(0, 16)}
                </div>
              </div>
              <a href={`/api/attachments/download?id=${a.id}`} className="btn btn-sm"
                 style={{ textDecoration: "none" }}>下载</a>
              <button className="btn btn-sm" onClick={() => remove(a.id, a.file_name)}
                      style={{ color: "var(--bad)" }}>删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
