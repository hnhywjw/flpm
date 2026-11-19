"use client";

import { useState } from "react";

/** 导出按钮：触发浏览器下载 */
export function ExportButton({
  type,
  label = "导出",
  className = "btn",
}: {
  type: string;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function doExport() {
    setBusy(true);
    try {
      const res = await fetch(`/api/export?type=${type}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "导出失败" }));
        alert(d.error ?? "导出失败");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename\*=UTF-8''(.+)/);
      const filename = m ? decodeURIComponent(m[1]) : `export-${type}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className={className} onClick={doExport} disabled={busy}>
      {busy ? "导出中…" : label}
    </button>
  );
}
