"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";

export function NewTicketButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<{ id: number; code: string; name: string }[] | null>(null);

  useEffect(() => {
    if (open && !projects) {
      fetch("/api/tickets").then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setProjects(d.projects));
    }
  }, [open, projects]);

  const fields: Field[] = projects ? [
    {
      key: "projectId", label: "所属项目", type: "select", required: true, colSpan: 2,
      options: projects.map((p) => ({ value: String(p.id), label: `${p.code} ${p.name}` })),
    },
    { key: "title", label: "问题描述", required: true, colSpan: 2, placeholder: "如：3号病房楼呼叫系统离线" },
    {
      key: "level", label: "故障级别", type: "select", defaultValue: "一般",
      options: [
        { value: "严重", label: "严重（SLA 4 小时）" },
        { value: "一般", label: "一般（SLA 24 小时）" },
        { value: "咨询", label: "咨询（无 SLA）" },
      ],
    },
    { key: "slaHours", label: "SLA 小时数", type: "number", placeholder: "留空按级别默认" },
    { key: "snList", label: "设备 SN", colSpan: 2, placeholder: "多个用 / 分隔" },
    { key: "isWarranty", label: "在质保期内", type: "checkbox", defaultValue: true, colSpan: 2 },
    { key: "note", label: "备注", type: "textarea", colSpan: 2 },
  ] : [];

  return (
    <>
      <button className="btn btn-pri" onClick={() => setOpen(true)}>新建工单</button>
      {projects && (
        <FormModal
          open={open}
          title="新建服务工单"
          desc="按故障级别自动设定 SLA 响应时限"
          fields={fields}
          submitText="创建工单"
          onClose={() => setOpen(false)}
          onSubmit={async (v) => {
            const res = await fetch("/api/tickets", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: Number(v.projectId),
                title: v.title,
                level: v.level,
                slaHours: v.slaHours ? Number(v.slaHours) : null,
                snList: v.snList,
                isWarranty: Boolean(v.isWarranty),
                note: v.note,
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
