import crypto from "node:crypto";

/**
 * TOTP 令牌认证（RFC 6238）
 *
 * 兼容 Google Authenticator / Microsoft Authenticator / 1Password 等
 * 标准实现：HMAC-SHA1，30 秒窗口，6 位数字
 *
 * 不引入第三方依赖——算法本身很短，自己实现可控性更好，
 * 也避免供应链风险。
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 生成 base32 密钥（默认 20 字节 = 160 bit，RFC 推荐） */
export function generateSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  // base32 编码（无填充）
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

/** base32 解码 */
function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * 生成指定时间片的 TOTP
 * @param secret base32 密钥
 * @param counter 时间片序号（默认当前时间 / 30）
 * @param digits 位数，默认 6
 */
export function generateTotp(secret: string, counter?: number, digits = 6): string {
  const c = counter ?? Math.floor(Date.now() / 1000 / 30);
  const key = base32Decode(secret);

  // 8 字节大端 counter
  const buf = Buffer.alloc(8);
  let v = c;
  for (let i = 7; i >= 0; i--) {
    buf[i] = v & 0xff;
    v = Math.floor(v / 256);
  }

  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  // 动态截断（RFC 4226 §5.4）
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % Math.pow(10, digits)).padStart(digits, "0");
}

/**
 * 校验 TOTP
 *
 * 允许 ±1 个时间片（共 90 秒窗口），容忍手机与服务器时钟偏差。
 * 窗口再大会显著降低安全性，1 个片是行业通行值。
 */
export function verifyTotp(secret: string, input: string, window = 1): boolean {
  const code = String(input ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  if (!secret) return false;

  const now = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (generateTotp(secret, now + i) === code) return true;
  }
  return false;
}

/** 生成 otpauth:// URI，用于生成二维码 */
export function buildOtpAuthUri(opts: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = opts.issuer ?? "ProjectFlow";
  const label = encodeURIComponent(`${issuer}:${opts.account}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** 生成恢复码（一次性，用掉作废） */
export function generateRecoveryCodes(count = 8): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString("hex");  // 10 位
    // 格式 xxxxx-xxxxx
    out.push(raw.slice(0, 5) + "-" + raw.slice(5, 10));
  }
  return out;
}

/** 校验并消费恢复码，返回剩余未用码 */
export function consumeRecoveryCode(
  storedJson: string | null,
  input: string
): { ok: boolean; remaining: string[] } {
  let list: { code: string; used: boolean }[] = [];
  try {
    list = JSON.parse(storedJson ?? "[]");
  } catch {
    return { ok: false, remaining: [] };
  }

  const target = String(input ?? "").trim().toLowerCase();
  const idx = list.findIndex((c) => !c.used && c.code.toLowerCase() === target);
  if (idx < 0) {
    return { ok: false, remaining: list.filter((c) => !c.used).map((c) => c.code) };
  }

  list[idx].used = true;
  return {
    ok: true,
    remaining: list.filter((c) => !c.used).map((c) => c.code),
  };
}

/** 把恢复码列表序列化为存储格式 */
export function packRecoveryCodes(codes: string[]): string {
  return JSON.stringify(codes.map((c) => ({ code: c, used: false })));
}
