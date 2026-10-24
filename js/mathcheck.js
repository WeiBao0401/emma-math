// Answer checking for 七年级 math, exact and without any model: rationals as BigInt fractions, polynomials with
// rational coefficients, and exact evaluation at random points for anything with a letter in a denominator.
// Grades her typed answers, and checks AI-made answers before she ever sees them (DESIGN 8).
//
//   check(given, expected, { kind, form }) -> { ok: true | false | null, reason, kind }
//     kind: 'number' | 'expr' | 'equation' | 'set' | 'choice' | 'compare' | 'text'; guessed from `expected` when omitted
//     form: 'scientific' (a×10ⁿ, 1 ≤ |a| < 10) | 'simplified' (no brackets, like terms combined) | ''
//     ok null: cannot be checked by program (kind text, or `expected` unreadable); the UI lets her check herself
//     reason when wrong: 'sign' | 'reciprocal' | 'missing' (some of several answers) | 'extra' | 'form' | 'unreadable' | 'wrong'
//   value(str) -> Frac | null                  a constant, e.g. value('-3^2') is -9
//   same(a, b) -> true | false | null          equal as numbers or expressions; null when either side can't be read
//   solveLinear(str) -> { variable, value } | null    'x/2 - 1 = 3' -> x = 8 (one letter, first degree)
//   compute(question) -> { kind, answer } | null      the program's own answer to a 计算 / 化简 / 解方程 stem, or null
//   parsePoly(str) -> Poly (throws MathError), Frac, MathError, fmt(frac)
//
// Precedence follows the textbook: −3² = −9, (−3)² = 9; × and ÷ left to right; 2a and 3(x+1) multiply.

export class MathError extends Error {}

// ---------------------------------------------------------------- rationals
const babs = x => (x < 0n ? -x : x);
function gcd(a, b) { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; }

export class Frac {
  constructor(n, d = 1n) {
    if (d === 0n) throw new MathError('除数不能是 0');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g; this.d = d / g;
  }
  static of(x) { return x instanceof Frac ? x : new Frac(BigInt(x)); }
  static dec(s) {   // '0.15' -> 3/20, '12' -> 12
    const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
    if (!m || (!m[1] && !m[2])) throw new MathError('数字写法不对：' + s);
    const frac = m[2] || '';
    return new Frac(BigInt((m[1] || '0') + frac), 10n ** BigInt(frac.length));
  }
  add(o) { return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { if (o.n === 0n) throw new MathError('除数不能是 0'); return new Frac(this.n * o.d, this.d * o.n); }
  neg() { return new Frac(-this.n, this.d); }
  abs() { return new Frac(babs(this.n), this.d); }
  inv() { return new Frac(1n, 1n).div(this); }
  eq(o) { return this.n === o.n && this.d === o.d; }
  cmp(o) { const x = this.n * o.d - o.n * this.d; return x < 0n ? -1 : x > 0n ? 1 : 0; }
  isZero() { return this.n === 0n; }
  isInt() { return this.d === 1n; }
  pow(k) {           // k: integer (Number); a large k only for 0, 1 and −1, like (−1)^2026
    if (k < 0) return this.inv().pow(-k);
    if (k > 64 && !(this.d === 1n && babs(this.n) <= 1n)) throw new MathError('指数太大');
    let r = new Frac(1n), b = this;
    for (; k > 0; k = Math.floor(k / 2)) { if (k % 2) r = r.mul(b); b = b.mul(b); }
    return r;
  }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
}
export const fmt = f => (f instanceof Frac ? f.toString() : String(f));
const ZERO = new Frac(0n), ONE = new Frac(1n);

// ---------------------------------------------------------------- polynomials
// A monomial key lists letters with exponents, sorted: '' (constant), 'a', 'a^2 b', 'x y'.
function monoKey(m) { return Object.keys(m).sort().filter(v => m[v]).map(v => (m[v] === 1 ? v : `${v}^${m[v]}`)).join(' '); }
function keyMono(k) {
  const m = {};
  if (k) for (const part of k.split(' ')) { const [v, e] = part.split('^'); m[v] = e ? Number(e) : 1; }
  return m;
}

export class Poly {
  constructor(terms = new Map()) { this.t = terms; for (const [k, c] of [...this.t]) if (c.isZero()) this.t.delete(k); }
  static c(f) { return new Poly(new Map([['', Frac.of(f)]])); }
  static v(name) { return new Poly(new Map([[name, ONE]])); }
  add(o) { const t = new Map(this.t); for (const [k, c] of o.t) t.set(k, (t.get(k) || ZERO).add(c)); return new Poly(t); }
  neg() { return new Poly(new Map([...this.t].map(([k, c]) => [k, c.neg()]))); }
  sub(o) { return this.add(o.neg()); }
  mul(o) {
    const t = new Map();
    for (const [k1, c1] of this.t) for (const [k2, c2] of o.t) {
      const m = keyMono(k1);
      for (const [v, e] of Object.entries(keyMono(k2))) m[v] = (m[v] || 0) + e;
      const k = monoKey(m);
      t.set(k, (t.get(k) || ZERO).add(c1.mul(c2)));
    }
    return new Poly(t);
  }
  isConst() { return [...this.t.keys()].every(k => k === ''); }
  constValue() { return this.t.get('') || ZERO; }
  vars() { const s = new Set(); for (const k of this.t.keys()) for (const v of Object.keys(keyMono(k))) s.add(v); return s; }
  degree() { let d = 0; for (const k of this.t.keys()) d = Math.max(d, Object.values(keyMono(k)).reduce((a, b) => a + b, 0)); return d; }
  eq(o) { const d = this.sub(o); return d.t.size === 0; }
  toString() {
    if (!this.t.size) return '0';
    return [...this.t].sort(([a], [b]) => b.length - a.length || a.localeCompare(b)).map(([k, c], i) => {
      const neg = c.n < 0n, a = c.abs();
      const coef = k && a.eq(ONE) ? '' : a.toString();
      const s = coef + (k && coef ? '' : '') + k.replace(/ /g, '');
      return (neg ? (i ? ' - ' : '-') : i ? ' + ' : '') + s;
    }).join('');
  }
}

// ---------------------------------------------------------------- text clean-up
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };

function stripLatex(s) {
  s = String(s ?? '');
  s = s.replace(/\\\(|\\\)|\\\[|\\\]|\$/g, ' ');
  s = s.replace(/\\(?:left|right|big|Big|bigl|bigr|displaystyle)\b/g, '');
  s = s.replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, '$1');
  // \frac{A}{B} (any nesting) -> ((A)/(B))
  for (let guard = 0; guard < 50; guard++) {
    const i = s.search(/\\[dt]?frac\s*\{/);
    if (i < 0) break;
    const a0 = s.indexOf('{', i);
    const a1 = matchBrace(s, a0);
    const b0 = s.slice(a1 + 1).search(/\S/) + a1 + 1;
    if (s[b0] !== '{') throw new MathError('分数写法不对');
    const b1 = matchBrace(s, b0);
    s = s.slice(0, i) + '((' + s.slice(a0 + 1, a1) + ')/(' + s.slice(b0 + 1, b1) + '))' + s.slice(b1 + 1);
  }
  s = s.replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ|\\circ|\\degree/g, '°');
  s = s.replace(/\^\s*\{\s*\\prime\s*\\prime\s*\}|\\prime\s*\\prime/g, '″').replace(/\^\s*\{\s*\\prime\s*\}|\\prime/g, '′');
  s = s.replace(/\\times|\\cdot|\\ast/g, '*').replace(/\\div/g, '/').replace(/\\pm/g, '±').replace(/\\%/g, '%');
  s = s.replace(/\\(?:leq|le)\b/g, '≤').replace(/\\(?:geq|ge)\b/g, '≥').replace(/\\lt\b/g, '<').replace(/\\gt\b/g, '>');
  s = s.replace(/\\neq?\b/g, '≠').replace(/\\pi\b/g, 'π');
  s = s.replace(/\\[,;:! ]|\\quad|\\qquad|~/g, ' ');
  s = s.replace(/\\\{|\\\}/g, m => (m === '\\{' ? '(' : ')'));
  s = s.replace(/\\[a-zA-Z]+/g, m => { throw new MathError('看不懂 ' + m); });
  return s.replace(/\{/g, '(').replace(/\}/g, ')');
}
function matchBrace(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return j;
  }
  throw new MathError('括号没配对');
}

function clean(raw) {
  let s = stripLatex(raw);
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, m => '^(' + [...m].map(c => SUP[c]).join('') + ')');
  s = s.replace(/[−–—‐‑﹣－]/g, '-').replace(/[＋]/g, '+').replace(/[×✕✖·•∙⋅＊]/g, '*').replace(/[÷／]/g, '/');
  s = s.normalize('NFKC');
  s = s.replace(/[（［【]/g, '(').replace(/[）］】]/g, ')').replace(/[＝]/g, '=').replace(/[＜]/g, '<').replace(/[＞]/g, '>');
  s = s.replace(/[\[]/g, '(').replace(/[\]]/g, ')');
  // angles: 37°30′15″ (also 37度30分) -> (37+30/60+15/3600)
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:°|度)\s*(?:(\d+(?:\.\d+)?)\s*(?:′|'|分)\s*)?(?:(\d+(?:\.\d+)?)\s*(?:″|''|"|秒)\s*)?/g,
    (_, d, m, sec) => `(${d}${m ? `+${m}/60` : ''}${sec ? `+${sec}/3600` : ''})`);
  s = s.replace(/(\d+(?:\.\d+)?)\s*(?:′|'|分)\s*(?:(\d+(?:\.\d+)?)\s*(?:″|''|"|秒))?/g, (_, m, sec) => `(${m}/60${sec ? `+${sec}/3600` : ''})`);
  return s.trim();
}

// ---------------------------------------------------------------- tokens and parser (AST)
function tokenize(s) {
  const out = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[\d.]/.test(c)) {
      const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i));
      out.push({ t: 'num', v: Frac.dec(m[0].replace(/\.$/, '')) });
      i += m[0].length; continue;
    }
    if (/[a-zA-Zπ]/.test(c)) { out.push({ t: 'var', v: c }); i++; continue; }
    if ('+-*/^()|%'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new MathError('看不懂“' + c + '”');
  }
  return out;
}

function parseAST(str) {
  const toks = tokenize(str);
  let i = 0, absDepth = 0;
  const peek = () => toks[i];
  const take = t => { if (!toks[i] || toks[i].t !== t) throw new MathError('式子不完整'); return toks[i++]; };
  function expr() {
    let node = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = toks[i++].t; node = { op, a: node, b: term() }; }
    return node;
  }
  function startsOperand(t) { return t && (t.t === 'var' || t.t === '(' || (t.t === '|' && absDepth === 0)); }
  function term() {
    let node = factor();
    for (;;) {
      const t = peek();
      if (t && (t.t === '*' || t.t === '/')) { i++; node = { op: t.t, a: node, b: factor() }; }
      else if (startsOperand(t)) node = { op: '*', a: node, b: factor() };
      else return node;
    }
  }
  function factor() {
    const t = peek();
    if (t && (t.t === '-' || t.t === '+')) { i++; const f = factor(); return t.t === '-' ? { op: 'neg', a: f } : f; }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek() && peek().t === '^') { i++; return { op: '^', a: base, b: factor() }; }
    return base;
  }
  function postfix() {
    let node = primary();
    while (peek() && peek().t === '%') { i++; node = { op: '/', a: node, b: { num: new Frac(100n) } }; }
    return node;
  }
  function primary() {
    const t = toks[i++];
    if (!t) throw new MathError('式子不完整');
    if (t.t === 'num') return { num: t.v };
    if (t.t === 'var') return { v: t.v };
    if (t.t === '(') { const e = expr(); take(')'); return e; }
    if (t.t === '|') { absDepth++; const e = expr(); absDepth--; take('|'); return { op: 'abs', a: e }; }
    throw new MathError('式子不完整');
  }
  if (!toks.length) throw new MathError('没有写式子');
  const tree = expr();
  if (i < toks.length) throw new MathError('式子写法不对');
  return tree;
}

function toPoly(n) {
  if (n.num) return Poly.c(n.num);
  if (n.v) return Poly.v(n.v);
  if (n.op === 'neg') return toPoly(n.a).neg();
  const a = toPoly(n.a);
  if (n.op === 'abs') { if (!a.isConst()) throw new MathError('abs'); return Poly.c(a.constValue().abs()); }
  const b = toPoly(n.b);
  if (n.op === '+') return a.add(b);
  if (n.op === '-') return a.sub(b);
  if (n.op === '*') return a.mul(b);
  if (n.op === '/') { if (!b.isConst()) throw new MathError('div'); return a.mul(Poly.c(b.constValue().inv())); }
  if (n.op === '^') {
    if (!b.isConst() || !b.constValue().isInt()) throw new MathError('指数要是整数');
    const k = Number(b.constValue().n);
    if (a.isConst()) return Poly.c(a.constValue().pow(k));
    if (k < 0) throw new MathError('div');
    if (k > 30) throw new MathError('指数太大');
    let r = Poly.c(1n);
    for (let j = 0; j < k; j++) r = r.mul(a);
    return r;
  }
  throw new MathError('式子写法不对');
}

// exact value at a point (letters -> Frac); used when a letter sits in a denominator or inside |…|
function evalAt(n, env) {
  if (n.num) return n.num;
  if (n.v) { if (!env[n.v]) throw new MathError('no value'); return env[n.v]; }
  if (n.op === 'neg') return evalAt(n.a, env).neg();
  if (n.op === 'abs') return evalAt(n.a, env).abs();
  const a = evalAt(n.a, env), b = evalAt(n.b, env);
  if (n.op === '+') return a.add(b);
  if (n.op === '-') return a.sub(b);
  if (n.op === '*') return a.mul(b);
  if (n.op === '/') return a.div(b);
  if (n.op === '^') { if (!b.isInt() || babs(b.n) > 100000n) throw new MathError('指数'); return a.pow(Number(b.n)); }
  throw new MathError('式子写法不对');
}
function varsOf(n, s = new Set()) {
  if (n.v) s.add(n.v);
  if (n.a) varsOf(n.a, s);
  if (n.b) varsOf(n.b, s);
  return s;
}

export function parsePoly(str) { return toPoly(parseAST(clean(str))); }

// One reading of an expression: polynomial when possible, else the tree for point evaluation.
function read(str) {
  const ast = parseAST(clean(str));
  try { return { poly: toPoly(ast), ast }; } catch (e) {
    if (e.message === 'div' || e.message === 'abs') return { poly: null, ast };
    throw e;
  }
}
const tryRead = s => { try { return read(s); } catch { return null; } };

export function value(str) {
  const r = tryRead(str);
  return r && r.poly && r.poly.isConst() ? r.poly.constValue() : null;
}

// Fixed sample points (deterministic, avoid 0, ±1 and small integers that hide mistakes).
const POINTS = [[7n, 3n], [-5n, 2n], [11n, 7n], [-13n, 5n], [17n, 4n], [-19n, 6n], [23n, 9n]];
function sameRead(x, y) {
  if (x.poly && y.poly) return x.poly.eq(y.poly);
  const vars = [...new Set([...varsOf(x.ast), ...varsOf(y.ast)])];
  let tried = 0;
  for (let p = 0; p < POINTS.length * 3 && tried < 6; p++) {
    const env = {};
    vars.forEach((v, j) => { const [n, d] = POINTS[(p + j * 2) % POINTS.length]; env[v] = new Frac(n + BigInt(p), d); });
    let a, b;
    try { a = evalAt(x.ast, env); b = evalAt(y.ast, env); } catch { continue; }
    if (!a.eq(b)) return false;
    tried++;
  }
  return tried >= 3 ? true : null;
}

export function same(a, b) {
  const x = typeof a === 'string' ? tryRead(a) : a, y = typeof b === 'string' ? tryRead(b) : b;
  if (!x || !y) return null;
  return sameRead(x, y);
}

// ---------------------------------------------------------------- equations
export function solveLinear(str) {
  try {
    const s = clean(str);
    const parts = s.split('=');
    if (parts.length !== 2) return null;
    const d = parsePoly(parts[0]).sub(parsePoly(parts[1]));
    const vars = [...d.vars()];
    if (vars.length !== 1 || d.degree() !== 1) return null;
    const a = d.t.get(vars[0]), b = d.constValue();
    return { variable: vars[0], value: b.neg().div(a) };
  } catch { return null; }
}

// ---------------------------------------------------------------- answers
const SET_SPLIT = /\s*(?:或者|或|和|及|,|，|、|;|；|\bor\b|\band\b)\s*/;
const UNIT_TAIL = /\s*(?:cm²|cm2|m²|cm|mm|dm|km|kg|min|千米|厘米|毫米|分米|米|千克|克|小时|分钟|秒钟|元|人|个|组|岁|天|本|只|辆|件|页|次|道|名|度|平方厘米|平方米|m|g|h|s|t)\s*$/;
const COMPARE = { '<': '<', '>': '>', '=': '=', '≤': '≤', '≥': '≥', '<=': '≤', '>=': '≥', '小于': '<', '大于': '>', '等于': '=' };

function plainAnswer(str) {
  // 'x = −11', 'AM = 3 cm', '答：共分 8 组。', '\(3\text{ cm}\)', '共分 8 组（学生共 59 人）' -> the value part.
  // A model that puts its working in the answer field: only the first line counts.
  let s = String(str ?? '').split(/\r?\n/).find(l => l.trim()) || '';
  s = s.replace(/\\\(|\\\)|\$/g, ' ').replace(/\\(?:text|mathrm)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/[（(][^（）()]*[一-鿿][^（）()]*[）)]\s*[。.．]?\s*$/, '');
  s = s.replace(/^\s*(?:答|解)\s*[:：]?\s*/, '').replace(/[。.．]\s*$/, '').trim();
  s = s.replace(/^[^=＝]*[=＝]\s*(?=[^=＝]*$)/, m => (/[a-zA-Z]/.test(m) || /[一-鿿]/.test(m) ? '' : m));
  s = s.replace(/^[一-鿿]+[:：]?\s*(?=[-\d(（.|\\])/, '');
  for (let k = 0; k < 3; k++) s = s.replace(UNIT_TAIL, '');
  return s.trim();
}

function expandPm(items) {
  const out = [];
  for (const it of items) {
    const m = /^\s*±\s*(.+)$/.exec(it);
    if (m) out.push(m[1], '-(' + m[1] + ')'); else out.push(it);
  }
  return out;
}

function guessKind(expected) {
  const e = String(expected ?? '').trim();
  const s = (() => { try { return clean(e); } catch { return e; } })();
  if (/^[A-H](?:\s*[,，、]?\s*[A-H])*$/.test(e)) return 'choice';
  if (COMPARE[s] || COMPARE[e]) return 'compare';
  if (SET_SPLIT.test(e) || /±/.test(s)) return 'set';
  if (/^[a-zA-Z]\s*=/.test(s) && !/=.*=/.test(s)) return 'equation';
  const r = tryRead(plainAnswer(e));
  if (r && r.poly && r.poly.isConst()) return 'number';
  if (r) return 'expr';
  return 'text';
}

function readNumberish(str) {
  const r = tryRead(plainAnswer(str));
  if (!r) return null;
  if (r.poly && r.poly.isConst()) return r;
  return r;
}

function scientificOk(given) {
  const s = clean(plainAnswer(given)).replace(/\s+/g, '');
  const m = /^(-?)(\d+(?:\.\d+)?)\*10\^\(?(-?\d+)\)?$/.exec(s);
  if (!m) return false;
  const a = Frac.dec(m[2]);
  return a.cmp(ONE) >= 0 && a.cmp(new Frac(10n)) < 0;
}

function simplifiedOk(given) {
  // no brackets, and no two top-level terms with the same letters
  const s = clean(plainAnswer(given));
  if (/[()|]/.test(s)) return false;
  const terms = s.replace(/^\s*[+-]/, '').split(/(?<=[\w)π])\s*[+-]\s*/);
  const keys = new Set();
  for (const t of terms) {
    let p;
    try { p = parsePoly(t); } catch { return false; }
    if (p.t.size > 1) return false;
    const k = p.t.size ? [...p.t.keys()][0] : '';
    if (keys.has(k)) return false;
    keys.add(k);
  }
  return true;
}

function relation(g, e) {
  // why a wrong number is wrong, for her feedback
  if (!g.poly || !e.poly) return 'wrong';
  if (g.poly.eq(e.poly.neg())) return 'sign';
  if (g.poly.isConst() && e.poly.isConst() && !e.poly.constValue().isZero() && !g.poly.constValue().isZero()) {
    const gv = g.poly.constValue(), ev = e.poly.constValue();
    if (gv.eq(ev.inv()) || gv.eq(ev.inv().neg())) return 'reciprocal';
  }
  return 'wrong';
}

export function check(given, expected, { kind = '', form = '' } = {}) {
  kind = kind || guessKind(expected);
  const blank = String(given ?? '').trim() === '';
  if (kind === 'text') return { ok: null, reason: 'self', kind };
  if (blank) return { ok: false, reason: 'unreadable', kind };

  if (kind === 'choice') {
    const letters = s => [...new Set(String(s).toUpperCase().match(/[A-H]/g) || [])].sort().join('');
    const g = letters(given), e = letters(expected);
    if (!e) return { ok: null, reason: 'self', kind };
    return { ok: g === e, reason: g === e ? '' : g && e.includes(g) ? 'missing' : 'wrong', kind };
  }
  if (kind === 'compare') {
    const sym = s => { const t = String(s).trim(); return COMPARE[t] || COMPARE[(() => { try { return clean(t); } catch { return t; } })()] || ''; };
    const g = sym(given), e = sym(expected);
    if (!e) return { ok: null, reason: 'self', kind };
    return { ok: g === e, reason: g === e ? '' : g ? 'wrong' : 'unreadable', kind };
  }
  if (kind === 'equation') {
    const ev = solveOrValue(expected), gv = solveOrValue(given);
    if (!ev) return { ok: null, reason: 'self', kind };
    if (!gv) return { ok: false, reason: 'unreadable', kind };
    if (gv.variable && ev.variable && gv.variable !== ev.variable) return { ok: false, reason: 'wrong', kind };
    if (gv.value.eq(ev.value)) return { ok: true, reason: '', kind };
    return { ok: false, reason: relation({ poly: Poly.c(gv.value) }, { poly: Poly.c(ev.value) }), kind };
  }
  if (kind === 'set') {
    const split = s => expandPm(String(s ?? '').replace(/^\s*(?:答|解)\s*[:：]?/, '').split(SET_SPLIT).map(x => plainAnswer(x)).filter(Boolean));
    const es = split(expected).map(tryRead), gs = split(given).map(tryRead);
    if (!es.length || es.some(x => !x)) return { ok: null, reason: 'self', kind };
    if (gs.some(x => !x)) return { ok: false, reason: 'unreadable', kind };
    const left = [...es];
    let extra = 0;
    for (const g of gs) {
      const j = left.findIndex(e => sameRead(g, e) === true);
      if (j >= 0) left.splice(j, 1); else extra++;
    }
    if (!left.length && !extra) return { ok: true, reason: '', kind };
    return { ok: false, reason: !extra && left.length ? 'missing' : !left.length ? 'extra' : 'wrong', kind };
  }
  // number / expr
  const e = readNumberish(expected);
  if (!e) return { ok: null, reason: 'self', kind };
  const g = readNumberish(given);
  if (!g) return { ok: false, reason: 'unreadable', kind };
  const eq = sameRead(g, e);
  if (eq === null) return { ok: null, reason: 'self', kind };
  if (!eq) return { ok: false, reason: relation(g, e), kind };
  if (form === 'scientific' && !scientificOk(given)) return { ok: false, reason: 'form', kind };
  if (form === 'simplified' && !simplifiedOk(given)) return { ok: false, reason: 'form', kind };
  return { ok: true, reason: '', kind };
}

function solveOrValue(str) {
  const s = (() => { try { return clean(String(str ?? '')); } catch { return ''; } })();
  const m = /^\s*([a-zA-Z])\s*=\s*([^=]+)$/.exec(s);
  if (m) { const v = value(m[2]); return v ? { variable: m[1], value: v } : null; }
  if (s.includes('=')) return solveLinear(s);
  const v = value(plainAnswer(str));
  return v ? { variable: '', value: v } : null;
}

// ---------------------------------------------------------------- the program's own answer to a stem
// Pulls the math out of a stem like "计算：\(-6\div 2\times\frac{1}{3}=\)" and works it out. Returns null when the
// stem is not a plain 计算 / 化简 / 解方程 (word problems, geometry, fill-in-the-blank with words).
export function compute(question) {
  const q = String(question ?? '');
  const segs = [...q.matchAll(/\\\((.+?)\\\)/gs)].map(m => m[1]);
  // only stems that are an instruction plus one formula: "(3) 计算：\(…=\)", "化简：3(2a−b)−2(a−3b)"
  const LEAD = /^\s*(?:\(\d+\)|（\d+）|\d+\s*[.、．])?\s*(?:计算|化简|求值|解方程|解下列方程)?\s*[:：]?\s*/;
  const outside = segs.length ? q.replace(/\\\((.+?)\\\)/gs, ' ').replace(LEAD, '').replace(/[=＝_\s?？。.]/g, '') : '';
  if (segs.length > 1 || outside) return null;
  const math = segs.length ? segs[0] : q.replace(LEAD, '');
  if (/[一-鿿]/.test(math)) return null;
  let s;
  try { s = clean(math); } catch { return null; }
  s = s.replace(/=\s*(?:_+|\?|\s)*$/, '').trim();
  if (/=/.test(s)) {
    const r = solveLinear(s);
    return r ? { kind: 'equation', answer: `${r.variable}=${fmt(r.value)}` } : null;
  }
  const r = tryRead(s);
  if (!r) return null;
  if (r.poly && r.poly.isConst()) return { kind: 'number', answer: fmt(r.poly.constValue()) };
  if (r.poly) return { kind: 'expr', answer: r.poly.toString() };
  return null;
}
