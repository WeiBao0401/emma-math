// Shows the LaTeX the models write, without a math library: 七年级 needs fractions, powers, |x|, ×, ÷, °, ∠, √ and
// a few symbols, which HTML and CSS (css/math.css) can draw. Unknown commands show as their name, never as an error.
//
//   renderText(text) -> HTML string   plain text with \( … \) or \[ … \] (also $…$) math inside; text is escaped
//   renderMath(latex) -> HTML string  one formula
//   plain(text) -> string             the same text for reading aloud or a summary line: "−3² = −9", "(x−1)/2"
//
// Everything that reaches the page goes through esc(), so model output can never inject markup.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SYMBOLS = {
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', circ: '°', degree: '°', prime: '′', angle: '∠', triangle: '△', perp: '⊥', parallel: '∥',
  because: '∵', therefore: '∴', cdots: '⋯', ldots: '…', dots: '…', pi: 'π', infty: '∞', lt: '<', gt: '>',
  alpha: 'α', beta: 'β', gamma: 'γ', theta: 'θ', square: '□', Box: '□', bigcirc: '○', rightarrow: '→', to: '→',
  Rightarrow: '⇒', leftarrow: '←', '%': '%', '{': '{', '}': '}', '$': '$', '#': '#', '&': '&', '_': '_', '|': '‖',
};
const SPACES = { ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', quad: ' ', qquad: '  ' };
const OPS = new Set(['+', '−', '×', '÷', '=', '<', '>', '≤', '≥', '≠', '≈', '±', '·', '→', '⇒']);
const IGNORE = new Set(['displaystyle', 'textstyle', 'big', 'Big', 'bigl', 'bigr', 'Bigl', 'Bigr', 'limits', 'nolimits']);

function tokenize(src) {
  const out = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) { i++; continue; }
      out.push({ cmd: m[1] });
      i += m[0].length;
      continue;
    }
    out.push({ ch: c });
    i++;
  }
  return out;
}

// Recursive reader over the token list: returns an array of pieces { html, plain, kind } where kind marks operators
// (for spacing and unary minus) and atoms.
function reader(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const piece = (html, plain, kind = 'atom') => ({ html, plain, kind });

  function group() {   // after "{"
    const parts = seq('}');
    if (peek() && peek().ch === '}') i++;
    return parts;
  }
  function arg() {     // one argument: {…} or a single token
    while (peek() && peek().ch === ' ') i++;
    const t = peek();
    if (!t) return [];
    if (t.ch === '{') { i++; return group(); }
    return one();
  }
  const join = parts => ({ html: parts.map(p => p.html).join(''), plain: parts.map(p => p.plain).join('') });
  const wrapPlain = s => (s.length > 1 && !/^[\w.]+$/.test(s) ? `(${s})` : s);

  function one() {
    const t = tokens[i++];
    if (!t) return [];
    if (t.ch !== undefined) {
      const c = t.ch;
      if (c === ' ') return [];
      if (c === '{') return group();
      if (c === '}') return [];
      if (c === '^' || c === '_') {
        const a = join(arg());
        if (c === '^' && /^[°′″]+$/.test(a.plain)) return [piece(a.html, a.plain)];   // 90^\circ: ° is already raised
        const tag = c === '^' ? 'sup' : 'sub';
        const plain = c === '^' ? (/^\d+$/.test(a.plain) ? [...a.plain].map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('') : `^${wrapPlain(a.plain)}`) : `_${a.plain}`;
        return [piece(`<${tag} class="m-${tag}">${a.html}</${tag}>`, plain)];
      }
      if (/[a-zA-Z]/.test(c)) return [piece(`<i>${c}</i>`, c)];
      if (c === '-' || c === '−') return [piece('−', '−', 'op')];
      if (c === '*') return [piece('×', '×', 'op')];
      if (c === "'") return [piece('′', '′')];
      if (OPS.has(c)) return [piece(esc(c), c, 'op')];
      return [piece(esc(c), c, /[(\[|]/.test(c) ? 'open' : 'atom')];
    }
    const name = t.cmd;
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const a = join(arg()), b = join(arg());
      return [piece(`<span class="m-frac"><span class="m-num">${a.html}</span><span class="m-den">${b.html}</span></span>`,
        `${wrapPlain(a.plain)}/${wrapPlain(b.plain)}`)];
    }
    if (name === 'sqrt') {
      let idx = '';
      if (peek() && peek().ch === '[') { i++; const p = seq(']'); i++; idx = join(p).html; }
      const a = join(arg());
      return [piece(`<span class="m-sqrt">${idx ? `<sup class="m-sup">${idx}</sup>` : ''}√<span class="m-rad">${a.html}</span></span>`, `√${wrapPlain(a.plain)}`)];
    }
    if (name === 'text' || name === 'mathrm' || name === 'textrm' || name === 'mbox' || name === 'operatorname') {
      const a = arg();
      const plain = a.map(p => p.plain).join('');
      return [piece(`<span class="m-text">${esc(plain)}</span>`, plain)];
    }
    if (name === 'mathbf' || name === 'boldsymbol') { const a = join(arg()); return [piece(`<b>${a.html}</b>`, a.plain)]; }
    if (name === 'overline' || name === 'bar') { const a = join(arg()); return [piece(`<span class="m-ol">${a.html}</span>`, a.plain)]; }
    if (name === 'underline') { const a = join(arg()); return [piece(`<span class="m-ul">${a.html}</span>`, a.plain)]; }
    if (name === 'boxed') { const a = join(arg()); return [piece(`<span class="m-box">${a.html}</span>`, a.plain)]; }
    if (name === 'left' || name === 'right') {
      const d = tokens[i++];
      if (!d) return [];
      if (d.ch === '.') return [];
      const ch = d.cmd ? (d.cmd === '{' ? '{' : d.cmd === '}' ? '}' : d.cmd === '|' ? '‖' : SYMBOLS[d.cmd] || '') : d.ch;
      return [piece(esc(ch), ch, name === 'left' ? 'open' : 'atom')];
    }
    if (IGNORE.has(name)) return [];
    if (name in SPACES) return [piece(SPACES[name], SPACES[name] ? ' ' : '', 'space')];
    if (name in SYMBOLS) { const s = SYMBOLS[name]; return [piece(esc(s), s, OPS.has(s) ? 'op' : 'atom')]; }
    return [piece(`<span class="m-text">${esc(name)}</span>`, name)];
  }

  function seq(stop) {
    const parts = [];
    while (i < tokens.length) {
      const t = peek();
      if (t.ch === stop) break;
      parts.push(...one());
    }
    return parts;
  }
  return { all: () => seq(null) };
}

function layout(parts) {
  // binary operators get thin spaces; a minus at the start or after an operator or "(" is a sign
  let html = '', plain = '', prev = 'start', barOpen = false;
  for (const p of parts) {
    if (p.plain === '|') { p.kind = barOpen ? 'atom' : 'open'; barOpen = !barOpen; }   // |−5| − |3|: open, then close
    if (p.kind === 'op') {
      const unary = (p.plain === '−' || p.plain === '+' || p.plain === '±') && (prev === 'start' || prev === 'op' || prev === 'open');
      html += unary ? `<span class="m-sign">${p.html}</span>` : `<span class="m-op">${p.html}</span>`;
      plain += unary ? p.plain : ` ${p.plain} `;
    } else {
      html += p.html;
      plain += p.plain;
    }
    if (p.kind !== 'space') prev = p.kind;
  }
  return { html, plain: plain.replace(/\s+/g, ' ').trim() };
}

export function renderMath(latex) {
  try {
    return `<span class="m">${layout(reader(tokenize(String(latex ?? ''))).all()).html}</span>`;
  } catch {
    return `<span class="m">${esc(latex)}</span>`;
  }
}

function mathPlain(latex) {
  try { return layout(reader(tokenize(String(latex ?? ''))).all()).plain; } catch { return String(latex ?? ''); }
}

// \( … \), \[ … \] and, for models that use them anyway, $$ … $$ and $ … $
const SPLIT = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g;

// v0.7 (Wei 10-25: “分数提取完以后显示得不好”): text outside \( \) still gets its math drawn. A bare LaTeX run
// (\frac{1}{3}x, a model that forgot the delimiters) is drawn whole; a typed fraction like 1/3, (x−1)/2, 3x/4 is stacked;
// x^2 is raised. Dates (2026/10/24), units (km/h) and words (and/or) are left alone.
const CJK = '　-〿一-鿿＀-￯“”‘’\n';
const RUN = new RegExp(`[^${CJK}]+`, 'g');
const OPERAND = '\\([^()\\n]{1,30}\\)';
const LOOSE = new RegExp(`(?<![0-9a-zA-Z./\\\\])(${OPERAND}|[0-9]+(?:\\.[0-9]+)?[a-zA-Z]{0,2}|[a-zA-Z])/(${OPERAND}|[0-9]+(?:\\.[0-9]+)?|[a-zA-Z])(?![0-9./])`
  + `|([0-9a-zA-Z)])\\^(\\{[^{}\\n]{1,12}\\}|[-−]?[0-9]+|[a-zA-Z])`, 'g');
const unwrap = t => (/^\(.*\)$/.test(t) ? t.slice(1, -1) : t);
// a run of text between Chinese characters -> LaTeX when it holds math the delimiters missed, else null
function looseTex(run) {
  let hit = /\\[a-zA-Z]+/.test(run);
  // x=-11, 2a+3b: a lone letter with an operator and nothing wordy is a formula too (the minus becomes −)
  if (/^[0-9a-zA-Z()+\-−×÷=<>.|,\s]+$/.test(run) && /(?<![a-zA-Z])[a-zA-Z](?![a-zA-Z])/.test(run) && /[=+\-−×÷<>]/.test(run) && !/[a-zA-Z]{2}/.test(run)) hit = true;
  const tex = run.replace(LOOSE, (all, num, den, base, exp, at, str) => {
    if (num !== undefined) {
      if (/^[a-zA-Z]$/.test(num) && /^[a-zA-Z]$/.test(den) && (/[a-zA-Z]/.test(str[at - 1] || '') || /[a-zA-Z]/.test(str[at + all.length] || ''))) return all;
      if (/^[a-zA-Z]$/.test(den) && /[a-zA-Z]/.test(str[at + all.length] || '')) return all;   // km/h, and/or
      hit = true;
      return `\\frac{${unwrap(num)}}{${unwrap(den)}}`;
    }
    hit = true;
    return `${base}^{${exp.replace(/^\{|\}$/g, '')}}`;
  });
  if (!hit || /\d+\/\d+\/\d+/.test(run) || /:\/\//.test(run)) return null;
  // an English sentence around a fraction: only the fraction is math
  if (/(?<!\\)\b[a-zA-Z]{3,}\b/.test(run.replace(/\\[a-zA-Z]+/g, ''))) return { parts: true };
  return tex;
}
function textPart(s) {
  let out = '', last = 0;
  for (const m of s.matchAll(RUN)) {
    out += esc(s.slice(last, m.index));
    last = m.index + m[0].length;
    const run = m[0], body = run.trim();
    const tex = body ? looseTex(body) : null;
    if (!tex) { out += esc(run); continue; }
    if (tex.parts) { out += esc(run); continue; }
    const lead = /^\s*/.exec(run)[0], tail = /\s*$/.exec(run)[0];
    out += esc(lead) + renderMath(tex) + esc(tail);
  }
  return (out + esc(s.slice(last))).replace(/\n/g, '<br>');
}

export function renderText(text) {
  const s = String(text ?? '');
  let out = '', last = 0;
  for (const m of s.matchAll(SPLIT)) {
    out += textPart(s.slice(last, m.index));
    const display = m[2] !== undefined || m[3] !== undefined;
    const body = m[1] ?? m[2] ?? m[3] ?? m[4];
    out += display ? `<span class="m-display">${renderMath(body)}</span>` : renderMath(body);
    last = m.index + m[0].length;
  }
  return out + textPart(s.slice(last));
}

export function plain(text) {
  const s = String(text ?? '');
  return s.replace(SPLIT, (_, a, b, c, d) => mathPlain(a ?? b ?? c ?? d)).replace(/[ \t]+/g, ' ').trim();
}
