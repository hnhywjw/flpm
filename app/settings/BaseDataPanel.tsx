"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";

interface Meta { label: string; fields: string[]; searchField: string }
type Row = Record<string, string | number | null>;

const FIELD_LABEL: Record<string, string> = {
  name: "名称", short_name: "简称", contact: "联系人", phone: "电话", address: "地址",
  sku: "物料编码", spec: "规格型号", unit: "单位", safe_stock: "安全库存",
  location: "位置", manager: "负责人",
};

const FIELD_TYPE: Record<string, "text" | "number"> = {
  safe_stock: "number",
};

export function BaseDataPanel() {
  const router = useRouter();
  const [tables, setTables] = useState<Record<string, Meta>>({});
  const [data, setData] = useState<Record<string, Row[]>>({});
  const [tab, setTab] = useState<string>("customers");
  const [kw, setKw] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /**
   * 加载基础数据
   *
   * all=true 时加载全部三类（用于 tab 上显示各自数量），
   * all=false 时只加载当前 tab（搜索时用，减少数据量）。
   *
   * 之前每次都只请求当前 tab，导致其他 tab 的数量一直是 0。
   */
  async function load(k = kw, all = true) {
    const url = all
      ? `/api/base-data?kw=${encodeURIComponent(k)}`
      : `/api/base-data?type=${tab}&kw=${encodeURIComponent(k)}`;
    const res = await fetch(url);
    if (res.ok) {
      const d = await res.json();
      setTables(d.tables ?? {});
      setData(d.data ?? {});
    }
  }
  // 首次加载全部，让各 tab 都能显示正确数量
  useEffect(() => { load(); }, []);
  // 切换 tab 且已有关键字时，重新按关键字加载全部
  useEffect(() => {
    load(kw, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const rows = data[tab] ?? [];
  const meta = tables[tab];

  const fields: Field[] = meta ? meta.fields.map((f) => ({
    key: f,
    label: FIELD_LABEL[f] ?? f,
    type: FIELD_TYPE[f] ?? "text",
    required: f === "name" || (tab === "items" && f === "sku"),
    colSpan: f === "address" || f === "spec" ? 2 : 1,
    defaultValue: editing?.[f] ?? "",
    hint: f === "safe_stock" ? "低于此值触发库存预警" : undefined,
  })) : [];

  async function save(v: Record<string, string | boolean>) {
    setBusy(true);
    setMsg(null);
    try {
      const payload = editing
        ? { type: tab, action: "update", id: editing.id, values: v }
        : { type: tab, action: "create", values: v };

      const res = await fetch("/api/base-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) return d.error ?? "保存失败";

      setMsg(editing ? "已更新" : "已新增");
      await load(kw, true);
      router.refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number, name: string) {
    if (!confirm(`删除「${name}」？\n\n若已被业务数据引用将无法删除。`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/base-data?type=${tab}&id=${id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error); return; }
      setMsg("已删除");
      await load(kw, true);
    } finally { setBusy(false); }
  }

  const tabLabel: Record<string, string> = {
    customers: "客户", items: "物料", warehouses: "仓库",
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {["customers", "items", "warehouses"].map((t) => (
          <button key={t} onClick={() => { setTab(t); setEditing(null); }}
            style={{
              padding: "6px 13px", fontSize: 12.5, borderRadius: 8, cursor: "pointer",
              border: `1px solid ${tab === t ? "var(--pri)" : "var(--line)"}`,
              background: tab === t ? "var(--pri-weak)" : "var(--card)",
              color: tab === t ? "var(--pri-2)" : "var(--sub)",
              fontWeight: tab === t ? 700 : 400,
            }}>
            {tabLabel[t]}（{(data[t] ?? []).length}）
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <input value={kw} onChange={(e) => setKw(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") load(kw, true); }}
               placeholder="搜索名称"
               style={{ padding: "6px 11px", fontSize: 12.5, border: "1px solid var(--line)",
                        borderRadius: 8, background: "var(--card)", width: 160 }} />
        <button className="btn btn-sm" onClick={() => load(kw, true)}>搜索</button>
        <button className="btn btn-sm btn-pri"
                onClick={() => { setEditing(null); setOpen(true); }}>
          + 新增{tabLabel[tab]}
        </button>
      </div>

      {msg && <div className="notice ok" style={{ marginBottom: 10 }}><div>{msg}</div></div>}

      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          暂无数据
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                {meta?.fields.map((f) => <th key={f}>{FIELD_LABEL[f] ?? f}</th>)}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  {meta?.fields.map((f) => (
                    <td key={f} className={f === "safe_stock" ? "num" : undefined}
                        style={{ whiteSpace: f === "address" ? "normal" : undefined, maxWidth: 200 }}>
                      {r[f] ?? "—"}
                    </td>
                  ))}
                  <td>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button className="btn btn-sm"
                              onClick={() => { setEditing(r); setOpen(true); }}>
                        编辑
                      </button>
                      <button className="btn btn-sm" style={{ color: "var(--bad)" }}
                              disabled={busy}
                              onClick={() => remove(Number(r.id), String(r[meta.searchField] ?? r.id))}>
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

      <FormModal
        open={open}
        title={editing ? `编辑${tabLabel[tab]}` : `新增${tabLabel[tab]}`}
        fields={fields}
        submitText={editing ? "保存" : "新增"}
        onClose={() => { setOpen(false); setEditing(null); }}
        onSubmit={async (v) => {
          const r = await save(v);
          if (!r) setOpen(false);
          return r;
        }}
      />
    </div>
  );
}
