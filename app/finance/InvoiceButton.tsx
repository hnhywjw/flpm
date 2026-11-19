"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";
import { todayLocal } from "@/lib/time";

export function InvoiceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<{
    id: number; label: string; amount_cents: number;
    invoiced_cents: number; actual_cents: number;
  }[] | null>(null);

  useEffect(() => {
    if (open && !terms) {
      fetch("/api/invoices").then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setTerms(d.terms));
    }
  }, [open, terms]);

  const fields: Field[] = terms ? [
    {
      key: "termId", label: "回款期次", type: "select", required: true, colSpan: 2,
      options: terms.map((t) => ({
        value: String(t.id),
        label: `${t.label} · 待开 ${((t.amount_cents - t.invoiced_cents) / 10000).toFixed(2)} 万`,
      })),
      hint: "只列出还有开票余额的期次",
    },
    { key: "invoiceNo", label: "发票号码", placeholder: "留空自动生成" },
    { key: "amountWan", label: "开票金额（万元）", type: "number", required: true },
    {
      key: "taxRate", label: "税率", type: "select", defaultValue: "13%",
      options: ["13%", "9%", "6%", "0%"].map((v) => ({ value: v, label: v })),
    },
    {
      key: "invoiceType", label: "发票类型", type: "select", defaultValue: "增值税专用发票",
      options: [
        { value: "增值税专用发票", label: "增值税专用发票" },
        { value: "增值税普通发票", label: "增值税普通发票" },
        { value: "电子发票", label: "电子发票" },
      ],
    },
    { key: "issueDate", label: "开票日期", type: "date",
      defaultValue: todayLocal() },
    { key: "remark", label: "备注", type: "textarea", colSpan: 2, placeholder: "如：客户要求分期开票" },
  ] : [];

  return (
    <>
      <button className="btn btn-pri" onClick={() => setOpen(true)} disabled={terms !== null && terms.length === 0}>
        登记开票
      </button>
      {terms && (
        <FormModal
          open={open}
          title="登记开票"
          desc="开票金额不能超过期次余额；验收资料未齐备时无法开票"
          fields={fields}
          submitText="确认开票"
          onClose={() => setOpen(false)}
          onSubmit={async (v) => {
            const res = await fetch("/api/invoices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                termId: Number(v.termId),
                invoiceNo: v.invoiceNo,
                amountWan: v.amountWan,
                taxRate: v.taxRate,
                invoiceType: v.invoiceType,
                issueDate: v.issueDate,
                remark: v.remark,
              }),
            });
            const d = await res.json();
            if (!res.ok) return d.error ?? "开票失败";
            router.refresh();
            return null;
          }}
        />
      )}
    </>
  );
}
