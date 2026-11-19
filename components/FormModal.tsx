"use client";

import { useState, useEffect, type ReactNode } from "react";

export interface Field {
  key: string;
  label: string;
  /** datetime-local：需要精确到时刻的场景（如开标时间 9:30） */
  type?: "text" | "number" | "date" | "datetime-local" | "textarea" | "select" | "checkbox";
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean | null;
  hint?: string;
  colSpan?: 1 | 2;
  /** 返回 false 时不显示。用于差价法隐藏过单费率这类只属于某一种结算方式的字段。 */
  when?: (vals: Record<string, string | boolean>) => boolean;
}

/**
 * 通用弹窗表单
 * 用法：<FormModal open fields={...} onSubmit={async(data)=>{}} onClose={} />
 */
export function FormModal({
  open,
  title,
  desc,
  fields,
  submitText = "保存",
  onSubmit,
  onClose,
  onFieldChange,
}: {
  open: boolean;
  title: string;
  desc?: string;
  fields: Field[];
  submitText?: string;
  onSubmit: (data: Record<string, string | boolean>) => Promise<string | null>;
  onClose: () => void;
  /** 某字段变化时返回要一并写入的其他字段，用于下拉后自动带出 */
  onFieldChange?: (
    key: string,
    value: string | boolean,
    vals: Record<string, string | boolean>,
  ) => Record<string, string | boolean> | void;
}) {
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const init: Record<string, string | boolean> = {};
      fields.forEach((f) => {
        init[f.key] = f.type === "checkbox"
          ? Boolean(f.defaultValue)
          : (f.defaultValue ?? "") as string;
      });
      setVals(init);
      setErr(null);
    }
    // 只在打开时初始化。字段列表变化（例如差价法才显示费率）不能把已填内容清掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // 必填校验
    const visible = fields.filter((f) => !f.when || f.when(vals));
    for (const f of visible) {
      if (f.required && !String(vals[f.key] ?? "").trim()) {
        setErr(`请填写「${f.label}」`);
        return;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      const msg = await onSubmit(vals);
      if (msg) setErr(msg);
      else onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setField(key: string, value: string | boolean) {
    const next = { ...vals, [key]: value };
    const patch = onFieldChange?.(key, value, next);
    setVals(patch ? { ...next, ...patch } : next);
  }

  const baseInput: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 13,
    border: "1px solid var(--line)", borderRadius: 8,
    background: "var(--card)", color: "var(--text)", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    display: "block", fontSize: 12, color: "var(--sub)",
    fontWeight: 600, marginBottom: 6,
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(16,26,48,.5)",
        zIndex: 90, display: "grid", placeItems: "center", padding: 16,
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: 560, padding: 20, maxHeight: "90vh", overflowY: "auto" }}
      >
        <h3 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 4 }}>{title}</h3>
        {desc && <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>{desc}</p>}

        <div style={{ display: "grid", gap: 13, gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
          {fields.filter((f) => !f.when || f.when(vals)).map((f) => (
            <div key={f.key} style={f.colSpan === 2 ? { gridColumn: "1 / -1" } : undefined}>
              {f.type !== "checkbox" && (
                <label style={lbl}>
                  {f.label}
                  {f.required && <span style={{ color: "var(--bad)" }}> *</span>}
                </label>
              )}

              {f.type === "textarea" ? (
                <textarea
                  value={String(vals[f.key] ?? "")}
                  onChange={(e) => setField(f.key, e.target.value)}
                  rows={3}
                  placeholder={f.placeholder}
                  style={{ ...baseInput, resize: "vertical" }}
                />
              ) : f.type === "select" ? (
                <select
                  value={String(vals[f.key] ?? "")}
                  onChange={(e) => setField(f.key, e.target.value)}
                  style={baseInput}
                >
                  <option value="">请选择</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : f.type === "checkbox" ? (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(vals[f.key])}
                    onChange={(e) => setField(f.key, e.target.checked)}
                  />
                  {f.label}
                </label>
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={String(vals[f.key] ?? "")}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  style={baseInput}
                  step={f.type === "number" ? "0.01" : undefined}
                />
              )}

              {f.hint && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{f.hint}</div>
              )}
            </div>
          ))}
        </div>

        {err && (
          <div className="notice danger" style={{ marginTop: 14 }}>
            <div>{err}</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="btn btn-pri" disabled={busy}>
            {busy ? "保存中…" : submitText}
          </button>
        </div>
      </form>
    </div>
  );
}
