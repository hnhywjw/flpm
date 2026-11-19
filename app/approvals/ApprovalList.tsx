"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PendingItem {
  id: number; code: string; biz_title: string; template_name: string;
  step_label: string; applicant_name: string; created_at: string;
  amount: string | null; status: string;
}
interface AppliedItem {
  id: number; code: string; biz_title: string; template_name: string;
  applicant_name: string; created_at: string; amount: string | null;
  status: string; step: number; total: number;
}

const STATUS_MAP: Record<string, { label: string; tone: string }> = {
  pending: { label: "审批中", tone: "warn" },
  approved: { label: "已通过", tone: "ok" },
  rejected: { label: "已驳回", tone: "bad" },
  cancelled: { label: "已撤回", tone: "gray" },
};

export function ApprovalList({ pending, applied }: { pending: PendingItem[]; applied: AppliedItem[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "applied">("pending");
  const [acting, setActing] = useState<number | null>(null);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);

  async function doAct(id: number, action: "approve" | "reject" | "cancel", cm?: string) {
    setActing(id);
    setMsg(null);
    try {
      const res = await fetch("/api/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: id, action, comment: cm }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ t: "err", m: data.error });
      } else {
        setMsg({ t: "ok", m: action === "approve" ? "已通过" : action === "reject" ? "已驳回" : "已撤回" });
        setRejectId(null);
        setComment("");
        router.refresh();
      }
    } catch (e) {
      setMsg({ t: "err", m: (e as Error).message });
    } finally {
      setActing(null);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 6, margin: "16px 0 12px" }}>
        <button className="btn btn-sm" onClick={() => setTab("pending")}
          style={{ background: tab === "pending" ? "var(--pri-weak)" : "var(--card)",
                   borderColor: tab === "pending" ? "var(--pri-soft)" : "var(--line)",
                   color: tab === "pending" ? "var(--pri-2)" : "var(--sub)", fontWeight: 700 }}>
          待我审批 {pending.length}
        </button>
        <button className="btn btn-sm" onClick={() => setTab("applied")}
          style={{ background: tab === "applied" ? "var(--pri-weak)" : "var(--card)",
                   borderColor: tab === "applied" ? "var(--pri-soft)" : "var(--line)",
                   color: tab === "applied" ? "var(--pri-2)" : "var(--sub)", fontWeight: 700 }}>
          我发起的 {applied.length}
        </button>
      </div>

      {msg && (
        <div className={msg.t === "ok" ? "notice ok" : "notice danger"} style={{ marginBottom: 12 }}>
          <div>{msg.m}</div>
        </div>
      )}

      <div className="card">
        {tab === "pending" ? (
          pending.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>
              暂无待审批事项
            </div>
          ) : (
            <div>
              {pending.map((p, i) => (
                <div key={p.id} style={{
                  display: "flex", gap: 12, padding: "13px 16px", alignItems: "center",
                  borderTop: i === 0 ? "none" : "1px solid var(--line2)",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <b style={{ fontSize: 13.5 }}>{p.biz_title}</b>
                      <span className="badge b-gray">{p.template_name}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                      {p.code} · {p.step_label} · 申请人 {p.applicant_name} · {p.created_at?.slice(0, 16)}
                      {p.amount ? " · 金额 " + p.amount + " 万" : ""}
                    </div>
                  </div>

                  {rejectId === p.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input value={comment} onChange={(e) => setComment(e.target.value)}
                        placeholder="驳回理由（必填）"
                        style={{ padding: "5px 9px", fontSize: 12, border: "1px solid var(--line)",
                                 borderRadius: 7, width: 170, background: "var(--card)" }} />
                      <button className="btn btn-sm" style={{ color: "var(--bad)" }}
                        disabled={!comment || acting === p.id}
                        onClick={() => doAct(p.id, "reject", comment)}>
                        确认驳回
                      </button>
                      <button className="btn btn-sm" onClick={() => { setRejectId(null); setComment(""); }}>
                        取消
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-sm btn-pri" disabled={acting === p.id}
                        onClick={() => doAct(p.id, "approve")}>
                        {acting === p.id ? "…" : "通过"}
                      </button>
                      <button className="btn btn-sm" style={{ color: "var(--bad)" }}
                        disabled={acting === p.id}
                        onClick={() => { setRejectId(p.id); setComment(""); }}>
                        驳回
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : applied.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--muted)", padding: 40 }}>
            暂无发起的审批
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>编号</th><th>事项</th><th>流程</th><th>进度</th>
                  <th>金额</th><th>发起时间</th><th>状态</th><th></th>
                </tr>
              </thead>
              <tbody>
                {applied.map((a) => {
                  const s = STATUS_MAP[a.status] ?? { label: a.status, tone: "gray" };
                  return (
                    <tr key={a.id}>
                      <td className="num">{a.code}</td>
                      <td style={{ whiteSpace: "normal", minWidth: 160 }}><b>{a.biz_title}</b></td>
                      <td>{a.template_name}</td>
                      <td className="num">{a.step}/{a.total}</td>
                      <td className="num">{a.amount ? a.amount + " 万" : "—"}</td>
                      <td className="num" style={{ fontSize: 12 }}>{a.created_at?.slice(0, 16)}</td>
                      <td><span className={"badge b-" + s.tone}>{s.label}</span></td>
                      <td>
                        {a.status === "pending" && (
                          <button className="btn btn-sm" disabled={acting === a.id}
                            onClick={() => doAct(a.id, "cancel")}>
                            撤回
                          </button>
                        )}
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
