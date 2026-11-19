import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * 文件存储层
 * 安全要点：
 * 1. 文件名用随机 UUID，不信任用户输入的文件名（防路径穿越 / 覆盖）
 * 2. 扩展名白名单，禁止可执行文件
 * 3. 大小限制
 * 4. 存储根目录固定在 UPLOAD_DIR，用 realpath 校验防止 ../ 逃逸
 */

export const UPLOAD_ROOT = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
export const MAX_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * 文件魔数（magic number）表
 *
 * 只校验扩展名不够：把 virus.exe 改名 a.pdf 能通过扩展名检查。
 * 这里读文件头几个字节比对真实类型，防止「改扩展名」绕过。
 *
 * 注意：ZIP 系（zip/docx/xlsx/pptx 都是 PK 开头）、
 * OLE 系（doc/xls/ppt 是老格式，D0CF11E0）、
 * 部分纯文本格式没有固定魔数，只做「宽松校验」。
 */
type MagicRule = { ext: string[]; bytes: number[]; offset?: number; label: string };

const MAGIC_RULES: MagicRule[] = [
  { ext: [".pdf"], bytes: [0x25, 0x50, 0x44, 0x46], label: "PDF" },                    // %PDF
  { ext: [".png"], bytes: [0x89, 0x50, 0x4e, 0x47], label: "PNG" },
  { ext: [".jpg", ".jpeg"], bytes: [0xff, 0xd8, 0xff], label: "JPEG" },
  { ext: [".gif"], bytes: [0x47, 0x49, 0x46, 0x38], label: "GIF" },                    // GIF8
  { ext: [".bmp"], bytes: [0x42, 0x4d], label: "BMP" },                                // BM
  // WebP: RIFF....WEBP
  { ext: [".webp"], bytes: [0x52, 0x49, 0x46, 0x46], label: "WebP(RIFF)" },
  // OOXML 容器（docx/xlsx/pptx 本质都是 zip）
  // 注意 .zip 本身已不在白名单，这里只保留 Office 新格式
  { ext: [".docx", ".xlsx", ".pptx"], bytes: [0x50, 0x4b, 0x03, 0x04], label: "Office 文档" },
  // 老版 Office：doc / xls / ppt（OLE 复合文档）
  { ext: [".doc", ".xls", ".ppt"], bytes: [0xd0, 0xcf, 0x11, 0xe0], label: "OLE 复合文档" },
  // RAR / 7z
  { ext: [".rar"], bytes: [0x52, 0x61, 0x72, 0x21], label: "RAR" },                    // Rar!
  { ext: [".7z"], bytes: [0x37, 0x7a, 0xbc, 0xaf], label: "7Z" },
];

/** 没有固定魔数的文本类扩展名（只做内容特征检查） */
const TEXT_EXT = new Set([".txt", ".csv", ".md"]);

/**
 * 校验文件内容是否与其扩展名匹配
 * @returns 错误信息，null 表示通过
 */
export function validateMagic(name: string, buffer: Buffer): string | null {
  const ext = path.extname(name).toLowerCase();

  // 纯文本类：拒绝含可执行内容特征的（如 HTML/脚本伪装成 txt）
  if (TEXT_EXT.has(ext)) {
    // 取前 512 字节检查
    const head = buffer.subarray(0, 512).toString("utf8").toLowerCase();
    // 允许 CSV/TXT/MD 含尖括号，但拒绝明显的 HTML/脚本标签
    if (/<script[\s>]|<iframe[\s>]|javascript:|<\?php/.test(head)) {
      return `文件内容包含可执行脚本特征，已拒绝（${ext}）`;
    }
    // 检查是否含 NUL 字节（二进制伪装成文本）
    if (buffer.subarray(0, 512).includes(0x00)) {
      return `文件内容不是文本格式，与扩展名 ${ext} 不符`;
    }
    return null;
  }

  // 二进制类：严格比对魔数
  const rule = MAGIC_RULES.find((r) => r.ext.includes(ext));
  if (!rule) return null; // 白名单里但没定义魔数规则的，放行（保守）

  const off = rule.offset ?? 0;
  for (let i = 0; i < rule.bytes.length; i++) {
    if (buffer[off + i] !== rule.bytes[i]) {
      return `文件内容不是有效的 ${rule.label}（扩展名 ${ext}），可能被篡改过`;
    }
  }
  return null;
}

/**
 * 允许的扩展名（白名单）
 *
 * 设计原则：只放业务真正需要的类型；能有多个入口的尽量堵死。
 *
 * 已移除：
 *   .zip / .rar / .7z —— 压缩包是最高风险类型：
 *     · 可藏任意可执行文件，杀毒软件难以扫描
 *     · 可做成 zip bomb（解压后撑爆磁盘）
 *     · 业务上没有必须用压缩包的场景（合同、验收单都是单文件）
 *   如确有需要（如批量资料），建议单独开一个「归档上传」入口并做病毒扫描。
 *
 * 也明确禁止（未列入即禁止）：
 *   .exe .bat .cmd .sh .ps1 .js .vbs .jar .msi .dll  —— 可执行
 *   .html .htm .svg .xml .jsx                        —— 可承载脚本（存储型 XSS）
 *   .php .jsp .asp .aspx                             —— 服务端脚本
 */
const ALLOWED_EXT = new Set([
  // 文档
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".txt", ".csv", ".md",
  // 图片（不含 svg —— SVG 可内嵌 <script>）
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
]);

export const ALLOWED_EXT_LIST = Array.from(ALLOWED_EXT).join(" ");

/** 分类说明，用于前端提示和错误信息 */
export const ALLOWED_EXT_GROUPS = [
  { label: "文档", exts: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"] },
  { label: "文本", exts: [".txt", ".csv", ".md"] },
  { label: "图片", exts: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"] },
];

/**
 * 危险文件名模式
 * 即使扩展名合法，这些文件名本身也不该接受：
 *   - 双扩展名伪装（a.pdf.exe 会被 extname 取到 .exe，已挡；但 a.exe.pdf 能过）
 *   - 隐藏文件（.htaccess、.env）
 *   - 控制字符 / 保留字符
 */
function checkNameSafety(name: string): string | null {
  const base = path.basename(name);

  // 控制字符与路径分隔符
  if (/[\x00-\x1f<>:"|?*\/\\]/.test(base)) {
    return "文件名包含非法字符";
  }

  // 隐藏文件（.env、.htaccess 等）
  if (base.startsWith(".")) {
    return "不允许上传隐藏文件";
  }

  // 多重扩展名伪装：a.exe.pdf、a.php.jpg
  const parts = base.toLowerCase().split(".");
  if (parts.length > 2) {
    const dangerous = ["exe", "bat", "cmd", "sh", "ps1", "js", "vbs", "jar",
                       "msi", "dll", "scr", "com", "pif", "hta", "php", "jsp", "asp"];
    for (let i = 1; i < parts.length - 1; i++) {
      if (dangerous.includes(parts[i])) {
        return `文件名包含可疑的中间扩展名「.${parts[i]}」`;
      }
    }
  }

  // 超长文件名
  if (base.length > 180) {
    return "文件名过长（超过 180 字符）";
  }

  return null;
}

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 校验扩展名与大小 */
export function validateFile(name: string, size: number): string | null {
  const nameErr = checkNameSafety(name);
  if (nameErr) return nameErr;

  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    const hint = ext ? `「${ext}」` : "无扩展名";
    return `不支持的文件类型${hint}。允许：${ALLOWED_EXT_LIST}`;
  }
  if (size <= 0) return "文件为空";
  if (size > MAX_SIZE) return `文件超过 ${MAX_SIZE / 1024 / 1024}MB 限制`;
  return null;
}

/**
 * 保存文件
 * @param entityType 业务实体类型（用于分目录）
 * @param entityId   业务实体 id
 * @param originalName 原始文件名（仅用于取扩展名）
 */
export function saveFile(
  entityType: string,
  entityId: number,
  originalName: string,
  buffer: Buffer
): { storedName: string; relPath: string; absPath: string } {
  // 目录：uploads/<entityType>/<entityId>/
  const safeType = entityType.replace(/[^a-zA-Z0-9_-]/g, "");
  const dir = path.join(UPLOAD_ROOT, safeType, String(entityId));
  ensureDir(dir);

  const ext = path.extname(originalName).toLowerCase();
  const storedName = crypto.randomUUID() + ext;
  const absPath = path.join(dir, storedName);

  // 防路径穿越：确认最终路径仍在 UPLOAD_ROOT 内
  const rootReal = fs.realpathSync(UPLOAD_ROOT);
  const targetDirReal = fs.realpathSync(dir);
  if (!targetDirReal.startsWith(rootReal)) {
    throw new Error("非法存储路径");
  }

  fs.writeFileSync(absPath, buffer);

  const relPath = path
    .relative(UPLOAD_ROOT, absPath)
    .split(path.sep)
    .join("/");
  return { storedName, relPath, absPath };
}

/** 解析下载路径（严格限制在 UPLOAD_ROOT 内） */
export function resolveFile(relPath: string): string | null {
  // 拒绝绝对路径与 .. 片段
  if (path.isAbsolute(relPath) || relPath.includes("..")) return null;
  const abs = path.join(UPLOAD_ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  const rootReal = fs.realpathSync(UPLOAD_ROOT);
  const absReal = fs.realpathSync(abs);
  if (!absReal.startsWith(rootReal)) return null;
  return absReal;
}

export function deleteFile(relPath: string): boolean {
  const abs = resolveFile(relPath);
  if (!abs) return false;
  try {
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

/** 人类可读大小 */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}
