import { all, one, run, tx, audit } from "./db";
import type { Role } from "./domain";
import { ROLE_LABEL } from "./domain";

/**
 * 审批流模板
 * 每步给定「角色集合」，这些角色中的任一人都可以审批该步
 * 按顺序审批，前一步通过后才轮到下一步
 */
export interface ApprovalTemplate {
  key: string;
  name: string;
  bizType: string;
  steps: { role: Role; label: string }[];
  /** 金额阈值（分），低于该值可跳过某些步骤时使用 */
  amountThreshold?: number;
}

export const TEMPLATES: ApprovalTemplate[] = [
  {
    key: "contract",
    name: "合同会签",
    bizType: "contract",
    steps: [
      { role: "finance", label: "财务审核（付款条款、税率）" },
      { role: "sales", label: "商务审核（违约条款、验收标准）" },
      { role: "boss", label: "总经理批准" },
    ],
  },
  {
    key: "agent_agreement",
    name: "代中标协议",
    bizType: "agent_agreement",
    steps: [
      { role: "finance", label: "财务审核（过单费核算）" },
      { role: "boss", label: "总经理批准" },
    ],
  },
  {
    key: "agent_fee_payment",
    name: "过单费支付",
    bizType: "agent_fee_payment",
    steps: [
      { role: "finance", label: "财务复核" },
      { role: "boss", label: "总经理批准" },
    ],
  },
  {
    key: "purchase",
    name: "采购申请",
    bizType: "purchase",
    steps: [
      { role: "pm", label: "项目经理确认需求" },
      { role: "finance", label: "财务审核预算" },
      { role: "boss", label: "总经理批准" },
    ],
  },
  {
    key: "project_change",
    name: "项目变更",
    bizType: "project_change",
    steps: [
      { role: "pm", label: "项目经理确认影响" },
      { role: "finance", label: "财务评估金额" },
      { role: "boss", label: "总经理批准" },
    ],
  },
];

export function getTemplate(key: string): ApprovalTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

// ---------------- 发起审批 ----------------

export interface StartInput {
  templateKey: string;
  bizId: number | null;
  bizTitle: string;
  amountCents?: number | null;
  summary?: string;
  /** role 用于判断发起人是否就是某步审批人，是则自动跳过该步 */
  applicant: { id: number; name: string; role: Role };
}

export function startApproval(input: StartInput): { id: number; code: string } {
  const tpl = getTemplate(input.templateKey);
  if (!tpl) throw new Error(`未知的审批模板：${input.templateKey}`);

  return tx((db) => {
    // 生成编号 AP{年}-{4位}
    const year = new Date().getFullYear();
    const row = db
      .prepare("SELECT seq FROM code_sequences WHERE prefix = 'AP' AND year = ?")
      .get(year) as { seq: number } | undefined;
    const seq = (row?.seq ?? 0) + 1;
    if (row) db.prepare("UPDATE code_sequences SET seq = ? WHERE prefix = 'AP' AND year = ?").run(seq, year);
    else db.prepare("INSERT INTO code_sequences (prefix, year, seq) VALUES ('AP', ?, ?)").run(year, seq);
    const code = `AP${year}-${String(seq).padStart(4, "0")}`;

    const info = db.prepare(
      `INSERT INTO approval_instances
       (code, biz_type, biz_id, biz_title, template_key, status, current_step, total_steps,
        applicant_id, applicant_name, amount_cents, summary)
       VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?)`
    ).run(
      code, tpl.bizType, input.bizId, input.bizTitle, tpl.key,
      tpl.steps.length, input.applicant.id, input.applicant.name,
      input.amountCents ?? null, input.summary ?? null
    );

    const iid = Number(info.lastInsertRowid);
    const stmt = db.prepare(
      "INSERT INTO approval_steps (instance_id, step_no, role_required, action, approver_id, approver_name, comment, acted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    // 发起人角色若与某步要求的角色相同，自动跳过该步（避免自己审批自己）
    let firstPendingStep = 0;
    tpl.steps.forEach((s, i) => {
      const selfStep = s.role === input.applicant.role && firstPendingStep === 0;
      if (selfStep) {
        stmt.run(
          iid, i + 1, s.role, "approved",
          input.applicant.id, input.applicant.name,
          "发起人本人职责范围，自动跳过", new Date().toISOString().slice(0, 19).replace("T", " ")
        );
      } else {
        stmt.run(iid, i + 1, s.role, "pending", null, null, null, null);
        if (firstPendingStep === 0) firstPendingStep = i + 1;
      }
    });

    // 若所有步骤都被跳过（单人流程），直接通过
    if (firstPendingStep === 0) {
      db.prepare(
        "UPDATE approval_instances SET status = 'approved', current_step = ?, finished_at = datetime('now','localtime') WHERE id = ?"
      ).run(tpl.steps.length, iid);
      return { id: iid, code };
    }

    db.prepare("UPDATE approval_instances SET current_step = ? WHERE id = ?").run(firstPendingStep, iid);
    return { id: iid, code };
  });
}

// ---------------- 查询 ----------------

export interface ApprovalInstance {
  id: number;
  code: string;
  biz_type: string;
  biz_id: number | null;
  biz_title: string;
  template_key: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  current_step: number;
  total_steps: number;
  applicant_id: number | null;
  applicant_name: string | null;
  amount_cents: number | null;
  summary: string | null;
  created_at: string;
  finished_at: string | null;
  template_name?: string;
}

export interface ApprovalStep {
  id: number;
  instance_id: number;
  step_no: number;
  role_required: string;
  approver_id: number | null;
  approver_name: string | null;
  action: "pending" | "approved" | "rejected";
  comment: string | null;
  acted_at: string | null;
  role_label?: string;
  step_label?: string;
}

function decorate(inst: ApprovalInstance): ApprovalInstance {
  const tpl = getTemplate(inst.template_key);
  return { ...inst, template_name: tpl?.name ?? inst.template_key };
}

export function getInstance(id: number): ApprovalInstance | undefined {
  const row = one<ApprovalInstance>("SELECT * FROM approval_instances WHERE id = ?", [id]);
  return row ? decorate(row) : undefined;
}

export function getSteps(instanceId: number): ApprovalStep[] {
  const inst = getInstance(instanceId);
  const tpl = inst ? getTemplate(inst.template_key) : undefined;
  const rows = all<ApprovalStep>(
    "SELECT * FROM approval_steps WHERE instance_id = ? ORDER BY step_no", [instanceId]
  );
  return rows.map((r) => ({
    ...r,
    role_label: ROLE_LABEL[r.role_required as Role] ?? r.role_required,
    step_label: tpl?.steps[r.step_no - 1]?.label ?? `第 ${r.step_no} 步`,
  }));
}

export function listByBiz(bizType: string, bizId: number): ApprovalInstance[] {
  return all<ApprovalInstance>(
    "SELECT * FROM approval_instances WHERE biz_type = ? AND biz_id = ? ORDER BY id DESC",
    [bizType, bizId]
  ).map(decorate);
}

/** 待我审批的列表 */
export function listMyPending(role: Role): (ApprovalInstance & { step_no: number; step_label: string })[] {
  const rows = all<ApprovalInstance & { step_no: number }>(
    `SELECT i.*, s.step_no
     FROM approval_instances i
     JOIN approval_steps s ON s.instance_id = i.id AND s.step_no = i.current_step
     WHERE i.status = 'pending'
       AND s.action = 'pending'
       AND s.role_required = ?
     ORDER BY i.created_at DESC`,
    [role]
  );
  // current_step 已由 startApproval / act 维护为「下一个待审批步骤」，此处直接使用
  return rows.map((r) => {
    const d = decorate(r);
    const tpl = getTemplate(r.template_key);
    return {
      ...d,
      step_no: r.step_no,
      step_label: tpl?.steps[r.step_no - 1]?.label ?? `第 ${r.step_no} 步`,
    };
  });
}

/** 我发起的 */
export function listMyApplied(userId: number) {
  return all<ApprovalInstance>(
    "SELECT * FROM approval_instances WHERE applicant_id = ? ORDER BY id DESC LIMIT 100",
    [userId]
  ).map(decorate);
}

// ---------------- 审批动作 ----------------

export interface ActInput {
  instanceId: number;
  approver: { id: number; name: string; role: Role };
  action: "approve" | "reject";
  comment?: string;
}

export function act(input: ActInput): { status: string; nextStep?: number } {
  const inst = getInstance(input.instanceId);
  if (!inst) throw new Error("审批实例不存在");
  if (inst.status !== "pending") throw new Error(`该审批${statusText(inst.status)}，无法操作`);

  const steps = getSteps(inst.id);
  const cur = steps.find((s) => s.step_no === inst.current_step);
  if (!cur) throw new Error("审批步骤异常");
  if (cur.action !== "pending") throw new Error("该步骤已处理");

  // 角色校验
  if (cur.role_required !== input.approver.role) {
    throw new Error(
      `当前步骤需「${ROLE_LABEL[cur.role_required as Role]}」审批，你的角色是「${ROLE_LABEL[input.approver.role]}」`
    );
  }

  return tx((db) => {
    db.prepare(
      "UPDATE approval_steps SET action = ?, approver_id = ?, approver_name = ?, comment = ?, acted_at = datetime('now','localtime') WHERE id = ?"
    ).run(
      input.action === "approve" ? "approved" : "rejected",
      input.approver.id, input.approver.name, input.comment ?? null, cur.id
    );

    if (input.action === "reject") {
      db.prepare(
        "UPDATE approval_instances SET status = 'rejected', finished_at = datetime('now','localtime') WHERE id = ?"
      ).run(inst.id);
      return { status: "rejected" as const };
    }

    // 找下一个真正待审批的步骤（跳过已自动通过的步骤）
    const next = steps.find((s) => s.step_no > cur.step_no && s.action === "pending");
    if (!next) {
      db.prepare(
        "UPDATE approval_instances SET status = 'approved', current_step = ?, finished_at = datetime('now','localtime') WHERE id = ?"
      ).run(inst.total_steps, inst.id);
      return { status: "approved" as const };
    }

    db.prepare("UPDATE approval_instances SET current_step = ? WHERE id = ?").run(next.step_no, inst.id);
    return { status: "pending" as const, nextStep: next.step_no };
  });
}

/** 撤回（仅申请人，且未完成的） */
export function cancel(instanceId: number, applicantId: number) {
  const inst = getInstance(instanceId);
  if (!inst) throw new Error("审批实例不存在");
  if (inst.applicant_id !== applicantId) throw new Error("只能撤回自己发起的审批");
  if (inst.status !== "pending") throw new Error("该审批已结束，无法撤回");
  run(
    "UPDATE approval_instances SET status = 'cancelled', finished_at = datetime('now','localtime') WHERE id = ?",
    [instanceId]
  );
}

export function statusText(s: string): string {
  return { pending: "审批中", approved: "已通过", rejected: "已驳回", cancelled: "已撤回" }[s] ?? s;
}

/** 业务对象最终审批状态 */
export function bizApprovalStatus(bizType: string, bizId: number): "pending" | "approved" | "rejected" | "none" {
  const rows = all<{ status: string }>(
    "SELECT status FROM approval_instances WHERE biz_type = ? AND biz_id = ? ORDER BY id DESC LIMIT 1",
    [bizType, bizId]
  );
  if (rows.length === 0) return "none";
  return rows[0].status as "pending" | "approved" | "rejected";
}
