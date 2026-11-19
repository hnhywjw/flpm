import { NextRequest, NextResponse } from "next/server";
import { one, run, audit } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { verifyCaptcha, CAPTCHA_COOKIE } from "@/lib/captcha";
import { notifyRole } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * 注册账号
 * 策略：注册后账号默认停用（active=0、reg_status=pending），
 *       管理员审核通过并分配角色后才能登录
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password, name, phone, dept, captcha } = body;

    // 1. 验证码
    const token = req.cookies.get(CAPTCHA_COOKIE)?.value;
    const capResult = verifyCaptcha(token, captcha);
    if (!capResult.ok) {
      const res = NextResponse.json({ error: capResult.reason }, { status: 400 });
      res.cookies.set(CAPTCHA_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }

    // 2. 字段校验
    const uname = String(username ?? "").trim();
    const pwd = String(password ?? "");
    const displayName = String(name ?? "").trim();
    const phoneNo = String(phone ?? "").trim();

    if (!uname) throw new Error("请输入账号");
    if (!/^[\w\u4e00-\u9fa5.-]{2,32}$/.test(uname)) {
      throw new Error("账号只能包含中文、字母、数字、下划线、点、短横线，2-32 位");
    }
    if (!displayName) throw new Error("请输入姓名");

    // 密码强度：至少 8 位，含字母 + 数字
    if (pwd.length < 8) throw new Error("密码至少 8 位");
    if (!/[a-zA-Z]/.test(pwd)) throw new Error("密码必须包含字母");
    if (!/[0-9]/.test(pwd)) throw new Error("密码必须包含数字");

    if (!phoneNo) throw new Error("请输入手机号");
    if (!/^1[3-9]\d{9}$/.test(phoneNo)) throw new Error("手机号格式不正确");

    // 3. 唯一性
    const dupUser = one<{ id: number }>(
      "SELECT id FROM users WHERE username = ? COLLATE NOCASE", [uname]
    );
    if (dupUser) throw new Error(`账号「${uname}」已被注册`);

    const dupName = one<{ id: number }>(
      "SELECT id FROM users WHERE name = ?", [displayName]
    );
    if (dupName) throw new Error(`姓名「${displayName}」已存在，请联系管理员`);

    // 4. 创建账号（停用状态，无角色）
    // 不预设角色：role 留空，user_roles 也为空
    // 审核通过后必须由管理员显式分配角色，否则看不到任何菜单
    // （getUserMenus 在 user_roles 为空时会回退读 users.role，
    //   所以这里必须留空，不能写 'sales'，否则会白送权限）
    const { hash, salt } = hashPassword(pwd);
    const info = run(
      `INSERT INTO users
       (name, username, role, dept, phone, active, must_change_pwd,
        password_hash, password_salt, reg_status, reg_note, reg_at)
       VALUES (?, ?, '', ?, ?, 0, 0, ?, ?, 'pending', ?, datetime('now','localtime'))`,
      [
        displayName, uname, dept?.trim() || null, phoneNo,
        hash, salt,
        `注册申请：${uname}`,
      ]
    );

    const uid = Number(info.lastInsertRowid);

    // 5. 通知管理员
    const notifyPayload = {
      category: "system",
      title: `新注册申请：${displayName}（${uname}）`,
      content:
        `账号：${uname}\n姓名：${displayName}\n手机：${phoneNo}\n` +
        (dept ? `部门：${dept}\n` : "") +
        `\n请在「基础数据 → 人员管理」审核并分配角色。`,
      link: "/settings",
      level: "warn" as const,
    };
    notifyRole("boss", notifyPayload);
    notifyRole("admin", notifyPayload);

    audit({
      userId: uid, userName: displayName, action: "create",
      entityType: "users", entityId: uid,
      summary: `自助注册申请：${displayName}（${uname}），待管理员审核`,
    });

    const res = NextResponse.json({
      ok: true,
      message:
        "注册申请已提交。管理员审核通过并分配角色后即可登录，请留意通知或联系管理员。",
    });
    res.cookies.set(CAPTCHA_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
