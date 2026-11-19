import { NextRequest, NextResponse } from "next/server";
import { login, SESSION_COOKIE } from "@/lib/auth";
import { verifyCaptcha, CAPTCHA_COOKIE } from "@/lib/captcha";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { name, password, captcha, totpCode } = await req.json();
    if (!name || !password) {
      return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
    }

    // 验证码校验（防暴力破解）
    const captchaToken = req.cookies.get(CAPTCHA_COOKIE)?.value;
    const capResult = verifyCaptcha(captchaToken, captcha);
    if (!capResult.ok) {
      const res = NextResponse.json(
        { error: capResult.reason, captchaRequired: true },
        { status: 400 }
      );
      // 验证码一次性，失败即作废
      res.cookies.set(CAPTCHA_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      null;
    const ua = req.headers.get("user-agent");

    const result = login(
      String(name).trim(), String(password), ip ?? undefined, ua ?? undefined,
      totpCode ? String(totpCode) : undefined
    );
    if (!result.ok) {
      // 需要令牌时返回 401 + needTotp 标记，前端据此显示输入框
      return NextResponse.json(
        { error: result.error, needTotp: result.needTotp === true },
        { status: 401 }
      );
    }

    // 经 Nginx 反代时 X-Forwarded-Proto=https
    const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
    const isHttps = proto === "https";

    const res = NextResponse.json({ ok: true, user: result.user });
    // 登录成功，销毁验证码
    res.cookies.set(CAPTCHA_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(SESSION_COOKIE, result.token!, {
      httpOnly: true,      // 禁止 JS 读取，防 XSS
      sameSite: "lax",     // 防 CSRF
      secure: isHttps,     // HTTPS 下自动启用
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
