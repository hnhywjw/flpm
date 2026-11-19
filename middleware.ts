import { NextRequest, NextResponse } from "next/server";

/**
 * 全局认证守卫（运行在 Edge Runtime，不能用 node:crypto / node:fs）
 *
 * 职责边界：
 * - 这里只做「有没有会话 cookie」的快速判断，属于第一道门禁
 * - 真正的身份校验（token 是否有效、是否过期、角色权限）在服务端
 *   lib/auth.ts 的 getCurrentUser / requireUser 中完成
 *
 * 这样设计的原因：Edge Runtime 不支持 Node 内置模块，
 * 而 scrypt 密码校验、SQLite 查询必须在 Node Runtime 执行。
 */
const SESSION_COOKIE = "ltc_session";
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/captcha",        // 登录前需要获取验证码
  "/api/auth/forgot-password", // 忘记密码申请
  "/api/auth/register",        // 注册申请
];

/**
 * 定时任务通道
 *
 * 背景：scheduler.js 是容器内的后台进程，没有浏览器会话 cookie。
 * 它靠 X-Job-Token 头鉴权，而这个头只有在 middleware 放行后
 * 才能到达 route handler 里做真正的 token 比对。
 *
 * 之前 middleware 只看 cookie，导致带 token 的请求在这里就被 401 拦掉，
 * route 里的 token 校验逻辑永远执行不到 —— 定时任务实际上从未成功执行过。
 *
 * 安全说明：
 *   这里只是「放行到下一层」，不做 token 校验。
 *   真正的比对在 app/api/jobs/route.ts 里（读 process.env.JOB_TOKEN）。
 *   未配置 JOB_TOKEN 时，route 会拒绝所有 token 请求。
 */
const JOB_PATHS = ["/api/jobs"];

function isJobRequestWithToken(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  if (!JOB_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return false;
  }
  const t = req.headers.get("x-job-token");
  // 必须有值才放行；空值不放行（避免误放通）
  return !!t && t.trim().length > 0;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|woff2?|ttf|map)$/)
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // 定时任务：带 X-Job-Token 的请求放行到 route 层做真实校验
  if (isJobRequestWithToken(req)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const isApi = pathname.startsWith("/api");

  if (!token) {
    if (isApi) {
      return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
