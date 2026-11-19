import { NextRequest, NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import { notifyRole } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * 忘记密码
 * 内部系统不开放自助重置，改为「提交申请 → 管理员处理」
 * 避免邮件/短信验证被骗导致账号被盗
 */
export async function POST(req: NextRequest) {
  try {
    const { username, contact, note } = await req.json();

    if (!username?.trim()) {
      return NextResponse.json({ error: "请输入用户名" }, { status: 400 });
    }

    const user = one<{ id: number; name: string }>(
      "SELECT id, name FROM users WHERE username = ? COLLATE NOCASE",
      [username.trim()]
    );

    // 安全考虑：无论用户是否存在，都返回相同提示，避免被用来探测账号
    if (user) {
      // 通知所有管理员
      const ids = notifyRole("boss", {
        category: "system",
        title: `密码重置申请：${user.name}`,
        content:
          `用户「${user.name}」申请重置密码。\n` +
          `联系方式：${contact?.trim() || "未填写"}\n` +
          `说明：${note?.trim() || "无"}\n\n` +
          `请核实身份后，在「基础数据 → 人员管理」中重置密码。`,
        link: "/settings",
        level: "warn",
      });

      // 管理员账号也可能只配了 admin 角色
      const adminIds = notifyRole("admin", {
        category: "system",
        title: `密码重置申请：${user.name}`,
        content:
          `用户「${user.name}」申请重置密码。\n` +
          `联系方式：${contact?.trim() || "未填写"}\n` +
          `说明：${note?.trim() || "无"}`,
        link: "/settings",
        level: "warn",
      });

      console.log(`[forgot] 密码重置申请 user=${user.name} 通知管理员 ${ids.length + adminIds.length} 人`);
    }

    return NextResponse.json({
      ok: true,
      message: "申请已提交。管理员核实身份后会为你重置密码，请留意站内通知或联系管理员。",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
