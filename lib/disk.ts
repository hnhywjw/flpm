
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ---------------- 存储空间 ----------------

export interface DiskMount {
  /** 挂载点或目录 */
  path: string;
  /** 用途说明 */
  purpose: string;
  /** 所属分区设备 */
  device: string;
  totalMB: number;
  usedMB: number;
  freeMB: number;
  /** 使用率 0-100 */
  usagePct: number;
  /** 该目录自身占用（仅 db/uploads 等可统计的目录） */
  selfSizeMB: number | null;
  /** 是否可读写 */
  writable: boolean;
}

export interface DiskInfo {
  /** 按分区去重后的汇总 */
  mounts: DiskMount[];
  /** 各业务目录的明细 */
  dirs: {
    path: string;
    purpose: string;
    sizeMB: number;
    /** 落在哪个分区 */
    mount: string;
    /** 该分区使用率 */
    mountUsagePct: number;
  }[];
  /** 最高使用率，用于概览卡 */
  maxUsagePct: number;
  /** 最低剩余空间（MB） */
  minFreeMB: number;
  supported: boolean;
}

/**
 * 取某个路径所在分区的容量
 *
 * 优先用 fs.statfsSync（Node 18.15+，不依赖外部命令）
 * 失败则退回 df -P（POSIX 输出格式，字段位置稳定）
 */
function getStatFs(p: string): { totalMB: number; freeMB: number; usedMB: number } | null {
  // 路径必须存在才能 statfs
  if (!fs.existsSync(p)) return null;

  // 方案 1：Node 原生
  try {
    const st = (fs as unknown as {
      statfsSync?: (p: string) => {
        bsize: number; blocks: number; bfree: number; bavail: number;
      };
    }).statfsSync?.(p);
    if (st && st.bsize > 0) {
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      // used 用 blocks - bfree（不含 root 保留块），更贴近 df 的 Used
      const used = (st.blocks - st.bfree) * st.bsize;
      return {
        totalMB: Math.round(total / 1024 / 1024),
        freeMB: Math.round(free / 1024 / 1024),
        usedMB: Math.round(used / 1024 / 1024),
      };
    }
  } catch { /* 降级到 df */ }

  // 方案 2：df -P（POSIX 格式，1K 块）
  try {
    const out = execFileSync("df", ["-Pk", p], { timeout: 5000 }).toString("utf-8");
    // 形如：/dev/sda1  1024000  500000  524000  49%  /
    const line = out.trim().split("\n")[1];
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) return null;
    const totalK = Number(parts[1]);
    const usedK = Number(parts[2]);
    const availK = Number(parts[3]);
    if (!Number.isFinite(totalK) || totalK <= 0) return null;
    return {
      totalMB: Math.round(totalK / 1024),
      usedMB: Math.round(usedK / 1024),
      freeMB: Math.round(availK / 1024),
    };
  } catch {
    return null;
  }
}

/**
 * 取某个路径的设备名与挂载点
 *
 * 注意：bind mount 下 df 会把挂载点显示成目录本身
 * （/app/db 和 /app/uploads 是同一块盘，但 df 各显示各的）。
 * 所以**去重要用设备名，不能用挂载点**。
 */
function getDeviceInfo(p: string): { device: string; mount: string } {
  try {
    const out = execFileSync("df", ["-Pk", p], { timeout: 5000 }).toString("utf-8");
    const line = out.trim().split(String.fromCharCode(10))[1];
    if (!line) return { device: "", mount: p };
    const parts = line.trim().split(/\s+/);
    const device = parts[0] ?? "";
    // df -P 最后一列是挂载点；挂载点含空格时取剩余部分
    const mount = parts.slice(5).join(" ") || p;
    return { device, mount };
  } catch {
    return { device: "", mount: p };
  }
}

/** 统计目录大小（MB） */
function dirSizeMB(p: string): number {
  try {
    if (!fs.existsSync(p)) return 0;
    let total = 0;
    const walk = (dir: string, depth = 0) => {
      if (depth > 6) return;  // 防止深层目录拖慢
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walk(fp, depth + 1);
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

function isWritable(p: string): boolean {
  try {
    if (!fs.existsSync(p)) return false;
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 存储空间
 *
 * 关注的点：
 * 1. 数据库目录（db/）：写入失败会直接导致业务崩
 * 2. 附件目录（uploads/）
 * 3. 备份目录（db/backup/）：备份写满也会出问题
 * 4. 升级包目录（db/upgrade/）
 *
 * 注意：容器内看到的容量是**宿主机的分区容量**（bind mount），
 * 这正是我们想监控的——它就是真实的磁盘水位。
 */
export function getDiskInfo(): DiskInfo {
  const cwd = process.cwd();

  const targets = [
    { path: path.join(cwd, "db"), purpose: "数据库" },
    { path: path.join(cwd, "uploads"), purpose: "附件存储" },
    { path: path.join(cwd, "db", "backup"), purpose: "数据备份" },
    { path: path.join(cwd, "db", "upgrade"), purpose: "升级包" },
  ];

  const dirs: DiskInfo["dirs"] = [];
  // key = 设备名（同一块盘只统计一次）
  const deviceMap = new Map<string, DiskMount>();
  let supported = false;

  for (const t of targets) {
    const stat = getStatFs(t.path) ?? getStatFs(cwd);
    if (!stat) continue;
    supported = true;

    const { device, mount } = getDeviceInfo(t.path);
    const usagePct = stat.totalMB > 0
      ? Math.round((stat.usedMB / stat.totalMB) * 100)
      : 0;

    const sizeMB = dirSizeMB(t.path);
    dirs.push({
      path: t.path,
      purpose: t.purpose,
      sizeMB,
      mount,
      mountUsagePct: usagePct,
    });

    // 用设备名去重：/app/db 与 /app/uploads 同盘时只保留一条
    const key = device || mount;
    if (!deviceMap.has(key)) {
      deviceMap.set(key, {
        path: mount,
        purpose: t.purpose,
        device,
        totalMB: stat.totalMB,
        usedMB: stat.usedMB,
        freeMB: stat.freeMB,
        usagePct,
        selfSizeMB: null,
        writable: isWritable(t.path),
      });
    }
  }

  const mounts = Array.from(deviceMap.values());
  const maxUsagePct = mounts.length
    ? Math.max(...mounts.map((m) => m.usagePct))
    : 0;
  const minFreeMB = mounts.length
    ? Math.min(...mounts.map((m) => m.freeMB))
    : 0;

  return { mounts, dirs, maxUsagePct, minFreeMB, supported };
}

/** 容量格式化 */
export function fmtMB(mb: number): string {
  if (mb < 1024) return mb + " MB";
  if (mb < 1024 * 1024) return (mb / 1024).toFixed(1) + " GB";
  return (mb / 1024 / 1024).toFixed(2) + " TB";
}
