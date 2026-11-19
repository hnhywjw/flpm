"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** 项目批量导入 */
export function ImportButton() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setReport(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/import/projects", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) {
        setReport("导入失败：" + (d.error ?? "未知错误"));
        return;
      }
      const fails = (d.results ?? []).filter((x: { ok: boolean }) => !x.ok);
      let msg = `导入完成：成功 ${d.success} / ${d.total}`;
      if (fails.length) {
        msg += "\n失败明细：\n" + fails.slice(0, 8).map((x: { row: number; msg: string }) => `  第 ${x.row} 行: ${x.msg}`).join("\n");
      }
      setReport(msg);
      router.refresh();
    } catch (err) {
      setReport("导入异常：" + (err as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <>
      <input ref={ref} type="file" accept=".csv" onChange={onFile} style={{ display: "none" }} />
      <button className="btn" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "导入中…" : "批量导入"}
      </button>
      <button className="btn" onClick={async () => {
        const res = await fetch("/api/import/projects");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "项目导入模板.csv";
        a.click();
        URL.revokeObjectURL(url);
      }}>下载模板</button>
      {report && (
        <div style={{
          position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12,
          padding: 20, zIndex: 90, maxWidth: 520, boxShadow: "0 20px 60px rgba(0,0,0,.28)",
        }}>
          <pre style={{ fontSize: 12.5, whiteSpace: "pre-wrap", lineHeight: 1.8, margin: 0 }}>
            {report}
          </pre>
          <button className="btn btn-sm btn-pri" style={{ marginTop: 12 }}
                  onClick={() => setReport(null)}>关闭</button>
        </div>
      )}
    </>
  );
}
