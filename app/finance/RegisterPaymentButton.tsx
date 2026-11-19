"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";
import { todayLocal } from "@/lib/time";

interface TermOpt {
  id: number;
  label: string;
  remaining: number;
}

export function RegisterPaymentButton({ terms }: { terms: TermOpt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const fields: Field[] = [
    {
      key: "termId", label: "回款期次", type: "select", required: true, colSpan: 2,
      options: terms.map((t) => ({ value: String(t.id), label: t.label })),
      hint: "只列出未结清的期次",
    },
    { key: "amountWan", label: "本次回款金额（万元）", type: "number", required: true },
    { key: "actualDate", label: "回款日期", type: "date", defaultValue: todayLocal() },
    { key: "remark", label: "备注", type: "textarea", colSpan: 2, placeholder: "如：银行转账，附回单" },
  ];

  return (
    <>
      <button className="btn btn-pri" onClick={() => setOpen(true)} disabled={terms.length === 0}>
        登记回款
      </button>
      <FormModal
        open={open}
        title="登记回款"
        desc="累计回款超过计划金额时会被拒绝"
        fields={fields}
        submitText="确认登记"
        onClose={() => setOpen(false)}
        onSubmit={async (v) => {
          const res = await fetch("/api/payments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              termId: Number(v.termId),
              amountWan: v.amountWan,
              actualDate: v.actualDate,
              remark: v.remark,
            }),
          });
          const d = await res.json();
          if (!res.ok) return d.error ?? "登记失败";
          router.refresh();
          return null;
        }}
      />
    </>
  );
}
