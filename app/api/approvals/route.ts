import { NextRequest, NextResponse } from "next/server";
import {
  TEMPLATES, startApproval, getInstance, getSteps, listByBiz,
  listMyPending, listMyApplied, act, cancel, bizApprovalStatus,
} from "@/lib/approval";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { notifyRole } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    const mine = sp.get("mine");
    const bizType = sp.get("bizType");
    const bizId = sp.get("bizId");
    const templates = sp.get("templates");

    if (templates) return NextResponse.json(TEMPLATES);
    if (id) {
      const inst = getInstance(Number(id));
      if (!inst) return NextResponse.json({ error: "审批不存在" }, { status: 404 });
      return NextResponse.json({ instance: inst, steps: getSteps(Number(id)) });
    }
    if (bizType && bizId) {
      return NextResponse.json({
        list: listByBiz(bizType, Number(bizId)),
        status: bizApprovalStatus(bizType, Number(bizId)),
      });
    }
    if (mine === "applied") return NextResponse.json(listMyApplied(user.id));
    // 默认：待我审批
    return NextResponse.json(listMyPending(user.role));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 发起审批 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const { templateKey, bizId, bizTitle, amountWan, summary } = await req.json();
    if (!templateKey || !bizTitle) {
      return NextResponse.json({ error: "缺少 templateKey 或 bizTitle" }, { status: 400 });
    }
    const result = startApproval({
      templateKey,
      bizId: bizId ?? null,
      bizTitle,
      amountCents: amountWan ? Math.round(Number(amountWan) * 10000) : null,
      summary: summary ?? undefined,
      applicant: { id: user.id, name: user.name, role: user.role },
    });
    // 推送给当前审批步骤的角色
    try {
      const inst = getInstance(result.id);
      if (inst) {
        const steps = getSteps(result.id);
        const cur = steps.find((x) => x.step_no === inst.current_step);
        if (cur && cur.action === "pending") {
          const ids = notifyRole(cur.role_required, {
            category: "approval",
            title: "待审批：" + bizTitle,
            content: `申请人 ${user.name} 提交了「${bizTitle}」，当前需「${cur.role_label}」审批。`,
            link: "/approvals",
            level: "info",
          });
          if (ids.length) {
            const { sendMessage } = await import("@/lib/notify");
            await sendMessage("待审批：" + bizTitle, `申请人 ${user.name}
当前步骤：${cur.role_label}`, "info");
          }
        }
      }
    } catch (e) {
      console.error("[notify]", (e as Error).message);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 审批 / 驳回 / 撤回 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const { instanceId, action, comment } = await req.json();
    if (!instanceId || !action) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }

    if (action === "cancel") {
      cancel(Number(instanceId), user.id);
      return NextResponse.json({ ok: true, status: "cancelled" });
    }
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action 必须为 approve / reject / cancel" }, { status: 400 });
    }
    if (action === "reject" && !comment) {
      return NextResponse.json({ error: "驳回必须填写理由" }, { status: 400 });
    }

    const r = act({
      instanceId: Number(instanceId),
      approver: { id: user.id, name: user.name, role: user.role },
      action,
      comment: comment ?? undefined,
    });

    // 通过后还有下一步 → 通知下一步审批人
    try {
      if (r.status === "pending" && r.nextStep) {
        const steps = getSteps(Number(instanceId));
        const nextStep = steps.find((x) => x.step_no === r.nextStep);
        const inst = getInstance(Number(instanceId));
        if (nextStep && inst) {
          notifyRole(nextStep.role_required, {
            category: "approval",
            title: "待审批：" + inst.biz_title,
            content: `上一步已通过（${user.name}），现需「${nextStep.role_label}」审批。`,
            link: "/approvals",
            level: "info",
          });
          const { sendMessage } = await import("@/lib/notify");
          await sendMessage("待审批：" + inst.biz_title, `当前步骤：${nextStep.role_label}`, "info");
        }
      }
    } catch (e) {
      console.error("[notify]", (e as Error).message);
    }

    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return errorResponse(e);
  }
}
