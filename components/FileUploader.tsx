"use client";

import { useState, useRef } from "react";

interface Uploaded {
  id: number;
  file_name: string;
  size_text: string;
}

/**
 * 内嵌文件上传器
 * 上传成功后把附件 id 回传给父组件，避免只存文件名
 */
export function FileUploader({
  entityType,
  entityId,
  label,
  hint,
  value,
  onChange,
}: {
  entityType: string;
  entityId: number;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<Uploaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  async function doUpload(f: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("entityType", entityType);
      fd.append("entityId", String(entityId));

      const res = await fetch("/api/attachments", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) {
        setErr(d.error ?? "上传失败");
        return;
      }
      // API 返回 name / size，兼容两种字段名
      setFile({
        id: d.id,
        file_name: d.name ?? d.file_name ?? f.name,
        size_text: d.size ?? d.size_text ?? "",
      });
      // 关键：把真实附件 id 写入表单字段
      onChange(String(d.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <label style={{
        display: "block", fontSize: 12, color: "var(--sub)",
        fontWeight: 600, marginBottom: 6,
      }}>
        {label}
      </label>

      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 11px", border: "1px dashed var(--line)",
        borderRadius: 8, background: "var(--bg)",
      }}>
        {file ? (
          <>
            <span style={{ fontSize: 13 }}>📎</span>
            <span style={{ flex: 1, fontSize: 12.5, overflow: "hidden",
                           textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.file_name}
              <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                {file.size_text || "已上传"}
              </span>
            </span>
            <span style={{ fontSize: 11, color: "var(--ok)", fontWeight: 600 }}>已上传</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { setFile(null); onChange(""); }}
            >
              重传
            </button>
          </>
        ) : (
          <>
            <span style={{ flex: 1, fontSize: 12, color: "var(--muted)" }}>
              {uploading ? "上传中…" : "未上传"}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={uploading}
              onClick={() => ref.current?.click()}
            >
              选择文件
            </button>
          </>
        )}
        <input
          ref={ref}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg,.gif,.webp,.bmp"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doUpload(f);
          }}
        />
      </div>

      {hint && !err && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{hint}</div>
      )}
      {err && (
        <div style={{ fontSize: 11, color: "var(--bad)", marginTop: 4 }}>{err}</div>
      )}
    </div>
  );
}
