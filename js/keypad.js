// 作答控件和小键盘（CONTRACTS 13，方案 C 5.3、5.4）。过程在纸上，结果在 iPad 上：她只填最后的答案。
// 负责：练习界面 agent（ui-practice.js、keypad.js、css/practice.css、css/keypad.css）。别的界面（讲题的同构题、
// 确认屏的“改一行”）照这个接口用，改接口先在 CONTRACTS 第 13 节说。
//
// 导出
//   createAnswer(host, { kind, options = [], unit = '', placeholder = '', onSubmit, letters, variable, context }) ->
//     { el, value(), set(text), clear(), focus(), destroy(), lock(on), fold(on) }
//     kind   mathcheck 的 kind。number | expr | equation | set 出小键盘：计算题不出字母，expr 出 a b x y m n，
//            equation 出“x =”，set 出“或”，unit 里有 ° 的出 ° ′ ″；choice 出选项按钮（options 是选项文字，
//            “A. 3”“B、-3”或者光是“3”都行），点一下就交，onSubmit 收到字母；compare 出 < = > 三个按钮，收到符号；
//            text 出“在纸上写好了，对照看”，onSubmit 收到 { self: true }
//     unit   印在画好的式子后面（cm、人），像卷子上印好的单位；含 ° 的不印，改出 ° ′ ″ 键
//     letters  可选，这道题要用的字母（比如答案里有 p）；不给就按 kind 出默认的
//     context  可选，题目（和答案）的文字：里面出现的小写字母自动放上键盘（Emma 10-25：题里有 d 却找不到 d）
//     每个一行输入的键盘都有 π 和“ABC”（展开 a 到 z），题目里没出现的字母也打得出来
//     variable 可选，equation 的“x =”键用哪个字母
//     onSubmit(text)  调用方用 mathcheck.check 判。输入行的文字 mathcheck 都能读：分数写成 (a)/(b)，乘方 a^b，
//            × ÷ − 原样，“或”隔开几个答案
//     lock(on)  判题、等提示时先锁住；fold(on)  做完这题收起键盘，只留她填的答案
//   以下是纯函数（node 测试用，tests/keypad.test.mjs）
//   toLatex(text) -> LaTeX            输入行 -> mathview.renderMath 用的式子：(1)/(3) 画成分数，2^3 画成上标，空格子画成 □
//   pressKey(state, key, { variable }) -> state      state = { text, caret }；key 是键的 id（见 KEY_INSERT）或一个字
//   insertFrac(state), backspace(state), moveCaret(state, dir), snapCaret(text, caret)
//   keyLayout(kind, { unit, letters, variable, context }) -> { a, b, c: [] }   随题型变的三个位置上放什么键
//   lettersFrom(text) -> ['d', 'x']   题目文字里当字母用的小写字母（去掉 \frac、cm 这类），按出现的顺序
//   splitOption(text, i) -> { letter, text }    选项文字拆出字母
//   normalizeChar(ch) -> 允许的字或 ''   外接键盘、set() 进来的字统一成输入行用的写法
//   MAX_LEN
//
// 为什么不用 <input>：一点就弹系统键盘，挡住半个屏幕，而且系统键盘找不到 ÷、分数。这里的输入行是自己画的，
// 外接键盘照样能打（document 上听 keydown，只给最近用过、正在显示的那一个控件）。
// 依赖：mathview.js（预览）、ui-dom.js（建元素）。模块顶层不碰 document。
import { renderMath } from './mathview.js';
import { h, mathText } from './ui-dom.js';

export const MAX_LEN = 64;
export const DEFAULT_LETTERS = ['x', 'a', 'b', 'y', 'm', 'n'];
const ANGLES = ['°', '′', '″'];
const LINE_KINDS = new Set(['number', 'expr', 'equation', 'set']);

// ---------------------------------------------------------------- 输入行里的字

// 键 id -> 插进去的字（分数、乘方、左括号另有规矩，见 pressKey）
export const KEY_INSERT = {
  d0: '0', d1: '1', d2: '2', d3: '3', d4: '4', d5: '5', d6: '6', d7: '7', d8: '8', d9: '9',
  dot: '.', plus: '+', minus: '-', times: '×', div: '÷', eq: '=', or: '或', rp: ')',
  deg: '°', min: '′', sec: '″', pow: '^', pi: 'π',
};

// 外接键盘和 set() 进来的字：统一成输入行的写法；不认识的丢掉（不会让奇怪的字进到 mathcheck）
export function normalizeChar(ch) {
  const c = String(ch || '');
  if (c.length !== 1) return c === '或' ? '或' : '';
  if (/[0-9a-zA-Z.]/.test(c)) return c;
  const map = {
    '+': '+', '＋': '+', '-': '-', '−': '-', '–': '-', '－': '-', '﹣': '-', '*': '×', '×': '×', '·': '×', '÷': '÷',
    '/': '/', '(': '(', '（': '(', '[': '(', ')': ')', '）': ')', ']': ')', '=': '=', '＝': '=', '<': '<', '>': '>',
    '≤': '≤', '≥': '≥', '^': '^', '|': '|', '°': '°', "'": '′', '′': '′', '"': '″', '″': '″', ',': ',', '，': ',',
    '、': ',', '或': '或', '%': '%', '．': '.', '。': '.', '±': '±', 'π': 'π',
  };
  return map[c] || '';
}

const isOpen = c => c === '(';
const isClose = c => c === ')';
// i 处的 ")" 配对的 "(" 下标；没有返回 -1
export function matchOpen(text, i) {
  let depth = 0;
  for (let j = i; j >= 0; j--) {
    if (isClose(text[j])) depth++;
    else if (isOpen(text[j]) && --depth === 0) return j;
  }
  return -1;
}
// i 处的 "(" 配对的 ")" 下标
export function matchClose(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (isOpen(text[j])) depth++;
    else if (isClose(text[j]) && --depth === 0) return j;
  }
  return -1;
}
const RUN = /[0-9a-zA-Z.°′″%]/;
// 一串数字字母（2ab、3.5、37°30′）：拆开分子分母时不用加括号
const simpleRun = s => s.length > 0 && [...s].every(c => RUN.test(c));
const isGroup = s => s.length >= 2 && s[0] === '(' && matchClose(s, 0) === s.length - 1;

// 光标前面那一“块”从哪儿开始：一串数字字母、一对括号、|…|，连着乘方和紧挨着的乘积（3x^2、2(x+1)）。没有就是光标处
export function atomStart(text, end) {
  let i = end;
  const core = () => {
    if (i <= 0) return false;
    const c = text[i - 1];
    if (c === ')') { const j = matchOpen(text, i - 1); if (j < 0) return false; i = j; return true; }
    if (c === '|') { const j = text.lastIndexOf('|', i - 2); if (j < 0) return false; i = j; return true; }
    if (RUN.test(c)) { while (i > 0 && RUN.test(text[i - 1])) i--; return true; }
    return false;
  };
  if (!core()) return end;
  for (;;) {
    if (i > 1 && text[i - 1] === '^') { const save = i; i--; if (!core()) { i = save; break; } continue; }
    if (i > 0 && /[0-9a-zA-Z.)°′″%]/.test(text[i - 1])) { if (!core()) break; continue; }
    break;
  }
  return i;
}

// “分数”键：光标前有一块（3、2a、(x+1)）就把它当分子，光标进分母；什么都没有就放一个空的 ()/()，光标进分子
export function insertFrac({ text, caret }) {
  const start = atomStart(text, caret);
  if (text.length + 5 > MAX_LEN) return { text, caret };
  if (start === caret) return { text: text.slice(0, caret) + '()/()' + text.slice(caret), caret: caret + 1 };
  const atom = text.slice(start, caret);
  const num = isGroup(atom) ? atom : '(' + atom + ')';
  return { text: text.slice(0, start) + num + '/()' + text.slice(caret), caret: start + num.length + 2 };
}

function insert({ text, caret }, s) {
  if (!s || text.length + s.length > MAX_LEN) return { text, caret };
  return { text: text.slice(0, caret) + s + text.slice(caret), caret: caret + s.length };
}

// 一个键（id 或一个字）按下去以后的样子。括号自动成对；光标后面正好是 ")" 时按 ")" 只往右走一格
export function pressKey(state, key, { variable = 'x' } = {}) {
  const s = { text: String(state.text || ''), caret: Math.max(0, Math.min(Number(state.caret) || 0, String(state.text || '').length)) };
  if (key === 'frac') return insertFrac(s);
  if (key === 'bs') return backspace(s);
  if (key === 'left') return moveCaret(s, -1);
  if (key === 'right') return moveCaret(s, 1);
  if (key === 'home') return { ...s, caret: 0 };
  if (key === 'end') return { ...s, caret: s.text.length };
  if (key === 'var') return insert(s, `${variable}=`);
  if (/^L[a-zA-Z]$/.test(key)) return insert(s, key[1]);
  const ch = key === 'lp' ? '(' : KEY_INSERT[key] !== undefined ? KEY_INSERT[key] : normalizeChar(key);
  if (!ch) return s;
  if (ch === '/') return insertFrac(s);
  if (ch === '(') return s.text.length + 2 > MAX_LEN ? s : { text: s.text.slice(0, s.caret) + '()' + s.text.slice(s.caret), caret: s.caret + 1 };
  if (ch === ')' && s.text[s.caret] === ')') return { ...s, caret: s.caret + 1 };
  return insert(s, ch);
}

// 光标不停在 ")/(" 中间：那里打字会把分数拆坏
export function snapCaret(text, caret) {
  if (text.slice(caret - 1, caret + 2) === ')/(') return caret - 1;
  if (text.slice(caret - 2, caret + 1) === ')/(') return caret + 1;
  return caret;
}

// ← →：分子分母之间的 ")/(" 一步跨过去
export function moveCaret({ text, caret }, dir) {
  let c = caret;
  if (dir < 0) c = text.slice(c - 3, c) === ')/(' ? c - 3 : Math.max(0, c - 1);
  else c = text.slice(c, c + 3) === ')/(' ? c + 3 : Math.min(text.length, c + 1);
  return { text, caret: snapCaret(text, c) };
}

// ⌫：一般删一个字；碰到括号和分数时按结构来，不留下半对括号
export function backspace({ text, caret }) {
  if (caret <= 0) return { text, caret: 0 };
  const prev = text[caret - 1], next = text[caret];
  if (prev === '(' && next === ')') {
    // 空分母 (A)/(|)：分数拆掉，留下分子
    if (text.slice(caret - 3, caret) === ')/(') {
      const j = matchOpen(text, caret - 3);
      if (j >= 0) {
        const inner = text.slice(j + 1, caret - 3);
        const keep = !inner || simpleRun(inner) ? inner : '(' + inner + ')';
        return { text: text.slice(0, j) + keep + text.slice(caret + 1), caret: j + keep.length };
      }
    }
    // 空分子 (|)/(B)：分数拆掉，留下分母
    if (text.slice(caret + 1, caret + 3) === '/(') {
      const k = matchClose(text, caret + 2);
      if (k >= 0) {
        const inner = text.slice(caret + 3, k);
        const keep = !inner || simpleRun(inner) ? inner : '(' + inner + ')';
        return { text: text.slice(0, caret - 1) + keep + text.slice(k + 1), caret: caret - 1 };
      }
    }
    // 空括号 (|)：一起删
    return { text: text.slice(0, caret - 1) + text.slice(caret + 1), caret: caret - 1 };
  }
  if (prev === '(') {
    // 分母开头：退回分子末尾
    if (text.slice(caret - 3, caret) === ')/(') return { text, caret: caret - 3 };
    const k = matchClose(text, caret - 1);
    // 分子开头：跳到分数前面
    if (k >= 0 && text.slice(k + 1, k + 3) === '/(') return { text, caret: caret - 1 };
    // 普通括号的开头：这对括号拆掉，里面的留着
    if (k >= 0) return { text: text.slice(0, caret - 1) + text.slice(caret, k) + text.slice(k + 1), caret: caret - 1 };
  }
  // 配好对的 ")" 不删，光标进到括号里面（再按就删里面的字）
  if (prev === ')' && matchOpen(text, caret - 1) >= 0) return { text, caret: snapCaret(text, caret - 1) };
  return { text: text.slice(0, caret - 1) + text.slice(caret), caret: caret - 1 };
}

// ---------------------------------------------------------------- 预览：输入行 -> LaTeX

const SQUARE = '\\square ';
// 输入行一律只有上面这些字；别的字（外接键盘打进来的花括号、反斜杠）在这里丢掉，不会变成 LaTeX 命令
export function toLatex(text) {
  const s = String(text ?? '');
  let i = 0;

  // 读到 stop 为止，返回 [{ t: 'atom' | 'op' | 'pow' | 'frac', latex, inner }]
  function items(stop) {
    const out = [];
    while (i < s.length) {
      const c = s[i];
      if (c === stop) break;
      if (c === ')' && stop !== ')') { i++; out.push({ t: 'atom', latex: ')', inner: ')' }); continue; }   // 多出来的右括号照画
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        let lat = s.slice(i, j);
        i = j;
        while (i < s.length && /[°′″%]/.test(s[i])) { lat += s[i] === '%' ? '\\%' : s[i]; i++; }
        out.push({ t: 'atom', latex: lat, inner: lat });
        continue;
      }
      if (/[a-zA-Z]/.test(c)) { i++; out.push({ t: 'atom', latex: c, inner: c }); continue; }
      if (c === '(') {
        i++;
        const inner = render(items(')'));
        const closed = s[i] === ')';
        if (closed) i++;
        out.push({ t: 'atom', latex: '(' + (inner || SQUARE) + (closed ? ')' : ''), inner: inner || SQUARE, group: true });
        continue;
      }
      if (c === '|') {
        i++;
        const inner = render(items('|'));
        if (s[i] === '|') i++;
        out.push({ t: 'atom', latex: '|' + (inner || SQUARE) + '|', inner: '|' + (inner || SQUARE) + '|' });
        continue;
      }
      i++;
      if (c === '^') { out.push({ t: 'pow' }); continue; }
      if (c === '/') { out.push({ t: 'frac' }); continue; }
      const op = { '+': '+', '-': '-', '×': '\\times ', '÷': '\\div ', '=': '=', '<': '<', '>': '>', '≤': '\\le ', '≥': '\\ge ', ',': ',\\ ', '±': '\\pm ' }[c];
      if (op) { out.push({ t: 'op', latex: op, sign: c === '-' || c === '+' }); continue; }
      if (/[°′″]/.test(c)) { out.push({ t: 'atom', latex: c, inner: c }); continue; }
      if (c === '%') { out.push({ t: 'atom', latex: '\\%', inner: '\\%' }); continue; }
      if (/[一-鿿]/.test(c)) { out.push({ t: 'op', latex: `\\text{ ${c} }` }); continue; }
      // 其他字（空格、花括号、反斜杠）不画
    }
    return out;
  }

  // 乘方先合：底数 ^ 指数（指数是一块；括号里的去掉一层括号）。再合分数：左边一块 / 右边一块（右边可以带正负号）
  function render(list) {
    const a = [];
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      if (it.t !== 'pow') { a.push(it); continue; }
      const base = a.length && a[a.length - 1].t === 'atom' ? a.pop() : { t: 'atom', latex: SQUARE, inner: SQUARE };
      const exp = list[k + 1] && list[k + 1].t === 'atom' ? list[++k] : null;
      const e = exp ? (exp.group ? exp.inner : exp.latex) : SQUARE;
      const latex = `{${base.latex}}^{${e}}`;
      a.push({ t: 'atom', latex, inner: latex });
    }
    const b = [];
    for (let k = 0; k < a.length; k++) {
      const it = a[k];
      if (it.t !== 'frac') { b.push(it); continue; }
      const num = b.length && b[b.length - 1].t === 'atom' ? b.pop() : null;
      let sign = '';
      if (a[k + 1] && a[k + 1].t === 'op' && a[k + 1].sign && a[k + 2] && a[k + 2].t === 'atom') sign = a[++k].latex;
      const den = a[k + 1] && a[k + 1].t === 'atom' ? a[++k] : null;
      const part = x => (x ? (x.group ? x.inner : x.latex) : SQUARE);
      const latex = `\\frac{${part(num)}}{${sign}${part(den)}}`;
      b.push({ t: 'atom', latex, inner: latex });
    }
    return b.map(x => x.latex).join('');
  }

  return render(items(null));
}

// ---------------------------------------------------------------- 随题型变的键

// 三个会变的位置：a（第一行倒数第二格：字母或“x =”）、b（第二行倒数第二格：“或”）、c（最后一行中间五格：字母、° ′ ″）
// 题目文字里当字母用的小写字母：去掉 LaTeX 命令（\frac、\text）、单位和英文词（cm、kg、abc 这种连着的两个以上字母），
// 只留单独出现的 a 到 z；大写的点名（A、B、C、M）不算，答案里用不到
export function lettersFrom(text) {
  const t = String(text || '').replace(/\\[a-zA-Z]+/g, ' ').replace(/[a-zA-Z]{2,}/g, ' ');
  return [...new Set(t.match(/[a-z]/g) || [])];
}

// 三个会变的位置：a（第一行倒数第二格：字母或“x =”）、b（第二行倒数第二格：“或”）、c（最后一行中间几格：字母、π、ABC、° ′ ″）
export function keyLayout(kind, { unit = '', letters = null, variable = 'x', context = '' } = {}) {
  const angle = /°/.test(String(unit || ''));
  const fromText = lettersFrom(context);
  const given = Array.isArray(letters) && letters.length ? [...letters, ...fromText] : fromText.length ? fromText : kind === 'expr' ? DEFAULT_LETTERS : [];
  const ls = [...new Set(given.map(String).filter(ch => /^[a-zA-Z]$/.test(ch)))];
  const letterKey = ch => ({ id: 'L' + ch, label: ch, aria: '字母 ' + ch, cls: 'kp-letter' });
  let a = null;
  const b = kind === 'set' ? { id: 'or', label: '或', aria: '或' } : null;
  if (kind === 'equation') {
    a = { id: 'var', label: `${variable} =`, aria: `${variable} 等于`, cls: 'kp-letter' };
    const at = ls.indexOf(variable);
    if (at >= 0) ls.splice(at, 1);
  } else if (ls.length) {
    const x = ls.includes('x') ? 'x' : ls[0];
    a = letterKey(x);
    ls.splice(ls.indexOf(x), 1);
  }
  const angleKeys = angle ? [{ id: 'deg', label: '°', aria: '度' }, { id: 'min', label: '′', aria: '分' }, { id: 'sec', label: '″', aria: '秒' }] : [];
  const always = [{ id: 'pi', label: 'π', aria: '派', cls: 'kp-letter' }, { id: 'abc', label: 'ABC', aria: '更多字母', cls: 'kp-word' }];
  const room = Math.max(0, 6 - angleKeys.length - always.length);
  const c = [...ls.slice(0, room).map(letterKey), ...angleKeys, ...always];
  return { a, b, c };
}

// 固定的键：[id, 字, 读屏的名字, 格子名]
const FIXED = [
  ['d7', '7'], ['d8', '8'], ['d9', '9'], ['div', '÷', '除以'], ['lp', '(', '左括号'], ['rp', ')', '右括号'],
  ['d4', '4'], ['d5', '5'], ['d6', '6'], ['times', '×', '乘'], ['frac', '分数', '分数'], ['pow', '乘方', '乘方'],
  ['d1', '1'], ['d2', '2'], ['d3', '3'], ['minus', '−', '减号或负号'], ['plus', '+', '加'], ['eq', '=', '等于'], ['dot', '.', '小数点'],
  ['d0', '0'],
];
const AREA = { d7: 'k7', d8: 'k8', d9: 'k9', div: 'kdiv', lp: 'klp', rp: 'krp', d4: 'k4', d5: 'k5', d6: 'k6', times: 'kmul', frac: 'kfrac',
  pow: 'kpow', d1: 'k1', d2: 'k2', d3: 'k3', minus: 'kmin', plus: 'kplus', eq: 'keq', dot: 'kdot', d0: 'k0' };

// 选项文字拆出字母：“A. 3”“B、−3”“(C) 5” -> 字母 + 后面的字；没写字母的按顺序给 A B C D
export function splitOption(text, i = 0) {
  const s = String(text ?? '');
  // 只认大写字母加标点（“A.”“B、”“(C)”）：“a 是正数”“A 在 B 左边”里的字母是题里的字母，不是选项号
  const m = /^\s*(?:[(（]([A-H])[)）]|([A-H])\s*[.．、:：)）])\s*/.exec(s);
  if (m) return { letter: m[1] || m[2], text: s.slice(m[0].length) };
  return { letter: 'ABCDEFGH'[i] || String(i + 1), text: s };
}

// ---------------------------------------------------------------- 外接键盘：只给最近用过、正在显示的控件
const live = [];
let active = null;
function visible(w) { return w.el.isConnected && w.el.offsetParent !== null; }
function onDocKey(e) {
  if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  const w = active && live.includes(active) && visible(active) ? active : live.filter(visible).pop();
  if (w && w.key(e)) e.preventDefault();
}
function register(w) {
  if (!live.length && typeof document !== 'undefined') document.addEventListener('keydown', onDocKey);
  live.push(w);
  active = w;
}
function unregister(w) {
  const at = live.indexOf(w);
  if (at >= 0) live.splice(at, 1);
  if (active === w) active = live[live.length - 1] || null;
  if (!live.length && typeof document !== 'undefined') document.removeEventListener('keydown', onDocKey);
}

// ---------------------------------------------------------------- 控件
export function createAnswer(host, { kind = 'number', options = [], unit = '', placeholder = '', onSubmit = () => {}, letters = null, variable = 'x', context = '' } = {}) {
  const k = LINE_KINDS.has(kind) || kind === 'choice' || kind === 'compare' || kind === 'text' ? kind : 'number';
  let locked = false;
  let state = { text: '', caret: 0 };
  let picked = '';
  const el = h('div', { className: 'kp kp-' + k, dataset: { kind: k } });
  const w = { el, key: () => false };
  const submit = v => { if (!locked) onSubmit(v); };

  if (k === 'choice' || k === 'compare') {
    const list = k === 'compare'
      ? [['<', '小于'], ['=', '等于'], ['>', '大于']].map(([sym, name]) => ({ letter: sym, text: '', aria: name }))
      : options.map((o, i) => ({ ...splitOption(o, i), aria: '' }));
    const btns = list.map(o => h('button', {
      type: 'button', className: k === 'compare' ? 'kp-cmp' : 'kp-opt', dataset: { v: o.letter }, 'aria-label': o.aria || null,
      on: { click: () => { setActive(); pick(o.letter, true); } },
    }, k === 'compare' ? o.letter : [h('b', { className: 'kp-opt-l', text: o.letter }), mathText(o.text, { className: 'kp-opt-t' })]));
    const box = h('div', { className: k === 'compare' ? 'kp-cmps' : 'kp-opts', role: 'group', 'aria-label': k === 'compare' ? '选一个符号' : '选一个答案' }, btns);
    el.append(box);
    const pick = (v, send) => {
      if (locked) return;
      picked = v;
      for (const b of btns) { b.classList.toggle('picked', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'); }
      if (send) submit(v);
    };
    w.key = e => {
      if (locked) return false;
      const key = e.key;
      if (k === 'compare') {
        const v = { '<': '<', ',': '<', '=': '=', '>': '>', '.': '>' }[key];
        if (v) { pick(v, true); return true; }
        return false;
      }
      const up = String(key).toUpperCase();
      const byLetter = btns.find(b => b.dataset.v === up);
      const byNum = /^[1-8]$/.test(key) ? btns[Number(key) - 1] : null;
      const b = byLetter || byNum;
      if (b) { pick(b.dataset.v, true); return true; }
      return false;
    };
    Object.assign(w, {
      value: () => picked,
      set: v => pick(k === 'compare' ? String(v || '').trim() : String(v || '').trim().toUpperCase(), false),
      clear: () => { picked = ''; for (const b of btns) { b.classList.remove('picked'); b.setAttribute('aria-pressed', 'false'); } },
      focus: () => { setActive(); const b = btns.find(x => x.classList.contains('picked')) || btns[0]; if (b) b.focus({ preventScroll: true }); },
      lockKeys: on => { for (const b of btns) b.disabled = on; },
    });
  } else if (k === 'text') {
    const go = h('button', { type: 'button', className: 'btn quiet kp-paper', text: '在纸上写好了，对照看', on: { click: () => { setActive(); submit({ self: true }); } } });
    el.append(h('p', { className: 'small kp-paper-note', text: placeholder || '这道在纸上写。写好了点下面，和答案对照。' }), go);
    w.key = e => { if (!locked && e.key === 'Enter') { submit({ self: true }); return true; } return false; };
    Object.assign(w, { value: () => '', set: () => {}, clear: () => {}, focus: () => { setActive(); go.focus({ preventScroll: true }); }, lockKeys: on => { go.disabled = on; } });
  } else {
    // 一行输入：上面是画好的式子，下面是她打的字和光标
    const layout = keyLayout(k, { unit, letters, variable, context });
    // 单位印在画好的式子后面（“3 或 7 cm”），像卷子上印好的空：她只填数
    const math = h('span', { className: 'kp-math' });
    const showUnit = unit && !/°/.test(unit) ? h('span', { className: 'kp-unit', text: unit }) : null;
    const preview = h('div', { className: 'kp-preview', 'aria-hidden': 'true' }, math, showUnit);
    const line = h('div', { className: 'kp-line', tabIndex: 0, role: 'textbox', 'aria-label': '答案', 'aria-multiline': 'false' });
    const screen = h('div', { className: 'kp-screen' }, preview, h('div', { className: 'kp-row' }, line));
    const caretEl = h('span', { className: 'kp-caret', 'aria-hidden': 'true' });
    const keys = h('div', { className: 'kp-keys', role: 'group', 'aria-label': '小键盘' });
    const keyBtns = [];
    const keyBtn = (def, area) => {
      const b = h('button', {
        type: 'button', className: 'kp-k' + (def.cls ? ' ' + def.cls : '') + (def.op ? ' kp-op' : ''), text: def.label,
        'aria-label': def.aria || null, dataset: { k: def.id },
        on: { click: () => { setActive(); if (def.id === 'abc') toggleAbc(); else apply(def.id); } },
      });
      if (area) b.style.gridArea = area;
      keyBtns.push(b);
      return b;
    };
    for (const [id, label, aria] of FIXED) {
      const op = /^(div|times|minus|plus|eq|lp|rp|frac|pow|dot)$/.test(id);
      keys.append(keyBtn({ id, label, aria, op, cls: id === 'frac' || id === 'pow' ? 'kp-word' : '' }, AREA[id]));
    }
    const slot = (def, area) => (def ? keyBtn(def, area) : (() => { const d = h('span', { className: 'kp-blank', 'aria-hidden': 'true' }); d.style.gridArea = area; return d; })());
    keys.append(slot(layout.a, 'ka'), slot(layout.b, 'kb'));
    const cRow = h('div', { className: 'kp-c' }, layout.c.map(d => keyBtn(d)));
    cRow.style.gridArea = 'kc';
    keys.append(cRow);
    // ⌫ 按住不放会连着删
    const bs = h('button', { type: 'button', className: 'kp-k kp-fn', text: '⌫', 'aria-label': '删掉一个字', dataset: { k: 'bs' } });
    bs.style.gridArea = 'kbs';
    let rep = 0, held = false;
    const stopRep = () => { clearTimeout(rep); clearInterval(rep); rep = 0; };
    bs.addEventListener('pointerdown', () => {
      if (locked) return;
      setActive(); held = true; apply('bs');
      stopRep();
      rep = setTimeout(() => { rep = setInterval(() => { if (locked || !state.text) stopRep(); else apply('bs'); }, 90); }, 450);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) bs.addEventListener(ev, stopRep);
    bs.addEventListener('click', () => { if (held) { held = false; return; } setActive(); apply('bs'); });
    keyBtns.push(bs);
    const mv = h('div', { className: 'kp-mv' },
      keyBtn({ id: 'left', label: '←', aria: '光标往左', cls: 'kp-fn' }), keyBtn({ id: 'right', label: '→', aria: '光标往右', cls: 'kp-fn' }));
    mv.style.gridArea = 'kmv';
    const ok = h('button', { type: 'button', className: 'kp-k kp-ok', text: '好了', on: { click: () => { setActive(); send(); } } });
    ok.style.gridArea = 'kok';
    keyBtns.push(ok);
    keys.append(bs, mv, ok);
    // ABC：展开 a 到 z，题目里没出现的字母也打得出来；按一个字母就收起
    const abc = h('div', { className: 'kp-abc', role: 'group', 'aria-label': '全部字母', hidden: true },
      [...'abcdefghijklmnopqrstuvwxyz'].map(ch => h('button', { type: 'button', className: 'kp-k kp-letter', text: ch, 'aria-label': '字母 ' + ch,
        on: { click: () => { setActive(); apply('L' + ch); toggleAbc(false); } } })));
    function toggleAbc(on) { abc.hidden = on === undefined ? !abc.hidden : !on; }
    el.append(screen, keys, abc);

    const shown = c => (c === '-' ? '−' : c);
    function paint() {
      const chars = [...state.text];
      const nodes = [];
      chars.forEach((c, i) => {
        if (i === state.caret) nodes.push(caretEl);
        nodes.push(h('span', { className: 'kp-ch', dataset: { i: String(i) }, text: shown(c) }));
      });
      if (state.caret >= chars.length) nodes.push(caretEl);
      if (!chars.length && placeholder) nodes.push(h('span', { className: 'kp-ph', text: placeholder }));
      line.replaceChildren(...nodes);
      line.setAttribute('aria-label', state.text ? '答案：' + chars.map(shown).join('') : '答案，还没写');
      math.innerHTML = state.text ? renderMath(toLatex(state.text)) : '';   // renderMath 自己转义
      ok.disabled = locked || !state.text.trim();
    }
    function apply(id) {
      if (locked) return;
      state = pressKey(state, id, { variable });
      paint();
    }
    function send() {
      if (locked || !state.text.trim()) return;
      submit(state.text);
    }
    // 点输入行里的字：光标挪到点的那一边
    line.addEventListener('click', e => {
      setActive();
      const span = e.target && e.target.closest ? e.target.closest('.kp-ch') : null;
      let c = state.text.length;
      if (span) {
        const i = Number(span.dataset.i);
        const r = span.getBoundingClientRect();
        c = e.clientX > r.left + r.width / 2 ? i + 1 : i;
      }
      state = { ...state, caret: snapCaret(state.text, c) };
      paint();
    });
    w.key = e => {
      if (locked) return false;
      const key = e.key;
      if (key === 'Enter') { send(); return true; }
      if (key === 'Backspace') { apply('bs'); return true; }
      if (key === 'ArrowLeft') { apply('left'); return true; }
      if (key === 'ArrowRight') { apply('right'); return true; }
      if (key === 'Home') { apply('home'); return true; }
      if (key === 'End') { apply('end'); return true; }
      if (key && key.length === 1 && normalizeChar(key)) { apply(key); return true; }
      return false;
    };
    Object.assign(w, {
      value: () => state.text,
      set: text => {
        const t = [...String(text ?? '')].map(normalizeChar).join('').slice(0, MAX_LEN);
        state = { text: t, caret: t.length };
        paint();
      },
      clear: () => { state = { text: '', caret: 0 }; paint(); },
      focus: () => { setActive(); line.focus({ preventScroll: true }); },
      lockKeys: on => { for (const b of keyBtns) b.disabled = on; if (!on) paint(); },
    });
    paint();
  }

  function setActive() { active = w; }
  host.append(el);
  register(w);
  return {
    el,
    value: () => w.value(),
    set: v => w.set(v),
    clear: () => w.clear(),
    focus: () => w.focus(),
    lock(on = true) { locked = !!on; el.classList.toggle('kp-locked', locked); w.lockKeys(locked); },
    fold(on = true) { el.classList.toggle('kp-folded', !!on); },
    destroy() { unregister(w); el.remove(); },
  };
}
