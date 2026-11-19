"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BizFileCard } from "@/components/BizFileCard";
import { ParticipantManager } from "./ParticipantManager";
import { BidEditButton } from "./BidEditButton";

/**
 * 招标项目卡片（可展开）
 *
 * ★ 重新设计的原因
 *
 * 原来投标管理是「一张大表格 + 页面最底部只有一个 focus 项目的参与方」，
 * 问题很明显：
 *   · 参与方只能看一个项目，点别的项目得先改 focus 逻辑
 *   · 招标文件和所有投标人的投标文件混在同一个 bid 附件里，分不清
 *   · 参与方信息挤在底部，和上面的表格断开
 *
 * 现在改成「一层招标项目 + 二层参与方」：
 *
 *   ┌─ 招标项目 B2026-001  XX 医院信息化项目         [展开 ▼]
 *   │   预算 120万 · 截止 11-05 · 保证金 2万（已缴）
 *   │   招标文件：[上传] [招标文件.pdf]
 *   └─ 展开后：
 *        ├─ 投标参与方（3 家）
 *        │   └ 我方       报价 118万  已递交
 *        │      投标文件：[上传]
 *        │   └ XX 科技    报价 121万  已递交
 *        │      投标文件：[上传]
 *        └─ 投标任务分解
 *
 * 招标文件挂 bid（项目级），投标文件挂 bid_participant（每家独立），
 * 这样「谁交了什么」一目了然。
 */

interface Participant {
  id: number;
  company_name: string;
  is_self: number;
  price_cents: number | null;
  relation: string;
  risk_note: string | null;
  status: string | null;
  checked_by_name?: string;
}

/** 属性网格里的一格：上标签、下值 */
function Field({ label, title, children }: {
  label: string; title?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 10, color: "var(--muted)", marginBottom: 2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {label}
      </div>
      <div
        title={title}
        style={{
          fontSize: 12, color: "var(--text)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** 开标结果配色 */
const RESULT_TONE: Record<string, string> = {
  "中标": "b-ok",
  "未中标": "b-gray",
  "废标": "b-bad",
  "待开标": "b-info",
};

const REL_TONE: Record<string, string> = {
  本方: "b-pri",
  关联风险: "b-bad",
  已核查无关联: "b-ok",
  未知: "b-gray",
};

export function BidProjectCard({
  bid,
  participants,
  riskCount,
  defaultOpen,
}: {
  bid: {
    id: number; code: string; name: string;
    budget_cents: number | null; bond_cents: number | null;
    bond_status: string | null; deadline: string | null;
    phase: string | null; result: string | null;
    owner_name?: string | null; owner_id?: number | null; mode: string;
    daysLeft: number;
    // P0
    open_date?: string | null;
    bond_paid_date?: string | null;
    customer_name?: string | null;
    // P1
    bid_no?: string | null;
    agent_company?: string | null;
    bid_method?: string | null;
    bid_open_place?: string | null;
    site_visit_date?: string | null;
    qa_deadline?: string | null;
    doc_price_cents?: number | null;
    // 关联项目（中标后自动生成）
    project_id?: number | null;
    project_code?: string | null;
    project_name?: string | null;
  };
  participants: Participant[];
  riskCount: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const router = useRouter();

  const wan = (c: number | null) =>
    c === null || c === undefined ? "—" : (c / 10000).toFixed(2);

  const near =
    bid.result === "待开标" && bid.daysLeft >= 0 && bid.daysLeft <= 3;

  // 中标：整卡用绿色左边框 + 淡绿底突出，优先级高于临期红色
  const won = bid.result === "中标";

  return (
    <div
      style={{
        border: "1px solid " + (won ? "var(--ok)" : near ? "var(--bad)" : "var(--line)"),
        borderLeft: won ? "4px solid var(--ok)" : undefined,
        borderRadius: 11,
        marginBottom: 10,
        overflow: "hidden",
        background: won ? "var(--ok-weak)" : "var(--card)",
        boxShadow: won ? "0 2px 10px rgba(15,157,88,.12)" : undefined,
      }}
    >
      {/* ---------- 第一层：招标项目 ---------- */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px", cursor: "pointer",
          background: won ? "var(--ok-weak)"
            : near ? "var(--bad-weak)"
            : open ? "var(--line2)" : "var(--card)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 标题行：三角 + 名称 + 编号，三者同一行同一基线 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10, color: "var(--muted)",
              transform: open ? "rotate(90deg)" : "none",
              transition: "transform .15s",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 12, height: 12, flex: "0 0 12px",
            }}>
              ▶
            </span>
            <b style={{ fontSize: 13.5, lineHeight: 1.2 }}>{bid.name}</b>
            <span style={{
              fontSize: 11, color: "var(--muted)", fontFamily: "monospace",
              background: "var(--line2)", padding: "1px 6px", borderRadius: 4,
            }}>
              {bid.code}
            </span>
            {riskCount > 0 && (
              <span className="badge b-bad" style={{ fontSize: 10.5 }}>
                关联风险 {riskCount}
              </span>
            )}
            {/* 与项目管理打通：中标自动立项后，这里直接可跳转 */}
            {bid.project_id ? (
              <a
                href={"/projects/" + bid.project_id}
                onClick={(e) => e.stopPropagation()}
                className="badge b-ok"
                style={{ fontSize: 10.5, textDecoration: "none" }}
                title={"已转项目：" + (bid.project_name ?? "")}
              >
                已转项目 {bid.project_code}
              </a>
            ) : bid.result === "中标" ? (
              <span className="badge b-warn" style={{ fontSize: 10.5 }}
                    title="中标但尚未立项">
                未立项
              </span>
            ) : null}
          </div>

          {/* 只保留业务要看的字段，一行排开 */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(11, minmax(0, 1fr))",
            gap: "6px 10px", marginTop: 8,
          }}>
            <Field label="项目编号" title={bid.bid_no || bid.code}>
              {bid.bid_no || bid.code}
            </Field>
            <Field label="招标方式">{bid.bid_method ?? "—"}</Field>
            <Field label="招标代理机构" title={bid.agent_company ?? ""}>
              {bid.agent_company ?? "—"}
            </Field>
            <Field label="业主单位" title={bid.customer_name ?? ""}>
              {bid.customer_name ?? "—"}
            </Field>
            <Field label="项目预算"><b>{wan(bid.budget_cents)}</b>万</Field>
            <Field label="投标保证金"><b>{wan(bid.bond_cents)}</b>万</Field>
            <Field label="标书费"><b>{wan(bid.doc_price_cents ?? null)}</b>万</Field>
            <Field label="投标截止">
              <b>{bid.deadline ?? "—"}</b>
              {bid.result === "待开标" && bid.daysLeft >= 0 && (
                <span style={{ marginLeft: 3, fontSize: 10, color: near ? "var(--bad)" : "var(--muted)", fontWeight: near ? 700 : 400 }}>
                  剩{bid.daysLeft}天
                </span>
              )}
            </Field>
            <Field label="开标时间">{bid.open_date ?? "—"}</Field>
            <Field label="投标方式">
              {bid.mode === "agent" ? "代中标" : "直接投标"}
            </Field>
            <Field label="项目负责人">{bid.owner_name ?? "未指派"}</Field>
          </div>
        </div>

        {/* 右侧：招标文件在上，编辑/删除在下方左右排列 */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: "0 0 auto", width: 230, alignSelf: "flex-start",
            display: "flex", flexDirection: "column", gap: 6,
          }}
          title="招标公告、技术参数、评分办法、答疑澄清等（所有参与方共用）"
        >
          <BizFileCard entityType="bid" entityId={bid.id} label="招标文件" compact />
          <BidEditButton bid={bid} />
        </div>
      </div>

      {/* ---------- 第二层：展开内容 ---------- */}
      {open && (
        <div style={{ borderTop: "1px solid var(--line)", padding: 14 }}>
          {/* 投标参与方
              ParticipantManager 自带完整表格（含保证金、结果、编制人、投标文件）。

              注：原来的「投标任务分解」区块已迁走 ——
              项目级任务现在并入参与方「任务进度」弹窗里展示，
              只在本方参与方弹出时显示。这里不再重复一块。 */}
          <ParticipantManager
            bidId={bid.id}
            bidCode={bid.code}
            bidName={bid.name}
            bondCents={bid.bond_cents}
            embedded
          />
        </div>
      )}
    </div>
  );
}
