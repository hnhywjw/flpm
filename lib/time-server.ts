import { one, run } from "./db";
import { DEFAULT_TIMEZONE, todayLocal, nowLocalFull, nowTime, tzOffsetMinutes } from "./time";

/**
 * 时间工具（**仅服务端**）
 *
 * 这个文件会 import ./db（→ better-sqlite3 → node:fs），
 * 所以绝对不能被任何 "use client" 组件或页面引用，
 * 否则 webpack 会把它打进浏览器包，构建报：
 *   UnhandledSchemeError: Reading from "node:fs" is not handled
 *
 * 前端需要「今天」时，直接用 lib/time.ts 的 todayLocal()（默认时区）。
 * 服务端需要「按系统配置时区取今天」时，才用这里的 getTimezone()。
 */

export { DEFAULT_TIMEZONE, todayLocal, nowLocalFull, nowTime, tzOffsetMinutes };

/** 读取系统配置的时区（app_settings.timezone，默认 Asia/Shanghai） */
export function getTimezone(): string {
  try {
    const row = one<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'timezone'"
    );
    return row?.value?.trim() || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** 保存时区 */
export function setTimezone(tz: string): void {
  run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('timezone', ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [tz]
  );
}

/** 按系统配置时区取「今天」——服务端专用 */
export function todayByConfig(at: Date = new Date()): string {
  return todayLocal(getTimezone(), at);
}

/** 按系统配置时区取「此刻 YYYY-MM-DD HH:mm:ss」——服务端专用 */
export function nowByConfig(at: Date = new Date()): string {
  return nowLocalFull(getTimezone(), at);
}
