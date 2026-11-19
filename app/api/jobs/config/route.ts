import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { getJobConfig } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * 调度器读取任务配置
 * token 与登录二选一，避免调度器需要会话
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("x-job-token");
    const expected = process.env.JOB_TOKEN ?? "";

    if (token) {
      // JOB_TOKEN 未配置时拒绝 token 通道（防止空 token 绕过）
      if (!expected || token !== expected) {
        return NextResponse.json({ error: "token 无效" }, { status: 403 });
      }
      return NextResponse.json({ config: getJobConfig() });
    }

    await requireUser();
    return NextResponse.json({ config: getJobConfig() });
  } catch (e) {
    return errorResponse(e);
  }
}
