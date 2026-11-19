"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";

/**
 * 新建项目
 *
 * ★ 项目编号必须手工填
 *
 * 原来是系统按 P2026-018 自动生成的内部流水号，
 * 但那个号和招标文件上的项目编号对不上 —— 对账、查档时找不到依据。
 * 现在改成用户照招标文件录入，系统只校验唯一性。
 */
export function NewProjectButton({
  customers,
  users,
}: {
  customers: { id: number; name: string }[];
  users: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const fields: Field[] = [
    { key: "code", label: "项目编号", required: true, colSpan: 2,
      placeholder: "照招标文件上的项目编号录入",
      hint: "系统不再自动编号，这里填招标方给的编号" },
    { key: "name", label: "项目名称", required: true, colSpan: 2 },
    {
      key: "customerId", label: "业主单位", type: "select",
      options: customers.map((c) => ({ value: String(c.id), label: c.name })),
    },
    {
      key: "ownerId", label: "责任人", type: "select",
      options: users.map((u) => ({ value: String(u.id), label: u.name })),
    },
    { key: "projectType", label: "项目类型",
      placeholder: "系统集成 / 工程实施 / 货物+服务 / 运维服务" },
    {
      key: "mode", label: "中标方式", type: "select", defaultValue: "direct",
      options: [
        { value: "direct", label: "直接中标" },
        { value: "agent", label: "代中标" },
      ],
    },
    { key: "budgetWan", label: "预算（万元）", type: "number" },
    { key: "contractNo", label: "合同编号",
      placeholder: "立项后签的合同号，和合同模块对账用" },
    { key: "startDate", label: "开始日期", type: "date" },
    { key: "planDue", label: "计划完成", type: "date" },
  ];

  async function submit(v: Record<string, string | boolean>): Promise<string | null> {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: v.code,
        name: v.name,
        customerId: v.customerId ? Number(v.customerId) : null,
        ownerId: v.ownerId ? Number(v.ownerId) : undefined,
        projectType: v.projectType,
        mode: v.mode,
        budgetWan: v.budgetWan,
        startDate: v.startDate,
        planDue: v.planDue,
        contractNo: v.contractNo,
      }),
    });
    const d = await res.json();
    if (!res.ok) return d.error ?? "创建失败";
    router.refresh();
    return null;
  }

  return (
    <>
      <button className="btn btn-pri" onClick={() => setOpen(true)}>
        + 新建项目
      </button>
      <FormModal
        open={open}
        title="新建项目"
        desc="项目编号请照招标文件填写"
        fields={fields}
        submitText="创建"
        onClose={() => setOpen(false)}
        onSubmit={submit}
      />
    </>
  );
}
