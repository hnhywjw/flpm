"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field as FormField } from "@/components/FormModal";

/**
 * 招标项目编辑 / 删除
 *
 * ★ 为什么必须有
 *
 * 原来投标项目只能新建，信息录错或情况有变就彻底卡住：
 *   · 截止日期写错 → 提醒全错，但改不了
 *   · 预算填错 → 台账金额一直是错的
 *   · 负责人选错 → 通知发给错的人
 *
 * 删除做了软删除（deleted_at），并明确提示会连带什么。
 */

export function BidEditButton({
  bid,
}: {
  bid: {
    id: number;
    code: string;
    name: string;
    budget_cents: number | null;
    bond_cents: number | null;
    bond_status: string | null;
    deadline: string | null;
    phase: string | null;
    result: string | null;
    mode: string;
    owner_name?: string | null;
    // P0
    open_date?: string | null;
    bond_paid_date?: string | null;
    // P1
    bid_no?: string | null;
    agent_company?: string | null;
    bid_method?: string | null;
    bid_open_place?: string | null;
    site_visit_date?: string | null;
    qa_deadline?: string | null;
    doc_price_cents?: number | null;
    customer_name?: string | null;
    owner_id?: number | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    fetch("/api/bids/create").then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUsers(d.users ?? []));
  }, [open]);

  const fields: FormField[] = [
    { key: "name", label: "项目名称", required: true, colSpan: 2, defaultValue: bid.name },
    { key: "bidNo", label: "项目编号", required: true, colSpan: 2, defaultValue: bid.bid_no ?? "" },
    { key: "bidMethod", label: "招标方式", type: "select",
      defaultValue: bid.bid_method ?? "公开招标",
      options: ["公开招标", "邀请招标", "竞争性谈判", "竞争性磋商", "单一来源", "询价"]
        .map((v) => ({ value: v, label: v })) },
    { key: "agentCompany", label: "招标代理机构", defaultValue: bid.agent_company ?? "",
      hint: "投标保证金交给这家机构" },
    { key: "customerName", label: "业主单位名称", colSpan: 2, defaultValue: bid.customer_name ?? "" },
    { key: "budgetWan", label: "项目预算（万元）", type: "number",
      defaultValue: bid.budget_cents ? bid.budget_cents / 10000 : "" },
    { key: "bondWan", label: "投标保证金（万元）", type: "number",
      defaultValue: bid.bond_cents ? bid.bond_cents / 10000 : "" },
    { key: "docPriceWan", label: "标书费（万元）", type: "number",
      defaultValue: bid.doc_price_cents ? bid.doc_price_cents / 10000 : "" },
    { key: "deadline", label: "投标截止时间", type: "date", defaultValue: bid.deadline ?? "" },
    { key: "open_date", label: "开标时间", type: "datetime-local",
      defaultValue: (bid.open_date ?? "").replace(" ", "T") },
    {
      key: "mode", label: "投标方式", type: "select",
      defaultValue: bid.mode,
      options: [
        { value: "direct", label: "直接投标" },
        { value: "agent", label: "代中标" },
      ],
    },
    {
      key: "ownerId", label: "项目负责人", type: "select",
      defaultValue: bid.owner_id ? String(bid.owner_id) : "",
      options: users.map((u) => ({ value: String(u.id), label: u.name })),
    },
  ];

  async function save(v: Record<string, string | boolean>): Promise<string | null> {
    const res = await fetch("/api/bids/create", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: bid.id,
        name: v.name,
        bidNo: v.bidNo,
        bidMethod: v.bidMethod,
        agentCompany: v.agentCompany,
        customerName: v.customerName,
        budgetWan: v.budgetWan,
        bondWan: v.bondWan,
        docPriceWan: v.docPriceWan,
        deadline: v.deadline,
        openDate: v.open_date,
        mode: v.mode,
        ownerId: v.ownerId ? Number(v.ownerId) : null,
      }),
    });
    const d = await res.json();
    if (!res.ok) return d.error ?? "保存失败";
    router.refresh();
    return null;
  }

  async function doDelete() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/bids/create?id=" + bid.id, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "删除失败"); return; }
      setDelOpen(false);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* 编辑 / 删除 左右并排，放在招标文件上传框下方 */}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          className="btn btn-sm"
          style={{ flex: 1 }}
          onClick={() => setOpen(true)}
        >
          编辑
        </button>
        <button
          className="btn btn-sm"
          style={{ flex: 1, color: "var(--bad)" }}
          onClick={() => { setErr(null); setDelOpen(true); }}
        >
          删除
        </button>
      </div>

      <FormModal
        open={open}
        title={"编辑招标项目：" + bid.code}
        desc="修改后立即生效，变更会记入操作日志"
        fields={fields}
        submitText="保存"
        onClose={() => setOpen(false)}
        onSubmit={save}
      />

      {delOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 320,
            background: "rgba(10,20,40,.45)", display: "grid", placeItems: "center",
          }}
          onClick={() => setDelOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card)", borderRadius: 13, width: "min(440px, 92vw)",
              padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
              删除招标项目？
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: "var(--sub)" }}>
              <div><b>{bid.code}</b> {bid.name}</div>
              <div style={{
                marginTop: 10, padding: "9px 11px", background: "var(--bad-weak)",
                borderRadius: 8, color: "var(--bad)", fontSize: 12.5,
              }}>
                删除后：该项目的参与方、投标文件、任务进度将<b>一并隐藏</b>，
                不再出现在统计中。<br />
                数据保留在数据库中（软删除），如需恢复请联系管理员。
              </div>
            </div>

            {err && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--bad)" }}>{err}</div>
            )}

            <div style={{
              marginTop: 16, display: "flex", gap: 9, justifyContent: "flex-end",
            }}>
              <button className="btn" onClick={() => setDelOpen(false)} disabled={busy}>
                取消
              </button>
              <button
                className="btn"
                style={{ background: "var(--bad)", color: "#fff", borderColor: "var(--bad)" }}
                onClick={doDelete}
                disabled={busy}
              >
                {busy ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
