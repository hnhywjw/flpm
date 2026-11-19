import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import {
  getNotifyConfig, saveNotifyConfig, sendMessage,
  listNotifications, markRead, unreadCount,
} from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const sp = req.nextUrl.searchParams;

    if (sp.get("config") === "1") {
      if (!["boss", "admin"].includes(user.role) && !user.roles.includes("boss")) {
        return NextResponse.json({ error: "无权限查看推送配置" }, { status: 403 });
      }
      const cfg = getNotifyConfig();
      // 不返回完整 URL 与密钥，只返回掩码
      return NextResponse.json({
        channel: cfg.channel,
        enabled: cfg.enabled,
        urlMasked: cfg.url ? cfg.url.replace(/\/([a-z0-9]{6})[a-z0-9]+$/i, "/$1****") : "",
        hasSecret: !!cfg.secret,
      });
    }

    return NextResponse.json({
      list: listNotifications(user.id, Number(sp.get("limit") ?? 50)),
      unread: unreadCount(user.id),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 保存推送配置 / 测试推送 / 标记已读 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json();

    if (body.action === "test") {
      if (!user.roles.includes("boss") && !user.roles.includes("admin")) {
        return NextResponse.json({ error: "无权限测试推送" }, { status: 403 });
      }
      const r = await sendMessage(
        "推送测试",
        `这是来自 ProjectFlow 的测试消息。\n\n操作人：${user.name}\n时间：${new Date().toLocaleString("zh-CN")}`,
        "info"
      );
      return NextResponse.json(r);
    }

    if (body.action === "markRead") {
      markRead(user.id, body.ids);
      return NextResponse.json({ ok: true, unread: unreadCount(user.id) });
    }

    // 保存配置
    if (!user.roles.includes("boss") && !user.roles.includes("admin")) {
      return NextResponse.json({ error: "无权限修改推送配置" }, { status: 403 });
    }
    if (body.channel && !["dingtalk", "wecom", "webhook", ""].includes(body.channel)) {
      return NextResponse.json({ error: "channel 必须为 dingtalk / wecom / webhook" }, { status: 400 });
    }
    if (body.url && !/^https?:\/\//.test(body.url)) {
      return NextResponse.json({ error: "URL 必须以 http:// 或 https:// 开头" }, { status: 400 });
    }

    saveNotifyConfig({
      channel: body.channel,
      url: body.url,
      secret: body.secret,
      enabled: body.enabled,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
