// 画给她看（v0.11，Wei 11-02：“看到不太懂的就想放弃，首要原则是把她讲懂；能出图、能互动的最好”）。
// 老师（讲题的诊断、聊天）写一个小小的图形说明 {type, ...}，这里画成能一步步点、能拖的图。图是程序画的，
// 数和位置都准；模型只说要画什么。七上用得到的六种：
//
//   numberline  数轴：点、跳一跳（加减法一步一步走）、两点距离（绝对值）；drag 时能拖一个点，看它的相反数和绝对值
//               { min, max, points: [{ x, label }], jumps: [{ from, to, label }], dist: [{ a, b, label }], drag }
//   line        直线上的点和线段长（几何、行程）；cases 是分类讨论的几种位置，点按钮切换
//               { kind: 'line'|'segment'|'ray', points: [{ name, x }], marks: [{ from, to, label }], cases: [{ title, points, marks }] }
//   bars        线段图（应用题）：一行一个量，每段按长短画，total 是整行的总数
//               { bars: [{ label, parts: [{ len, label }], total }] }
//   balance     天平（解方程、等式的性质）：两边同时做一样的事，一步一步
//               { left, right, steps: [{ do, left, right }] }
//   tiles       同类项分组（合并同类项、去括号以后整理）：先按颜色归队，再合并
//               { terms: ['3a', '-2b', ...], result }
//   angle       角（余角、补角、角的和差）；drag 时能拖着改度数
//               { deg, name, show: ''|'complement'|'supplement', drag }
//   compare     两个看着像的式子左右对照（−3² 和 (−3)²），一行一行一起点开
//               { left: { title, lines }, right: { title, lines } }
// 每种都可以有 caption（图下面一句话）。
//
// 导出（纯函数，node 测试用，模块顶层不碰 document）
//   normalizeVisual(raw) -> spec | null    模型写的说明规整一遍：类型不认识、数不对、画不出来的给 null（就不画）
//   framesOf(spec) -> n                    一共几步（1 = 不用点）
//   drawVisual(spec, { frame, pick, value }) -> HTML 字符串   第 frame 步（0 开始）、第 pick 种情况、拖到的 value
//   termKey(term) / termCoef(term)         同类项：字母部分（'a^2b'）、系数（数，读不出是 null）
//   VISUAL_TYPES
//   mountVisual(spec) -> HTMLElement       画进页面：上一步 / 下一步、情况切换、拖动（只在浏览器里调）
import { renderText, plain } from './mathview.js';

export const VISUAL_TYPES = ['numberline', 'line', 'bars', 'balance', 'tiles', 'angle', 'compare'];

const str = v => (v === null || v === undefined ? '' : String(v)).trim();
const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = str(v).replace(/[−–]/g, '-').replace(/\s/g, '');
  if (!s) return null;
  const f = s.match(/^(-?)(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (f) return (f[1] ? -1 : 1) * Number(f[2]) / Number(f[3]);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const arr = v => (Array.isArray(v) ? v : []);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const txt = s => esc(plain(str(s)));          // SVG 里的字：公式变成读得懂的字（−3²、1/2）
const fmt = n => {                              // 数轴上的数：整数照写，小数最多两位，负号用 −
  if (n === null || n === undefined) return '';
  const r = Math.round(n * 100) / 100;
  return (r < 0 ? '−' : '') + String(Math.abs(r));
};
const R = n => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- 规整

function normNumberline(r) {
  const points = arr(r.points).map(p => ({ x: num(p && p.x), label: str(p && p.label) })).filter(p => p.x !== null).slice(0, 6);
  const jumps = arr(r.jumps).map(j => ({ from: num(j && j.from), to: num(j && j.to), label: str(j && j.label) }))
    .filter(j => j.from !== null && j.to !== null && j.from !== j.to).slice(0, 6);
  const dist = arr(r.dist).map(d => ({ a: num(d && d.a), b: num(d && d.b), label: str(d && d.label) }))
    .filter(d => d.a !== null && d.b !== null && d.a !== d.b).slice(0, 3);
  const all = [...points.map(p => p.x), ...jumps.flatMap(j => [j.from, j.to]), ...dist.flatMap(d => [d.a, d.b]), 0];
  let min = num(r.min), max = num(r.max);
  const lo = Math.min(...all), hi = Math.max(...all);
  if (min === null || min > lo) min = Math.floor(lo) - 1;
  if (max === null || max < hi) max = Math.ceil(hi) + 1;
  min = Math.floor(min); max = Math.ceil(max);
  if (max - min < 4) { const pad = Math.ceil((4 - (max - min)) / 2); min -= pad; max += pad; }
  if (max - min > 40) return null;             // 太宽，刻度挤成一团，不如不画
  if (!points.length && !jumps.length && !dist.length && !r.drag) return null;
  const drag = r.drag ? { x: num(r.drag.x ?? r.drag) ?? (points[0] ? points[0].x : Math.round((min + max) / 2)), label: str(r.drag.label) || 'P' } : null;
  if (drag) drag.x = Math.max(min, Math.min(max, Math.round(drag.x)));
  return { type: 'numberline', min, max, points, jumps, dist, drag };
}

function normLineSet(r) {
  const points = arr(r && r.points).map(p => ({ name: str(p && (p.name ?? p.label)), x: num(p && p.x) }))
    .filter(p => p.name && p.x !== null).slice(0, 7);
  const names = new Set(points.map(p => p.name));
  const marks = arr(r && r.marks).map(m => ({ from: str(m && m.from), to: str(m && m.to), label: str(m && m.label) }))
    .filter(m => names.has(m.from) && names.has(m.to) && m.from !== m.to).slice(0, 5);
  return { title: str(r && r.title), points, marks };
}
function normLine(r) {
  const kind = ['line', 'segment', 'ray'].includes(r.kind) ? r.kind : 'line';
  const base = normLineSet(r);
  const cases = arr(r.cases).map(normLineSet).filter(c => c.points.length >= 2).slice(0, 4);
  cases.forEach((c, i) => { if (!c.title) c.title = `情况 ${i + 1}`; });
  if (base.points.length < 2 && !cases.length) return null;
  return { type: 'line', kind, points: base.points, marks: base.marks, cases };
}

function normBars(r) {
  const bars = arr(r.bars).map(b => ({
    label: str(b && b.label),
    parts: arr(b && b.parts).map(p => ({ len: num(p && p.len), label: str(p && p.label), unknown: !!(p && p.unknown) }))
      .filter(p => p.len !== null && p.len > 0).slice(0, 6),
    total: str(b && b.total),
  })).filter(b => b.parts.length).slice(0, 5);
  return bars.length ? { type: 'bars', bars } : null;
}

function normBalance(r) {
  const left = str(r.left), right = str(r.right);
  if (!left || !right) return null;
  const steps = arr(r.steps).map(s => ({ do: str(s && s.do), left: str(s && s.left), right: str(s && s.right) }))
    .filter(s => s.left && s.right).slice(0, 6);
  return { type: 'balance', left, right, steps };
}

function normTiles(r) {
  const terms = arr(r.terms).map(str).filter(Boolean).slice(0, 10);
  return terms.length >= 2 ? { type: 'tiles', terms, result: str(r.result) } : null;
}

function normAngle(r) {
  const deg = num(r.deg);
  if (deg === null || deg <= 0 || deg >= 180) return null;
  const show = ['complement', 'supplement'].includes(r.show) ? r.show : '';
  if (show === 'complement' && deg >= 90) return null;
  return { type: 'angle', deg: Math.round(deg), name: str(r.name) || '∠AOB', show, drag: !!r.drag };
}

function normCompare(r) {
  const side = s => ({ title: str(s && s.title), lines: arr(s && s.lines).map(str).filter(Boolean).slice(0, 6) });
  const left = side(r.left), right = side(r.right);
  if (!left.title || !right.title) return null;
  return { type: 'compare', left, right };
}

const NORM = { numberline: normNumberline, line: normLine, bars: normBars, balance: normBalance, tiles: normTiles, angle: normAngle, compare: normCompare };

export function normalizeVisual(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = str(raw.type).toLowerCase();
  if (!NORM[type]) return null;
  let spec = null;
  try { spec = NORM[type](raw); } catch { spec = null; }
  if (!spec) return null;
  spec.caption = str(raw.caption);
  return spec;
}

export function framesOf(spec) {
  if (!spec) return 1;
  switch (spec.type) {
    case 'numberline': return 1 + spec.jumps.length;
    case 'bars': return spec.bars.length;
    case 'balance': return 1 + spec.steps.length;
    case 'tiles': return 3;
    case 'compare': return Math.max(1, spec.left.lines.length, spec.right.lines.length) + 1;
    default: return 1;
  }
}

// ---------------------------------------------------------------- 同类项

// 字母部分：'3a^2b' -> 'a^2b'，'-x' -> 'x'，'5' -> ''（常数项一队）
export function termKey(term) {
  const s = plain(str(term)).replace(/[−–]/g, '-').replace(/\s/g, '').replace(/^[+-]/, '').replace(/²/g, '^2').replace(/³/g, '^3');
  const body = s.replace(/^[\d.\/]+/, '');
  const letters = [...body.matchAll(/([a-zA-Z])(?:\^(\d+))?/g)].map(m => [m[1], m[2] && m[2] !== '1' ? m[2] : '']);
  letters.sort((a, b) => a[0].localeCompare(b[0]));
  return letters.map(([l, e]) => l + (e ? '^' + e : '')).join('');
}
export function termCoef(term) {
  const s = plain(str(term)).replace(/[−–]/g, '-').replace(/\s/g, '');
  const m = s.match(/^([+-]?)(\d+(?:\.\d+)?(?:\/\d+)?)?/);
  const sign = m && m[1] === '-' ? -1 : 1;
  if (!m || !m[2]) return /^[+-]?[a-zA-Z]/.test(s) ? sign : null;
  const v = num(m[2]);
  return v === null ? null : sign * v;
}
const coefTerm = (c, key) => {
  if (c === 0) return '0';
  const a = Math.abs(c), sign = c < 0 ? '−' : '';
  const k = key.replace(/\^(\d)/g, (_, d) => ({ 2: '²', 3: '³' }[d] || '^' + d));
  if (!key) return sign + fmt(a);
  return sign + (a === 1 ? '' : fmt(a)) + k;
};

// ---------------------------------------------------------------- 画

const W = 640;

function svg(h, body, label) {
  return `<svg class="vz-svg" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">`
    + `<defs><marker id="vz-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="vz-ahead"/></marker></defs>`
    + body + '</svg>';
}

const jumpH = (s, j) => Math.min(70, 24 + Math.abs(j.to - j.from) * (W - 72) / (s.max - s.min) * 0.28);
function drawNumberline(s, { frame = 0, value } = {}) {
  const pad = 36;
  // 上面留的地方：最高的那一跳要多高留多高（没跳就只留点的名字）
  const y = R(Math.max(s.drag ? 64 : 40, ...s.jumps.map(j => jumpH(s, j) + 34)));
  const X = x => R(pad + (x - s.min) * (W - 2 * pad) / (s.max - s.min));
  const span = s.max - s.min;
  const every = span > 24 ? 5 : span > 14 ? 2 : 1;
  let b = `<line class="vz-axis" x1="${pad - 16}" y1="${y}" x2="${W - pad + 18}" y2="${y}" marker-end="url(#vz-ah)"/>`;
  for (let k = s.min; k <= s.max; k++) {
    const zero = k === 0;
    b += `<line class="vz-tick${zero ? ' zero' : ''}" x1="${X(k)}" y1="${y - (zero ? 9 : 6)}" x2="${X(k)}" y2="${y + (zero ? 9 : 6)}"/>`;
    if (k % every === 0 || zero) b += `<text class="vz-num${zero ? ' zero' : ''}" x="${X(k)}" y="${y + 28}" text-anchor="middle">${fmt(k)}</text>`;
  }
  // 两点距离：数轴下面的括号
  s.dist.forEach((d, i) => {
    const a = X(Math.min(d.a, d.b)), c = X(Math.max(d.a, d.b)), yy = y + 46 + i * 26;
    b += `<path class="vz-brace" d="M${a},${yy - 8} V${yy} H${c} V${yy - 8}"/>`;
    if (d.label) b += `<text class="vz-lab hl" x="${R((a + c) / 2)}" y="${yy + 18}" text-anchor="middle">${txt(d.label)}</text>`;
  });
  // 跳一跳：一步一个弧，点到第几步画到第几步
  s.jumps.slice(0, frame).forEach((j, i) => {
    const a = X(j.from), c = X(j.to), hgt = jumpH(s, j);
    const cur = i === frame - 1;
    b += `<path class="vz-jump${cur ? ' cur' : ''}" d="M${a},${y - 4} Q${R((a + c) / 2)},${R(y - 4 - hgt * 2)} ${c},${y - 4}" marker-end="url(#vz-ah)"/>`;
    if (j.label) b += `<text class="vz-lab${cur ? ' hl' : ''}" x="${R((a + c) / 2)}" y="${R(y - 10 - hgt)}" text-anchor="middle">${txt(j.label)}</text>`;
    b += `<circle class="vz-dot small" cx="${c}" cy="${y}" r="4.5"/>`;
  });
  s.points.forEach(p => {
    b += `<circle class="vz-dot" cx="${X(p.x)}" cy="${y}" r="7"/>`;
    if (p.label) b += `<text class="vz-name" x="${X(p.x)}" y="${y - 16}" text-anchor="middle">${txt(p.label)}</text>`;
  });
  if (s.drag) {
    const v = Number.isFinite(value) ? value : s.drag.x;
    b += `<line class="vz-mirror" x1="${X(-v)}" y1="${y - 14}" x2="${X(-v)}" y2="${y + 14}"/>`;
    b += `<circle class="vz-ghost" cx="${X(-v)}" cy="${y}" r="7"/>`;
    b += `<path class="vz-brace soft" d="M${X(0)},${y - 22} V${y - 30} H${X(v)} V${y - 22}"/>`;
    b += `<circle class="vz-dot drag" cx="${X(v)}" cy="${y}" r="11" data-drag="1"/>`;
    b += `<text class="vz-name" x="${X(v)}" y="${y - 38}" text-anchor="middle">${txt(s.drag.label)}</text>`;
  }
  const hgt = y + 50 + s.dist.length * 26;
  return svg(hgt, b, '数轴');
}

function lineSetOf(s, pick) {
  if (s.cases.length) {
    const c = s.cases[Math.max(0, Math.min(s.cases.length - 1, pick || 0))];
    return { points: c.points, marks: c.marks };
  }
  return { points: s.points, marks: s.marks };
}
function drawLine(s, { pick = 0 } = {}) {
  const { points, marks } = lineSetOf(s, pick);
  // 所有情况用同一把尺子，切换时点不乱跳
  const xs = [...s.points, ...s.cases.flatMap(c => c.points)].map(p => p.x);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const pad = 60, y = 96;
  const X = x => R(hi === lo ? W / 2 : pad + (x - lo) * (W - 2 * pad) / (hi - lo));
  const at = Object.fromEntries(points.map(p => [p.name, p.x]));
  const l = Math.min(...points.map(p => X(p.x))), r = Math.max(...points.map(p => X(p.x)));
  let b = '';
  if (s.kind === 'segment') b += `<line class="vz-axis" x1="${l}" y1="${y}" x2="${r}" y2="${y}"/>`;
  else if (s.kind === 'ray') b += `<line class="vz-axis" x1="${l}" y1="${y}" x2="${W - 14}" y2="${y}" marker-end="url(#vz-ah)"/>`;
  else b += `<line class="vz-axis" x1="14" y1="${y}" x2="${W - 14}" y2="${y}" marker-start="url(#vz-ah)" marker-end="url(#vz-ah)"/>`;
  // 线段长：在线上面一层一层标，短的在下
  const ms = marks.map(m => ({ ...m, a: X(Math.min(at[m.from], at[m.to])), c: X(Math.max(at[m.from], at[m.to])) }))
    .sort((p, q) => (p.c - p.a) - (q.c - q.a));
  ms.forEach((m, i) => {
    const yy = y - 30 - i * 30;
    b += `<path class="vz-brace" d="M${m.a},${yy + 8} V${yy} H${m.c} V${yy + 8}"/>`;
    if (m.label) b += `<text class="vz-lab hl" x="${R((m.a + m.c) / 2)}" y="${yy - 6}" text-anchor="middle">${txt(m.label)}</text>`;
  });
  points.forEach(p => {
    b += `<circle class="vz-dot" cx="${X(p.x)}" cy="${y}" r="5.5"/>`;
    b += `<text class="vz-name" x="${X(p.x)}" y="${y + 26}" text-anchor="middle">${txt(p.name)}</text>`;
  });
  const top = Math.max(0, ms.length * 30 + 4 - 66);
  return svg(130 + top, `<g transform="translate(0,${top})">${b}</g>`, '直线上的点');
}

function drawBars(s, { frame = 0 } = {}) {
  const max = Math.max(...s.bars.map(b => b.parts.reduce((a, p) => a + p.len, 0)));
  const left = 84, right = 100, unit = (W - left - right) / max, rowH = 62;
  let b = '';
  s.bars.forEach((bar, i) => {
    const y = 18 + i * rowH, shown = i <= frame;
    b += `<g class="vz-row${shown ? '' : ' later'}">`;
    b += `<text class="vz-name" x="${left - 12}" y="${y + 22}" text-anchor="end">${txt(bar.label)}</text>`;
    let x = left;
    bar.parts.forEach((p, k) => {
      const w = R(p.len * unit);
      b += `<rect class="vz-part p${k % 4}${p.unknown ? ' unknown' : ''}" x="${R(x)}" y="${y}" width="${w}" height="32" rx="3"/>`;
      if (p.label) b += `<text class="vz-lab in" x="${R(x + w / 2)}" y="${y + 21}" text-anchor="middle">${txt(p.label)}</text>`;
      x += w;
    });
    if (bar.total) b += `<text class="vz-lab hl" x="${R(x + 10)}" y="${y + 21}">${txt(bar.total)}</text>`;
    b += '</g>';
  });
  return svg(24 + s.bars.length * rowH, b, '线段图');
}

function drawBalance(s, { frame = 0 } = {}) {
  const st = frame > 0 ? s.steps[frame - 1] : null;
  const left = st ? st.left : s.left, right = st ? st.right : s.right;
  const chain = [`${s.left} = ${s.right}`, ...s.steps.slice(0, frame).map(x => `${x.left} = ${x.right}`)];
  const pan = cx => `<path class="vz-pan" d="M${cx},24 L${cx - 92},104 M${cx},24 L${cx + 92},104"/>`
    + `<path class="vz-pan-base" d="M${cx - 104},104 Q${cx},134 ${cx + 104},104"/>`;
  const scale = svg(160,
    `<path class="vz-stand" d="M320,24 L296,156 H344 Z"/>`
    + pan(140) + pan(500)
    + `<line class="vz-beam" x1="140" y1="24" x2="500" y2="24"/>`
    + `<circle class="vz-pivot" cx="320" cy="24" r="7"/>`,
    '天平');
  return `<div class="vz-balance">`
    + (st && st.do ? `<p class="vz-do">两边同时：${renderText(st.do)}</p>` : `<p class="vz-do muted">天平两边一样重，就是等号两边相等</p>`)
    + `<div class="vz-scale">${scale}<div class="vz-pan-t l" data-k="${frame}">${renderText(`\\(${left}\\)`)}</div><div class="vz-pan-t r" data-k="${frame}">${renderText(`\\(${right}\\)`)}</div></div>`
    + `<ol class="vz-chain">${chain.map((c, i) => `<li class="${i === chain.length - 1 ? 'cur' : ''}">${renderText(`\\(${c}\\)`)}</li>`).join('')}</ol>`
    + '</div>';
}

function drawTiles(s, { frame = 0 } = {}) {
  const keys = [...new Set(s.terms.map(termKey))];
  const cls = t => `vz-tile c${keys.indexOf(termKey(t)) % 5}`;
  const chip = t => `<span class="${cls(t)}">${renderText(`\\(${t}\\)`)}</span>`;
  if (frame === 0) {
    return `<div class="vz-tiles"><p class="vz-do muted">同一种字母（连指数一起）涂同一种颜色</p><div class="vz-tile-row">${s.terms.map(chip).join('')}</div></div>`;
  }
  const groups = keys.map(k => ({ k, terms: s.terms.filter(t => termKey(t) === k) }));
  const merged = groups.map(g => {
    const cs = g.terms.map(termCoef);
    return cs.every(c => c !== null) ? coefTerm(Math.round(cs.reduce((a, c) => a + c, 0) * 1000) / 1000, g.k) : '';
  });
  return `<div class="vz-tiles"><p class="vz-do">${frame === 1 ? '同色的站到一起（带着自己前面的符号）' : '每一队合并：系数相加，字母部分不变'}</p>`
    + `<div class="vz-groups">${groups.map((g, i) => `<div class="vz-group c${i % 5}"><div class="vz-tile-row">${g.terms.map(chip).join('')}</div>`
      + (frame >= 2 && merged[i] ? `<p class="vz-merged">${renderText(`\\(${merged[i]}\\)`)}</p>` : '') + '</div>').join('')}</div>`
    + (frame >= 2 && s.result ? `<p class="vz-result">结果：${renderText(`\\(${s.result}\\)`)}</p>` : '')
    + '</div>';
}

function drawAngle(s, { value } = {}) {
  const deg = Number.isFinite(value) ? value : s.deg;
  const ox = s.show === 'supplement' ? 320 : 230, oy = 190, len = 170;
  const P = (d, r = len) => [R(ox + r * Math.cos(d * Math.PI / 180)), R(oy - r * Math.sin(d * Math.PI / 180))];
  const arc = (d0, d1, r) => { const [x0, y0] = P(d0, r), [x1, y1] = P(d1, r); return `M${x0},${y0} A${r},${r} 0 0 0 ${x1},${y1}`; };
  const [bx, by] = P(deg), [lx, ly] = P(deg / 2, 64);
  let b = `<line class="vz-axis" x1="${ox}" y1="${oy}" x2="${ox + len}" y2="${oy}"/>`
    + `<line class="vz-axis" x1="${ox}" y1="${oy}" x2="${bx}" y2="${by}"/>`
    + `<path class="vz-arc" d="${arc(0, deg, 44)}"/>`
    + `<text class="vz-lab hl" x="${lx}" y="${ly + 5}" text-anchor="middle">${deg}°</text>`;
  if (s.show === 'complement') {
    const [cx, cy] = P(90), [tx, ty] = P((deg + 90) / 2, 92);
    b += `<line class="vz-axis dash" x1="${ox}" y1="${oy}" x2="${cx}" y2="${cy}"/><path class="vz-arc other" d="${arc(deg, 90, 76)}"/>`
      + `<text class="vz-lab other" x="${tx}" y="${ty + 5}" text-anchor="middle">${90 - deg}°</text>`
      + `<path class="vz-right" d="M${ox + 14},${oy} V${oy - 14} H${ox}"/>`;
  }
  if (s.show === 'supplement') {
    const [tx, ty] = P((deg + 180) / 2, 92);
    b += `<line class="vz-axis dash" x1="${ox}" y1="${oy}" x2="${ox - len}" y2="${oy}"/><path class="vz-arc other" d="${arc(deg, 180, 76)}"/>`
      + `<text class="vz-lab other" x="${tx}" y="${ty + 5}" text-anchor="middle">${180 - deg}°</text>`;
  }
  b += `<circle class="vz-dot" cx="${ox}" cy="${oy}" r="4"/><text class="vz-name" x="${ox - 4}" y="${oy + 24}" text-anchor="middle">O</text>`
    + `<text class="vz-name" x="${ox + len + 6}" y="${oy + 22}" text-anchor="middle">A</text>`
    + `<text class="vz-name" x="${R(bx + 14 * Math.cos(deg * Math.PI / 180))}" y="${R(by - 10)}" text-anchor="middle">B</text>`;
  if (s.drag) b += `<circle class="vz-dot drag" cx="${bx}" cy="${by}" r="12" data-drag="1"/>`;
  const say = s.show === 'complement' ? `${s.name} = ${deg}°，它的余角 = 90° − ${deg}° = ${90 - deg}°`
    : s.show === 'supplement' ? `${s.name} = ${deg}°，它的补角 = 180° − ${deg}° = ${180 - deg}°` : `${s.name} = ${deg}°`;
  return svg(220, b, '角') + `<p class="vz-readout">${esc(say)}</p>`;
}

function drawCompare(s, { frame = 0 } = {}) {
  // 只把第一处不一样的那一行涂上（两边从这里分开）
  const n = Math.max(s.left.lines.length, s.right.lines.length);
  let split = -1;
  for (let i = 0; i < n && split < 0; i++) if (s.left.lines[i] !== s.right.lines[i]) split = i;
  const col = (side, other) => `<div class="vz-cmp-col"><p class="vz-cmp-t">${renderText(side.title.includes('\\(') ? side.title : `\\(${side.title}\\)`)}</p>`
    + side.lines.map((l, i) => `<p class="vz-cmp-l${i < frame ? '' : ' later'}${i === split && other ? ' diff' : ''}">${renderText(l.includes('\\(') ? l : `\\(${l}\\)`)}</p>`).join('') + '</div>';
  return `<div class="vz-cmp">${col(s.left, s.right)}${col(s.right, s.left)}</div>`;
}

const DRAW = { numberline: drawNumberline, line: drawLine, bars: drawBars, balance: drawBalance, tiles: drawTiles, angle: drawAngle, compare: drawCompare };

export function drawVisual(spec, opts = {}) {
  if (!spec || !DRAW[spec.type]) return '';
  const n = framesOf(spec);
  const frame = Math.max(0, Math.min(n - 1, Number(opts.frame) || 0));
  return DRAW[spec.type](spec, { ...opts, frame });
}

// ---------------------------------------------------------------- 浏览器里

const FIRST_FRAME = { numberline: 0, bars: 0, balance: 0, tiles: 0, compare: 1 };
const NEXT_WORD = { numberline: '走一步', bars: '下一行', balance: '两边同时做', tiles: '下一步', compare: '再算一步' };
const DRAG_TIP = { numberline: '拖动大圆点，看它的相反数和绝对值', angle: '拖动 B 点，改改角的大小' };

export function mountVisual(spec) {
  const box = document.createElement('figure');
  box.className = 'vz vz-' + spec.type;
  const stage = document.createElement('div');
  stage.className = 'vz-stage';
  const ctrl = document.createElement('div');
  ctrl.className = 'vz-ctrl';
  box.append(stage, ctrl);
  if (spec.caption) {
    const cap = document.createElement('figcaption');
    cap.className = 'vz-cap';
    cap.innerHTML = renderText(spec.caption);
    box.append(cap);
  }
  const n = framesOf(spec);
  const st = { frame: Math.min(n - 1, FIRST_FRAME[spec.type] ?? 0), pick: 0, value: spec.drag ? (spec.type === 'angle' ? spec.deg : spec.drag.x) : undefined };
  if (spec.type === 'angle' && spec.drag) st.value = spec.deg;

  const btn = (text, fn, cls = 'vz-btn') => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  };
  function paint() {
    stage.innerHTML = drawVisual(spec, st);
    ctrl.innerHTML = '';
    if (spec.type === 'line' && spec.cases.length) {
      spec.cases.forEach((c, i) => ctrl.append(btn(c.title, () => { st.pick = i; paint(); }, 'vz-btn case' + (i === st.pick ? ' on' : ''))));
    } else if (n > 1) {
      const last = st.frame >= n - 1;
      if (st.frame > (FIRST_FRAME[spec.type] ?? 0)) ctrl.append(btn('上一步', () => { st.frame--; paint(); }, 'vz-btn quiet'));
      ctrl.append(btn(last ? '从头再看' : NEXT_WORD[spec.type] || '下一步', () => { st.frame = last ? (FIRST_FRAME[spec.type] ?? 0) : st.frame + 1; paint(); }));
      const k = document.createElement('span');
      k.className = 'vz-count';
      k.textContent = `${st.frame + 1} / ${n}`;
      ctrl.append(k);
    }
    if (DRAG_TIP[spec.type] && spec.drag) {
      const tip = document.createElement('span');
      tip.className = 'vz-tip';
      tip.textContent = DRAG_TIP[spec.type];
      ctrl.append(tip);
      if (spec.type === 'numberline') {
        const v = st.value, say = document.createElement('p');
        say.className = 'vz-readout';
        say.textContent = `${spec.drag.label} 表示 ${fmt(v)}，相反数是 ${fmt(-v || 0)}，绝对值是 ${fmt(Math.abs(v))}（到原点的距离）`;
        stage.append(say);
      }
    }
    stage.querySelectorAll('.vz-pan-t').forEach(el => { el.classList.remove('pop'); void el.offsetWidth; if (st.frame) el.classList.add('pop'); });
  }
  // 拖动：数轴拖点（取整数），角拖 B（1° 一格，5° 吸附）
  if (spec.drag && (spec.type === 'numberline' || spec.type === 'angle')) {
    let dragging = false;
    const toValue = e => {
      const svgEl = stage.querySelector('svg');
      if (!svgEl) return st.value;
      const r = svgEl.getBoundingClientRect(), vb = svgEl.viewBox.baseVal;
      const x = (e.clientX - r.left) * vb.width / r.width, y = (e.clientY - r.top) * vb.height / r.height;
      if (spec.type === 'numberline') {
        const pad = 36, v = spec.min + (x - pad) * (spec.max - spec.min) / (W - 2 * pad);
        return Math.max(spec.min, Math.min(spec.max, Math.round(v)));
      }
      const ox = spec.show === 'supplement' ? 320 : 230, oy = 190;
      let d = Math.atan2(oy - y, x - ox) * 180 / Math.PI;
      d = Math.max(1, Math.min(spec.show === 'complement' ? 89 : 179, Math.round(d)));
      return Math.abs(d - Math.round(d / 5) * 5) <= 1 ? Math.round(d / 5) * 5 : d;
    };
    stage.addEventListener('pointerdown', e => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-drag]')) return;
      dragging = true; stage.setPointerCapture(e.pointerId); e.preventDefault();
    });
    stage.addEventListener('pointermove', e => {
      if (!dragging) return;
      const v = toValue(e);
      if (v !== st.value) { st.value = v; paint(); }
    });
    const end = () => { dragging = false; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.style.touchAction = 'none';
  }
  paint();
  return box;
}
