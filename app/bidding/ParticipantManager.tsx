"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "@/components/FormModal";
import { BizFileCard } from "@/components/BizFileCard";

interface P {
  id: number;
  company_name: string;
  is_self: number;
  price_cents: number | null;
  relation: string;
  risk_note: string | null;
  status: string;
  bond_cents: number | null;
  bond_status: string | null;
  result: string | null;
  preparer: string | null;
  // P1
  contact_person: string | null;
  contact_phone: string | null;
  qualification: string | null;
  score: number | null;
  rank: number | null;
}

const REL_TONE: Record<string, string> = {
  "本方": "b-pri",
  "关联风险": "b-bad",
  "已核查无关联": "b-ok",
  "未知": "b-gray",
};

const RESULT_TONE: Record<string, string> = {
  "中标": "b-ok",
  "未中标": "b-gray",
  "废标": "b-bad",
  "待开标": "b-info",
};

const wan = (c: number | null | undefined) =>
  c === null || c === undefined ? "—" : (c / 10000).toFixed(2);

/**
 * 投标参与方管理
 *
 * 字段说明（2026-10 扩展）：
 *   保证金     各家交了多少、什么状态（未缴/已缴/已退/不退）
 *   结果       这家自己的开标结果（bids.result 是整个项目的，各家可能不同）
 *   编制人     谁做的这份标书，出问题能找到人
 *   投标文件   走 attachments（entity_type='bid_participant'），
 *              不用单个字段存文件名 —— 能存多个、有版本、有上传人
 */
export function ParticipantManager({
  bidId, bidCode, bidName, bondCents = null, embedded = false,
}: {
  bidId: number;
  bidCode: string;
  bidName: string;
  /** 本招标项目的投标保证金（分），新增参与方时直接继承，不手填 */
  bondCents?: number | null;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState<P[] | null>(null);
  const [open, setOpen] = useState(false);
  /** 正在编辑的参与方；null 表示「新增」 */
  const [editing, setEditing] = useState<P | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/bids/participants?bidId=${bidId}`);
    if (res.ok) setList((await res.json()).list ?? []);
  }
  useEffect(() => { load(); }, [bidId]);

  async function remove(id: number, name: string) {
    if (!confirm(`删除参与方「${name}」？`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bids/participants?id=${id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) { alert(d.error); return; }
      await load();
      router.refresh();
    } finally { setBusy(false); }
  }

  /** 新增 / 编辑共用的字段定义 */
  function buildFields(p: P | null): Field[] {
    const paid = p?.bond_status === "已缴" || p?.bond_status === "已退";
    return [
      { key: "companyName", label: "参与方名称", required: true, colSpan: 2,
        placeholder: "投标单位全称",
        defaultValue: p?.company_name ?? "" },
      { key: "isSelf", label: "这是我方", type: "checkbox",
        defaultValue: p ? p.is_self === 1 : false },
      { key: "priceWan", label: "最终报价（万元）", type: "number",
        defaultValue: p?.price_cents ? p.price_cents / 10000 : "" },
      {
        key: "bondPaid", label: "保证金是否已交", type: "select",
        hint: "金额按本项目投标保证金 "
          + (bondCents ? (bondCents / 10000).toFixed(2) : "0")
          + " 万元自动带入，不用再填",
        defaultValue: paid ? "已交" : "未交",
        options: ["未交", "已交"].map((v) => ({ value: v, label: v })),
      },
      {
        key: "result", label: "结果", type: "select",
        defaultValue: p?.result ?? "待开标",
        options: ["待开标", "中标", "未中标", "废标"].map((v) => ({ value: v, label: v })),
      },
      { key: "rank", label: "排名", type: "number",
        defaultValue: p?.rank ?? "" },
      { key: "preparer", label: "标书编制人员",
        defaultValue: p?.preparer ?? "" },
    ];
  }

  async function submit(v: Record<string, string | boolean>): Promise<string | null> {
    const payload = {
      bidId,
      companyName: v.companyName,
      isSelf: Boolean(v.isSelf),
      priceWan: v.priceWan,
      bondStatus: v.bondPaid === "已交" ? "已缴" : "未缴",
      relation: "未知",
      result: v.result,
      preparer: v.preparer,
      rank: v.rank,
    };

    const res = editing
      ? await fetch("/api/bids/participants", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, id: editing.id }),
        })
      : await fetch("/api/bids/participants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    const d = await res.json();
    if (!res.ok) return d.error ?? (editing ? "保存失败" : "添加失败");
    await load();
    router.refresh();
    return null;
  }

  const rows = list ?? [];

  return (
    <>
      <div className={embedded ? undefined : "card"} style={embedded ? undefined : { marginTop: 14 }}>
        <div className={embedded ? undefined : "card-h"} style={embedded ? {
          display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
        } : undefined}>
          {embedded ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sub)" }}>
              投标参与方（{rows.length} 家）
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
                保证金、结果、编制人可点「编辑」修改
              </span>
            </span>
          ) : (
            <>
              <h3>投标参与方</h3>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {bidCode} · {bidName} · {rows.length} 家
              </span>
            </>
          )}
          <div style={{ marginLeft: "auto" }}>
            <button className="btn btn-sm btn-pri"
                    onClick={() => { setEditing(null); setOpen(true); }}>
              + 添加参与方
            </button>
          </div>
        </div>

        {list === null ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12.5 }}>
            加载中…
          </div>
        ) : rows.length === 0 ? (
          <div style={{
            padding: "14px 16px", fontSize: 12.5, color: "var(--muted)",
            border: "1px dashed var(--line)", borderRadius: 9, textAlign: "center",
          }}>
            暂无参与方，点右上角添加
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>参与方名称</th>
                  <th>最终报价</th>
                  <th>保证金</th>
                  <th>结果</th>
                  <th>排名</th>
                  <th>标书编制人员</th>
                  <th style={{ minWidth: 190 }}>投标文件</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  // 中标行突出：淡绿底 + 左侧绿粗边 + 加粗
                  // 优先级：中标 > 关联风险（风险是红色警示，中标是正向结果，
                  // 两者同时出现时以中标为主，风险说明仍在单元格里显示）
                  const isWon = p.result === "中标";
                  const isRisk = p.relation === "关联风险";
                  return (
                  <tr key={p.id}
                      style={
                        isWon
                          ? {
                              background: "var(--ok-weak)",
                              boxShadow: "inset 3px 0 0 var(--ok)",
                            }
                          : isRisk
                            ? { background: "var(--bad-weak)", boxShadow: "inset 3px 0 0 var(--bad)" }
                            : undefined
                      }>
                    <td style={{ whiteSpace: "normal", maxWidth: 200 }}>
                      <b style={{ fontWeight: isWon ? 800 : 600 }}>
                        {isWon && <span style={{ marginRight: 4 }}>🏆</span>}
                        {p.company_name}
                      </b>
                      {p.is_self === 1 && (
                        <span className="badge b-pri" style={{ marginLeft: 6, fontSize: 10 }}>本方</span>
                      )}
                    </td>
                    <td className="num">
                      {p.price_cents ? wan(p.price_cents) + " 万" : "未公开"}
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      {wan(p.bond_cents)} 万
                      <span className={"badge " + ((p.bond_status === "已缴" || p.bond_status === "已退") ? "b-ok" : "b-gray")}
                            style={{ marginLeft: 5, fontSize: 10 }}>
                        {(p.bond_status === "已缴" || p.bond_status === "已退") ? "已交" : "未交"}
                      </span>
                    </td>
                    <td>
                      <span className={"badge " + (RESULT_TONE[p.result ?? "待开标"] ?? "b-gray")}
                            style={{ fontSize: 10.5 }}>
                        {p.result ?? "待开标"}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                      {p.rank ? (
                        <b style={{ color: p.rank === 1 ? "var(--ok)" : undefined }}>
                          第 {p.rank} 名
                        </b>
                      ) : "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {p.preparer ?? "—"}
                    </td>
                    <td style={{ minWidth: 190 }}>
                      <BizFileCard
                        entityType="bid_participant"
                        entityId={p.id}
                        label="投标文件"
                        compact
                      />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button
                          className="btn btn-sm"
                          disabled={busy}
                          onClick={() => { setEditing(p); setOpen(true); }}
                        >
                          编辑
                        </button>
                        {/* 本方同样可以删除 —— 录错了要能撤掉，
                            删掉后可以重新「添加参与方」并勾选本方 */}
                        <button
                          className="btn btn-sm"
                          style={{ color: "var(--bad)" }}
                          disabled={busy}
                          onClick={() => remove(p.id, p.company_name)}
                        >
                          删除
                        </button>
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

      <FormModal
        open={open}
        title={editing ? `编辑参与方：${editing.company_name}` : "添加投标参与方"}
        desc={editing
          ? "修改后立即生效。报价、保证金改变会记入操作日志。"
          : "如实记录参与方，关联风险需说明具体原因"}
        fields={buildFields(editing)}
        submitText={editing ? "保存" : "添加"}
        onClose={() => { setOpen(false); setEditing(null); }}
        onSubmit={submit}
      />
    </>
  );
}
