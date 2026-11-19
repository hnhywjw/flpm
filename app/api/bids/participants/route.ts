import { NextRequest, NextResponse } from "next/server";
import { all, one, run, audit } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { ensureProjectForWonBid } from "@/lib/ensure-won-project";

export const dynamic = "force-dynamic";

/** 保证金状态合法值 */
const BOND_STATUS = ["未缴", "已缴", "已退", "不退"] as const;

/** 单个参与方的开标结果合法值 */
const PART_RESULT = ["待开标", "中标", "未中标", "废标"] as const;

/**
 * 投标过程状态合法值（P2 清洗）
 *
 * ★ 原来 status 里混进了「中标 / 未中标 / 废标」，
 *   和 result 完全重复，可能出现 status='中标' 但 result='未中标' 的矛盾。
 *
 * 现在明确分工：
 *   status  →  过程：编标中 / 待递交 / 已递交 / 已撤回
 *   result  →  结果：待开标 / 中标 / 未中标 / 废标
 *
 * 老数据传进来的结果值会被自动纠正：
 *   传 status='中标'  → 归一为 '已递交'（结果应该走 result 字段）
 */
const PART_STATUS = ["编标中", "待递交", "已递交", "已撤回", "未知"] as const;

/** 结果值集合：用于识别「误把结果填进 status」的情况 */
const RESULT_VALUES = ["中标", "未中标", "废标"] as const;

function normalizeStatus(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "未知";
  // 误填成结果值 → 归一到已递交，避免脏数据
  if ((RESULT_VALUES as readonly string[]).includes(s)) return "已递交";
  return (PART_STATUS as readonly string[]).includes(s) ? s : "未知";
}

function normalizeBondStatus(v: unknown): string {
  const s = String(v ?? "").trim();
  return (BOND_STATUS as readonly string[]).includes(s) ? s : "未缴";
}

function normalizeResult(v: unknown): string {
  const s = String(v ?? "").trim();
  return (PART_RESULT as readonly string[]).includes(s) ? s : "待开标";
}

/** 某投标的全部参与方 */
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const bidId = Number(req.nextUrl.searchParams.get("bidId"));
    if (!bidId) return NextResponse.json({ error: "缺少 bidId" }, { status: 400 });

    const rows = all<{
      id: number; company_name: string; is_self: number;
      price_cents: number | null; relation: string; risk_note: string | null;
      status: string; checked_by_name: string | null; checked_at: string | null;
    }>(`
      SELECT p.*, u.name AS checked_by_name
      FROM bid_participants p
      LEFT JOIN users u ON u.id = p.checked_by
      WHERE p.bid_id = ?
      ORDER BY p.is_self DESC, p.id
    `, [bidId]);

    return NextResponse.json({ list: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 新增参与方 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["sales", "boss", "admin"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限维护投标参与方", 403);
    }

    const b = await req.json();
    const {
      bidId, companyName, isSelf, priceWan, relation, riskNote, status,
      bondWan, bondStatus, result, preparer,
      // P1 新增（score 已移除：评标得分无法获取，只留排名）
      contactPerson, contactPhone, qualification, rank,
    } = b;

    if (!bidId) throw new Error("缺少投标 id");
    if (!companyName?.trim()) throw new Error("参与方名称必填");

    const bid = one<{ id: number; code: string; bond_cents: number | null }>(
      "SELECT id, code, bond_cents FROM bids WHERE id = ? AND deleted_at IS NULL", [Number(bidId)]
    );
    if (!bid) throw new Error("投标不存在");

    // 同名去重
    const dup = one<{ id: number }>(
      "SELECT id FROM bid_participants WHERE bid_id = ? AND company_name = ?",
      [Number(bidId), companyName.trim()]
    );
    if (dup) throw new Error(`参与方「${companyName.trim()}」已存在`);

    const ALLOWED_REL = ["本方", "未知", "已核查无关联", "关联风险"];
    const rel = relation && ALLOWED_REL.includes(relation) ? relation : "未知";
    if (rel === "关联风险" && !riskNote?.trim()) {
      throw new Error("标注关联风险必须填写具体说明");
    }

    // 若标记为本方，取消其他参与方的本方标记
    if (isSelf) {
      run("UPDATE bid_participants SET is_self = 0 WHERE bid_id = ?", [Number(bidId)]);
    }

    const info = run(
      `INSERT INTO bid_participants
       (bid_id, company_name, is_self, price_cents, relation, risk_note, status,
        bond_cents, bond_status, result, preparer,
        contact_person, contact_phone, qualification, rank, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
      [
        Number(bidId), companyName.trim(), isSelf ? 1 : 0,
        priceWan !== undefined && priceWan !== "" ? Math.round(Number(priceWan) * 10000) : null,
        rel, riskNote?.trim() || null, normalizeStatus(status),
        // 参与方保证金金额不手填，直接继承本招标项目的投标保证金
        bid.bond_cents ?? null,
        normalizeBondStatus(bondStatus),
        normalizeResult(result),
        preparer?.trim() || null,
        contactPerson?.trim() || null,
        contactPhone?.trim() || null,
        qualification?.trim() || null,
        rank !== undefined && rank !== "" ? Number(rank) : null,
      ]
    );

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "bid_participant", entityId: Number(info.lastInsertRowid),
      summary: `新增投标参与方：${companyName.trim()}（${bid.code}）`,
    });

    return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * 修改参与方
 *
 * 只允许改业务字段，不允许改 bid_id（否则能把参与方挪到别的招标下，
 * 造成「这家公司在 A 项目的报价出现在 B 项目」这种数据错位）。
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["sales", "boss", "admin"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限维护投标参与方", 403);
    }

    const b = await req.json();
    const id = Number(b.id);
    if (!id) throw new Error("缺少参与方 id");

    const cur = one<{
      bid_id: number; company_name: string; is_self: number;
      price_cents: number | null; relation: string; risk_note: string | null;
      status: string | null; bond_cents: number | null; bond_status: string | null;
      result: string | null; preparer: string | null;
      contact_person: string | null; contact_phone: string | null;
      qualification: string | null; rank: number | null;
    }>("SELECT * FROM bid_participants WHERE id = ?", [id]);
    if (!cur) throw new Error("参与方不存在");

    // ---- 逐字段合并：没传的保持原值 ----
    const nextName =
      b.companyName !== undefined ? String(b.companyName).trim() : cur.company_name;
    if (!nextName) throw new Error("参与方名称不能为空");

    // 改名要查重
    if (nextName !== cur.company_name) {
      const dup = one<{ id: number }>(
        "SELECT id FROM bid_participants WHERE bid_id = ? AND company_name = ? AND id <> ?",
        [cur.bid_id, nextName, id]
      );
      if (dup) throw new Error(`参与方「${nextName}」已存在`);
    }

    const nextRel = b.relation !== undefined ? String(b.relation) : cur.relation;
    const ALLOWED_REL = ["本方", "未知", "已核查无关联", "关联风险"];
    if (!ALLOWED_REL.includes(nextRel)) {
      throw new Error("关联关系取值不合法");
    }

    const nextRiskNote =
      b.riskNote !== undefined ? (String(b.riskNote).trim() || null) : cur.risk_note;
    if (nextRel === "关联风险" && !nextRiskNote) {
      throw new Error("标注关联风险必须填写具体说明");
    }

    // 报价 / 保证金：传空表示清空，不传表示不动
    const nextPrice =
      b.priceWan === undefined ? cur.price_cents
        : b.priceWan === "" || b.priceWan === null ? null
        : Math.round(Number(b.priceWan) * 10000);
    const nextBond =
      b.bondWan === undefined ? cur.bond_cents
        : b.bondWan === "" || b.bondWan === null ? null
        : Math.round(Number(b.bondWan) * 10000);

    const nextIsSelf = b.isSelf !== undefined ? (b.isSelf ? 1 : 0) : cur.is_self;

    // 改成本方时，取消同项目其他方的本方标记
    if (nextIsSelf === 1 && cur.is_self === 0) {
      run("UPDATE bid_participants SET is_self = 0 WHERE bid_id = ?", [cur.bid_id]);
    }

    run(
      `UPDATE bid_participants SET
         company_name = ?, is_self = ?, price_cents = ?,
         relation = ?, risk_note = ?, status = ?,
         bond_cents = ?, bond_status = ?, result = ?, preparer = ?,
         contact_person = ?, contact_phone = ?, qualification = ?,
         rank = ?,
         updated_at = datetime('now','localtime')
       WHERE id = ?`,
      [
        nextName, nextIsSelf, nextPrice,
        nextRel, nextRiskNote,
        b.status !== undefined ? normalizeStatus(b.status) : cur.status,
        nextBond,
        b.bondStatus !== undefined ? normalizeBondStatus(b.bondStatus) : cur.bond_status,
        b.result !== undefined ? normalizeResult(b.result) : cur.result,
        b.preparer !== undefined ? (String(b.preparer).trim() || null) : cur.preparer,
        b.contactPerson !== undefined ? (String(b.contactPerson).trim() || null) : cur.contact_person,
        b.contactPhone !== undefined ? (String(b.contactPhone).trim() || null) : cur.contact_phone,
        b.qualification !== undefined ? (String(b.qualification).trim() || null) : cur.qualification,
        b.rank !== undefined ? (b.rank === "" || b.rank === null ? null : Number(b.rank)) : cur.rank,
        id,
      ]
    );

    const nextResult = b.result !== undefined ? normalizeResult(b.result) : cur.result;
    if (nextResult === "中标") {
      ensureProjectForWonBid(cur.bid_id, user);
    }

    // 审计：只记变了什么，方便追溯
    const changes: string[] = [];
    if (nextName !== cur.company_name) changes.push(`名称 ${cur.company_name} → ${nextName}`);
    if (nextPrice !== cur.price_cents) {
      changes.push(`报价 ${cur.price_cents ? cur.price_cents / 10000 : "—"} → ${nextPrice ? nextPrice / 10000 : "—"} 万`);
    }
    if (nextRel !== cur.relation) changes.push(`关联关系 ${cur.relation} → ${nextRel}`);
    if (nextBond !== cur.bond_cents) {
      changes.push(`保证金 ${cur.bond_cents ? cur.bond_cents / 10000 : "—"} → ${nextBond ? nextBond / 10000 : "—"} 万`);
    }

    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: "bid_participant", entityId: id,
      summary: `修改投标参与方「${nextName}」${changes.length ? "：" + changes.join("；") : ""}`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 删除参与方 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["sales", "boss", "admin"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限维护投标参与方", 403);
    }

    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少参与方 id");

    const p = one<{ company_name: string; is_self: number }>(
      "SELECT company_name, is_self FROM bid_participants WHERE id = ?", [id]
    );
    if (!p) throw new Error("参与方不存在");
    if (p.is_self) throw new Error("不能删除本方参与方");

    run("DELETE FROM bid_participants WHERE id = ?", [id]);

    audit({
      userId: user.id, userName: user.name, action: "delete",
      entityType: "bid_participant", entityId: id,
      summary: `删除投标参与方：${p.company_name}`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
