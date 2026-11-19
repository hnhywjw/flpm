import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { getTimezone, setTimezone } from "@/lib/time-server";
import { TIMEZONE_OPTIONS, todayLocal, nowLocalFull, tzOffsetMinutes } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * 时区设置
 *
 * GET  取当前时区 + 服务器时间（用于「服务器与浏览器时间是否一致」比对）
 * POST 保存时区
 *
 * 只有总经理 / 系统管理员能改：时区改错会让所有历史日期语义漂移。
 */

export async function GET() {
  try {
    await requireUser();
    const tz = getTimezone();
    const now = new Date();
    return NextResponse.json({
      timezone: tz,
      options: TIMEZONE_OPTIONS,
      // 服务器按该时区的当前时间
      serverTime: nowLocalFull(tz, now),
      serverDate: todayLocal(tz, now),
      // 时区偏移（分钟），前端可用来和浏览器时区比对
      offsetMinutes: tzOffsetMinutes(tz, now),
      // 服务器 UTC 时间戳，前端可算绝对时差
      serverEpochMs: now.getTime(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const isAdmin =
      user.roles.includes("boss") || user.roles.includes("admin");
    if (!isAdmin) {
      throw new AuthError("只有总经理或系统管理员可以修改时区", 403);
    }

    const body = await req.json();
    const tz = String(body.timezone ?? "").trim();

    // 白名单校验：防止写入任意字符串导致 Intl 抛异常
    if (!TIMEZONE_OPTIONS.some((o) => o.value === tz)) {
      return NextResponse.json({ error: "不支持的时区" }, { status: 400 });
    }

    setTimezone(tz);
    const now = new Date();
    return NextResponse.json({
      ok: true,
      timezone: tz,
      serverTime: nowLocalFull(tz, now),
      serverDate: todayLocal(tz, now),
      offsetMinutes: tzOffsetMinutes(tz, now),
      serverEpochMs: now.getTime(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
