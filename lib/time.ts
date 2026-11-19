/**
 * 时间工具（前端 + 后端通用，**不能 import 任何服务端模块**）
 *
 * ★ 血泪教训
 *
 * 最初把 getTimezone()（要读数据库）也写在这个文件里，
 * 结果前端组件 import 了 todayLocal，webpack 顺着
 *   time.ts → db.ts → better-sqlite3 → node:fs
 * 一路打进了浏览器包，构建直接失败：
 *
 *   UnhandledSchemeError: Reading from "node:fs" is not handled by plugins
 *
 * 所以这个文件保持「纯函数、零依赖」：
 *   - 前端用默认时区（与服务器保持一致即可，日期只用于输入框默认值）
 *   - 需要「按配置时区」的地方（服务端任务、API）从 lib/time-server.ts 取
 */

/** 默认时区。前端在不知道配置值时用它兜底 */
export const DEFAULT_TIMEZONE = "Asia/Shanghai";

/** 常用时区列表（纯数据，前后端都能用） */
export const TIMEZONE_OPTIONS = [
  { value: "Asia/Shanghai", label: "中国标准时间 (UTC+8) 北京/上海" },
  { value: "Asia/Hong_Kong", label: "香港时间 (UTC+8)" },
  { value: "Asia/Taipei", label: "台北时间 (UTC+8)" },
  { value: "Asia/Tokyo", label: "日本标准时间 (UTC+9) 东京" },
  { value: "Asia/Singapore", label: "新加坡时间 (UTC+8)" },
  { value: "Asia/Dubai", label: "海湾标准时间 (UTC+4) 迪拜" },
  { value: "Europe/London", label: "格林尼治标准时间 (UTC+0) 伦敦" },
  { value: "Europe/Berlin", label: "中欧时间 (UTC+1) 柏林" },
  { value: "America/New_York", label: "美国东部时间 (UTC-5) 纽约" },
  { value: "America/Los_Angeles", label: "美国太平洋时间 (UTC-8) 洛杉矶" },
  { value: "UTC", label: "协调世界时 (UTC+0)" },
];

/**
 * 按指定时区取出年月日时分秒
 *
 * 用 Intl 而不是 toISOString：Intl 支持任意 IANA 时区，
 * 且不受运行环境 TZ 影响（容器通常是 UTC）。
 */
export function partsInTz(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(d)) {
    if (x.type !== "literal") p[x.type] = x.value;
  }
  // 部分环境跨日边界会给出 "24"
  if (p.hour === "24") p.hour = "00";
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/**
 * 时区安全的「今天」：YYYY-MM-DD
 *
 * ★ 这是修复 26 处日期 bug 的核心
 *
 * 原来到处写 new Date().toISOString().slice(0,10)，
 * 取的是 UTC 日期。东八区凌晨 0:00–8:00 会退一天：
 *   本地 2026-10-29 07:00 → UTC 2026-10-28 23:00 → "2026-10-28"
 * 合同签署日、回款计划日、开票日、验收提交日全部受影响。
 */
export function todayLocal(tz: string = DEFAULT_TIMEZONE, at: Date = new Date()): string {
  const p = partsInTz(at, tz);
  return p.y + "-" + p.mo + "-" + p.d;
}

/** 时区安全的「现在」：YYYY-MM-DD HH:mm:ss */
export function nowLocalFull(tz: string = DEFAULT_TIMEZONE, at: Date = new Date()): string {
  const p = partsInTz(at, tz);
  return p.y + "-" + p.mo + "-" + p.d + " " + p.h + ":" + p.mi + ":" + p.s;
}

/** 时区安全的「现在」时间部分：HH:mm:ss */
export function nowTime(tz: string = DEFAULT_TIMEZONE, at: Date = new Date()): string {
  const p = partsInTz(at, tz);
  return p.h + ":" + p.mi + ":" + p.s;
}

/** 时区偏移（分钟，东八区为 +480） */
export function tzOffsetMinutes(tz: string = DEFAULT_TIMEZONE, at: Date = new Date()): number {
  const p = partsInTz(at, tz);
  const asUtc = Date.UTC(
    Number(p.y), Number(p.mo) - 1, Number(p.d),
    Number(p.h), Number(p.mi), Number(p.s)
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * 给某个日期字符串加减天数（纯日历运算，与时区无关）
 * @param dateStr YYYY-MM-DD
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return dt.getUTCFullYear() + "-" + p(dt.getUTCMonth() + 1) + "-" + p(dt.getUTCDate());
}

/**
 * 两个日期相差天数（b - a）
 * 用 UTC 构造避免夏令时导致的 23/25 小时偏差
 */
export function daysBetween(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  return Math.round((tb - ta) / 86400000);
}

/** 从 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm" 里取出日期部分 */
export function dateOnly(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + "-" + m[2] + "-" + m[3] : null;
}
