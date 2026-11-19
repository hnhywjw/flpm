"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";

export interface ContractProject {
  id: number;
  code: string;
  name: string;
  customerName: string | null;
  winCents: number | null;
}

export function NewContractButton({
  projects, used = [],
}: {
  projects: ContractProject[];
  used?: { project_id: number; type: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const fields: Field[] = [
    {
      key: "projectId", label: "关联项目", type: "select", required: true, colSpan: 2,
      options: projects.map((p) => ({ value: String(p.id), label: p.code + " " + p.name })),
      hint: "项目都会列出。同一项目只能有一份客户合同，采购合同可以添加多份",
    },
    {
      key: "type", label: "合同类型", type: "select", required: true, defaultValue: "customer",
      options: [
        { value: "customer", label: "客户合同（收入）" },
        { value: "purchase", label: "采购合同（成本）" },
      ],
    },
    {
      key: "partyName", label: "相对方名称", required: true,
      placeholder: "客户合同时自动填业主单位",
    },
    { key: "title", label: "合同名称", colSpan: 2, placeholder: "客户合同时默认用项目名称" },
    { key: "amountWan", label: "合同金额（万元）", type: "number", required: true,
      hint: "客户合同时默认用项目中标金额，可改" },
    { key: "signDate", label: "签订日期", type: "date" },
    {
      key: "invoiceMode", label: "开票方式", type: "select", defaultValue: "by_payment",
      options: [
        { value: "by_payment", label: "按付款比例" },
        { value: "full", label: "全额一次性" },
      ],
    },
    {
      key: "taxRate", label: "税率", type: "select", defaultValue: "13%",
      options: ["13%", "9%", "6%", "0%"].map((v) => ({ value: v, label: v })),
    },
    { key: "warrantyMonths", label: "质保期（月）", type: "number", placeholder: "如 24" },
    {
      key: "paySummary", label: "付款比例", defaultValue: "30/40/25/5",
      hint: "用 / 分隔，合计需为 100。如 30/40/25/5，系统自动生成回款计划",
      colSpan: 2,
    },
  ];

  function onFieldChange(
    key: string,
    value: string | boolean,
    vals: Record<string, string | boolean>,
  ): Record<string, string | boolean> | void {
    if (key !== "projectId" && key !== "type") return;
    const type = key === "type" ? String(value) : String(vals.type || "customer");
    const projectId = key === "projectId" ? String(value) : String(vals.projectId || "");
    if (type !== "customer" || !projectId) return;
    const p = projects.find((x) => String(x.id) === projectId);
    if (!p) return;
    return {
      partyName: p.customerName ?? "",
      title: p.name,
      amountWan: p.winCents != null ? String(p.winCents / 10000) : "",
    };
  }

  return (
    <>
      <button className="btn btn-pri" onClick={() => setOpen(true)}>新建合同</button>
      <FormModal
        open={open}
        title="新建合同"
        desc="选客户合同并选中项目后，业主单位、合同名称、中标金额会自动带出"
        fields={fields}
        submitText="创建合同"
        onClose={() => setOpen(false)}
        onFieldChange={onFieldChange}
        onSubmit={async (v) => {
          const sum = String(v.paySummary ?? "").split("/").map(Number);
          const total = sum.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
          if (v.type === "customer" && used.some((u) => String(u.project_id) === String(v.projectId) && u.type === "customer")) {
            return "该项目已有客户合同，不能再加。采购合同不受这条限制，可以继续添加";
          }
          if (v.type === "customer" && Math.abs(total - 100) > 0.01) {
            return "付款比例合计必须为 100，当前为 " + total;
          }
          const res = await fetch("/api/contracts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: Number(v.projectId),
              type: v.type,
              partyName: v.partyName,
              title: v.title,
              amountWan: v.amountWan,
              signDate: v.signDate,
              warrantyMonths: v.warrantyMonths ? Number(v.warrantyMonths) : null,
              invoiceMode: v.invoiceMode,
              taxRate: v.taxRate,
              paySummary: v.paySummary,
            }),
          });
          const d = await res.json();
          if (!res.ok) return d.error ?? "创建失败";
          router.refresh();
          return null;
        }}
      />
    </>
  );
}
