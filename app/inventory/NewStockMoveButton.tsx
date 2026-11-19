"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";
import { todayLocal } from "@/lib/time";

export function NewStockMoveButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<{
    items: { id: number; sku: string; name: string; unit: string }[];
    warehouses: { id: number; name: string }[];
    projects: { id: number; code: string; name: string }[];
  } | null>(null);

  useEffect(() => {
    if (open && !opts) {
      fetch("/api/stock").then((r) => (r.ok ? r.json() : null)).then((d) => d && setOpts(d));
    }
  }, [open, opts]);

  const fields: Field[] = opts ? [
    {
      key: "direction", label: "类型", type: "select", required: true, defaultValue: "out",
      options: [
        { value: "out", label: "出库（领用）" },
        { value: "in", label: "入库（到货）" },
      ],
    },
    {
      key: "itemId", label: "物料", type: "select", required: true,
      options: opts.items.map((i) => ({ value: String(i.id), label: `${i.name}（${i.unit}）` })),
    },
    { key: "qty", label: "数量", type: "number", required: true },
    {
      key: "warehouseId", label: "仓库", type: "select", required: true,
      options: opts.warehouses.map((w) => ({ value: String(w.id), label: w.name })),
    },
    {
      key: "projectId", label: "关联项目", type: "select", colSpan: 2,
      options: opts.projects.map((p) => ({ value: String(p.id), label: `${p.code} ${p.name}` })),
      hint: "出库到项目时必选，入库可留空",
    },
    { key: "moveDate", label: "日期", type: "date", defaultValue: todayLocal() },
    { key: "remark", label: "备注 / 来源", placeholder: "如 采购订单 CG2026-0031" },
  ] : [];

  return (
    <>
      <button className="btn btn-pri" onClick={() => setOpen(true)}>新建出入库单</button>
      {opts && (
        <FormModal
          open={open}
          title="新建出入库单"
          desc="出库会自动扣减库存，库存不足时拒绝"
          fields={fields}
          submitText="提交"
          onClose={() => setOpen(false)}
          onSubmit={async (v) => {
            const res = await fetch("/api/stock", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                direction: v.direction,
                itemId: Number(v.itemId),
                qty: Number(v.qty),
                warehouseId: Number(v.warehouseId),
                projectId: v.projectId ? Number(v.projectId) : null,
                moveDate: v.moveDate,
                remark: v.remark,
              }),
            });
            const d = await res.json();
            if (!res.ok) return d.error ?? "提交失败";
            router.refresh();
            return null;
          }}
        />
      )}
    </>
  );
}
