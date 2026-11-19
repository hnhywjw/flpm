/**
 * CSV 工具（Excel 兼容）
 * - 导出：加 UTF-8 BOM，Excel 双击打开不乱码
 * - 解析：支持引号包裹、转义引号、换行、逗号
 * - 防 CSV 注入：以 = + - @ 开头的单元格前置单引号
 */

const BOM = "\uFEFF";

/** 单元格转义 */
function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // 防公式注入（CSV Injection）
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** 行数组 -> CSV 字符串 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(r.map(esc).join(","));
  return BOM + lines.join("\r\n");
}

/** CSV 字符串 -> 二维数组（正确处理引号与换行） */
export function parseCsv(text: string): string[][] {
  let s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** 构造下载响应 */
export function csvResponse(csv: string, filename: string): Response {
  const encoded = encodeURIComponent(filename);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}
