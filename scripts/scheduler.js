#!/usr/bin/env node
/**
 * 定时任务调度器
 * 每天在配置的时间点执行一次（默认 08:30，可在基础数据 → 定时任务里改）
 * 配置存在数据库 app_settings：job.enabled / job.hour / job.minute
 */
const TOKEN = (process.env.JOB_TOKEN || "").trim();
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api/jobs`;

let lastRunDate = "";
let checking = false;
// 连续鉴权失败计数：避免 token 配错时静默停摆
let authFailStreak = 0;
let lastAuthWarnAt = 0;

function authHeaders() {
  return TOKEN ? { "X-Job-Token": TOKEN } : {};
}

/**
 * 启动自检：确认 token 能通过后端校验
 *
 * 为什么需要：getConfig() 失败时会静默回退默认值，
 * 结果「看起来在跑，实际一个任务都没执行」。
 */
async function selfCheck() {
  if (!TOKEN) {
    console.error("[scheduler] ❌ JOB_TOKEN 未配置，定时任务将全部失效！");
    return false;
  }
  try {
    const res = await fetch(`${API}/config`, { headers: authHeaders() });
    if (res.ok) {
      console.log(`[scheduler] ✅ 鉴权自检通过 (token ${TOKEN.slice(0,6)}...)`);
      authFailStreak = 0;
      return true;
    }
    console.error(`[scheduler] ❌ 鉴权自检失败：HTTP ${res.status}，请检查 JOB_TOKEN`);
    return false;
  } catch (e) {
    console.error(`[scheduler] 自检无法连接应用：${e.message}`);
    return false;
  }
}

/** 从 API 读取配置（避免直接依赖 sqlite） */
async function getConfig() {
  try {
    const res = await fetch(`${API}/config`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        authFailStreak++;
        const nowMs = Date.now();
        if (nowMs - lastAuthWarnAt > 30 * 60 * 1000) {
          console.error(`[scheduler] ⚠ 鉴权失败第 ${authFailStreak} 次 (HTTP ${res.status})，定时任务未执行。请检查 JOB_TOKEN。`);
          lastAuthWarnAt = nowMs;
        }
      }
      return { enabled: true, hour: 8, minute: 30 };
    }
    authFailStreak = 0;
    const d = await res.json();
    return d.config ?? { enabled: true, hour: 8, minute: 30 };
  } catch {
    return { enabled: true, hour: 8, minute: 30 };
  }
}

async function tick() {
  if (checking) return;
  checking = true;
  try {
    const cfg = await getConfig();
    if (!cfg.enabled) return;

    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (lastRunDate === dateKey) return;

    const hh = now.getHours();
    const mm = now.getMinutes();
    const nowMin = hh * 60 + mm;
    const targetMin = Number(cfg.hour) * 60 + Number(cfg.minute);

    // 目标时间点后的 12 分钟内执行（容忍调度间隔）
    if (nowMin < targetMin || nowMin > targetMin + 12) return;

    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({}),
    });
    // 必须检查状态码：403 时 res.json() 拿到 {error}，results 为空，
    // 看起来像「跑了但没任务」，实际是鉴权失败
    if (!res.ok) {
      const body = await res.text();
      console.error(`[scheduler] ❌ 任务执行被拒绝 (HTTP ${res.status})：${body.slice(0,120)}`);
      console.error("[scheduler] 原因：JOB_TOKEN 不匹配。本次不标记已执行，下一轮会重试。");
      return;
    }
    const data = await res.json();
    lastRunDate = dateKey;
    const summary = (data.results || [])
      .map((r) => `${r.key}:${r.sent}`)
      .join(" ");
    console.log(`[scheduler] ${dateKey} ${String(cfg.hour).padStart(2,"0")}:${String(cfg.minute).padStart(2,"0")} 执行完成 ${summary}`);
  } catch (e) {
    console.error("[scheduler] 执行失败:", e.message);
  } finally {
    checking = false;
  }
}

// 启动后等 60 秒（应用就绪），然后每 2 分钟检查
setTimeout(async () => {
  await selfCheck();
  tick();
  setInterval(tick, 2 * 60 * 1000);
}, 60000);

console.log("[scheduler] 调度器已启动（时间可配置，默认每天 08:30）");
if (!TOKEN) {
  console.error("[scheduler] ⛔ 严重：JOB_TOKEN 为空，8 个定时任务将无法执行。");
}
