import crypto from "node:crypto";
import { one, run } from "./db";

/**
 * 验证码
 * 用 SVG 动态生成，无第三方依赖
 * 答案存在 HttpOnly Cookie（客户端 JS 读不到），5 分钟有效
 */

export const CAPTCHA_COOKIE = "ltc_captcha";

// 去掉易混淆字符：0/O、1/I/l、2/Z、5/S
const CHARS = "ABCDEFGHJKMNPQRTUVWXY346789";

export function generateCode(len = 4): string {
  let s = "";
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    s += CHARS[bytes[i] % CHARS.length];
  }
  return s;
}

/** 生成 SVG 图片（转 base64 data URI） */
export function renderCaptchaSvg(code: string): string {
  const W = 90;
  const H = 38;

  // 随机干扰线和点（用 code 做种子保证同一次渲染稳定）
  const seed = crypto.createHash("md5").update(code).digest();
  const rnd = (i: number) => seed[i % seed.length] / 255;

  const lines: string[] = [];
  for (let i = 0; i < 3; i++) {
    const x1 = rnd(i * 3) * W;
    const y1 = rnd(i * 3 + 1) * H;
    const x2 = rnd(i * 3 + 2) * W;
    const y2 = rnd(i * 3 + 4) * H;
    const c = ["#93c5fd", "#c7d2fe", "#a5b4fc"][i % 3];
    lines.push(
      '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
      '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
      '" stroke="' + c + '" stroke-width="1.2" />'
    );
  }

  // 每个字符随机旋转/偏移
  const chars: string[] = [];
  for (let i = 0; i < code.length; i++) {
    const x = 14 + i * 20;
    const y = 26 + (rnd(i * 7) - 0.5) * 4;
    const rot = (rnd(i * 5) - 0.5) * 26;
    const color = ["#1e3a8a", "#1e40af", "#1d4ed8", "#2563eb"][i % 4];
    chars.push(
      '<text x="' + x + '" y="' + y.toFixed(1) + '" font-size="22" font-weight="800" ' +
      'font-family="ui-monospace,Menlo,Consolas,monospace" fill="' + color + '" ' +
      'transform="rotate(' + rot.toFixed(1) + ' ' + x + ' ' + y + ')">' + code[i] + '</text>'
    );
  }

  const dots: string[] = [];
  for (let i = 0; i < 18; i++) {
    const cx = rnd(i * 2) * W;
    const cy = rnd(i * 2 + 1) * H;
    dots.push(
      '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="0.8" fill="#c7d2fe" />'
    );
  }

  const svgOpen =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<rect width="' + W + '" height="' + H + '" fill="#f0f4ff" rx="6"/>';

  const svg = svgOpen + lines.join("") + dots.join("") + chars.join("") + "</svg>";

  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

/**
 * 验证码签名密钥
 *
 * 安全：绝不使用硬编码默认值。
 * 未配置 CAPTCHA_SECRET 时，进程启动时随机生成一个，
 * 攻击者无法离线伪造 token。
 *
 * 代价：进程重启后，重启前签发的验证码会失效（最长 5 分钟），
 * 用户重新获取即可。生产环境建议显式配置 CAPTCHA_SECRET。
 */
const CAPTCHA_SECRET: string = (() => {
  const fromEnv = process.env.CAPTCHA_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const generated = crypto.randomBytes(32).toString("hex");
  // 只在服务端打印一次，便于运维发现「没配环境变量」
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    console.warn(
      "[captcha] CAPTCHA_SECRET 未配置，已使用进程内随机密钥。" +
      "重启后旧验证码失效，建议在 docker-compose 中配置固定值。"
    );
  }
  return generated;
})();

/** 生成签名 token（防篡改：code + 时间戳 + HMAC） */
export function signCaptcha(code: string): string {
  const ts = Date.now().toString(36);
  const payload = `${code.toUpperCase()}.${ts}`;
  const sig = crypto.createHmac("sha256", CAPTCHA_SECRET).update(payload).digest("hex").slice(0, 16);
  return `${payload}.${sig}`;
}

/** 校验：答案正确且未过期（5 分钟） */
export function verifyCaptcha(token: string | undefined, input: string | undefined): {
  ok: boolean;
  reason?: string;
} {
  if (!token || !input) return { ok: false, reason: "请输入验证码" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "验证码无效，请刷新" };

  const [code, ts, sig] = parts;
  const expect = crypto.createHmac("sha256", CAPTCHA_SECRET).update(`${code}.${ts}`).digest("hex").slice(0, 16);

  if (sig !== expect) return { ok: false, reason: "验证码无效，请刷新" };

  // 5 分钟有效
  const issued = parseInt(ts, 36);
  if (Date.now() - issued > 5 * 60 * 1000) {
    return { ok: false, reason: "验证码已过期，请刷新" };
  }

  if (String(input).trim().toUpperCase() !== code) {
    return { ok: false, reason: "验证码错误" };
  }

  // 一次性：检查是否已被用过
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const used = one<{ token_hash: string }>(
    "SELECT token_hash FROM captcha_used WHERE token_hash = ?", [tokenHash]
  );
  if (used) {
    return { ok: false, reason: "验证码已使用，请刷新后重试" };
  }

  // 标记为已使用
  run("INSERT OR IGNORE INTO captcha_used (token_hash) VALUES (?)", [tokenHash]);

  // 顺手清理 1 小时前的记录，防表膨胀
  run("DELETE FROM captcha_used WHERE used_at < datetime('now','localtime','-1 hour')");

  return { ok: true };
}
