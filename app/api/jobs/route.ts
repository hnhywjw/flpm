import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { runAllJobs, listJobRuns, getJobConfig, saveJobConfig } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** 查看任务执行历史 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    // 任务历史与配置属于运维信息，仅管理员可看
    if (!user.roles.includes("boss") && !user.roles.includes("admin")) {
      return NextResponse.json({ error: "无权限查看任务记录" }, { status: 403 });
    }
    return NextResponse.json({
      runs: listJobRuns(50),
      config: getJobConfig(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * 手动触发任务 / 保存配置
 * 定时调用：scripts/scheduler.js 带 X-Job-Token 头
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("x-job-token");
    const expected = process.env.JOB_TOKEN ?? "";

    // 定时器调用：走 token，不走会话
    if (token) {
      // 安全：JOB_TOKEN 未配置时必须完全拒绝 token 通道。
      // 之前的写法是 `if (expected && token !== expected)`，
      // expected 为空时条件短路直接放行 —— 任何人带个假 token 就能触发任务。
      if (!expected || token !== expected) {
        return NextResponse.json({ error: "token 无效" }, { status: 403 });
      }
      const body = await req.json().catch(() => ({}));
      const results = runAllJobs(body.only);
      return NextResponse.json({ ok: true, results });
    }

    // 手动触发：需要登录 + 管理员
    const user = await requireUser();
    if (!user.roles.includes("boss") && !user.roles.includes("admin")) {
      return NextResponse.json({ error: "无权限执行定时任务" }, { status: 403 });
    }

    const body = await req.json();
    if (body.action === "saveConfig") {
      saveJobConfig(body.config ?? {});
      return NextResponse.json({ ok: true });
    }

    const results = runAllJobs(body.only);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return errorResponse(e);
  }
}
