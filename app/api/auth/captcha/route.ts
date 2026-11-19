import { NextResponse } from "next/server";
import { generateCode, renderCaptchaSvg, signCaptcha, CAPTCHA_COOKIE } from "@/lib/captcha";

export const dynamic = "force-dynamic";

/** 生成验证码：返回图片，答案写入 HttpOnly Cookie */
export async function GET() {
  const code = generateCode(4);
  const image = renderCaptchaSvg(code);
  const token = signCaptcha(code);

  const res = NextResponse.json({ image });
  res.cookies.set(CAPTCHA_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 5 * 60, // 5 分钟
  });
  return res;
}
