/**
 * 极简 QR 码生成器（TypeScript，无第三方依赖）
 *
 * 支持：字节模式（UTF-8）、纠错等级 M、版本 1-10（最多约 213 字节）。
 * otpauth:// URI 通常 100-160 字符，版本 7-8 足够。
 *
 * 实现依据 ISO/IEC 18004。只实现生成二维码所需的最小子集：
 *   - 数据编码（Byte mode）
 *   - Reed-Solomon 纠错码
 *   - 模块放置（含 8 种掩码择优）
 *   - 格式信息 / 版本信息
 */

// ---------------- 纠错等级 M 的每块参数表 ----------------
// [总码字数, 数据码字数, 纠错块数]  （版本 1-10，等级 M）
const RS_BLOCK_TABLE: Record<number, [number, number, number]> = {
  1:  [26, 16, 1],
  2:  [44, 28, 1],
  3:  [70, 44, 1],
  4:  [100, 64, 2],
  5:  [134, 86, 2],
  6:  [172, 108, 4],
  7:  [196, 124, 4],
  8:  [242, 154, 4],
  9:  [292, 182, 5],
  10: [346, 216, 5],
};

/** 对齐图案中心坐标（版本 1-10，等级 M 无关） */
const ALIGNMENT_PATTERN_TABLE: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// ---------------- GF(256) 运算 ----------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // 本原多项式 x^8+x^4+x^3+x^2+1
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** 生成 Reed-Solomon 生成多项式 */
function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** 计算纠错码 */
function rsEncode(data: number[], ecCount: number): number[] {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Array(ecCount).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) {
        res[i] ^= gfMul(gen[i + 1], factor);
      }
    }
  }
  return res;
}

// ---------------- 位缓冲 ----------------
class BitBuffer {
  bits: number[] = [];
  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }
  get length() { return this.bits.length; }
}

/** UTF-8 编码（不依赖 TextEncoder，兼容 Edge 和服务端） */
function utf8Bytes(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      // 代理对
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
               0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

/** 选择能容纳数据的最小版本 */
function chooseVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const [total, data, blocks] = RS_BLOCK_TABLE[v];
    // 字节模式：4bit 模式 + 8/16bit 长度 + 数据
    const lenBits = v <= 9 ? 8 : 16;
    const capacityBits = data * 8;
    const needBits = 4 + lenBits + byteLen * 8;
    if (needBits <= capacityBits) return v;
  }
  throw new Error("内容过长，超出二维码版本 10 的容量（约 213 字节）");
}

/** 生成最终码字序列（含纠错、交织） */
function buildCodewords(text: string, version: number): number[] {
  const bytes = utf8Bytes(text);
  const [, dataCodewords, blockCount] = RS_BLOCK_TABLE[version];
  const bb = new BitBuffer();

  // 模式指示符：字节模式 = 0100
  bb.put(4, 4);
  // 字符计数
  const lenBits = version <= 9 ? 8 : 16;
  bb.put(bytes.length, lenBits);
  // 数据
  for (const b of bytes) bb.put(b, 8);

  // 终止符（最多 4 个 0）
  const capacityBits = dataCodewords * 8;
  const term = Math.min(4, capacityBits - bb.length);
  bb.put(0, term);

  // 补齐到字节边界
  while (bb.length % 8 !== 0) bb.bits.push(0);

  // 转成字节
  const data: number[] = [];
  for (let i = 0; i < bb.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bb.bits[i + j];
    data.push(v);
  }

  // 填充字节 0xEC / 0x11 交替
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (data.length < dataCodewords) {
    data.push(padBytes[pi++ % 2]);
  }

  // 分块 + 纠错
  const [totalCodewords] = RS_BLOCK_TABLE[version];
  const ecPerBlock = (totalCodewords - dataCodewords) / blockCount;
  const dataPerBlock = Math.floor(dataCodewords / blockCount);
  const remainder = dataCodewords % blockCount;

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blockCount; i++) {
    const n = dataPerBlock + (i >= blockCount - remainder ? 1 : 0);
    const blk = data.slice(offset, offset + n);
    offset += n;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, ecPerBlock));
  }

  // 交织
  const result: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) result.push(blk[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const blk of ecBlocks) {
      result.push(blk[i]);
    }
  }
  return result;
}

// ---------------- 矩阵构建 ----------------
type Matrix = boolean[][];
type Reserved = boolean[][];

function createMatrix(size: number): { m: Matrix; r: Reserved } {
  const m: Matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const r: Reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  return { m, r };
}

/** 放置定位图案（三个角） */
function placeFinder(m: Matrix, r: Reserved, row: number, col: number) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const rr = row + dr, cc = col + dc;
      if (rr < 0 || rr >= m.length || cc < 0 || cc >= m.length) continue;
      const isBorder = (dr === 0 || dr === 6) && dc >= 0 && dc <= 6;
      const isBorder2 = (dc === 0 || dc === 6) && dr >= 0 && dr <= 6;
      const isCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      m[rr][cc] = isBorder || isBorder2 || isCenter;
      r[rr][cc] = true;
    }
  }
}

/** 放置对齐图案 */
function placeAlignment(m: Matrix, r: Reserved, version: number) {
  const centers = ALIGNMENT_PATTERN_TABLE[version] ?? [];
  for (const row of centers) {
    for (const col of centers) {
      // 跳过与定位图案重叠的位置
      const near = (a: number, b: number) => Math.abs(a - b) <= 2;
      if (near(row, 6) && near(col, 6)) continue;
      if (near(row, 6) && near(col, m.length - 7)) continue;
      if (near(row, m.length - 7) && near(col, 6)) continue;

      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const v = Math.max(Math.abs(dr), Math.abs(dc));
          m[row + dr][col + dc] = v !== 1;
          r[row + dr][col + dc] = true;
        }
      }
    }
  }
}

/** 放置定时图案 */
function placeTiming(m: Matrix, r: Reserved) {
  for (let i = 8; i < m.length - 8; i++) {
    m[6][i] = i % 2 === 0;
    r[6][i] = true;
    m[i][6] = i % 2 === 0;
    r[i][6] = true;
  }
}

/** 保留格式信息区 */
function reserveFormat(r: Reserved, size: number) {
  for (let i = 0; i < 9; i++) {
    if (!r[8][i]) r[8][i] = true;
    if (!r[i][8]) r[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    r[8][size - 1 - i] = true;
    r[size - 1 - i][8] = true;
  }
}

/** 保留暗模块 */
function placeDarkModule(m: Matrix, r: Reserved) {
  const size = m.length;
  m[size - 8][8] = true;
  r[size - 8][8] = true;
}

/**
 * 保留版本信息区（版本 >= 7）
 *
 * ⚠ 必须在 placeData 之前调用
 *
 * 踩过的坑：
 *   原来只在 applyMask 阶段用 writeVersion 写入版本信息，
 *   而 placeData 此时已经把数据位铺满了这两块区域，
 *   导致版本号被覆盖、数据位流整体错位 ——
 *   版本 1-6 没有版本信息区所以正常，版本 7 以上全扫不出来。
 *
 *   对照实验（版本 7 / 8）：
 *     不预留 → 解码失败
 *     先预留 → 解码成功
 *
 * 布局（ISO 18004 §8.10）：两个 6×3 区域，内容互为转置
 *   左下：3 行 × 6 列，行从 size-11 起，列从 0 起
 *   右上：6 行 × 3 列，行从 0 起，列从 size-11 起
 */
function reserveVersion(m: Matrix, r: Reserved, version: number) {
  if (version < 7) return;
  const size = m.length;
  for (let i = 0; i < 18; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    // 左下区块
    r[size - 11 + col][row] = true;
    // 右上区块
    r[row][size - 11 + col] = true;
  }
}

/** 放置数据（之字形） */
function placeData(m: Matrix, r: Reserved, codewords: number[]) {
  const size = m.length;
  const bits: number[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  }

  let idx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    // 跳过第 6 列（竖直定时图案所在列）
    if (col === 6) col--;

    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (r[row][cc]) continue;
        m[row][cc] = idx < bits.length ? bits[idx] === 1 : false;
        idx++;
      }
    }
    upward = !upward;
  }
}

/** 应用掩码 */
function applyMask(m: Matrix, r: Reserved, mask: number): Matrix {
  const size = m.length;
  const out = m.map((row) => row.slice());
  const cond = (row: number, col: number): boolean => {
    switch (mask) {
      case 0: return (row + col) % 2 === 0;
      case 1: return row % 2 === 0;
      case 2: return col % 3 === 0;
      case 3: return (row + col) % 3 === 0;
      case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
      case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
      case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
      case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
      default: return false;
    }
  };
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (r[row][col]) continue;
      if (cond(row, col)) out[row][col] = !out[row][col];
    }
  }
  return out;
}

/** 计算掩码惩罚分 */
function penalty(m: Matrix): number {
  const size = m.length;
  let score = 0;

  // 规则 1：连续同色 >= 5
  for (let i = 0; i < size; i++) {
    let runR = 1, runC = 1;
    for (let j = 1; j < size; j++) {
      if (m[i][j] === m[i][j - 1]) runR++;
      else { if (runR >= 5) score += 3 + (runR - 5); runR = 1; }
      if (m[j][i] === m[j - 1][i]) runC++;
      else { if (runC >= 5) score += 3 + (runC - 5); runC = 1; }
    }
    if (runR >= 5) score += 3 + (runR - 5);
    if (runC >= 5) score += 3 + (runC - 5);
  }

  // 规则 2：2x2 同色块
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // 规则 3：1:1:3:1:1 模式
  const pat = [true, false, true, true, true, false, true];
  const check = (get: (k: number) => boolean) => {
    for (let i = 0; i + 6 < size; i++) {
      let ok = true;
      for (let k = 0; k < 7; k++) if (get(i + k) !== pat[k]) { ok = false; break; }
      if (ok) {
        const before = i >= 4 && [1, 2, 3, 4].every((d) => !get(i - d));
        const after = i + 10 < size && [7, 8, 9, 10].every((d) => !get(i + d));
        if (before || after) score += 40;
      }
    }
  };
  for (let r = 0; r < size; r++) check((k) => m[r][k]);
  for (let c = 0; c < size; c++) check((k) => m[k][c]);

  // 规则 4：深色比例
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const ratio = Math.abs((dark * 100) / (size * size) - 50);
  score += Math.floor(ratio / 5) * 10;

  return score;
}

/**
 * 写入格式信息
 *
 * 15 位格式信息 = 5 位数据(EC 2bit + mask 3bit) + 10 位 BCH 纠错，再与 0x5412 异或。
 * 按 ISO 18004 §8.9 的位置放置，注意 bit 顺序：bit0 是最低位。
 */
function writeFormat(m: Matrix, r: Reserved, mask: number) {
  const size = m.length;
  const EC_M = 0b00; // 纠错等级 M
  const data = (EC_M << 3) | mask;

  // 10 位 BCH
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  // 副本 1：左上（跳过第 6 行/列，那里是定时图案）
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);        // 竖直：bit0-5 → (0,8)..(5,8)
  m[7][8] = bit(6);                                     // (7,8)
  m[8][8] = bit(7);                                     // (8,8)
  m[8][7] = bit(8);                                     // (8,7)
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);    // 水平：bit9-14 → (8,5)..(8,0)

  // 副本 2：右上 + 左下
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);   // 右上：(8, size-1)..
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i); // 左下：(size-7,8)..

  // 固定暗模块（不属于格式信息，但位置相邻）
  m[size - 8][8] = true;
  void r;
}

/**
 * 写入版本信息（版本 >= 7）
 * 18 位 = 6 位版本号 + 12 位 BCH 纠错，放在右上和左下两个 6×3 区域。
 */
function writeVersion(m: Matrix, r: Reserved, version: number) {
  if (version < 7) return;
  const size = m.length;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;

  for (let i = 0; i < 18; i++) {
    const b = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);   // 0..5
    const col = i % 3;               // 0..2
    // 左下：6 行 × 3 列
    m[size - 11 + col][row] = b;
    // 右上：3 行 × 6 列（转置）
    m[row][size - 11 + col] = b;
    r[size - 11 + col][row] = true;
    r[row][size - 11 + col] = true;
  }
}

/** 主函数：文本 → 布尔矩阵（true = 黑） */
export function generateQR(text: string): boolean[][] {
  const version = chooseVersion(utf8Bytes(text).length);
  const size = version * 4 + 17;
  const codewords = buildCodewords(text, version);

  const { m, r } = createMatrix(size);
  placeFinder(m, r, 0, 0);
  placeFinder(m, r, 0, size - 7);
  placeFinder(m, r, size - 7, 0);
  placeAlignment(m, r, version);
  placeTiming(m, r);
  reserveFormat(r, size);
  placeDarkModule(m, r);
  // 版本信息区必须先占位，否则数据会写进去
  reserveVersion(m, r, version);
  placeData(m, r, codewords);

  // 试 8 种掩码，取惩罚分最低的
  let best: Matrix | null = null;
  let bestScore = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const cand = applyMask(m, r, mask);
    writeFormat(cand, r, mask);
    writeVersion(cand, r, version);
    const s = penalty(cand);
    if (s < bestScore) { bestScore = s; best = cand; bestMask = mask; }
  }
  void bestMask;
  return best!;
}

/**
 * 生成 SVG 字符串
 *
 * ⚠ 关键：不要让浏览器对模块做非整数缩放
 *
 * 踩过的坑：
 *   最初按 viewBox="0 0 53 53" + width="168" 输出，
 *   168/53 = 3.17 像素/模块 —— 不是整数，
 *   浏览器会用抗锯齿把模块边缘画得半灰不白，
 *   手机扫码时（尤其 Google Authenticator）经常识别失败。
 *   而直接解码矩阵生成的 PNG 是整数倍，所以测试时"看起来通过"了。
 *
 * 现在的做法：
 *   1. viewBox 直接用「像素」为单位（不用模块数）
 *   2. 每模块固定 scale 像素，保证整数倍
 *   3. 静区（quiet zone）按标准留 4 个模块
 *   4. 只给 width/height 不设具体像素值时，用整数缩放比
 */
export function qrToSvg(text: string, opts?: {
  /** 期望显示尺寸（像素），实际会向下取整到整数倍 */
  size?: number;
  /** 静区宽度（模块数），标准要求 4 */
  margin?: number;
  dark?: string;
  light?: string;
}): string {
  const matrix = generateQR(text);
  const n = matrix.length;
  const margin = opts?.margin ?? 4;   // 标准静区是 4 个模块
  const total = n + margin * 2;

  // 计算整数缩放：每个模块占 scale×scale 像素
  // 默认目标 240px，对 51 模块的版本 8 来说 scale = floor(240/59) = 4 → 实际 236px
  const target = opts?.size ?? 240;
  const scale = Math.max(1, Math.floor(target / total));
  const px = total * scale;

  const dark = opts?.dark ?? "#0f172a";
  const light = opts?.light ?? "#ffffff";

  // 路径用「像素坐标」直接画，避免 viewBox 缩放带来的非整数问题
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) {
        const x = (c + margin) * scale;
        const y = (r + margin) * scale;
        path += `M${x},${y}h${scale}v${scale}h-${scale}z`;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"` +
    ` shape-rendering="crispEdges">` +
    `<rect width="${px}" height="${px}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  );
}
