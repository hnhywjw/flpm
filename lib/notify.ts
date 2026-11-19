import crypto from "node:crypto";
import { all, one, run } from "./db";

/**
 * 消息推送
 * 支持三种渠道：
 *   1. 钉钉群机器人（支持加签）
 *   2. 企业微信群机器人
 *   3. 通用 Webhook（POST JSON）
 *
 * 配置优先级：数据库 notify_config > 环境变量
 */

export type NotifyChannel = "dingtalk" | "wecom" | "webhook";

export interface NotifyConfig {
  channel: NotifyChannel | "";
  url: string;
  secret: string;
  enabled: boolean;
}

export function getNotifyConfig(): NotifyConfig {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM notify_config");
  const map = new Map(rows.map((r) => [r.key, r.value ?? ""]));

  const channel = (map.get("channel") ?? "").trim() as NotifyChannel | "";
  const url = (map.get("url") ?? process.env.WEBHOOK_URL ?? "").trim();
  const secret = (map.get("secret") ?? process.env.WEBHOOK_SECRET ?? "").trim();
  const enabledRaw = map.get("enabled") ?? (url ? "1" : "0");

  return { channel, url, secret, enabled: enabledRaw === "1" && !!url && !!channel };
}

export function saveNotifyConfig(cfg: Partial<NotifyConfig>) {
  const set = (k: string, v: string) => {
    run(
      `INSERT INTO notify_config (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [k, v]
    );
  };
  if (cfg.channel !== undefined) set("channel", cfg.channel);
  if (cfg.url !== undefined) set("url", cfg.url);
  if (cfg.secret !== undefined) set("secret", cfg.secret);
  if (cfg.enabled !== undefined) set("enabled", cfg.enabled ? "1" : "0");
}

// ---------------- 发送 ----------------

interface SendResult {
  ok: boolean;
  error?: string;
  skipped?: boolean;
}

/** 钉钉加签 */
function dingtalkSign(url: string, secret: string): string {
  const ts = Date.now();
  const stringToSign = `${ts}\n${secret}`;
  const sign = crypto.createHmac("sha256", secret).update(stringToSign).digest("base64");
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
}

export async function sendMessage(
  title: string,
  content: string,
  level: "info" | "warn" | "bad" = "info"
): Promise<SendResult> {
  const cfg = getNotifyConfig();
  if (!cfg.enabled) return { ok: false, skipped: true, error: "未启用推送" };

  const emoji = level === "bad" ? "🔴" : level === "warn" ? "🟡" : "🔵";
  const text = `${emoji} **${title}**\n\n${content}`;

  try {
    let url = cfg.url;
    let body: Record<string, unknown>;

    if (cfg.channel === "dingtalk") {
      if (cfg.secret) url = dingtalkSign(url, cfg.secret);
      body = {
        msgtype: "markdown",
        markdown: { title, text },
      };
    } else if (cfg.channel === "wecom") {
      body = {
        msgtype: "markdown",
        markdown: { content: text },
      };
    } else {
      // 通用 webhook
      body = { title, content, level, timestamp: new Date().toISOString() };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
    }

    // 钉钉/企微返回 errcode
    const data = await res.json().catch(() => null) as { errcode?: number; errmsg?: string } | null;
    if (data && typeof data.errcode === "number" && data.errcode !== 0) {
      return { ok: false, error: `errcode=${data.errcode} ${data.errmsg ?? ""}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------- 站内通知 ----------------

export function createNotification(input: {
  userId: number;
  category: string;
  title: string;
  content?: string;
  link?: string;
  level?: "info" | "warn" | "bad";
  channel?: string;
  /** 幂等：同一天同用户同标题只插一次 */
  dedupe?: boolean;
}): number {
  if (input.dedupe !== false) {
    const exists = one<{ id: number }>(
      "SELECT id FROM notifications WHERE user_id = ? AND title = ? AND date(created_at) = date('now','localtime') LIMIT 1",
      [input.userId, input.title]
    );
    if (exists) return exists.id;
  }
  const info = run(
    `INSERT INTO notifications (user_id, channel, category, title, content, link, level)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId, input.channel ?? "web", input.category,
      input.title, input.content ?? null, input.link ?? null, input.level ?? "info",
    ]
  );
  return Number(info.lastInsertRowid);
}

export function listNotifications(userId: number, limit = 50) {
  return all<{
    id: number; category: string; title: string; content: string | null;
    link: string | null; level: string; is_read: number; created_at: string;
  }>(
    `SELECT id, category, title, content, link, level, is_read, created_at
     FROM notifications WHERE user_id = ?
     ORDER BY is_read ASC, id DESC LIMIT ?`,
    [userId, limit]
  );
}

export function markRead(userId: number, ids?: number[]) {
  if (ids && ids.length) {
    const ph = ids.map(() => "?").join(",");
    run(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${ph})`, [userId, ...ids]);
  } else {
    run("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [userId]);
  }
}

export function unreadCount(userId: number): number {
  return one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0", [userId]
  )?.c ?? 0;
}

/** 记录推送结果（用于排查） */
export function logSent(id: number, ok: boolean, error?: string) {
  run(
    "UPDATE notifications SET sent_status = ?, sent_at = datetime('now','localtime'), error = ? WHERE id = ?",
    [ok ? "sent" : "failed", error ?? null, id]
  );
}

/**
 * 给某角色下所有用户发通知
 * roleKey 为空则发给所有人
 */
export function notifyRole(
  roleKey: string | null,
  payload: { category: string; title: string; content?: string; link?: string; level?: "info" | "warn" | "bad" }
): number[] {
  const users = roleKey
    ? all<{ id: number }>(
        "SELECT DISTINCT user_id AS id FROM user_roles WHERE role_key = ?", [roleKey]
      )
    : all<{ id: number }>("SELECT id FROM users WHERE active = 1", []);

  return users.map((u) =>
    createNotification({ userId: u.id, ...payload })
  );
}
