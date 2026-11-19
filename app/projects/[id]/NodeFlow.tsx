"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectNode } from "@/lib/types";
import { NODE_STATUS_LABEL } from "@/lib/domain";
import { todayLocal } from "@/lib/time";

const LABEL: Record<string, string> = {
  招标: "招标", 投标: "投标", 中标: "中标", 合同: "合同",
  实施: "实施", 验收: "验收", 开票: "开票", 回款: "回款",
  保证金返还: "保证金", 质保金: "质保金", 售后: "售后",
};

export function NodeFlow({ nodes, projectId, gate }: {
  nodes: ProjectNode[];
  projectId: number;
  gate: { ok: boolean; done: number; missing: string[] };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [target, setTarget] = useState<ProjectNode | null>(null);
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  // 中标节点专用
  const [winNoticeNo, setWinNoticeNo] = useState("");
  const [winAmountWan, setWinAmountWan] = useState("");
  const [winDate, setWinDate] = useState("");
  // 实施节点专用
  const [implPlan, setImplPlan] = useState("");
  const [progressNote, setProgressNote] = useState("");

  async function advance(node: ProjectNode) {
    setBusy(node.id);
    setErr(null);
    try {
      const res = await fetch("/api/projects/node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: node.id,
          action: "advance",
          actualDate: date,
          note,
          winNoticeNo: winNoticeNo || undefined,
          winAmountWan: winAmountWan || undefined,
          winDate: winDate || undefined,
          implPlan: implPlan || undefined,
          progressNote: progressNote || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "推进失败");
        return;
      }
      setTarget(null);
      setNote("");
      setWinNoticeNo(""); setWinAmountWan(""); setWinDate("");
      setImplPlan(""); setProgressNote("");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flow">
        {nodes.map((n) => {
          const cls = n.status === "done" ? "done" : n.status === "cur" ? "cur" : n.status === "late" ? "late" : "";
          return (
            <button
              key={n.id}
              onClick={() => { if (n.status === "cur" || n.status === "next") setTarget(n); }}
              className={`fnode ${cls}`}
              style={{ cursor: n.status === "cur" || n.status === "next" ? "pointer" : "default",
                       border: 0, textAlign: "center" }}
              title={n.note ?? ""}
            >
              <div className="st">{n.is_parallel ? "并行" : NODE_STATUS_LABEL[n.status]}</div>
              <div className="nn">{LABEL[n.node_key] ?? n.node_key}</div>
              <div className="dd">计划 {n.plan_date?.slice(5) ?? "—"}</div>
              <div className="dd">{n.actual_date ? "实际 " + n.actual_date.slice(5) : "—"}</div>
            </button>
          );
        })}
      </div>

      {err && (
        <div className="notice danger" style={{ marginTop: 10 }}>
          <div>{err}</div>
        </div>
      )}

      {target && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,26,48,.45)",
                      zIndex: 80, display: "grid", placeItems: "center", padding: 16 }}
             onClick={() => setTarget(null)}>
          <div className="card" style={{ width: "100%", maxWidth: 440, padding: 20 }}
               onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              推进节点「{target.node_key}」
            </h3>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
              计划完成 {target.plan_date ?? "—"} · 推进后自动激活下一个非并行节点
            </p>

            {target.node_key === "验收" && !gate.ok && (
              <div className="notice danger" style={{ marginBottom: 12 }}>
                <div>
                  <b>验收资料未齐备 {gate.done}/4</b>
                  缺少：{gate.missing.join("、")}。齐备前无法推进到「开票」节点。
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ fontSize: 12, color: "var(--sub)", fontWeight: 600 }}>
                实际完成日期
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid var(--line)",
                         borderRadius: 8, fontSize: 13, background: "var(--card)" }}
              />
              {/* 中标节点：结构化字段 */}
              {target.node_key === "中标" && (
                <>
                  <label style={{ fontSize: 12, color: "var(--sub)", fontWeight: 600 }}>
                    中标通知书编号
                  </label>
                  <input value={winNoticeNo} onChange={(e) => setWinNoticeNo(e.target.value)}
                         placeholder="如 ZB-2026-0088"
                         style={{ padding: "8px 10px", border: "1px solid var(--line)",
                                  borderRadius: 8, fontSize: 13, background: "var(--card)" }} />
                  <label style={{ fontSize: 12, color: "var(--sub)", fontWeight: 600 }}>
                    中标金额（万元）
                  </label>
                  <input type="number" step="0.01" value={winAmountWan}
                         onChange={(e) => setWinAmountWan(e.target.value)}
                         placeholder="如 180.00"
                         style={{ padding: "8px 10px", border: "1px solid var(--line)",
                                  borderRadius: 8, fontSize: 13, background: "var(--card)" }} />
                  <label style={{ fontSize: 12, color: "var(--sub)", fontWeight: 600 }}>
                    中标日期
                  </label>
                  <input type="date" value={winDate} onChange={(e) => setWinDate(e.target.value)}
                         style={{ padding: "8px 10px", border: "1px solid var(--line)",
                                  borderRadius: 8, fontSize: 13, background: "var(--card)" }} />
                </>
              )}

              {/* 实施节点：方案与进度 */}
              {target.node_key === "实施" && (
                <>
                  <label style={{ fontSize: 12, color: "var(--sub)", fontWeight: 600 }}>
                    实施方案
                  </label>
                  <textarea value={implPlan} onChange={(e) => setImplPlan(e.target.value)}
                            rows={3} placeholder="施工方案、人员安排、里程碑"
                            style={{ padding: "8px 10px", border: "1px solid var(--line)",
                                     borderRadius: 8, fontSize: 13, background: "var(--card)",
                                     resize: "vertical" }} />
                  <label style={{ fontSize: 12, color: "var(--sub)", fontWeight: 600 }}>
                    进度说明
                  </label>
                  <input value={progressNote} onChange={(e) => setProgressNote(e.target.value)}
                         placeholder="如 设备已到货，安装完成 60%"
                         style={{ padding: "8px 10px", border: "1px solid var(--line)",
                                  borderRadius: 8, fontSize: 13, background: "var(--card)" }} />
                </>
              )}

              <label style={{ fontSize: 12, color: "var(--sub)", fontWeight: 600 }}>备注</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="补充说明（可选）"
                style={{ padding: "8px 10px", border: "1px solid var(--line)",
                         borderRadius: 8, fontSize: 13, background: "var(--card)", resize: "vertical" }}
              />
            </div>

            {err && <div className="notice danger" style={{ marginTop: 10 }}><div>{err}</div></div>}

            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => { setTarget(null); setErr(null); }}>取消</button>
              <button className="btn btn-pri" disabled={busy !== null} onClick={() => advance(target)}>
                {busy !== null ? "提交中…" : "确认推进"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
