import fs from "node:fs";
import path from "node:path";
import { all } from "./db";
import { UPLOAD_ROOT } from "./storage";

/**
 * 孤儿附件清理
 *
 * 「孤儿」= 磁盘上存在、但 attachments 表里没有对应记录的文件。
 * 产生原因：
 *   · 上传后业务单据被回滚 / 未保存，但文件已落盘
 *   · 早期测试数据被直接清库，文件没同步删
 *   · 手动改库、异常中断
 *
 * ★ 设计原则：宁可漏删，绝不错删
 *
 * 五重保护：
 *   1. 宽限期   只处理 mtime 早于 GRACE_HOURS(7天) 的文件
 *               刚上传、还没写库的瞬间不会被误伤
 *   2. 白名单   只扫描已知的实体类型目录（project / agent_fee_payment）
 *               其他目录一律不碰 —— 将来新增业务不会因为"没登记"被误删
 *   3. 双查表   文件路径必须同时不在 attachments.file_path 里
 *               用「相对路径完全匹配」，不做模糊匹配
 *   4. 不删目录 只删文件，空目录留着（成本极低，避免误删有用途的目录层次）
 *   5. 只报告不静默 返回详细清单，写进 job_runs，可追溯
 */

/** 宽限期：只清理这个时间之前的文件 */
const GRACE_DAYS = 7;

/** 允许清理的实体目录（新增业务时必须来这里登记，否则不会被清理） */
const CLEANABLE_DIRS = ["project", "agent_fee_payment"];

export interface OrphanScanResult {
  /** 扫描的文件总数 */
  scanned: number;
  /** 判定为孤儿并删除的数量 */
  removed: number;
  /** 删除的文件大小合计（字节） */
  freedBytes: number;
  /** 因为「还在宽限期」而跳过的数量 */
  skippedFresh: number;
  /** 因为「数据库里有记录」而保留的数量 */
  keptReferenced: number;
  /** 删除失败的数量 */
  failed: number;
  /** 明细（最多保留 20 条，避免日志爆炸） */
  samples: string[];
}

/**
 * 扫描并清理孤儿文件
 *
 * @param opts.dryRun 只扫描不删除（用于手工排查）
 */
export function cleanupOrphanFiles(opts: { dryRun?: boolean } = {}): OrphanScanResult {
  const result: OrphanScanResult = {
    scanned: 0, removed: 0, freedBytes: 0,
    skippedFresh: 0, keptReferenced: 0, failed: 0, samples: [],
  };

  if (!fs.existsSync(UPLOAD_ROOT)) return result;

  // 一次性取出所有已登记的路径，避免逐个文件查库
  // 存成 Set，O(1) 命中
  const registered = new Set<string>();
  const rows = all<{ file_path: string }>("SELECT file_path FROM attachments");
  for (const r of rows) {
    if (r.file_path) registered.add(r.file_path);
  }

  const now = Date.now();
  const graceMs = GRACE_DAYS * 24 * 60 * 60 * 1000;

  for (const entityType of CLEANABLE_DIRS) {
    const typeDir = path.join(UPLOAD_ROOT, entityType);
    if (!fs.existsSync(typeDir)) continue;

    let idDirs: fs.Dirent[];
    try {
      idDirs = fs.readdirSync(typeDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const idDir of idDirs) {
      if (!idDir.isDirectory()) continue;

      const idPath = path.join(typeDir, idDir.name);
      let files: fs.Dirent[];
      try {
        files = fs.readdirSync(idPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const f of files) {
        if (!f.isFile()) continue;
        result.scanned++;

        const abs = path.join(idPath, f.name);
        // 相对路径统一成正斜杠，与 saveFile 写库的格式一致
        const rel = path.relative(UPLOAD_ROOT, abs).split(path.sep).join("/");

        // ---- 保护 2：数据库里有记录 → 保留
        if (registered.has(rel)) {
          result.keptReferenced++;
          continue;
        }

        // ---- 保护 1：还在宽限期 → 保留
        let mtimeMs: number;
        try {
          mtimeMs = fs.statSync(abs).mtimeMs;
        } catch {
          continue; // 读不到状态的跳过，不冒险
        }
        if (now - mtimeMs < graceMs) {
          result.skippedFresh++;
          continue;
        }

        // ---- 三条都过了，判定为孤儿
        if (opts.dryRun) {
          result.removed++;
          if (result.samples.length < 20) result.samples.push(rel);
          continue;
        }

        try {
          const size = fs.statSync(abs).size;
          fs.unlinkSync(abs);
          result.removed++;
          result.freedBytes += size;
          if (result.samples.length < 20) result.samples.push(rel);
        } catch {
          result.failed++;
        }
      }
    }
  }

  return result;
}
