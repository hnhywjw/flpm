"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ChangeItem {
  id: number; code: string; project_name: string; project_code: string;
  title: string; change_type: string; amount: string; amountNum: number;
  days: number; status: string; applicant: string; created_at: string;
  confirmed: boolean;
}
interface Proj { id: number; code: string; name: string }

const TYPE_LABEL: Record<string, string> = {
  scope: "范围变更", schedule: "工期变更", amount: "金额变更",
  tech: "技术变更", other: "其他",
};
const ST_LABEL: Record<string, { t: string; c: string }> = {
  draft: { t: "草稿", c: "gray" },
  pending: { t: "审批中", c: "warn" },
  approved: { t: "已批准", c: "ok" },
  rejected: { t: "已驳回", c: "bad" },
  cancelled: { t: "已撤回", c: "gray" },
};

export function ChangeList({ changes, projects }: { changes: ChangeItem[]; projects: Proj[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  const [projectId, setProjectId] = useState<string>(String(projects[0]?.id ?? ""));
  const [title, setTitle] = useState("");
  const [changeType, setChangeType] = useState("scope");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState("");
  const [amountWan, setAmountWan] = useState("");
  const [daysDelta, setDaysDelta] = useState("");

  async function create(submit: boolean) {
    if (!title.trim()) { setMsg({ t: "err", m: "变更标题必填" }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: Number(projectId), title: title.trim(), changeType,
          reason, impact,
          amountDeltaWan: amountWan || 0,
          daysDelta: daysDelta || 0,
          submit,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ t: "err", m: d.error }); return; }
      setMsg({ t: "ok", m: `变更单 ${d.code} 已${submit ? "提交审批" : "保存为草稿"}` });
      setOpen(false);
      setTitle(""); setReason(""); setImpact(""); setAmountWan(""); setDaysDelta("");
      router.refresh();
    } catch (e) {
      setMsg({ t: "err", m: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function act(id: number, action: "submit" | "customer_confirm") {
    setBusy(true);
    try {
      const res = await fetch("/api/changes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const d = await res.json();
      if (!res.ok) setMsg({ t: "err", m: d.error });
      else {
        setMsg({ t: "ok", m: action === "submit" ? "已提交审批" : "已标记客户确认" });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid var(--line)",
    borderRadius: 8, background: "var(--card)", color: "var(--text)", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, color: "var(--sub)", fontWeight: 600, marginBottom: 6,
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, margin: "16px 0 12px" }}>
        <button className="btn btn-pri" onClick={() => setOpen(!open)}>
          {open ? "收起" : "+ 新建变更单"}
        </button>
        <button className="btn" onClick={async () => {
          await fetch("/api/changes/sync", { method: "POST" });
          router.refresh();
        }}>同步审批结果</button>
      </div>

      {msg && (
        <div className={msg.t === "ok" ? "notice ok" : "notice danger"} style={{ marginBottom: 12 }}>
          <div>{msg.m}</div>
        </div>
      )}

      {open && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-h"><h3>新建变更单</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              提交后进入「项目经理 → 财务 → 总经理」审批流
            </span>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <label style={labelStyle}>所属项目</label>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inputStyle}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} {p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>变更类型</label>
                <select value={changeType} onChange={(e) => setChangeType(e.target.value)} style={inputStyle}>
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>变更标题 *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)}
                       placeholder="如：增加 2 个病区点位" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>金额增减（万元，负数表示减少）</label>
                <input value={amountWan} onChange={(e) => setAmountWan(e.target.value)}
                       placeholder="如 18.6 或 -5" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>工期增减（天，负数表示提前）</label>
                <input value={daysDelta} onChange={(e) => setDaysDelta(e.target.value)}
                       placeholder="如 15 或 -3" style={inputStyle} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>变更原因</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                          style={{ ...inputStyle, resize: "vertical" }} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>影响分析</label>
                <textarea value={impact} onChange={(e) => setImpact(e.target.value)} rows={2}
                          style={{ ...inputStyle, resize: "vertical" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="btn btn-pri" disabled={busy} onClick={() => create(true)}>
                {busy ? "提交中…" : "提交审批"}
              </button>
              <button className="btn" disabled={busy} onClick={() => create(false)}>存为草稿</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {changes.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>暂无变更单</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>编号</th><th>项目</th><th>变更内容</th><th>类型</th>
                  <th>金额影响</th><th>工期</th><th>客户确认</th>
                  <th>状态</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => {
                  const st = ST_LABEL[c.status] ?? { t: c.status, c: "gray" };
                  return (
                    <tr key={c.id}>
                      <td className="num">{c.code}</td>
                      <td style={{ whiteSpace: "normal", maxWidth: 180, fontSize: 12 }}>
                        {c.project_name}
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.project_code}</div>
                      </td>
                      <td style={{ whiteSpace: "normal", minWidth: 150 }}><b>{c.title}</b></td>
                      <td><span className="badge b-gray">{TYPE_LABEL[c.change_type] ?? c.change_type}</span></td>
                      <td className="num" style={{ color: c.amountNum > 0 ? "var(--ok)" : c.amountNum < 0 ? "var(--bad)" : undefined }}>
                        {c.amount}
                      </td>
                      <td className="num">{c.days ? (c.days > 0 ? "+" : "") + c.days + " 天" : "—"}</td>
                      <td>
                        {c.confirmed
                          ? <span className="badge b-ok">已确认</span>
                          : <span className="badge b-gray">未确认</span>}
                      </td>
                      <td><span className={"badge b-" + st.c}>{st.t}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 5 }}>
                          {c.status === "draft" && (
                            <button className="btn btn-sm btn-pri" disabled={busy}
                                    onClick={() => act(c.id, "submit")}>提交</button>
                          )}
                          {c.status === "approved" && !c.confirmed && (
                            <button className="btn btn-sm" disabled={busy}
                                    onClick={() => act(c.id, "customer_confirm")}>客户确认</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
