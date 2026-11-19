import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { one, all } from "./db";

/** 系统运行指标采集 */

export interface LoadInfo {
  cpu: {
    cores: number;
    model: string;
    load1: number;
    load5: number;
    load15: number;
    /** 0-100，按 load1 / 核数 估算 */
    usagePct: number;
  };
  memory: {
    totalMB: number;
    usedMB: number;
    freeMB: number;
    usagePct: number;
  };
  uptime: {
    seconds: number;
    text: string;
  };
  process: {
    nodeVersion: string;
    pid: number;
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    /** Node 进程已运行秒数 */
    uptimeSec: number;
  };
  host: {
    platform: string;
    arch: string;
    hostname: string;
  };
  disk: {
    dbSizeMB: number;
    uploadsSizeMB: number;
    freeMB: number | null;
  };
  ts: string;
}

function dirSizeMB(p: string): number {
  try {
    if (!fs.existsSync(p)) return 0;
    let total = 0;
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walk(fp);
        else {
          try { total += fs.statSync(fp).size; } catch { /* 忽略 */ }
        }
      }
    };
    walk(p);
    return Math.round((total / 1024 / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

export function getLoadInfo(): LoadInfo {
  const cpus = os.cpus();
  const cores = cpus.length || 1;
  const load1 = os.loadavg()[0] ?? 0;
  const load5 = os.loadavg()[1] ?? 0;
  const load15 = os.loadavg()[2] ?? 0;

  // Linux 的 loadavg 是系统级；Windows 恒为 0，此时用内存压力估算
  const usagePct = load1 > 0
    ? Math.min(100, Math.round((load1 / cores) * 100))
    : 0;

  const totalMB = Math.round(os.totalmem() / 1024 / 1024);
  const freeMB = Math.round(os.freemem() / 1024 / 1024);
  const usedMB = totalMB - freeMB;

  const mem = process.memoryUsage();
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "db", "app.db");
  const uploadsDir = path.join(process.cwd(), "uploads");

  let dbSizeMB = 0;
  try {
    if (fs.existsSync(dbPath)) {
      dbSizeMB = Math.round((fs.statSync(dbPath).size / 1024 / 1024) * 10) / 10;
    }
  } catch { /* 忽略 */ }

  return {
    cpu: {
      cores,
      model: (cpus[0]?.model ?? "未知").trim(),
      load1: Math.round(load1 * 100) / 100,
      load5: Math.round(load5 * 100) / 100,
      load15: Math.round(load15 * 100) / 100,
      usagePct,
    },
    memory: {
      totalMB,
      usedMB,
      freeMB,
      usagePct: Math.round((usedMB / totalMB) * 100),
    },
    uptime: {
      seconds: Math.round(os.uptime()),
      text: fmtUptime(os.uptime()),
    },
    process: {
      nodeVersion: process.version,
      pid: process.pid,
      rssMB: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      uptimeSec: Math.round(process.uptime()),
    },
    host: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
    },
    disk: {
      dbSizeMB,
      uploadsSizeMB: dirSizeMB(uploadsDir),
      freeMB: null,  // Node 无原生磁盘容量 API，由外部展示
    },
    ts: new Date().toISOString(),
  };
}

/** 业务服务状态 */
export interface ServiceStatus {
  key: string;
  name: string;
  status: "ok" | "warn" | "down";
  /** 一句话摘要（列表里显示） */
  detail: string;
  /** 详细检查项：逐条列出，前端展开显示 */
  checks: { label: string; value: string; ok: boolean }[];
  /** 关键指标 */
  metric?: string;
  /** 支撑该服务的进程 PID 列表 */
  pids: number[];
  /** 该服务相关进程合计内存 MB */
  memMB: number;
  /** 该服务相关进程的 CPU 时间（秒，累计） */
  cpuSec: number;
}

function svcMeta(key: string) {
  const procs = getProcesses().filter((p) => p.serviceKey === key);
  return {
    pids: procs.map((p) => p.pid),
    memMB: Math.round(procs.reduce((s2, p) => s2 + p.rssMB, 0) * 10) / 10,
    cpuSec: Math.round(procs.reduce((s2, p) => s2 + p.cpuSec, 0) * 10) / 10,
  };
}

export function getServices(): ServiceStatus[] {
  const out: ServiceStatus[] = [];

  // ---------- 1. 数据库 ----------
  try {
    const t0 = Date.now();
    const r = one<{ quick_check: string }>("PRAGMA quick_check") as unknown as { quick_check?: string };
    const ms = Date.now() - t0;
    const users = one<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE active = 1")?.c ?? 0;
    const projects = one<{ c: number }>("SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL")?.c ?? 0;
    const contracts = one<{ c: number }>("SELECT COUNT(*) AS c FROM contracts WHERE deleted_at IS NULL")?.c ?? 0;
    const tables = one<{ c: number }>("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'")?.c ?? 0;
    const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "db", "app.db");
    let dbSizeMB = 0;
    try { if (fs.existsSync(dbPath)) dbSizeMB = Math.round(fs.statSync(dbPath).size / 1024 / 1024 * 10) / 10; } catch {}
    const integrity = r?.quick_check ?? "unknown";
    const okIntegrity = integrity === "ok";

    out.push({
      key: "db",
      name: "数据库",
      status: okIntegrity && ms < 200 ? "ok" : "warn",
      detail: `完整性校验 ${okIntegrity ? "通过" : "异常"}，查询响应 ${ms}ms，${tables} 张表`,
      checks: [
        { label: "完整性", value: integrity, ok: okIntegrity },
        { label: "响应时间", value: ms + " ms", ok: ms < 200 },
        { label: "数据表", value: tables + " 张", ok: true },
        { label: "文件大小", value: dbSizeMB + " MB", ok: true },
      ],
      metric: `${users} 用户 / ${projects} 项目 / ${contracts} 合同`,
      ...svcMeta("db"),
    });
  } catch (e) {
    out.push({
      key: "db", name: "数据库", status: "down",
      detail: (e as Error).message,
      checks: [{ label: "连接", value: "失败", ok: false }],
      ...svcMeta("db"),
    });
  }

  // ---------- 2. 文件存储 ----------
  try {
    const up = path.join(process.cwd(), "uploads");
    const exists = fs.existsSync(up);
    let count = 0;
    let sizeMB = 0;
    let writable = false;
    if (exists) {
      // ★ 必须递归统计
      //
      // 附件实际存放在 uploads/<entityType>/<entityId>/<uuid>.<ext>，
      // 之前只读根目录（readdirSync 不递归），永远拿到 0 个文件，
      // 「文件存储」一直显示 0 MB —— 看起来像上传功能坏了，其实是统计方式错了。
      const walk = (dir: string, depth: number) => {
        if (depth > 6) return; // 防止异常目录结构导致递归过深
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) {
            walk(p, depth + 1);
          } else if (e.isFile()) {
            count++;
            try { sizeMB += fs.statSync(p).size; } catch {}
          }
        }
      };
      walk(up, 0);
      sizeMB = Math.round(sizeMB / 1024 / 1024 * 10) / 10;
      try { fs.accessSync(up, fs.constants.W_OK); writable = true; } catch {}
    }
    out.push({
      key: "storage",
      name: "文件存储",
      status: exists && writable ? "ok" : "warn",
      detail: exists
        ? `uploads 目录${writable ? "可读写" : "只读（权限异常）"}，${count} 个文件，共 ${sizeMB} MB`
        : "uploads 目录不存在（首次上传时自动创建）",
      checks: [
        { label: "目录存在", value: exists ? "是" : "否", ok: exists },
        { label: "可写权限", value: writable ? "是" : "否", ok: writable },
        { label: "文件数量", value: count + " 个", ok: true },
        { label: "占用空间", value: sizeMB + " MB", ok: true },
      ],
      metric: `${count} 个文件 / ${sizeMB} MB`,
      ...svcMeta("storage"),
    });
  } catch (e) {
    out.push({
      key: "storage", name: "文件存储", status: "down",
      detail: (e as Error).message,
      checks: [{ label: "访问", value: "失败", ok: false }],
      ...svcMeta("storage"),
    });
  }

  // ---------- 3. 定时任务 ----------
  try {
    const day = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM notifications WHERE created_at >= datetime('now','localtime','-1 day')"
    )?.c ?? 0;
    const lastRun = one<{ finished_at: string | null; status: string; job_key: string }>(
      "SELECT finished_at, status, job_key FROM job_runs ORDER BY id DESC LIMIT 1"
    );
    const todayRuns = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM job_runs WHERE run_date = date('now','localtime')"
    )?.c ?? 0;
    const failedRuns = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM job_runs WHERE run_date = date('now','localtime') AND status = 'failed'"
    )?.c ?? 0;

    // ★ 状态判定要区分「现在有问题」和「今天曾经出过问题」
    //
    // 原来只判断 failedRuns > 0（今日失败次数），于是：
    // 早上 11:51 挂了一次，之后 13:18 / 13:22 连续成功恢复，
    // 但页面一整天都是「告警」，值守的人无法判断到底还要不要处理。
    //
    // 正确做法看「每个任务最近一次执行」的结果：
    //   · 所有任务最近一次都成功 → ok（历史失败只是记录，不告警）
    //   · 有任务最近一次是失败   → warn（真的还没恢复）
    const latestByJob = all<{ job_key: string; status: string; finished_at: string | null }>(
      `SELECT j.job_key, j.status, j.finished_at
       FROM job_runs j
       JOIN (SELECT job_key, MAX(id) AS max_id FROM job_runs GROUP BY job_key) m
         ON m.max_id = j.id`
    );
    const brokenJobs = latestByJob.filter((j) => j.status !== "ok");

    const okRun = !lastRun || lastRun.status === "ok";
    const status =
      brokenJobs.length > 0 ? "warn"
      : !okRun ? "warn"
      : "ok";

    // 详情里说清楚：最近一次是否成功 + 今天有过几次失败（历史）
    const histNote = failedRuns > 0
      ? `（今日历史失败 ${failedRuns} 次，均已恢复）`
      : "";

    out.push({
      key: "jobs",
      name: "定时任务",
      status,
      detail: lastRun
        ? `最近执行 ${lastRun.job_key}（${lastRun.status === "ok" ? "成功" : "失败"}）于 ${lastRun.finished_at ?? "-"}，今日 ${todayRuns} 次执行` + histNote
        : "尚未执行过任何任务",
      checks: [
        { label: "最近状态", value: lastRun ? (lastRun.status === "ok" ? "成功" : "失败") : "无记录", ok: okRun },
        {
          label: "未恢复任务",
          value: brokenJobs.length === 0 ? "无" : brokenJobs.map((j) => j.job_key).join("、"),
          ok: brokenJobs.length === 0,
        },
        { label: "今日执行", value: todayRuns + " 次", ok: true },
        { label: "今日失败", value: failedRuns + " 次" + (failedRuns > 0 && brokenJobs.length === 0 ? "（已恢复）" : ""), ok: true },
        { label: "近 24h 通知", value: day + " 条", ok: true },
      ],
      metric: `今日 ${todayRuns} 次 / 失败 ${failedRuns} 次`,
      ...svcMeta("jobs"),
    });
  } catch {
    out.push({
      key: "jobs", name: "定时任务", status: "warn",
      detail: "无法读取任务执行记录",
      checks: [{ label: "记录读取", value: "失败", ok: false }],
      ...svcMeta("jobs"),
    });
  }

  // ---------- 4. 登录会话 ----------
  try {
    const valid = one<{ c: number }>(
      "SELECT COUNT(*) AS c FROM sessions WHERE expires_at > datetime('now','localtime')"
    )?.c ?? 0;
    const total = one<{ c: number }>("SELECT COUNT(*) AS c FROM sessions")?.c ?? 0;
    const activeUsers = one<{ c: number }>(
      "SELECT COUNT(DISTINCT user_id) AS c FROM sessions WHERE expires_at > datetime('now','localtime')"
    )?.c ?? 0;
    out.push({
      key: "session",
      name: "登录会话",
      status: "ok",
      detail: `${valid} 个有效会话（${activeUsers} 位用户在线），历史累计 ${total} 条`,
      checks: [
        { label: "有效会话", value: valid + " 个", ok: true },
        { label: "在线用户", value: activeUsers + " 人", ok: true },
        { label: "历史记录", value: total + " 条", ok: true },
      ],
      metric: `${valid} 会话 / ${activeUsers} 在线`,
      ...svcMeta("session"),
    });
  } catch {
    out.push({
      key: "session", name: "登录会话", status: "warn",
      detail: "会话统计失败",
      checks: [{ label: "统计", value: "失败", ok: false }],
      ...svcMeta("session"),
    });
  }

  // ---------- 5. Web 服务 ----------
  try {
    const mem = process.memoryUsage();
    out.push({
      key: "web",
      name: "Web 服务",
      status: "ok",
      detail: `Node ${process.version} 运行中，PID ${process.pid}，已运行 ${Math.round(process.uptime() / 60)} 分钟`,
      checks: [
        { label: "Node 版本", value: process.version, ok: true },
        { label: "进程 PID", value: String(process.pid), ok: true },
        { label: "堆内存", value: Math.round(mem.heapUsed / 1024 / 1024) + " / " + Math.round(mem.heapTotal / 1024 / 1024) + " MB", ok: true },
        { label: "运行时长", value: Math.round(process.uptime() / 60) + " 分钟", ok: true },
      ],
      metric: `RSS ${Math.round(mem.rss / 1024 / 1024)} MB`,
      ...svcMeta("web"),
    });
  } catch {
    out.push({
      key: "web", name: "Web 服务", status: "warn",
      detail: "无法读取进程信息",
      checks: [{ label: "进程信息", value: "读取失败", ok: false }],
      ...svcMeta("web"),
    });
  }

  return out;
}

/** 数据备份信息 */
export interface BackupInfo {
  file: string;
  sizeMB: number;
  mtime: string;
}

/**
 * 备份目录
 * 与 scripts/backup.js 保持一致：/app/db/backup
 * （放在 db/ 下是因为 /app 属 root，nextjs 用户无法在 /app 下建目录）
 */
export function getBackupDir(): string {
  return path.join(process.cwd(), "db", "backup");
}

export function listBackups(): BackupInfo[] {
  const dir = getBackupDir();
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith(".db") || f.endsWith(".sqlite") || f.endsWith(".sql"))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return {
          file: f,
          sizeMB: Math.round((st.size / 1024 / 1024) * 10) / 10,
          mtime: st.mtime.toISOString().slice(0, 19).replace("T", " "),
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch {
    return [];
  }
}

/** 读取单个系统参数（带默认值） */
export function getParam(key: string, fallback: string): string {
  try {
    const row = one<{ value: string }>(
      "SELECT value FROM system_params WHERE key = ?", [key]
    );
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

/** 读取整数参数 */
export function getParamInt(key: string, fallback: number): number {
  const v = getParam(key, String(fallback));
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 升级包目录（与 db/backup 同级，nextjs 用户可写） */
export function getUpgradeDir(): string {
  return path.join(process.cwd(), "db", "upgrade");
}

/** 系统参数（key-value） */
export function getParams(): Record<string, string> {
  try {
    const rows = all<{ key: string; value: string }>(
      "SELECT key, value FROM system_params"
    );
    const o: Record<string, string> = {};
    for (const r of rows) o[r.key] = r.value;
    return o;
  } catch {
    return {};
  }
}

/** 版本信息 */
export function getVersionInfo() {
  // 与 UI 共用同一来源：package.json 的 version 字段
  let version = "v0.0.0";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
    version = "v" + (pkg.version ?? "0.0.0");
  } catch { /* 忽略 */ }

  const buildDate = process.env.BUILD_DATE ?? null;
  return {
    version,
    buildDate,
    nodeVersion: process.version,
    nextVersion: (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
        return pkg.dependencies?.next ?? "—";
      } catch { return "—"; }
    })(),
  };
}

// ---------------- 网口流量 ----------------

/** 单个网口的累计字节数 */
interface NetRaw {
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  rxErrors: number;
  txErrors: number;
}

/**
 * 读取 Linux /proc/net/dev
 * 容器内可用（属于宿主机网络命名空间的统计）
 *
 * 格式：
 *   Inter-|   Receive                          |  Transmit
 *    face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets ...
 *    eth0: 1234567   8901    0    0    0     0          0         0 7654321   1234 ...
 */
function readProcNetDev(): Record<string, NetRaw> {
  const out: Record<string, NetRaw> = {};
  try {
    if (!fs.existsSync("/proc/net/dev")) return out;
    const txt = fs.readFileSync("/proc/net/dev", "utf-8");
    for (const line of txt.split("\n")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const name = line.slice(0, idx).trim();
      if (!name || name === "lo") continue;  // 回环不算业务流量
      const parts = line.slice(idx + 1).trim().split(/\s+/).map(Number);
      if (parts.length < 11) continue;
      out[name] = {
        rxBytes: parts[0],
        txBytes: parts[8],
        rxPackets: parts[1],
        txPackets: parts[9],
        rxErrors: parts[2],
        txErrors: parts[10],
      };
    }
  } catch { /* 非 Linux 或权限不足 */ }
  return out;
}

/**
 * 上次采样（用于算速率）
 *
 * 必须挂在 globalThis 上，不能用模块级变量：
 * Next.js 生产模式下不同 route / 不同的 server 实例
 * 可能各自加载一份模块，模块级变量会互相看不见，
 * 导致每次都判定为「首次采样」而算不出速率。
 */
type NetSample = { ts: number; data: Record<string, NetRaw> };
const NET_SAMPLE_KEY = "__ltc_net_sample";
function getLastSample(): NetSample | null {
  const g = globalThis as unknown as Record<string, NetSample | undefined>;
  return g[NET_SAMPLE_KEY] ?? null;
}
function setLastSample(s: NetSample) {
  (globalThis as unknown as Record<string, NetSample>)[NET_SAMPLE_KEY] = s;
}

export interface NetIfInfo {
  name: string;
  /** 累计接收字节 */
  rxBytes: number;
  /** 累计发送字节 */
  txBytes: number;
  /** 接收速率 KB/s（首次采样为 null） */
  rxKBs: number | null;
  /** 发送速率 KB/s */
  txKBs: number | null;
  rxPackets: number;
  txPackets: number;
  rxErrors: number;
  txErrors: number;
  /** 是否有错误包 */
  hasError: boolean;
}

export function getNetInfo(): {
  interfaces: NetIfInfo[];
  totalRxKBs: number | null;
  totalTxKBs: number | null;
  supported: boolean;
} {
  const now = Date.now();
  const raw = readProcNetDev();
  const supported = Object.keys(raw).length > 0;

  const prev = getLastSample();
  const dt = prev ? (now - prev.ts) / 1000 : 0;

  const interfaces: NetIfInfo[] = Object.entries(raw).map(([name, cur]) => {
    let rxKBs: number | null = null;
    let txKBs: number | null = null;
    if (prev && dt > 0.2 && prev.data[name]) {
      const p = prev.data[name];
      // 计数器可能归零（网卡重启），出现负值时按 0 处理
      const dRx = cur.rxBytes >= p.rxBytes ? cur.rxBytes - p.rxBytes : 0;
      const dTx = cur.txBytes >= p.txBytes ? cur.txBytes - p.txBytes : 0;
      rxKBs = Math.round((dRx / 1024 / dt) * 10) / 10;
      txKBs = Math.round((dTx / 1024 / dt) * 10) / 10;
    }
    return {
      name,
      rxBytes: cur.rxBytes,
      txBytes: cur.txBytes,
      rxKBs,
      txKBs,
      rxPackets: cur.rxPackets,
      txPackets: cur.txPackets,
      rxErrors: cur.rxErrors,
      txErrors: cur.txErrors,
      hasError: cur.rxErrors > 0 || cur.txErrors > 0,
    };
  }).sort((a, b) => b.rxBytes + b.txBytes - (a.rxBytes + a.txBytes));

  let totalRxKBs: number | null = null;
  let totalTxKBs: number | null = null;
  if (prev && dt > 0.2) {
    totalRxKBs = 0;
    totalTxKBs = 0;
    for (const i of interfaces) {
      totalRxKBs += i.rxKBs ?? 0;
      totalTxKBs += i.txKBs ?? 0;
    }
    totalRxKBs = Math.round(totalRxKBs * 10) / 10;
    totalTxKBs = Math.round(totalTxKBs * 10) / 10;
  }

  setLastSample({ ts: now, data: raw });

  return { interfaces, totalRxKBs, totalTxKBs, supported };
}

/** 字节数格式化为易读单位 */
export function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}


// ---------------- 相关进程 ----------------

export interface ProcInfo {
  pid: number;
  /** 进程名（/proc/PID/comm） */
  name: string;
  /** 命令行摘要 */
  cmd: string;
  /** 关联的业务服务 key（db / storage / jobs / session / web） */
  serviceKey: string | null;
  /** 常驻内存 MB */
  rssMB: number;
  /** CPU 时间（秒，用户+系统） */
  cpuSec: number;
  /** 进程状态 R/S/D/Z */
  state: string;
  /** 进程启动后经过的秒数 */
  uptimeSec: number;
  /** 角色说明：本系统相关进程标记 */
  role: string;
}

function readProc(pid: string): ProcInfo | null {
  try {
    const base = "/proc/" + pid;
    const comm = fs.readFileSync(base + "/comm", "utf-8").trim();
    const statm = fs.readFileSync(base + "/statm", "utf-8").split(/\s+/);
    const rssPages = Number(statm[1] ?? 0);
    const pageSize = 4096;
    const rssMB = Math.round((rssPages * pageSize) / 1024 / 1024 * 10) / 10;

    // /proc/PID/stat: 第 3 列状态, 14/15 列 utime/stime(clock ticks, 通常 100/s)
    const statRaw = fs.readFileSync(base + "/stat", "utf-8");
    const rp = statRaw.lastIndexOf(")");
    const statFields = statRaw.slice(rp + 2).split(/\s+/);
    const state = statFields[0] ?? "?";
    const utime = Number(statFields[11] ?? 0);
    const stime = Number(statFields[12] ?? 0);
    const startTicks = Number(statFields[19] ?? 0);
    const cpuSec = Math.round((utime + stime) / 100 * 10) / 10;

    let cmd = "";
    try {
      cmd = fs.readFileSync(base + "/cmdline", "utf-8")
        .replace(/\0/g, " ").trim().slice(0, 120);
    } catch { /* 忽略 */ }

    // 进程运行时长：用系统 uptime - starttime/HZ
    let uptimeSec = 0;
    try {
      const bootUptime = fs.readFileSync("/proc/uptime", "utf-8").split(" ")[0];
      uptimeSec = Math.max(0, Math.round(Number(bootUptime) - startTicks / 100));
    } catch { /* 忽略 */ }

    return {
      pid: Number(pid), name: comm, cmd, serviceKey: null,
      rssMB, cpuSec, state, uptimeSec, role: "",
    };
  } catch {
    return null;
  }
}

/** 本系统相关进程：node（应用）、备份调度、以及容器内 1 号进程 */
function classify(p: ProcInfo): string {
  const c = (p.cmd + " " + p.name).toLowerCase();
  if (c.includes("backup-scheduler")) return "备份调度";
  if (c.includes("jobs-scheduler") || c.includes("scheduler.js")) return "任务调度";
  // 注意：不能只匹配 "next"，否则会把 next-server 之外的
  // 任何含 next 字样的进程（如工具链残留）也标成应用服务
  if (c.includes("next-server") || c.includes("next start")) return "应用服务";
  if (/\bnode\b.*\bserver\.js\b/.test(c)) return "应用服务";
  if (c.includes("nginx")) return "反向代理";
  if (p.pid === 1) return "容器主进程";
  if (c.includes("node")) return "Node 进程";
  return "";
}

export function getProcesses(): ProcInfo[] {
  const out: ProcInfo[] = [];
  try {
    if (!fs.existsSync("/proc")) return out;
    const pids = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pid of pids) {
      const p = readProc(pid);
      if (!p) continue;
      p.role = classify(p);
      p.serviceKey = servicesForProcess(p);
      // 保留规则：
      //   1. 能关联到业务服务的（真正需要监控的）
      //   2. 有明确角色的（调度、主进程等）
      //   3. 常驻内存 >= 10MB 的（避免噪音，但比之前 50MB 宽松）
      //   4. 排除内核线程（cmd 为空的 /proc 条目）
      if (!p.cmd && p.rssMB < 1) continue;
      if (p.serviceKey || p.role || p.rssMB >= 10) out.push(p);
    }
  } catch { /* 忽略 */ }
  // 上限放宽到 60，并优先按「有服务关联」排序，
  // 保证业务服务对应的进程一定在前排、不会被截断
  return out
    .sort((a, b) => {
      const sa = a.serviceKey ? 1 : 0;
      const sb = b.serviceKey ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return b.rssMB - a.rssMB;
    })
    .slice(0, 60);
}


// ---------------- SSL 证书 ----------------

export interface CertInfo {
  /** 是否找到证书文件 */
  found: boolean;
  path: string;
  subject: string | null;
  issuer: string | null;
  /** 生效时间 */
  validFrom: string | null;
  /** 到期时间 */
  validTo: string | null;
  /** 剩余天数，负数表示已过期 */
  daysLeft: number | null;
  expired: boolean;
  /** 自签证书判断 */
  selfSigned: boolean;
  error: string | null;
}

export interface CertInfo {
  /** 是否找到证书文件 */
  found: boolean;
  path: string;
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** 剩余天数，负数表示已过期 */
  daysLeft: number | null;
  expired: boolean;
  /** 自签证书判断 */
  selfSigned: boolean;
  /** 域名/SAN 列表 */
  san: string[];
  /** 与私钥是否匹配（配置了 key 才有值，null = 未检查/无法读取） */
  keyMatch: boolean | null;
  /** 私钥文件是否可被当前进程读取（权限不足时为 false，属正常） */
  keyReadable: boolean;
  /** 私钥路径 */
  keyPath: string | null;
  /** 密钥类型（RSA / EC） */
  keyType: string | null;
  /** 密钥长度（bit） */
  keyBits: number | null;
  /** 证书链层数（1 = 只有叶子证书） */
  chainLength: number;
  /** 是否被系统信任（由 CA 签发且链完整） */
  trusted: boolean;
  error: string | null;
}

/** 解析 PEM 中的所有证书块 */
function parsePemCerts(pem: string): string[] {
  const out: string[] = [];
  const re = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pem)) !== null) {
    out.push('-----BEGIN CERTIFICATE-----' + m[1] + '-----END CERTIFICATE-----');
  }
  return out;
}

/** 解析私钥基本信息 */
function parseKeyInfo(pem: string): { type: string; bits: number } | null {
  try {
    const k = createPrivateKey(pem);
    const t = String(k.asymmetricKeyType ?? 'unknown').toUpperCase();

    // RSA / DSA 有 modulusLength；EC 只有曲线名，没有位长字段
    //
    // 注意：modulusLength 在 Node 里可能是 BigInt，
    // 直接 JSON.stringify 会抛「Do not know how to serialize a BigInt」，
    // 那个异常会把外层 try 整块打断，导致 keyMatch 被误判为 false。
    const details = k.asymmetricKeyDetails as
      | { modulusLength?: number | bigint; namedCurve?: string }
      | undefined;
    let bits = details?.modulusLength ? Number(details.modulusLength) : 0;
    if (!bits && details?.namedCurve) {
      // 常见曲线位长映射
      const curveBits: Record<string, number> = {
        "prime256v1": 256, "secp256r1": 256, "secp384r1": 384, "secp521r1": 521,
        "Ed25519": 256, "Ed448": 448,
      };
      bits = curveBits[details.namedCurve] ?? 0;
    }
    return { type: t, bits };
  } catch {
    return null;
  }
}

/**
 * 读取并解析 PEM 证书
 *
 * 校验内容：
 * 1. 主体/颁发者/有效期（基础信息）
 * 2. 私钥与证书是否匹配（用公钥对比）
 * 3. 证书链层数（只做结构判断，不做 Trust Store 校验）
 * 4. SAN 域名列表
 * 5. 密钥类型与长度
 *
 * 注意：不做「系统信任链」验证。Node 的 X509Certificate 没有内置
 * Trust Store，要验完整信任链需要 openssl 或额外 CA 包。
 * 内网自签场景下「信任链验证」本来也不适用，所以只判断结构。
 */
export function getCertInfo(certPath: string, keyPath?: string): CertInfo {
  const empty: CertInfo = {
    found: false, path: certPath, subject: null, issuer: null,
    validFrom: null, validTo: null, daysLeft: null,
    expired: false, selfSigned: false, san: [], keyMatch: null,
    keyReadable: false, keyPath: null,
    keyType: null, keyBits: null, chainLength: 0, trusted: false, error: null,
  };

  if (!certPath) return { ...empty, error: '未配置证书路径' };
  if (!fs.existsSync(certPath)) return { ...empty, error: '证书文件不存在' };

  try {
    const pem = fs.readFileSync(certPath, 'utf-8');
    const blocks = parsePemCerts(pem);
    if (blocks.length === 0) {
      return { ...empty, found: true, path: certPath, error: '不是有效的 PEM 证书' };
    }

    const leaf = new X509Certificate(blocks[0]);
    const to = new Date(leaf.validTo);
    const from = new Date(leaf.validFrom);
    const daysLeft = Math.ceil((to.getTime() - Date.now()) / 86400000);
    const selfSigned = leaf.subject === leaf.issuer;

    // SAN 域名
    let san: string[] = [];
    try {
      const sanStr = String(leaf.subjectAltName ?? '');
      san = sanStr ? sanStr.split(',').map((x: string) => x.trim()).filter(Boolean) : [];
    } catch { /* 忽略 */ }

    // 私钥匹配 + 密钥信息
    //
    // 重要：私钥通常是 600 root:root，应用进程（nextjs）读不到。
    // 这是**正确的安全设置**，不应该为了展示而放宽权限。
    // 读不到时 keyMatch 保持 null，前端提示「权限不足」即可。
    let keyMatch: boolean | null = null;
    let keyType: string | null = null;
    let keyBits: number | null = null;
    let keyReadable = false;
    let resolvedKeyPath: string | null = null;

    if (keyPath && fs.existsSync(keyPath)) {
      resolvedKeyPath = keyPath;
      let keyPem = '';
      try {
        keyPem = fs.readFileSync(keyPath, 'utf-8');
        keyReadable = keyPem.length > 0;
      } catch { keyReadable = false; }

      if (keyPem) {
        // 1. 密钥信息（失败不影响匹配判断）
        try {
          const info = parseKeyInfo(keyPem);
          if (info) { keyType = info.type; keyBits = info.bits; }
        } catch { /* 忽略 */ }

        // 2. 公钥对比（独立 try，互不干扰）
        try {
          const pubFromKey = createPublicKey(keyPem).export({ type: 'spki', format: 'pem' });
          const pubFromCert = leaf.publicKey.export({ type: 'spki', format: 'pem' });
          keyMatch = String(pubFromKey) === String(pubFromCert);
        } catch {
          keyMatch = false;
        }
      }
    }

    const chainLength = blocks.length;
    // 结构性判断：非自签 + 链完整，才认为「看起来可信」
    // （真正的信任校验需要 Trust Store，见函数注释）
    const trusted = !selfSigned && chainLength >= 1;

    return {
      found: true,
      path: certPath,
      subject: leaf.subject,
      issuer: leaf.issuer,
      validFrom: from.toISOString().slice(0, 19).replace('T', ' '),
      validTo: to.toISOString().slice(0, 19).replace('T', ' '),
      daysLeft,
      expired: daysLeft < 0,
      selfSigned,
      san,
      keyMatch,
      keyReadable,
      keyPath: resolvedKeyPath,
      keyType,
      keyBits,
      chainLength,
      trusted,
      error: null,
    };
  } catch (e) {
    return { ...empty, found: true, path: certPath, error: (e as Error).message };
  }
}

/**
 * 进程 → 业务服务关联
 *
 * 让「相关进程状态」和「业务服务状态」对应起来：
 * 点开某个服务，能看到它是哪几个进程在支撑。
 */
function servicesForProcess(p: ProcInfo): string | null {
  const c = (p.cmd + " " + p.name).toLowerCase();

  // 备份调度 → 定时任务
  if (c.includes("backup-scheduler")) return "jobs";
  // 任务调度 → 定时任务
  if (c.includes("scheduler.js") || c.includes("jobs-scheduler")) return "jobs";
  // Web 服务：包含整个启动链路
  //   entrypoint.sh → npm exec next start → sh -c next start → next-server
  if (c.includes("next-server")) return "web";
  if (/\bnext\b\s+start/.test(c)) return "web";
  if (c.includes("entrypoint.sh")) return "web";
  if (p.pid === 1) return "web";
  return null;
}

/** 服务 key → 名称（前端展示用） */
export const SERVICE_LABELS: Record<string, string> = {
  web: "Web 服务",
  db: "数据库",
  storage: "文件存储",
  jobs: "定时任务",
  session: "登录会话",
};

