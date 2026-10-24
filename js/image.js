// 照片：把 iPad 拍的作业照片摆正、缩小、裁剪，转成 JPEG 交给看照片的模型（CONTRACTS 第 7 节）。
// 负责：照片 agent（image.js、tests/image.test.mjs）。
//
// 导出（浏览器里用）
//   prepare(file, { maxSide = 1600, quality = 0.8, maxBytes = 1500000, turns = 0, rect }) -> Promise<Shot>
//                                    按 EXIF 摆正，缩到长边 maxSide，转 JPEG。拍完照第一步调它
//   rotate(blob, quarterTurns, opts) -> Promise<Shot>   顺时针转 quarterTurns 个 90 度（-1 是逆时针转一下）
//   crop(blob, rect, opts) -> Promise<Shot>             rect 是 0 到 1 的比例 { x, y, w, h }，按“摆正以后看到的样子”量；
//                                    opts.turns 可以同时转。想裁得清楚就传原始照片（file），别传已经缩到 1600 的那张
//   thumb(blob, side = 320) -> Promise<dataURL>         小图，列表里用。传 prepare 出来的 blob，别传原始照片（省一次大解码）
//   mask(blob, rects, opts) -> Promise<Shot>            遮名字：把 rects（0 到 1 的比例框，按“转好、裁好以后看到的样子”量）
//                                    涂成实心黑块，画死在像素里再压成 JPEG（EXIF 随重新编码丢掉）。opts 同 prepare（turns、maxSide…），
//                                    所以可以直接传原始照片，一次解码、转向、涂黑、压缩。prepare / rotate / crop 也认 opts.masks
//   Shot = { blob, dataURL, width, height, bytes, type: 'image/jpeg', quality, srcWidth, srcHeight, orientation, format }
//          （带了 masks 时多一个 masked：涂了几块）
//   class ImageError extends Error { code: 'unreadable', stage: 'read' | 'decode' | 'canvas' | 'encode', format }
//                                    照片打不开、画不出来、压缩失败都是 'unreadable'；HEIC 打不开时 format 是 'heic'
//   createImager(env) -> { prepare, rotate, crop, thumb, transform }   换一套 env（假画布、假解码器）就能在 node 里测流程
//   browserEnv(globalThis) -> env    浏览器里的 env（createImageBitmap / <img>、canvas、toBlob、FileReader）
//
// 导出（纯函数，node 能测）
//   fitSize(w, h, maxSide) -> { w, h }           等比缩到长边不超过 maxSide，不放大，取整，至少 1
//   clampRect(rect, { min = 0.02 }) -> rect       收进 0 到 1；反着拖（w、h 是负数）也行；太小的撑到 min
//   rotatedSize(w, h, turns) -> { w, h }          转 turns 个 90 度以后的宽高
//   sourceRect(rect, turns, flip) -> rect         “摆正后看到的”比例框，换算回原始像素方向上的比例框
//   cropBox(w, h, rect) -> { sx, sy, sw, sh }     比例框换成整数像素框（往外取整，至少 1 像素，不出界）
//   orientOps(orientation) -> { flip, turns }     EXIF 方向 1 到 8：先左右镜像（flip），再顺时针转 turns 个 90 度
//   scaleSteps(sw, sh, dw, dh, maxArea) -> [{ w, h }]   逐级减半的中间画布尺寸（不含最后一步）
//   drawMatrix(turns, flip, outW, outH) -> [a, b, c, d, e, f]   最后一步 ctx.setTransform 用的矩阵
//   planTransform(srcW, srcH, { turns, flip, rect, maxSide, maxArea }) -> { box, out, dw, dh, steps, matrix, turns, flip }
//   jpegInfo(bytes) -> { width, height, orientation } | null   读 JPEG 头：SOF 里的宽高、EXIF 方向（没有就是 1）
//   sniffType(bytes) -> 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'bmp' | 'tiff' | 'pdf' | 'unknown'
//   maskBoxes(w, h, rects) -> [{ x, y, w, h }]    遮名字的比例框换成整数像素框：往外取整（宁可多盖一像素），不出界，空框丢掉
//   approxBytes(dataURL) -> number               dataURL 解码后的字节数（不解码，按长度算）
//   nextTry({ quality, maxSide }, bytes, maxBytes) -> { quality, maxSide } | null   太大时下一次怎么压
//   MAX_CANVAS_AREA, DEFAULT_MAX_BYTES, PROBE_JPEG
//
// 为什么这样写
// - iOS Safari 的画布面积上限约 1677 万像素（4096×4096）。超了不报错，画出来是空白、toBlob 给 null。iPad 照片 4032×3024
//   （1219 万）还在线内，但全景、相册里的 4800 万像素照片会超。所以从不按原图大小建画布：解码出来的位图直接画进小画布，
//   每块画布都不超过 MAX_CANVAS_AREA（比上限再留一点余量）。
// - 一次从 4032 缩到 1600，手写的细笔画会发虚、出锯齿。逐级减半（每步最多缩一半）再画到目标大小，字更清楚，
//   模型更容易认对“1”和“7”。中间画布用完马上把宽高设成 0，iOS 对所有画布的总内存也有上限，不等垃圾回收。
// - EXIF 方向：createImageBitmap(file, { imageOrientation: 'from-image' }) 和 <img> 在新浏览器里都会自己摆正，
//   但老一点的 Safari 会忽略。启动后用一张 2×1、方向 6 的小 JPEG（PROBE_JPEG）试一次：解出来是 1×2 说明浏览器会摆正，
//   否则自己按 EXIF 镜像加旋转。每种解码方式只试一次。横着拿 iPad、反着拿 iPad 拍的照片都靠这一步。
// - HEIC：iPad 从“照片”里选图，Safari 一般会自动转成 JPEG（file 输入框的 accept 写 image/*，别单独写 image/heic）；
//   Safari 17 以后也能直接解 HEIC。实在解不开就抛 ImageError('unreadable')，format 是 'heic'，界面让她重拍或换一张。
// - 透明的 PNG 转 JPEG 会变黑底，先铺白底再画。
// - 遮名字（mask）：照片会经中转站发到境外，名字必须在发出去之前从像素里消失。所以黑块画在最后一块画布上、压 JPEG 之前，
//   不是盖一层 CSS；压不到大小重画时黑块跟着重画。黑块用不透明的纯黑，往外取整，JPEG 的 8×8 块在边上也不会透出字来。
// - maxBytes：中转站和 Poe 对请求体积有上限，照片太大时先降质量（到 0.6），再缩边长（到 800）。正常的作业照片
//   1600 长边、质量 0.8 只有两三百 KB，碰不到这条。
// 依赖：无。

export const MAX_CANVAS_AREA = 16000000;     // iOS 上限 16,777,216，留一点余量
export const DEFAULT_MAX_BYTES = 1500000;    // JPEG 本身的字节数；dataURL 再大三分之一
const HEAD_BYTES = 262144;                   // 读文件头 256 KB：EXIF（含缩略图）和 SOF 都在这里面
const DECODE_TIMEOUT_MS = 30000;

// 2×1 像素、EXIF 方向 6 的 JPEG（左黑右白）。会自己摆正的浏览器解出来是 1×2，上黑下白。
// 用 sips 生成，再把 APP1 换成只有一个 Orientation=6 的 EXIF（Chromium 152 实测解出 1×2，像素上黑下白）。
export const PROBE_JPEG = '/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwAGBgYGBgYKBgYKDgoKCg4SDg4ODhIXEhISEhIXHBcXFxcXFxwcHBwcHBwcIiIiIiIiJycnJycsLCwsLCwsLCws/9sAQwEHBwcLCgsTCgoTLh8aHy4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4u/90ABAAB/9oADAMBAAIRAxEAPwD3/wACf8iRoP8A2DbT/wBEpXVVyvgT/kSNB/7Btp/6JSuqoA//2Q==';

export class ImageError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// ---------------------------------------------------------------- 纯函数

const mod4 = t => { const n = Math.round(Number(t)); return Number.isFinite(n) ? ((n % 4) + 4) % 4 : 0; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r9 = v => Math.round(v * 1e9) / 1e9;   // 去掉 0.30000000000000004 这种尾巴，又不影响 2 万像素宽的照片取整
const z = v => v || 0;   // -0 变 0，矩阵和测试里好比较

export function fitSize(w, h, maxSide = Infinity) {
  w = Number(w); h = Number(h);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) throw new RangeError(`图片尺寸不对：${w}×${h}`);
  const m = Number(maxSide) > 0 ? Number(maxSide) : Infinity;
  const long = Math.max(w, h);
  if (long <= m) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const s = m / long;
  const out = { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  if (w >= h) out.w = Math.max(1, Math.floor(m)); else out.h = Math.max(1, Math.floor(m));   // 长边正好是 maxSide
  return out;
}

export function clampRect(rect, { min = 0.02 } = {}) {
  const r = rect || {};
  const num = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const m = clamp(num(min, 0), 0, 1);
  const axis = (a, b) => {
    if (b < a) [a, b] = [b, a];              // 从右下往左上拖
    a = clamp(a, 0, 1); b = clamp(b, 0, 1);
    if (b - a < m) {                          // 太小：以中心撑开到 min，再推回框内
      const c = (a + b) / 2;
      a = c - m / 2; b = c + m / 2;
      if (a < 0) { b -= a; a = 0; }
      if (b > 1) { a -= b - 1; b = 1; }
    }
    return [r9(a), r9(b)];
  };
  const x = num(r.x, 0), y = num(r.y, 0);
  const [x1, x2] = axis(x, x + num(r.w, 1 - x));
  const [y1, y2] = axis(y, y + num(r.h, 1 - y));
  return { x: x1, y: y1, w: r9(x2 - x1), h: r9(y2 - y1) };
}

export function rotatedSize(w, h, turns = 0) {
  return mod4(turns) % 2 ? { w: h, h: w } : { w, h };
}

// 显示出来的图 = 先把原图左右镜像（flip），再顺时针转 turns 个 90 度。这里反过来：先撤销旋转，再撤销镜像。
export function sourceRect(rect, turns = 0, flip = false) {
  const { x, y, w, h } = rect;
  let s;
  switch (mod4(turns)) {
    case 1: s = { x: y, y: 1 - x - w, w: h, h: w }; break;
    case 2: s = { x: 1 - x - w, y: 1 - y - h, w, h }; break;
    case 3: s = { x: 1 - y - h, y: x, w: h, h: w }; break;
    default: s = { x, y, w, h };
  }
  if (flip) s.x = 1 - s.x - s.w;
  return { x: r9(s.x), y: r9(s.y), w: r9(s.w), h: r9(s.h) };
}

export function cropBox(W, H, rect) {
  if (!rect) return { sx: 0, sy: 0, sw: W, sh: H };
  const r = clampRect(rect, { min: 0 });
  const eps = 1e-4;   // 比例乘回像素后的小误差（r9 最多 0.00001 像素），别让 4.99999 取整成 4
  let sx = Math.floor(r.x * W + eps), sy = Math.floor(r.y * H + eps);
  let ex = Math.ceil((r.x + r.w) * W - eps), ey = Math.ceil((r.y + r.h) * H - eps);
  sx = clamp(sx, 0, W - 1); sy = clamp(sy, 0, H - 1);
  ex = clamp(ex, sx + 1, W); ey = clamp(ey, sy + 1, H);
  return { sx, sy, sw: ex - sx, sh: ey - sy };
}

// EXIF 方向 → 先左右镜像，再顺时针转几下。4 = 镜像 + 180 度（上下颠倒），5 = 镜像 + 270 度（转置），7 = 镜像 + 90 度。
const ORIENT = { 1: [false, 0], 2: [true, 0], 3: [false, 2], 4: [true, 2], 5: [true, 3], 6: [false, 1], 7: [true, 1], 8: [false, 3] };
export function orientOps(orientation) {
  const [flip, turns] = ORIENT[orientation] || ORIENT[1];
  return { flip, turns };
}

export function scaleSteps(sw, sh, dw, dh, maxArea = MAX_CANVAS_AREA) {
  const steps = [];
  let w = sw, h = sh;
  for (let guard = 0; guard < 40 && Math.max(w / dw, h / dh) > 2; guard++) {
    let nw = Math.max(dw, Math.ceil(w / 2)), nh = Math.max(dh, Math.ceil(h / 2));
    if (nw * nh > maxArea) {                  // 超大原图：第一块中间画布也不能超过面积上限
      const s = Math.sqrt(maxArea / (nw * nh));
      nw = Math.max(dw, Math.floor(nw * s)); nh = Math.max(dh, Math.floor(nh * s));
    }
    steps.push({ w: nw, h: nh });
    w = nw; h = nh;
  }
  return steps;
}

// canvas 矩阵 [a, b, c, d, e, f]：(x, y) → (a·x + c·y + e, b·x + d·y + f)。
// 最后一步在“没转过”的坐标里画（宽 dw、高 dh），矩阵把它镜像、转到 outW×outH 的画布上。
export function drawMatrix(turns, flip, outW, outH) {
  const t = mod4(turns);
  const dw = t % 2 ? outH : outW;
  const R = [[1, 0, 0, 1, 0, 0], [0, 1, -1, 0, outW, 0], [-1, 0, 0, -1, outW, outH], [0, -1, 1, 0, 0, outH]][t];
  const F = flip ? [-1, 0, 0, 1, dw, 0] : [1, 0, 0, 1, 0, 0];
  const [a1, b1, c1, d1, e1, f1] = R, [a2, b2, c2, d2, e2, f2] = F;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1].map(z);
}

export function planTransform(srcW, srcH, { turns = 0, flip = false, rect = null, maxSide = 1600, maxArea = MAX_CANVAS_AREA } = {}) {
  const t = mod4(turns);
  const box = cropBox(srcW, srcH, rect ? sourceRect(clampRect(rect), t, flip) : null);
  const shown = rotatedSize(box.sw, box.sh, t);
  let out = fitSize(shown.w, shown.h, maxSide);
  if (out.w * out.h > maxArea) {
    const s = Math.sqrt(maxArea / (out.w * out.h));
    out = { w: Math.max(1, Math.floor(out.w * s)), h: Math.max(1, Math.floor(out.h * s)) };
  }
  const d = rotatedSize(out.w, out.h, t);
  return { turns: t, flip: !!flip, box, out, dw: d.w, dh: d.h,
    steps: scaleSteps(box.sw, box.sh, d.w, d.h, maxArea), matrix: drawMatrix(t, flip, out.w, out.h) };
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function jpegInfo(b) {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out = { width: 0, height: 0, orientation: 1 };
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) break;                                 // 对不上标记，别瞎猜
    const m = b[p + 1];
    if (m === 0xff) { p++; continue; }                        // 填充字节
    if (m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m === 0xd9 || m === 0xda) break;                      // 图像结束 / 开始扫描数据
    const len = (b[p + 2] << 8) | b[p + 3];
    if (len < 2) break;
    const seg = p + 4, end = Math.min(p + 2 + len, b.length);
    if (m === 0xe1 && end - seg > 14 && String.fromCharCode(...b.subarray(seg, seg + 6)) === 'Exif\0\0') {
      const o = exifOrientation(b, seg + 6, end);
      if (o) out.orientation = o;
    }
    if (SOF.has(m)) {
      if (seg + 5 <= b.length) { out.height = (b[seg + 1] << 8) | b[seg + 2]; out.width = (b[seg + 3] << 8) | b[seg + 4]; }
      break;
    }
    p += 2 + len;
  }
  return out;
}

function exifOrientation(b, t, limit) {
  if (t + 8 > limit) return 0;
  const le = b[t] === 0x49 && b[t + 1] === 0x49;
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return 0;
  const u16 = i => (i >= 0 && i + 2 <= limit ? (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]) : -1);
  const u32 = i => (i >= 0 && i + 4 <= limit
    ? (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])) >>> 0
    : -1);
  if (u16(t + 2) !== 42) return 0;
  const off = u32(t + 4);
  if (off < 8) return 0;
  const ifd = t + off, n = u16(ifd);
  for (let i = 0; i < n && i < 500; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > limit) break;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 0;
}

const HEIC_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/;
export function sniffType(b) {
  if (!b || b.length < 4) return 'unknown';
  const s = (i, n) => (i + n <= b.length ? String.fromCharCode(...b.subarray(i, i + n)) : '');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
  if (s(0, 4) === 'GIF8') return 'gif';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (s(0, 4) === '%PDF') return 'pdf';
  if (s(4, 4) === 'ftyp') {
    const major = s(8, 4);
    if (/^avi[fs]$/.test(major)) return 'avif';
    if (HEIC_BRANDS.test(major) && !/^m[is]f1$/.test(major)) return 'heic';   // mif1 / msf1 are plain HEIF: the compatible brands decide
    const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    const brands = [];
    for (let i = 16; i + 4 <= Math.min(size, b.length, 96); i += 4) brands.push(s(i, 4));
    if (brands.some(x => /^avi[fs]$/.test(x))) return 'avif';
    if (brands.some(x => HEIC_BRANDS.test(x))) return 'heic';
    return 'unknown';                                         // mp4、mov 这类视频
  }
  if (s(0, 2) === 'BM') return 'bmp';
  if (s(0, 4) === 'II*\0' || s(0, 4) === 'MM\0*') return 'tiff';
  return 'unknown';
}

export const MASK_COLOR = '#000';

export function maskBoxes(W, H, rects) {
  const out = [];
  if (!(W > 0) || !(H > 0)) return out;
  for (const rect of Array.isArray(rects) ? rects : rects ? [rects] : []) {
    if (!rect || typeof rect !== 'object') continue;
    const n = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? NaN : Number(v));
    let x = n(rect.x), y = n(rect.y), w = n(rect.w), h = n(rect.h);
    if ([x, y, w, h].some(Number.isNaN)) continue;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    if (!(w > 0) || !(h > 0)) continue;                       // 高度是 0 的黑条：没东西要盖
    const eps = 1e-6;
    const x0 = clamp(Math.floor(x * W + eps), 0, W), y0 = clamp(Math.floor(y * H + eps), 0, H);
    const x1 = clamp(Math.ceil((x + w) * W - eps), 0, W), y1 = clamp(Math.ceil((y + h) * H - eps), 0, H);
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return out;
}

export function approxBytes(dataURL) {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:')) return 0;
  const comma = dataURL.indexOf(',');
  if (comma < 0) return 0;
  const meta = dataURL.slice(5, comma), body = dataURL.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    let len = body.length, pad = 0;
    if (/\s/.test(body)) len = body.replace(/\s+/g, '').length;
    const tail = body.trimEnd();
    if (tail.endsWith('==')) pad = 2; else if (tail.endsWith('=')) pad = 1;
    return Math.max(0, Math.floor((len * 3) / 4) - pad);
  }
  // 百分号编码：每个 %XX 是 1 字节，其余字符按 UTF-8 算
  return new TextEncoder().encode(body.replace(/%[0-9a-f]{2}/gi, '\x01')).length;
}

export function nextTry({ quality, maxSide }, bytes, maxBytes) {
  if (!(maxBytes > 0) || !(bytes > maxBytes)) return null;
  if (quality > 0.6 + 1e-9) return { quality: Math.round(Math.max(0.6, quality - 0.1) * 100) / 100, maxSide };
  if (maxSide > 800) return { quality, maxSide: Math.max(800, Math.round(maxSide * 0.8)) };
  return null;                                                // 已经很小了，就用这一张
}

// ---------------------------------------------------------------- 浏览器 env

function readAs(g, blob, how) {
  return new Promise((resolve, reject) => {
    const r = new g.FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('read failed'));
    r[how](blob);
  });
}

function loadImg(g, blob) {
  return new Promise((resolve, reject) => {
    if (typeof g.Image !== 'function' || !g.URL || !g.URL.createObjectURL) { reject(new Error('no <img> here')); return; }
    const url = g.URL.createObjectURL(blob);
    const img = new g.Image();
    img.decoding = 'async';
    img.onload = () => {
      img.onload = img.onerror = null;
      if (!img.naturalWidth || !img.naturalHeight) { g.URL.revokeObjectURL(url); reject(new Error('image is empty')); return; }
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, via: 'img',
        close() { g.URL.revokeObjectURL(url); } });
    };
    img.onerror = () => { img.onload = img.onerror = null; g.URL.revokeObjectURL(url); reject(new Error('<img> could not decode it')); };
    img.src = url;
  });
}

async function decodeVia(g, blob, via) {
  if (via === 'img') return loadImg(g, blob);
  const b = via === 'bitmap' ? await g.createImageBitmap(blob, { imageOrientation: 'from-image' }) : await g.createImageBitmap(blob);
  return { source: b, width: b.width, height: b.height, via, close() { if (b.close) b.close(); } };
}

export function browserEnv(g = globalThis) {
  const probes = {};
  return {
    timeoutMs: DECODE_TIMEOUT_MS,
    async head(blob, n) {
      const part = blob.slice(0, n);
      const buf = typeof part.arrayBuffer === 'function' ? await part.arrayBuffer() : await readAs(g, part, 'readAsArrayBuffer');
      return new Uint8Array(buf);
    },
    // 先 <img>：WebKit 画 <img> 时总按 EXIF 摆正；Safari 的 createImageBitmap 从 Blob 解码有不摆正的 bug（调研 05 B2）。
    // <img> 解不开再试 createImageBitmap（带 from-image，老浏览器不认这个选项会抛 TypeError，就不带选项再试）。
    // 不管哪条路，autoOrients 的小图探针都会再确认一次方向。
    async decode(blob) {
      let last = null;
      if (typeof g.Image === 'function') {
        try { return await decodeVia(g, blob, 'img'); } catch (e) { last = e; }
      }
      if (typeof g.createImageBitmap === 'function') {
        try { return await decodeVia(g, blob, 'bitmap'); } catch (e) {
          last = e;
          if (e && e.name === 'TypeError') { try { return await decodeVia(g, blob, 'bitmap-plain'); } catch (e2) { last = e2; } }
        }
      }
      throw last || new Error('no decoder here');
    },
    // 这种解码方式会不会自己按 EXIF 摆正。试不出来就当会（新浏览器都会），免得转两次。
    autoOrients(via) {
      if (!probes[via]) {
        probes[via] = (async () => {
          const bytes = Uint8Array.from(g.atob(PROBE_JPEG), c => c.charCodeAt(0));
          const d = await decodeVia(g, new g.Blob([bytes], { type: 'image/jpeg' }), via);
          const ok = d.width === 1 && d.height === 2;
          d.close();
          return ok;
        })().catch(() => true);
      }
      return probes[via];
    },
    canvas(w, h) {
      let c;
      if (g.document && g.document.createElement) c = g.document.createElement('canvas');
      else if (typeof g.OffscreenCanvas === 'function') c = new g.OffscreenCanvas(w, h);
      else throw new Error('no canvas here');
      c.width = w; c.height = h;
      return c;
    },
    encode(c, type, quality) {
      try {
        if (typeof c.toBlob === 'function') return new Promise(resolve => c.toBlob(resolve, type, quality));
        if (typeof c.convertToBlob === 'function') return c.convertToBlob({ type, quality }).catch(() => null);
      } catch { /* 画布被污染或内存不够：当作压缩失败 */ }
      return Promise.resolve(null);
    },
    toDataURL(blob) { return readAs(g, blob, 'readAsDataURL'); },
  };
}

// ---------------------------------------------------------------- 流程

function release(c) {
  if (!c) return;
  try { c.width = 0; c.height = 0; } catch { /* OffscreenCanvas 转移以后改不了，不要紧 */ }
}

function ctx2d(c) {
  const g = c.getContext('2d');
  if (!g) throw new ImageError('unreadable', '画布建不出来，可能是内存不够。关掉别的 App 再试。', { stage: 'canvas' });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return g;
}

function withTimeout(p, ms) {
  if (!(ms > 0)) return p;
  return new Promise((resolve, reject) => {
    let late = false;
    const timer = setTimeout(() => { late = true; reject(new Error('decode timeout')); }, ms);
    p.then(v => {
      if (late) { try { if (v && v.close) v.close(); } catch { /* 已经超时了，释放就行 */ } return; }
      clearTimeout(timer); resolve(v);
    }, e => { if (!late) { clearTimeout(timer); reject(e); } });
  });
}

function decodeMessage(format) {
  if (format === 'heic' || format === 'avif') return `照片是 ${format.toUpperCase()} 格式，这个浏览器打不开。从“照片”里重新选一次，或者直接拍一张。`;
  if (format === 'pdf') return '这是 PDF，不是照片。截个图或者拍一张再试。';
  if (format === 'unknown') return '这个文件不是能打开的照片。';
  return `照片打不开（${format.toUpperCase()}），可能文件坏了或者太大。`;
}

export function createImager(env) {
  // 画一遍：原图里的 box → 逐级减半的中间画布 → 最后一块画布（铺白底、镜像、旋转）
  // boxes：遮名字的黑块（输出画布的像素框），画在照片上面、压 JPEG 之前
  function render(decoded, plan, boxes = []) {
    let src = decoded.source, { sx, sy, sw, sh } = plan.box, prev = null;
    try {
      for (const s of plan.steps) {
        const c = env.canvas(s.w, s.h);
        try { ctx2d(c).drawImage(src, sx, sy, sw, sh, 0, 0, s.w, s.h); } catch (e) { release(c); throw e; }
        release(prev);
        prev = c; src = c; sx = 0; sy = 0; sw = s.w; sh = s.h;
      }
      const out = env.canvas(plan.out.w, plan.out.h);
      try {
        const g = ctx2d(out);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, plan.out.w, plan.out.h);
        g.setTransform(...plan.matrix);
        g.drawImage(src, sx, sy, sw, sh, 0, 0, plan.dw, plan.dh);
        if (boxes.length) {
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.fillStyle = MASK_COLOR;
          for (const b of boxes) g.fillRect(b.x, b.y, b.w, b.h);
        }
      } catch (e) { release(out); throw e; }
      return out;
    } finally { release(prev); }
  }

  async function transform(input, { turns = 0, rect = null, maxSide = 1600, quality = 0.8, maxBytes = DEFAULT_MAX_BYTES, masks = null } = {}) {
    if (!input || typeof input.size !== 'number' || input.size <= 0) {
      throw new ImageError('unreadable', '没有选到照片，或者文件是空的。', { stage: 'read', format: 'unknown' });
    }
    let head;
    try { head = await env.head(input, HEAD_BYTES); } catch (e) {
      throw new ImageError('unreadable', '照片读不出来。', { stage: 'read', format: 'unknown', cause: e });
    }
    const format = sniffType(head);
    let decoded;
    try {
      decoded = await withTimeout(Promise.resolve().then(() => env.decode(input)), env.timeoutMs);
      if (!decoded || !(decoded.width > 0) || !(decoded.height > 0)) throw new Error('decoded to nothing');
    } catch (e) {
      throw new ImageError('unreadable', decodeMessage(format), { stage: 'decode', format, cause: e });
    }

    let canvas = null;
    try {
      let orientation = 1, flip = false, exifTurns = 0;
      if (format === 'jpeg') {
        orientation = (jpegInfo(head) || {}).orientation || 1;
        if (orientation !== 1 && !(await env.autoOrients(decoded.via))) ({ flip, turns: exifTurns } = orientOps(orientation));
      }
      let q = quality, side = maxSide, drawnSide = null, plan = null, boxes = [];
      for (let n = 0; n < 12; n++) {
        if (drawnSide !== side) {
          release(canvas); canvas = null;
          plan = planTransform(decoded.width, decoded.height, { turns: exifTurns + turns, flip, rect, maxSide: side });
          boxes = masks ? maskBoxes(plan.out.w, plan.out.h, masks) : [];
          try { canvas = render(decoded, plan, boxes); } catch (e) {
            if (e instanceof ImageError) throw e;
            throw new ImageError('unreadable', '画不出这张照片，可能是内存不够。关掉别的 App 再试。', { stage: 'canvas', format, cause: e });
          }
          drawnSide = side;
        }
        let blob = null;
        try { blob = await env.encode(canvas, 'image/jpeg', q); } catch { blob = null; }
        if (!blob || !blob.size) throw new ImageError('unreadable', '照片压缩失败，可能是内存不够。关掉别的 App 再试。', { stage: 'encode', format });
        const next = nextTry({ quality: q, maxSide: side }, blob.size, maxBytes);
        if (!next) {
          release(canvas); canvas = null;
          const dataURL = await env.toDataURL(blob);
          return { blob, dataURL, width: plan.out.w, height: plan.out.h, bytes: blob.size, type: 'image/jpeg', quality: q,
            srcWidth: decoded.width, srcHeight: decoded.height, orientation, format, ...(masks ? { masked: boxes.length } : {}) };
        }
        q = next.quality; side = next.maxSide;
      }
      throw new ImageError('unreadable', '照片压不到能发出去的大小。', { stage: 'encode', format });
    } finally {
      release(canvas);
      try { if (decoded.close) decoded.close(); } catch { /* 释放失败不影响结果 */ }
    }
  }

  return {
    transform,
    prepare: (file, opts = {}) => transform(file, opts),
    rotate: (blob, quarterTurns = 1, opts = {}) => transform(blob, { ...opts, turns: (Number(opts.turns) || 0) + (Number(quarterTurns) || 0) }),
    crop: (blob, rect, opts = {}) => transform(blob, { ...opts, rect: clampRect(rect) }),
    thumb: async (blob, side = 320) => (await transform(blob, { maxSide: side, quality: 0.7, maxBytes: 0 })).dataURL,
    mask: (blob, rects, opts = {}) => transform(blob, { ...opts, masks: Array.isArray(rects) ? rects : rects ? [rects] : [] }),
  };
}

// 页面里直接 import { prepare } 用；第一次调用时才碰浏览器的全局对象，所以 node 里 import 这个文件不会出错。
let shared = null;
const imager = () => (shared || (shared = createImager(browserEnv())));
export const prepare = (file, opts) => imager().prepare(file, opts);
export const rotate = (blob, quarterTurns, opts) => imager().rotate(blob, quarterTurns, opts);
export const crop = (blob, rect, opts) => imager().crop(blob, rect, opts);
export const thumb = (blob, side) => imager().thumb(blob, side);
export const mask = (blob, rects, opts) => imager().mask(blob, rects, opts);
