import { NextRequest, NextResponse } from "next/server";
import {
  requireUser, verifyPassword, hashPassword, SESSION_COOKIE,
  isUsingDefaultPassword,
} from "@/lib/auth";
import { one, run, audit } from "@/lib/db";
import { errorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // allowPendingPwdChange：必须放行，否则「必须先改密」的人永远改不了密
    const user = await requireUser({ allowPendingPwdChange: true });
    const { oldPassword, newPassword } = await req.json();

    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: "请填写原密码和新密码" }, { status: 400 });
    }
    if (String(newPassword).length < 8) {
      return NextResponse.json({ error: "新密码至少 8 位" }, { status: 400 });
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return NextResponse.json({ error: "新密码需同时包含字母和数字" }, { status: 400 });
    }
    if (oldPassword === newPassword) {
      return NextResponse.json({ error: "新密码不能与原密码相同" }, { status: 400 });
    }

    // 不允许把密码设成系统默认密码
    //
    // 之前漏了这条：用户被强制改密后，可以再把密码填成 Admin@123，
    // 一下又回到「默认密码」状态 —— 强制改密形同虚设。
    // 这里先做一次实际比对（用新密码试算旧 salt，虽然没有意义），
    // 更简单可靠的做法是直接比字符串，但大小写等变体也要考虑，
    // 所以改成「用新密码算出的哈希与默认密码哈希比对」。
    {
      const { hash: newHash, salt: newSalt } = hashPassword(String(newPassword));
      if (isUsingDefaultPassword(newHash, newSalt)) {
        return NextResponse.json(
          { error: "不能使用系统默认密码，请设置一个你自己的密码" },
          { status: 400 }
        );
      }
    }

    const row = one<{ password_hash: string | null; password_salt: string | null }>(
      "SELECT password_hash, password_salt FROM users WHERE id = ?", [user.id]
    );
    if (!row?.password_hash || !row.password_salt) {
      return NextResponse.json({ error: "账号状态异常" }, { status: 400 });
    }
    if (!verifyPassword(oldPassword, row.password_hash, row.password_salt)) {
      return NextResponse.json({ error: "原密码不正确" }, { status: 400 });
    }

    const { hash, salt } = hashPassword(newPassword);
    run(
      "UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = 0 WHERE id = ?",
      [hash, salt, user.id]
    );

    // 改密后使其他会话失效，只保留当前会话
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      run("DELETE FROM sessions WHERE user_id = ? AND id != ?", [user.id, token]);
    }

    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: "user", entityId: user.id,
      summary: "修改登录密码",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
