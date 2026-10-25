// 本机题型模板（DESIGN 5.6）：期中范围里最高频、程序能算的 8 个坑，程序随机取数，答案和陷阱答案也是程序算的。
// 不花钱、不用等、不会算错；出来的题和模型出的变式题同一个形状，放进卡的池子里照样用（checked 'program'）。
//
//   hasTemplate(tag) -> bool,  TEMPLATE_TAGS,  templateInfo(tag) -> { tag, name, section } | null
//   makeVariant(tag, level, { rng, avoid }) -> Variant | null
//   makeVariants(tag, levels, { rng, avoid }) -> Variant[]         每个 level 一道，题面互不相同、也不和 avoid 里的重复
//   makeRng(seed) -> () => [0, 1)                                  测试用的可重复随机数
//
// Variant = { level, q, answer, answer_kind, form, unit, trap, trap_answer, steps, checked: 'program', template: tag }
// level 同 prompts.js：'同构' | '近变式' | '辨析' | '远变式'（别的名字按近变式出）。
// 每道题出之前都用 mathcheck 再算一遍：本机算的答案和 mathcheck 对不上、或陷阱答案和答案没区别，这道题就不出。
// 第 4 章以后的坑（E-paren-minus 等）她学到再加；E-subst-neg-paren 要学到 3.2，调用方看 templateInfo(tag).section。

import { check, compute, Frac, fmt } from './mathcheck.js';

export const LEVELS = ['同构', '近变式', '辨析', '远变式'];

export function makeRng(seed = 1) {   // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = rng => ({
  int: (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)),
  pick: arr => arr[Math.floor(rng() * arr.length)],
  chance: p => rng() < p,
});

// 小零件。负号统一写成 ASCII 的 -（mathcheck 和 mathview 都认）
const sq = n => n * n;
const num = n => String(n);
const set = list => [...new Set(list)].join(' 或 ');
const frac1 = k => `\\frac{1}{${k}}`;

// ---------------------------------------------------------------- 8 个模板
// gen(level, r) -> { q, answer, trap_answer, trap, answer_kind?, form?, steps? }   q 里的数学写在 \( \) 里
// 注：同一个模板里各层的陷阱就是那个坑本身，trap 是写给她看的一句话（点名这个坑）。

const T = {};

T['E-pow-neg-paren'] = {
  name: '乘方前面的负号', section: '2.3.1',
  gen(level, r) {
    const trap = '负号在括号外面，平方只管紧挨着的那个数';
    if (level === '同构') {
      const n = r.pick([2, 2, 4]), a = n === 4 ? r.int(2, 3) : r.int(2, 9);
      return { q: `计算 \\(-${a}^${n}\\)`, answer: num(-(a ** n)), trap_answer: num(a ** n), trap,
        steps: [`没有括号，乘方只管 ${a}：${a}^${n} = ${a ** n}`, `再带上前面的负号：-${a ** n}`] };
    }
    if (level === '辨析') {
      const a = r.int(2, 6);
      return r.chance(0.5)
        ? { q: `计算 \\(-${a}^2+(-${a})^2\\)`, answer: '0', trap_answer: num(2 * sq(a)), trap: '两种写法放在一起比：一个有括号，一个没有',
          steps: [`-${a}^2 = -${sq(a)}`, `(-${a})^2 = ${sq(a)}`, '相加得 0'] }
        : { q: `计算 \\(-${a}^2-(-${a})^2\\)`, answer: num(-2 * sq(a)), trap_answer: '0', trap: '两种写法放在一起比：一个有括号，一个没有',
          steps: [`-${a}^2 = -${sq(a)}`, `(-${a})^2 = ${sq(a)}`, `-${sq(a)} - ${sq(a)} = ${-2 * sq(a)}`] };
    }
    if (level === '远变式') {
      const a = r.int(2, 5), b = r.int(2, 4), c = r.int(1, 6);
      return { q: `计算 \\(-${a}^2\\times ${b}-(-${c})\\)`, answer: num(-sq(a) * b + c), trap_answer: num(sq(a) * b + c), trap: '第一步乘方就是这个坑',
        steps: [`-${a}^2 = -${sq(a)}`, `-${sq(a)}×${b} = ${-sq(a) * b}`, `${-sq(a) * b} + ${c} = ${-sq(a) * b + c}`] };
    }
    const a = r.int(2, 9), b = r.int(2, 6), c = r.int(2, 6), plus = r.chance(0.5);
    const k = plus ? b * c : -b * c;
    return { q: `计算 \\(-${a}^2${plus ? '+' : '-'}${b}\\times ${c}\\)`, answer: num(-sq(a) + k), trap_answer: num(sq(a) + k), trap,
      steps: [`-${a}^2 = -${sq(a)}`, `${b}×${c} = ${b * c}`, `${-sq(a)} ${plus ? '+' : '-'} ${b * c} = ${-sq(a) + k}`] };
  },
};

T['E-sub-neg'] = {
  name: '减去负数要改两处', section: '2.2',
  gen(level, r) {
    const trap = '减去一个负数，要把减号变成加号，同时去掉那个数的负号';
    const a = r.int(-9, 9) || 4, b = r.int(2, 9), c = r.int(1, 9);
    if (level === '同构') {
      return { q: `计算 \\(${a}-(-${b})\\)`, answer: num(a + b), trap_answer: num(a - b), trap,
        steps: [`减去 -${b}，等于加上 ${b}`, `${a} + ${b} = ${a + b}`] };
    }
    if (level === '辨析') {
      return { q: `计算 \\(${a}-(-${b})-(${a}+(-${b}))\\)`, answer: num(2 * b), trap_answer: '0', trap: '一个是减去负数，一个是加上负数，结果不一样',
        steps: [`${a} - (-${b}) = ${a + b}`, `${a} + (-${b}) = ${a - b}`, `${a + b} - ${a - b} = ${2 * b}`] };
    }
    if (level === '远变式') {
      const d = r.int(1, 9), e = r.int(1, 9);
      return { q: `计算 \\(-${e}-(-${b})-${c}-(-${d})\\)`, answer: num(-e + b - c + d), trap_answer: num(-e - b - c - d), trap,
        steps: [`-(-${b}) 变成 +${b}，-(-${d}) 变成 +${d}`, `-${e} + ${b} - ${c} + ${d} = ${-e + b - c + d}`] };
    }
    const minus = r.chance(0.5);
    return { q: `计算 \\(${a}-(-${b})${minus ? '-' : '+'}${c}\\)`, answer: num(a + b + (minus ? -c : c)), trap_answer: num(a - b + (minus ? -c : c)), trap,
      steps: [`${a} - (-${b}) = ${a + b}`, `${a + b} ${minus ? '-' : '+'} ${c} = ${a + b + (minus ? -c : c)}`] };
  },
};

T['E-carry-sign'] = {
  name: '搬家带上符号', section: '2.2',
  gen(level, r) {
    const trap = '把一个数搬到别处，它前面的符号要一起带走';
    const tens = r.int(3, 9) * 10, x = r.int(11, tens - 11), y = tens - x;   // x + y 是整十，凑整好算
    let b = r.int(2, 30), d = r.int(2, 30);
    while (b === x || b === y) b = r.int(2, 30);   // 别让 b 和 x、y 一样：那样一眼就消掉，不用凑整
    if (level === '同构') {
      return { q: `计算 \\(-${x}+${b}-${y}\\)`, answer: num(-tens + b), trap_answer: num(-x + b + y),
        trap, steps: [`把 -${x} 和 -${y} 凑在一起：-${x} - ${y} = -${tens}`, `-${tens} + ${b} = ${-tens + b}`] };
    }
    if (level === '辨析') {
      const z = r.int(2, 20);
      return { q: `计算 \\(-${x}+${b}-${y}-(-${z})\\)`, answer: num(-tens + b + z), trap_answer: num(-x + b + y + z), trap,
        steps: [`-(-${z}) 变成 +${z}`, `-${x} - ${y} = -${tens}`, `-${tens} + ${b} + ${z} = ${-tens + b + z}`] };
    }
    if (level === '远变式') {
      const e = r.int(2, 30);
      return { q: `计算 \\(-${x}+${b}-${y}-${d}+${e}\\)`, answer: num(-tens + b - d + e), trap_answer: num(-x + b + y - d + e), trap,
        steps: [`-${x} - ${y} = -${tens}`, `${b} - ${d} + ${e} = ${b - d + e}`, `${-tens} + ${b - d + e} = ${-tens + b - d + e}`] };
    }
    return { q: `计算 \\(-${x}+${b}-${y}-${d}\\)`, answer: num(-tens + b - d), trap_answer: num(-x + b + y - d), trap,
      steps: [`-${x} - ${y} = -${tens}`, `${-tens} + ${b} - ${d} = ${-tens + b - d}`] };
  },
};

T['E-mul-sign-count'] = {
  name: '先数负号', section: '2.2',
  gen(level, r) {
    const trap = '先数有几个负号：奇数个得负，偶数个得正';
    // negCount 个负因数；其余因数为正
    const build = (count, negCount, divide) => {
      const vals = Array.from({ length: count }, () => r.int(2, 5));
      let negs = new Set();
      while (negs.size < negCount) negs.add(r.int(0, count - 1));
      let q = '', abs = 1;
      vals.forEach((v, i) => {
        const text = negs.has(i) ? `(-${v})` : String(v);
        const op = i === 0 ? '' : divide && i === 1 ? '\\div ' : '\\times ';
        q += op + text;
        abs = divide && i === 1 ? abs / v : abs * v;
      });
      return { q, abs, neg: negCount % 2 === 1 };
    };
    if (level === '远变式') {
      // 第一个因数是除数的整数倍，除得尽
      const d = r.int(2, 4), a = d * r.int(2, 4), c = r.int(2, 4), e = r.int(2, 3);
      const negs = r.pick([[0, 1, 2], [1, 2, 3], [0, 2, 3]]);
      const f = (v, i) => (negs.includes(i) ? `(-${v})` : String(v));
      const abs = (a / d) * c * e, neg = negs.length % 2 === 1;
      return { q: `计算 \\(${f(a, 0)}\\div ${f(d, 1)}\\times ${f(c, 2)}\\times ${f(e, 3)}\\)`, answer: num(neg ? -abs : abs),
        trap_answer: num(neg ? abs : -abs), trap, steps: [`${negs.length} 个负号，结果${neg ? '是负数' : '是正数'}`, `绝对值：${a}÷${d}×${c}×${e} = ${abs}`] };
    }
    const count = level === '近变式' ? 3 : 4;
    const negCount = level === '辨析' ? r.pick([2, 4].filter(k => k <= count)) : level === '同构' ? 3 : r.pick([1, 3].filter(k => k <= count));
    const { q, abs, neg } = build(count, negCount, false);
    return { q: `计算 \\(${q}\\)`, answer: num(neg ? -abs : abs), trap_answer: num(neg ? abs : -abs), trap,
      steps: [`数一数：${negCount} 个负号，结果${neg ? '是负数' : '是正数'}`, `绝对值相乘：${abs}`] };
  },
};

T['E-order-ops'] = {
  name: '先算乘方', section: '2.3.1',
  gen(level, r) {
    const trap = '混合运算：先算乘方，再乘除，最后加减';
    if (level === '辨析') {
      const a = r.int(2, 5), b = r.int(2, 5);
      return { q: `计算 \\(${a}\\times ${b}^2-(${a}\\times ${b})^2\\)`, answer: num(a * sq(b) - sq(a * b)), trap_answer: '0', trap: `${a}×${b}² 和 (${a}×${b})² 不一样：前者乘方只管 ${b}`,
        steps: [`${a}×${b}^2 = ${a}×${sq(b)} = ${a * sq(b)}`, `(${a}×${b})^2 = ${sq(a * b)}`, `${a * sq(b)} - ${sq(a * b)} = ${a * sq(b) - sq(a * b)}`] };
    }
    if (level === '远变式') {
      const a = r.int(2, 9), b = r.int(2, 6), c = r.int(2, 4);
      return { q: `计算 \\(-${a}+${b}\\times ${c}^2\\div ${c}\\)`, answer: num(-a + b * c), trap_answer: num((b - a) * c), trap,
        steps: [`${c}^2 = ${sq(c)}`, `${b}×${sq(c)}÷${c} = ${b * c}`, `-${a} + ${b * c} = ${-a + b * c}`] };
    }
    const a = r.int(2, 9), b = r.int(2, 6), c = r.int(2, 5);
    const minus = level === '近变式' && a > 0 && r.chance(0.6);
    const ans = minus ? a - b * sq(c) : a + b * sq(c), tr = minus ? (a - b) * sq(c) : (a + b) * sq(c);
    return { q: `计算 \\(${a}${minus ? '-' : '+'}${b}\\times ${c}^2\\)`, answer: num(ans), trap_answer: num(tr), trap,
      steps: [`先算乘方：${c}^2 = ${sq(c)}`, `再乘：${b}×${sq(c)} = ${b * sq(c)}`, `最后${minus ? '减' : '加'}：${a} ${minus ? '-' : '+'} ${b * sq(c)} = ${ans}`] };
  },
};

T['E-abs-two-values'] = {
  name: '绝对值有两个数', section: '1.2',
  gen(level, r) {
    const a = r.int(2, 9), b = r.int(1, 9);
    const ans = (...xs) => set(xs.map(num));
    if (level === '辨析') {   // 混进只有一种情况的题，免得她学成“答案总写两个”
      const neg = r.chance(0.5);
      const x = neg ? -a : a;
      return { q: `已知 \\(|x|=${a}\\)，且 \\(x${neg ? '<' : '>'}0\\)，\\(y=${b}\\)，求 \\(x+y\\) 的值`, answer: num(x + b),
        trap_answer: ans(a + b, -a + b), trap: '题目里有条件 x 是正还是负，只剩一个数', answer_kind: 'number',
        steps: [`|x| = ${a}，x = ${a} 或 -${a}`, `又 x ${neg ? '<' : '>'} 0，所以 x = ${x}`, `x + y = ${x + b}`] };
    }
    if (level === '远变式') {
      const cc = (() => { const c = r.int(1, 9); return c === a ? (a % 9) + 1 : c; })();
      const vals = [a + cc, a - cc, -a + cc, -a - cc];
      return { q: `已知 \\(|x|=${a}\\)，\\(|y|=${cc}\\)，求 \\(x+y\\) 的值`, answer: ans(...vals), trap_answer: num(a + cc),
        trap: 'x 有两个值，y 也有两个值，要全部搭配起来', answer_kind: 'set',
        steps: [`x = ${a} 或 -${a}，y = ${cc} 或 -${cc}`, `四种搭配：${vals.join('、')}`] };
    }
    if (level === '近变式') {
      return { q: `已知 \\(|x|=${a}\\)，\\(y=-${b}\\)，求 \\(x+y\\) 的值`, answer: ans(a - b, -a - b), trap_answer: num(a - b),
        trap: '绝对值等于一个正数，有两个数', answer_kind: 'set', steps: [`x = ${a} 或 -${a}`, `${a} + (-${b}) = ${a - b}`, `-${a} + (-${b}) = ${-a - b}`] };
    }
    return { q: `已知 \\(|x|=${a}\\)，\\(y=${b}\\)，求 \\(x+y\\) 的值`, answer: ans(a + b, -a + b), trap_answer: num(a + b),
      trap: '绝对值等于一个正数，有两个数', answer_kind: 'set', steps: [`x = ${a} 或 -${a}`, `${a} + ${b} = ${a + b}`, `-${a} + ${b} = ${-a + b}`] };
  },
};

T['E-sci-notation'] = {
  name: '科学记数法的 a', section: '1.5.2',
  gen(level, r) {
    const digits = r.int(2, 3);
    const mant = () => {   // 1.0 到 9.99：digits 位有效数字，末位不为 0
      const parts = [r.int(1, 9)];
      for (let i = 1; i < digits; i++) parts.push(i === digits - 1 ? r.int(1, 9) : r.int(0, 9));
      return parts.length === 1 ? String(parts[0]) : `${parts[0]}.${parts.slice(1).join('')}`;
    };
    const grp = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');   // 3 500 000
    const toInt = (a, n) => {   // a × 10^n 写成整数的数字串（a 最多两位小数）
      const [i, f = ''] = a.split('.');
      return i + f + '0'.repeat(n - f.length);
    };
    const n = r.int(5, 8), a = mant();
    const trapForm = () => { const [i, f = ''] = a.split('.'); return `${i}${f.slice(0, 1)}${f.length > 1 ? '.' + f.slice(1) : ''}×10^${n - 1}`; };
    const pit = 'a 要写成 1 到 10 之间的数（不到 10），n 是整数部分比 1 位多出来的位数';
    if (level === '近变式') {
      return { q: `用科学记数法表示 \\(-${grp(toInt(a, n))}\\)`, answer: `-${a}×10^${n}`, trap_answer: `-${trapForm()}`, trap: pit, answer_kind: 'number', form: 'scientific',
        steps: [`小数点移到第一位非零数字后面：${a}`, `整数部分比 1 位多 ${n} 位，所以是 10^${n}`] };
    }
    if (level === '辨析') {
      return { q: `把 \\(${a}\\times 10^${n}\\) 写成原来的数`, answer: toInt(a, n), trap_answer: toInt(a, n - 1), trap: '10 的 n 次方，小数点要向右移 n 位', answer_kind: 'number',
        steps: [`向右移 ${n} 位小数点，不够的补 0`, grp(toInt(a, n))] };
    }
    if (level === '远变式') {
      const [uname, un] = r.pick([['万', 4], ['亿', 8]]);
      let v10 = r.int(11, 99);
      const dec = r.chance(0.5);
      if (dec) while (v10 % 10 === 0) v10 = r.int(11, 99);
      const base = dec ? (v10 / 10).toFixed(1) : String(v10);       // 3.6 或 36
      const total = dec ? v10 * 10 ** (un - 1) : v10 * 10 ** un;
      const mantissa = dec ? base : (v10 / 10).toFixed(v10 % 10 ? 1 : 0);
      const exp = dec ? un : un + 1;
      const wrong = dec ? `${v10}×10^${un - 1}` : `${base}×10^${un}`;   // a 取了两位整数
      return { q: `某地有 ${base} ${uname}人。用科学记数法表示这个人数`, answer: `${mantissa}×10^${exp}`, trap_answer: wrong, trap: pit, answer_kind: 'number', form: 'scientific',
        steps: [`${base} ${uname} = ${grp(String(total))}`, `${mantissa}×10^${exp}`] };
    }
    return { q: `用科学记数法表示 ${grp(toInt(a, n))}`, answer: `${a}×10^${n}`, trap_answer: trapForm(), trap: pit, answer_kind: 'number', form: 'scientific',
      steps: [`小数点移到第一位非零数字后面：${a}`, `整数部分比 1 位多 ${n} 位，所以是 10^${n}`] };
  },
};

T['E-subst-neg-paren'] = {
  name: '代入负数先套括号', section: '3.2',
  gen(level, r) {
    const trap = '把负数代进字母，先给它套上括号再算';
    const k = r.int(2, 6), m = r.int(2, 9);
    if (level === '同构') {
      return { q: `当 \\(a=-${k}\\) 时，求 \\(a^2\\) 的值`, answer: num(sq(k)), trap_answer: num(-sq(k)), trap,
        steps: [`代入时套括号：(-${k})^2`, `(-${k})×(-${k}) = ${sq(k)}`] };
    }
    if (level === '辨析') {
      return { q: `当 \\(a=-${k}\\) 时，求 \\(a^2-a\\) 的值`, answer: num(sq(k) + k), trap_answer: num(-sq(k) + k), trap,
        steps: [`代入：(-${k})^2 - (-${k})`, `${sq(k)} + ${k} = ${sq(k) + k}`] };
    }
    if (level === '远变式') {
      const d = r.int(2, 4);
      const x = new Frac(-1n, BigInt(d));
      const real = x.mul(x).add(x.mul(new Frac(2n)));   // a² + 2a
      const trapV = x.mul(x).neg().add(x.mul(new Frac(2n)));
      return { q: `当 \\(a=-${frac1(d)}\\) 时，求 \\(a^2+2a\\) 的值`, answer: fmt(real), trap_answer: fmt(trapV), trap,
        steps: [`代入：(-1/${d})^2 + 2×(-1/${d})`, `1/${d * d} - 2/${d} = ${fmt(real)}`] };
    }
    return { q: `当 \\(a=-${k}\\) 时，求 \\(-a^2+${m}\\) 的值`, answer: num(-sq(k) + m), trap_answer: num(sq(k) + m), trap,
      steps: [`代入：-(-${k})^2 + ${m}`, `(-${k})^2 = ${sq(k)}，再带上前面的负号：-${sq(k)} + ${m} = ${-sq(k) + m}`] };
  },
};

// ---------------------------------------------------------------- 出题

export const TEMPLATE_TAGS = Object.keys(T);
export const hasTemplate = tag => Object.prototype.hasOwnProperty.call(T, tag);
export const templateInfo = tag => (hasTemplate(tag) ? { tag, name: T[tag].name, section: T[tag].section } : null);

// 本机答案和 mathcheck 的算法对一遍；陷阱答案必须和答案不一样（DESIGN 第 6 关）
function sound(v, kind) {
  try {
    const opts = { kind: v.answer_kind, form: v.form };
    const self = check(v.answer, v.answer, opts);
    if (self.ok !== true) return false;
    const trapped = check(v.trap_answer, v.answer, opts);
    if (trapped.ok === true) return false;
    const c = compute(v.q);
    if (c && c.answer != null) {
      const same = check(c.answer, v.answer, { kind: v.answer_kind === 'set' ? 'number' : v.answer_kind });
      if (same.ok === false) return false;
    }
    return true;
  } catch (e) { return false; }
}

export function makeVariant(tag, level = '近变式', { rng = Math.random, avoid = new Set() } = {}) {
  const t = T[tag];
  if (!t) return null;
  const lv = LEVELS.includes(level) ? level : '近变式';
  const r = R(rng);
  for (let i = 0; i < 40; i++) {
    let g;
    try { g = t.gen(lv, r); } catch (e) { g = null; }
    if (!g || !g.q || avoid.has(g.q)) continue;
    const v = {
      level: lv, q: g.q, answer: g.answer, answer_kind: g.answer_kind || 'number', form: g.form || '', unit: '',
      trap: g.trap || '', trap_answer: g.trap_answer || '', steps: g.steps || [], checked: 'program', template: tag,
    };
    if (sound(v)) return v;
  }
  return null;
}

export function makeVariants(tag, levels = LEVELS, { rng = Math.random, avoid = new Set() } = {}) {
  const taken = new Set(avoid);
  const out = [];
  for (const level of levels) {
    const v = makeVariant(tag, level, { rng, avoid: taken });
    if (v) { out.push(v); taken.add(v.q); }
  }
  return out;
}
