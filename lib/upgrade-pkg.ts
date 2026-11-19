import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * 离线升级包
 *
 * =============== 设计说明 ===============
 *
 * 约束：应用跑在容器里，容器内没有 docker 命令，
 * 也没法构建镜像。所以「网页点一下就升级」不可行。
 *
 * 因此升级拆成两段：
 *   1. 网页端：上传、校验、生成升级指令（本文负责）
 *   2. 宿主机：执行升级脚本，原子替换 + 失败自动回滚
 *
 * 升级包格式（tar.gz）：
 *   manifest.json   版本、构建时间、迁移列表
 *   image.tar       docker save 出来的镜像（可选，镜像升级用）
 *   src/            源码（可选，用于仅代码更新的场景）
 *   migrations/     新增的数据库迁移（可选）
 * =============== ===============
 */

export interface Manifest {
  version: string;
  buildTime: string;
  /** 构建机器信息，便于排查 */
  buildHost?: string;
  /** 包含的内容 */
  contents: {
    image?: boolean;
    src?: boolean;
    migrations?: string[];
  };
  /** 最低可升级版本（低于此版本需先升到中间版本） */
  minFromVersion?: string;
  /** 升级后需要执行的校验 */
  checks?: string[];
}

export interface PkgVerifyResult {
  ok: boolean;
  manifest: Manifest | null;
  sha256: string;
  sizeBytes: number;
  errors: string[];
  warnings: string[];
}

/** 计算文件 SHA256 */
export function sha256File(p: string): string {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

/** 版本比较：1.2.3 vs 1.3.0 → -1 / 0 / 1 */
export function compareVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** 轻量 tar.gz 检查：验证 gzip 魔数 + 是否包含 manifest.json */
export function inspectPackage(filePath: string): {
  isGzip: boolean;
  hasManifest: boolean;
  entries: string[];
} {
  const result = { isGzip: false, hasManifest: false, entries: [] as string[] };
  try {
    const fd = fs.openSync(filePath, "r");
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    // gzip 魔数 1f 8b
    result.isGzip = head[0] === 0x1f && head[1] === 0x8b;
    if (!result.isGzip) return result;

    // 用 tar 解出文件名列表（容器内已有 tar）
    try {
      const out = execFileSync("tar", ["-tzf", filePath], {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
      }).toString("utf-8");
      result.entries = out.split("\n").filter(Boolean).slice(0, 200);
      // 兼容 ./manifest.json 与 manifest.json
      result.hasManifest = result.entries.some(
        (e) => e.replace(/^\.\//, "") === "manifest.json"
      );
    } catch {
      // tar 不可用或包损坏
    }
  } catch { /* 忽略 */ }
  return result;
}

/** 从包里读出 manifest.json（不落盘解压，用 tar -xzO） */
export function readManifest(filePath: string): { manifest: Manifest | null; error: string | null } {
  // tar 打包时路径可能带 ./ 前缀（tar czf x.tar.gz -C dir .），两种都试
  const candidates = ["manifest.json", "./manifest.json"];
  let lastErr = "";

  for (const name of candidates) {
    try {
      const out = execFileSync("tar", ["-xzOf", filePath, name], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      }).toString("utf-8");
      const m = JSON.parse(out) as Manifest;
      if (!m.version) return { manifest: null, error: "manifest 缺少 version 字段" };
      return { manifest: m, error: null };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return {
    manifest: null,
    error: "包内没有 manifest.json（需放在压缩包根目录）",
  };
}

/** 完整校验 */
export function verifyPackage(
  filePath: string,
  currentVersion: string
): PkgVerifyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sizeBytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  const sha256 = fs.existsSync(filePath) ? sha256File(filePath) : "";

  if (sizeBytes === 0) {
    return { ok: false, manifest: null, sha256, sizeBytes, errors: ["文件不存在或为空"], warnings };
  }
  if (sizeBytes > 500 * 1024 * 1024) {
    errors.push("超过 500MB 上限");
  }

  const ins = inspectPackage(filePath);
  if (!ins.isGzip) {
    errors.push("不是有效的 gzip 压缩包");
    return { ok: false, manifest: null, sha256, sizeBytes, errors, warnings };
  }
  if (!ins.hasManifest) {
    errors.push("包内缺少 manifest.json（不符合升级包规范）");
  }

  // 路径穿越检查
  const evil = ins.entries.filter((e) => e.includes("../") || e.startsWith("/"));
  if (evil.length > 0) {
    errors.push("包内含可疑路径：" + evil.slice(0, 3).join(", "));
  }

  const { manifest, error } = readManifest(filePath);
  if (error) errors.push(error);

  if (manifest) {
    // 版本比较
    if (compareVersion(manifest.version, currentVersion) <= 0) {
      warnings.push(
        `包版本 ${manifest.version} 不高于当前版本 ${currentVersion}`
      );
    }
    if (manifest.minFromVersion &&
        compareVersion(currentVersion, manifest.minFromVersion) < 0) {
      errors.push(
        `当前版本 ${currentVersion} 低于最低要求 ${manifest.minFromVersion}，需先升级到中间版本`
      );
    }
    if (!manifest.contents || (!manifest.contents.image && !manifest.contents.src)) {
      errors.push("manifest 未声明 image 或 src，包内没有可升级内容");
    }
  }

  return {
    ok: errors.length === 0,
    manifest,
    sha256,
    sizeBytes,
    errors,
    warnings,
  };
}

/**
 * 生成宿主机执行的升级脚本
 *
 * 脚本正文放在 scripts/upgrade-template.sh，避免在 TS 里手写 bash 转义
 * （之前直接在模板字符串里写 shell，${} 会被 JS 提前展开，引号也容易丢）
 *
 * 占位符用 __X__ 形式，不会和 shell 的 ${X} 冲突。
 */
export function buildUpgradeScript(opts: {
  pkgFile: string;
  version: string;
  currentVersion: string;
  hasImage: boolean;
}): string {
  const { pkgFile, version, currentVersion } = opts;

  const tplPath = path.join(process.cwd(), 'scripts', 'upgrade-template.sh');
  let tpl: string;
  try {
    tpl = fs.readFileSync(tplPath, 'utf-8');
  } catch {
    // 模板缺失时给一个最小可用的兜底
    return [
      '#!/usr/bin/env bash',
      'echo "升级失败：服务器缺少 scripts/upgrade-template.sh" ',
      'exit 1',
    ].join(String.fromCharCode(10));
  }

  return tpl
    .replace(/__CUR__/g, currentVersion)
    .replace(/__VER__/g, version)
    .replace(/__PKG__/g, pkgFile);
}
