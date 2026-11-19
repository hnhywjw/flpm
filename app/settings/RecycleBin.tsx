"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Meta { label: string; nameField: string }
interface Row {
  id: number;
  display_name: string | null;
  deleted_at: string;
  deleted_by_name: string;
}

export function RecycleBin() {
  const router = useRouter();
  const [data, setData] = useState<{ tables: Record<string, Meta>; deleted: Record<string, Row[]> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/recycle");
    if (res.ok) setData(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function restore(table: string, id: number) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/recycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, id }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error); return; }
      setMsg("已恢复");
      await load();
      router.refresh();
    } finally { setBusy(false); }
  }

  async function purge(table: string, id: number, name: string) {
    if (!confirm(`彻底删除「${name}」？\n\n此操作不可恢复，数据将从数据库移除。`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/recycle?table=${table}&id=${id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error); return; }
      setMsg("已彻底删除");
      await load();
    } finally { setBusy(false); }
  }

  if (!data) return <div style={{ padding: 24, color: "var(--muted)" }}>加载中…</div>;

  const groups = Object.entries(data.deleted);
  const total = groups.reduce((s, [, rows]) => s + rows.length, 0);

  return (
    <div style={{ padding: 16 }}>
      {msg && <div className="notice ok" style={{ marginBottom: 12 }}><div>{msg}</div></div>}

      {total === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>
          回收站为空
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14 }}>
            共 <b>{total}</b> 条已删除记录。删除只是隐藏，数据仍在库中，可随时恢复。
          </div>
          {groups.map(([table, rows]) => (
            <div key={table} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                {data.tables[table]?.label ?? table}
                <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
                  ({rows.length})
                </span>
              </div>
              <table className="tbl">
                <thead>
                  <tr><th>名称</th><th>删除时间</th><th>删除人</th><th>操作</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: "normal", maxWidth: 300 }}>
                        {r.display_name ?? `#${r.id}`}
                      </td>
                      <td className="num" style={{ fontSize: 12 }}>{r.deleted_at}</td>
                      <td style={{ fontSize: 12 }}>{r.deleted_by_name}</td>
                      <td>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button className="btn btn-sm" disabled={busy}
                                  onClick={() => restore(table, r.id)}>恢复</button>
                          <button className="btn btn-sm" style={{ color: "var(--bad)" }}
                                  disabled={busy}
                                  onClick={() => purge(table, r.id, r.display_name ?? String(r.id))}>
                            彻底删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
