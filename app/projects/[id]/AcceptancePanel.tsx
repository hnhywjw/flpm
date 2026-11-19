"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Acceptance } from "@/lib/types";
import { ACCEPTANCE_DOCS, ACCEPTANCE_DONE_STATUS } from "@/lib/domain";
import { BizFileCard } from "@/components/BizFileCard";
import { todayLocal } from "@/lib/time";

const DONE = ACCEPTANCE_DONE_STATUS as readonly string[];

const STATUS_OPTIONS: Record<string, string[]> = {
  安装配置文档: ["待提交", "已提交"],
  到货签收单: ["待签收", "已签收"],
  验收报告: ["待提交", "待签字", "已出具"],
  项目资料: ["缺项", "已齐备"],
};

export function AcceptancePanel({ projectId, acceptances, gate }: {
  projectId: number;
  acceptances: Acceptance[];
  gate: { ok: boolean; done: number; missing: string[]; missingFiles?: string[] };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const map = new Map(acceptances.map((a) => [a.doc_type, a]));

  async function update(docType: string, status: string) {
    setBusy(docType);
    setMsg(null);
    try {
      const done = DONE.includes(status);
      const res = await fetch("/api/acceptances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, docType, status,
          submitDate: done ? todayLocal() : null,
          // 不传 userId/userName：服务端从会话取真实用户，
          // 前端传的一律被忽略，写死只会误导（曾写死 userId:1/王经理）
        }),
      });
      const data = await res.json();
      if (!res.ok) setMsg(data.error ?? "更新失败");
      else {
        setMsg(`「${docType}」已更新为 ${status}，当前 ${data.gate.done}/4 齐备`);
        router.refresh();
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className={`notice ${gate.ok ? "ok" : "danger"}`} style={{ marginBottom: 14 }}>
        <div>
          <b>验收四件套 {gate.done}/4 {gate.ok ? "已齐备" : "未齐备"}</b>
          {gate.ok ? (
            "已满足推进到「开票」节点的条件。"
          ) : (
            <>
              缺少：{gate.missing.join("、")}。
              四项齐备<b>且每项都有实际文件</b>才允许推进到开票，
              否则验收款与质保金缺乏收款依据。
              {gate.missingFiles && gate.missingFiles.length > 0 && (
                <div style={{ marginTop: 6, color: "var(--bad)" }}>
                  其中「{gate.missingFiles.join("、")}」状态已完成但
                  <b>没有任何附件</b> —— 请上传文件后再计为齐备。
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <table className="tbl">
        <thead>
          <tr>
            <th>资料类型</th><th>状态</th><th>提交日期</th>
            <th>责任人</th><th>附件</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {ACCEPTANCE_DOCS.map((d) => {
            const a = map.get(d.key);
            const isDone = a ? DONE.includes(a.status) : false;
            const opts = STATUS_OPTIONS[d.key] ?? ["待提交", "已提交"];
            return (
              <tr key={d.key} style={!isDone ? { background: "var(--warn-weak)" } : undefined}>
                <td><b>{d.key}</b></td>
                <td>
                  <span className={`badge ${isDone ? "b-ok" : a?.status === "缺项" ? "b-bad" : "b-warn"}`}>
                    {a?.status ?? "待提交"}
                  </span>
                </td>
                <td className="num">{a?.submit_date ?? "—"}</td>
                <td>{a?.owner_name ?? "—"}</td>
                <td style={{ minWidth: 210 }}>
                  {/* 附件挂在 acceptances 行 id 上，不是 project_id —— 
                      这样四类资料各自的文件互不混淆 */}
                  {a ? (
                    <BizFileCard
                      entityType="acceptance"
                      entityId={a.id}
                      label={d.key}
                      required
                      compact
                    />
                  ) : (
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      先更新状态后上传
                    </span>
                  )}
                </td>
                <td>
                  <select
                    disabled={busy === d.key}
                    value={a?.status ?? "待提交"}
                    onChange={(e) => update(d.key, e.target.value)}
                    style={{ padding: "4px 8px", border: "1px solid var(--line)",
                             borderRadius: 7, fontSize: 12, background: "var(--card)" }}
                  >
                    {opts.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {msg && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--pri)" }}>{msg}</div>
      )}
    </div>
  );
}
