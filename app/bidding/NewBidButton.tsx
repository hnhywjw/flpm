"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";

/**
 * 新建投标
 *
 * ★ 字段分两段：
 *   基础信息  —— 录入时要填的（名称、业主、编号、金额、日期）
 *   招标参数  —— 从招标文件上抄的（代理机构、方式、地点、踏勘、答疑）
 *
 * 招标编号（bidNo）单独列出：
 *   系统内部编号 B2026-036 是自动生成的流水号，
 *   而招标文件上的编号才是对外对账用的，必须手工录。
 */
export function NewBidButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ id: number; name: string }[] | null>(null);
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    if (open && !users) {
      fetch("/api/bids/create").then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) {
            setUsers(d.users ?? []);
            setCustomers(d.customers ?? []);
          }
        });
    }
  }, [open, users]);

  const fields: Field[] = users ? [
    { key: "name", label: "项目名称", required: true, colSpan: 2,
      placeholder: "照招标文件上的项目名称" },
    { key: "bidNo", label: "项目编号", required: true, colSpan: 2,
      placeholder: "招标文件上的项目编号" },
    { key: "bidMethod", label: "招标方式", type: "select", defaultValue: "公开招标",
      options: ["公开招标", "邀请招标", "竞争性谈判", "竞争性磋商", "单一来源", "询价"]
        .map((v) => ({ value: v, label: v })) },
    { key: "agentCompany", label: "招标代理机构",
      placeholder: "保证金交给这家机构" },
    { key: "customerName", label: "业主单位名称", colSpan: 2,
      placeholder: customers.length ? "可填新名称，不存在会自动建档" : "业主单位名称" },
    { key: "budgetWan", label: "项目预算（万元）", type: "number" },
    { key: "bondWan", label: "投标保证金（万元）", type: "number",
      hint: "交给招标代理机构" },
    { key: "docPriceWan", label: "标书费（万元）", type: "number" },
    { key: "deadline", label: "投标截止时间", type: "date", required: true },
    { key: "openDate", label: "开标时间", type: "datetime-local" },
    {
      key: "mode", label: "投标方式", type: "select", defaultValue: "direct",
      options: [
        { value: "direct", label: "直接投标" },
        { value: "agent", label: "代中标" },
      ],
    },
    {
      key: "ownerId", label: "项目负责人", type: "select",
      options: users.map((u) => ({ value: String(u.id), label: u.name })),
      hint: "留空默认当前用户",
    },
  ] : [];

  return (
    <>
      <button className="btn btn-pri" onClick={() => setOpen(true)}>新建投标</button>
      {users && (
        <FormModal
          open={open}
          title="新建投标"
          desc="填写招标文件上的信息，创建后进入「立项评审」阶段"
          fields={fields}
          submitText="创建投标"
          onClose={() => setOpen(false)}
          onSubmit={async (v) => {
            const res = await fetch("/api/bids/create", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: v.name,
                bidNo: v.bidNo,
                customerName: v.customerName,
                budgetWan: v.budgetWan,
                bondWan: v.bondWan,
                deadline: v.deadline,
                openDate: v.openDate,
                bidMethod: v.bidMethod,
                mode: v.mode,
                agentCompany: v.agentCompany,
                docPriceWan: v.docPriceWan,
                ownerId: v.ownerId ? Number(v.ownerId) : null,
              }),
            });
            const d = await res.json();
            if (!res.ok) return d.error ?? "创建失败";
            router.refresh();
            return null;
          }}
        />
      )}
    </>
  );
}
