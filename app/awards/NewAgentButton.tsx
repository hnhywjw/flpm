"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";
import { invoicedWanFromFeeRate } from "@/lib/domain";
import { todayLocal } from "@/lib/time";

export interface WonCompany {
  bidId: number;
  bidCode: string;
  bidName: string;
  companyName: string;
  priceWan: number | null;
  projectId: number | null;
  projectCode: string | null;
  mode: string;
}

export function NewAgentButton({ won }: { won: WonCompany[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const fields: Field[] = [
    {
      key: "bidId", label: "已中标公司", type: "select", required: true, colSpan: 2,
      options: won.map((w) => ({
        value: String(w.bidId) + ":" + w.companyName,
        label: w.bidCode + " " + w.bidName + " · " + w.companyName,
      })),
      hint: won.length
        ? "已在过单费明细里的项目不再出现，避免重复登记"
        : "没有可登记的中标公司。已登记过的不会再出现",
    },
    {
      key: "partyType", label: "对方类型", type: "select", required: true, defaultValue: "company",
      options: [
        { value: "company", label: "公司" },
        { value: "individual", label: "个人（不开票，需凭证）" },
      ],
    },
    { key: "agreementWith", label: "中标公司 / 个人姓名", required: true,
      hint: "选择已中标公司后自动填入，可改" },
    {
      key: "feeMethod", label: "结算方式", type: "select", required: true, defaultValue: "diff",
      options: [
        { value: "diff", label: "差价法（客户合同额 − 开票额）" },
        { value: "cash", label: "现金法（客户合同额 × 费率）" },
      ],
      colSpan: 2,
    },
    { key: "customerAmountWan", label: "客户合同额（万元）", type: "number", required: true,
      hint: "默认带出该参与方的最终报价，可按合同额改" },
    { key: "feeRate", label: "过单费率（%）", type: "number",
      when: (vals) => String(vals.feeMethod) === "cash",
      hint: "只用于现金法。填写后自动算出开票额：客户合同额 × (1 − 费率/100)。例：100万、6% → 94万。不是增值税率" },
    { key: "invoicedAmountWan", label: "中标公司开票额（万元）", type: "number",
      hint: "差价法请手填；现金法填写费率后自动带出，仍可手改" },
    { key: "agreeDate", label: "协议日期", type: "date", defaultValue: todayLocal() },
    { key: "projectId", label: "关联项目", type: "select", colSpan: 2,
      options: won.filter((w) => w.projectId).map((w) => ({
        value: String(w.projectId),
        label: (w.projectCode ?? "") + " " + w.bidName,
      })),
      hint: "有关联项目时自动选中；没有则可空",
    },
    { key: "note", label: "说明", type: "textarea", colSpan: 2 },
  ];

  function onFieldChange(
    key: string,
    value: string | boolean,
    vals: Record<string, string | boolean>,
  ): Record<string, string | boolean> | void {
    const patch: Record<string, string | boolean> = {};
    if (key === "feeMethod" && value !== "cash") patch.feeRate = "";
    if (key === "bidId") {
      const raw = String(value);
      const hit = won.find((w) => raw === String(w.bidId) + ":" + w.companyName);
      if (hit) {
        patch.agreementWith = hit.companyName;
        patch.partyType = "company";
        patch.customerAmountWan = hit.priceWan != null ? String(hit.priceWan) : "";
        patch.projectId = hit.projectId ? String(hit.projectId) : "";
      }
    }
    const next = { ...vals, ...patch };
    if (String(next.feeMethod) === "cash" && (key === "feeRate" || key === "customerAmountWan" || key === "bidId" || key === "feeMethod")) {
      const invoiced = invoicedWanFromFeeRate(next.customerAmountWan, next.feeRate);
      if (invoiced != null) patch.invoicedAmountWan = String(invoiced);
    }
    return Object.keys(patch).length ? patch : undefined;
  }

  return (
    <>
      <button className="btn btn-pri" onClick={() => setOpen(true)}>
        登记过单费
      </button>
      <FormModal
        open={open}
        title="登记代中标协议与过单费"
        desc="先选投标里已中标的公司，名称和报价自动带出"
        fields={fields}
        submitText="核算并登记"
        onClose={() => setOpen(false)}
        onFieldChange={onFieldChange}
        onSubmit={async (v) => {
          const method = String(v.feeMethod);
          if (method === "diff") {
            if (!v.invoicedAmountWan) return "差价法必须填写开票额";
            if (Number(v.invoicedAmountWan) >= Number(v.customerAmountWan)) {
              return "差价法要求开票额小于客户合同额";
            }
          } else if (!v.feeRate || Number(v.feeRate) <= 0) {
            return "现金法必须填写过单费率";
          }
          const bidKey = String(v.bidId ?? "");
          const bidId = Number(bidKey.split(":")[0]);
          const res = await fetch("/api/agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: v.projectId ? Number(v.projectId) : null,
              bidId: Number.isFinite(bidId) ? bidId : null,
              agreementWith: v.agreementWith,
              partyType: v.partyType,
              feeMethod: v.feeMethod,
              feeRate: method === "cash" && v.feeRate ? Number(v.feeRate) : null,
              customerAmountWan: v.customerAmountWan,
              invoicedAmountWan: v.invoicedAmountWan || 0,
              agreeDate: v.agreeDate,
              note: v.note,
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
