"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";
import { RowActions } from "@/components/RowActions";

interface Risk {
  id: number;
  code: string;
  project_id: number;
  project_name: string;
  title: string;
  category: string | null;
  level: string;
  probability: string | null;
  impact_desc: string | null;
  response: string | null;
  owner_name: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
}

const LEVEL_TONE: Record<string, string> = {
  高: "b-bad", 中: "b-warn", 低: "b-gray",
};

export function RiskList({ projects }: { projects: { id: number; code: string; name: string }[] }) {
  const router = useRouter();
  const [list, setList] = useState<Risk[] | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "高" | "中" | "低">("all");

  async function load() {
    const res = await fetch("/api/risks");
    if (res.ok) {
      const d = await res.json();
      setList(Array.isArray(d) ? d : (d.list ?? []));
    }
  }
  useEffect(() => { load(); }, []);

  const shown = (list ?? []).filter((r) => filter === "all" || r.level === filter);
  const counts = {
    高: (list ?? []).filter((r) => r.level === "高").length,
    中: (list ?? []).filter((r) => r.level === "中").length,
    低: (list ?? []).filter((r) => r.level === "低").length,
  };

  const fields: Field[] = [
    {
      key: "projectId", label: "关联项目", type: "select", required: true, colSpan: 2,
      options: projects.map((p) => ({ value: String(p.id), label: `${p.code} ${p.name}` })),
    },
    { key: "title", label: "风险描述", required: true, colSpan: 2,
      placeholder: "如：客户付款审批链路过长，可能延迟回款" },
    {
      key: "category", label: "风险类别", type: "select",
      options: ["进度风险", "成本风险", "质量风险", "回款风险", "合规风险", "其他"]
        .map((v) => ({ value: v, label: v })),
    },
    {
      key: "level", label: "风险等级", type: "select", required: true, defaultValue: "中",
      options: ["高", "中", "低"].map((v) => ({ value: v, label: v })),
    },
    { key: "probability", label: "发生概率", type: "select",
      options: ["高", "中", "低"].map((v) => ({ value: v, label: v })) },
    { key: "dueDate", label: "跟进截止", type: "date" },
    { key: "impactDesc", label: "影响说明", type: "textarea", colSpan: 2 },
    { key: "response", label: "应对措施", type: "textarea", colSpan: 2 },
  ];

  return (
    <>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-h">
          <h3>风险台账</h3>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            高 {counts.高} · 中 {counts.中} · 低 {counts.低}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {(["all", "高", "中", "低"] as const).map((k) => (
              <button key={k} onClick={() => setFilter(k)}
                style={{
                  padding: "4px 10px", fontSize: 12, borderRadius: 7, cursor: "pointer",
                  border: `1px solid ${filter === k ? "var(--pri)" : "var(--line)"}`,
                  background: filter === k ? "var(--pri-weak)" : "var(--card)",
                  color: filter === k ? "var(--pri-2)" : "var(--sub)",
                  fontWeight: filter === k ? 700 : 400,
                }}>
                {k === "all" ? "全部" : k}
              </button>
            ))}
            <button className="btn btn-sm btn-pri" onClick={() => setOpen(true)}>+ 登记风险</button>
          </div>
        </div>

        {list === null ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>加载中…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>
            暂无风险记录
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>编号</th><th>项目</th><th>风险描述</th><th>类别</th>
                  <th>等级</th><th>概率</th><th>应对措施</th><th>跟进截止</th><th>状态</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} style={r.level === "高" ? { background: "var(--bad-weak)" } : undefined}>
                    <td className="num" style={{ fontSize: 12 }}>{r.code}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 160, fontSize: 12 }}>
                      {r.project_name}
                    </td>
                    <td style={{ whiteSpace: "normal", minWidth: 200, maxWidth: 300 }}>
                      {r.title}
                      {r.impact_desc && (
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.impact_desc}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.category ?? "—"}</td>
                    <td><span className={"badge " + (LEVEL_TONE[r.level] ?? "b-gray")}>{r.level}</span></td>
                    <td style={{ fontSize: 12 }}>{r.probability ?? "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 200, fontSize: 12 }}>
                      {r.response ?? "—"}
                    </td>
                    <td className="num" style={{ fontSize: 12 }}>{r.due_date ?? "—"}</td>
                    <td>
                      <span className={"badge " + (r.status === "已关闭" ? "b-ok" : "b-warn")}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <RowActions
                        id={r.id}
                        label="风险"
                        apiPath="/api/risks"
                        method="PATCH"
                        editFields={fields.filter((f) => f.key !== "projectId")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormModal
        open={open}
        title="登记风险"
        desc="高风险会出现在待办预警中"
        fields={fields}
        submitText="登记"
        onClose={() => setOpen(false)}
        onSubmit={async (v) => {
          const res = await fetch("/api/risks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: Number(v.projectId),
              title: v.title,
              category: v.category,
              level: v.level,
              probability: v.probability,
              dueDate: v.dueDate,
              impactDesc: v.impactDesc,
              response: v.response,
            }),
          });
          const d = await res.json();
          if (!res.ok) return d.error ?? "登记失败";
          await load();
          router.refresh();
          return null;
        }}
      />
    </>
  );
}
