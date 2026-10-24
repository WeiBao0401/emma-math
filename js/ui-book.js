// 错题本和一张卡的详情（C 4.3，CONTRACTS 11、12）。
// 错题本：标题是她的本子名（kv 'bookName'，默认“攻克本”，以后她可以改名）；按坑 / 按章两种看法（记在 kv 'bookBy'）；
// 每个坑一行：短名、三个点表示三档（●●○）、状态（在练 · 明天 / 自己改对的 / 攻克）；“问老师”单独一组，写原因；
// 底部“待讲 N 道”入口和“在练 N · 攻克 N”。没有红色，没有分数，没有“错了几次”。
// 卡详情：原题截图、题目、“这题的坑”（她补全的那句，没有就用 remember）、关键一步（她写的对照正确过程，错的那行
// 用荧光笔）、每次复习的日期和对错、下次哪天；底部“我会了，考考我”（go practice { cardId }）和“这题有问题”。
// 问老师的卡（status 'ask'）一律不讲：不显示正确过程、答案和要点，只说为什么要问老师（CONTRACTS 9）。
// 负责：首页 / 错题本 / 约定页 agent（ui-home.js、ui-book.js、ui-onboard.js、css/home.css、book.css、onboard.css）。
//
// 导出
//   createBook(ctx) -> { show({ tab }), hide() }     画在 #view-book；tab：'trap' | 'chapter' 换看法，'ask' 滚到问老师
//   createCard(ctx) -> { show({ id }), hide() }      画在 #view-card
//   纯函数（node 能测，tests/ui-book.test.mjs）：
//     relDay(day, today) -> '今天' | '明天' | '后天' | '昨天' | '前天' | '周四' | '下周二' | '上周五' | '11 月 14 日'
//     cardKind(card) -> 'learning' | 'light' | 'rest' | 'beaten' | 'ask'
//     dotsOf(card) -> 0..3          statusText(card, today) -> '在练 · 明天'
//     chapterName(n, title) -> '第二章 有理数的运算'       chapterOf(card, curriculum) -> { n, title }
//     bookView(cards, { by, today, curriculum }) -> { groups: [{ key, title, rows }], ask: rows, counts }
//       row = { id, name, dots, kind, text, just, reason }    counts = { learning, light, beaten, ask, total }
//     askReason(card) -> 一句话      ASK_REASONS（askTeacher.reason 的说法：unsure、mine-right、still-lost、flagged）
//     trapLines(card) -> { main, remember }   keyStep(card) -> { mine, wrong, right, answer, unit, answerOnly }
//     asMath(text) -> 没有公式记号的答案包成 \\( \\)，负号、字母按公式画
//     historyRows(card) -> [{ day, passed, items: [{ name, mark: 'ok' | 'hint' | 'again' }] }]
//     nextText(card, today)、foundText(found)、flagCard(card, { today, at }) -> card（“这题有问题”：放进问老师）
//     pendingList(kv) -> [{ photoId, idx, at }]     DEFAULT_BOOK_NAME、bookName(kv)
//
// 用到的 ctx：store（all / get / put 'items'）、kv（peek / set）、curriculum、today()、go、back、toast。
// 样式在 css/book.css，类名以 book- 开头。
import { h, icon, mathText, dateCn } from './ui-dom.js';
import { dayOf, addDays, reviewPlan, shortName } from './notebook.js';

export const DEFAULT_BOOK_NAME = '攻克本';
export const bookName = kv => {
  const n = kv && typeof kv.peek === 'function' ? kv.peek('bookName', '') : '';
  return typeof n === 'string' && n.trim() ? n.trim() : DEFAULT_BOOK_NAME;
};
// 问老师的卡里，只有“讲完还是不太懂”的可以接着问私人老师（诊断本身是可靠的）
export const askConfused = card => {
  const r = card && card.askTeacher && typeof card.askTeacher === 'object' ? card.askTeacher.reason : '';
  return !!card && card.status === 'ask' && (r === 'confused' || r === 'still-lost');
};
export const pendingList = kv => {
  const p = kv && typeof kv.peek === 'function' ? kv.peek('pending', []) : [];
  return Array.isArray(p) ? p.filter(x => x && x.photoId != null) : [];
};

// ---------------------------------------------------------------- 日期说法

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const parts = day => String(day).slice(0, 10).split('-').map(Number);
const toDate = day => { const [y, m, d] = parts(day); return new Date(y, m - 1, d); };
const utc = day => { const [y, m, d] = parts(day); return Date.UTC(y, m - 1, d); };
const diffDays = (from, to) => Math.round((utc(to) - utc(from)) / 864e5);
const mondayOf = day => addDays(String(day).slice(0, 10), -((toDate(day).getDay() + 6) % 7));
const isDay = d => /^\d{4}-\d{2}-\d{2}/.test(String(d || ''));

export function relDay(day, today = dayOf()) {
  if (!isDay(day) || !isDay(today)) return '';
  const n = diffDays(today, day);
  const near = { 0: '今天', 1: '明天', 2: '后天', '-1': '昨天', '-2': '前天' }[n];
  if (near) return near;
  const weeks = Math.round(diffDays(mondayOf(today), mondayOf(day)) / 7);
  const w = WEEKDAY[toDate(day).getDay()];
  if (weeks === 0) return w;
  if (weeks === 1) return '下' + w;
  if (weeks === -1) return '上' + w;
  return dateCn(String(day).slice(0, 10), toDate(today));
}

// ---------------------------------------------------------------- 一张卡的状态

export function cardKind(c) {
  if (!c) return 'learning';
  if (c.status === 'ask') return 'ask';
  if (c.status === 'beaten') return 'beaten';
  if (c.light) return c.due ? 'light' : 'rest';
  return 'learning';
}
// 三个点是三档：在第几档就亮几个，攻克时三个都亮。轻卡和问老师的不画点。
export function dotsOf(c) {
  const k = cardKind(c);
  if (k === 'beaten') return 3;
  if (k !== 'learning') return 0;
  return Math.max(1, Math.min(3, Number(c.stage) || 1));
}
export function statusText(c, today = dayOf()) {
  const k = cardKind(c);
  const when = () => (c.due && c.due <= today ? '今天' : relDay(c.due, today));
  if (k === 'ask') return '问老师';
  if (k === 'beaten') return '攻克';
  if (k === 'rest') return '自己改对的';
  if (k === 'light') return `自己改对的 · ${when()}`;
  return c.due ? `在练 · ${when()}` : '在练';
}

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
export function chapterName(n, title = '') {
  if (n === 0) return '小学衔接';
  if (!(n > 0)) return '其他';
  return `第${CN[n] || n}章${title ? ' ' + title : ''}`;
}
export function chapterOf(card, curriculum = null) {
  const id = (card && (card.section || (card.diagnosis && card.diagnosis.section))) || '';
  const sec = curriculum && typeof curriculum.section === 'function' ? curriculum.section(id) : null;
  if (sec && Number.isFinite(sec.chapter)) return { n: sec.chapter, title: sec.chapterTitle || '' };
  const n = parseInt(String(id), 10);
  return Number.isFinite(n) ? { n, title: '' } : { n: -1, title: '' };
}

export const ASK_REASONS = {
  unsure: '这道我算了两遍，结果不一样。',
  'mine-right': '你写的和我算的一样，问问老师是不是批错了。',
  'still-lost': '讲完还是不太懂，听听老师怎么讲。',
  flagged: '你觉得这题有问题。',
};
// 别的界面写的同义 reason（接线时对齐）：ui-capture 写 'maybe-right'，ui-explain 写 'confused'
const ASK_ALIAS = { 'maybe-right': 'mine-right', mine: 'mine-right', confused: 'still-lost', wrong: 'flagged' };
export function askReason(c) {
  const at = c && c.askTeacher;
  const raw = (at && typeof at === 'object' && (at.reason || at.code)) || (c && c.askReason) ||
    (c && c.diagnosis && c.diagnosis.checked === 'unsure' ? 'unsure' : '');
  return ASK_REASONS[ASK_ALIAS[raw] || raw] || '这道我拿不准。';
}

// ---------------------------------------------------------------- 错题本的行

const ORDER = { learning: 0, light: 1, rest: 2, beaten: 3 };
function compareRows(a, b) {
  const ka = cardKind(a), kb = cardKind(b);
  if (ORDER[ka] !== ORDER[kb]) return ORDER[ka] - ORDER[kb];
  if (ka === 'learning' || ka === 'light') return String(a.due || '').localeCompare(String(b.due || '')) || String(a.at || '').localeCompare(String(b.at || ''));
  if (ka === 'beaten') return String(b.beatenOn || '').localeCompare(String(a.beatenOn || ''));
  return String(b.restOn || b.day || '').localeCompare(String(a.restOn || a.day || ''));
}

export function bookView(cards, { by = 'trap', today = dayOf(), curriculum = null } = {}) {
  const list = (Array.isArray(cards) ? cards : []).filter(c => c && c.id != null);
  const row = c => ({
    id: c.id, name: shortName(c, curriculum), dots: dotsOf(c), kind: cardKind(c), text: statusText(c, today),
    just: cardKind(c) === 'beaten' && c.beatenOn === today,
  });
  const shelf = list.filter(c => cardKind(c) !== 'ask').sort(compareRows);
  const ask = list.filter(c => cardKind(c) === 'ask')
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .map(c => ({ ...row(c), reason: askReason(c) }));
  let groups;
  if (by === 'chapter') {
    const map = new Map();
    for (const c of shelf) {
      const ch = chapterOf(c, curriculum);
      if (!map.has(ch.n)) map.set(ch.n, { key: 'ch' + ch.n, n: ch.n, title: chapterName(ch.n, ch.title), rows: [] });
      const g = map.get(ch.n);
      if (!/ /.test(g.title) && ch.title) g.title = chapterName(ch.n, ch.title);
      g.rows.push(row(c));
    }
    // 新学的章在上面（C 4.3 的样子）；不知道哪一章的放最后
    groups = [...map.values()].sort((a, b) => (a.n < 0) - (b.n < 0) || b.n - a.n).map(({ key, title, rows }) => ({ key, title, rows }));
  } else {
    groups = shelf.length ? [{ key: 'all', title: '', rows: shelf.map(row) }] : [];
  }
  const count = k => list.filter(c => cardKind(c) === k).length;
  return {
    groups, ask,
    counts: { learning: count('learning'), light: count('light') + count('rest'), beaten: count('beaten'), ask: count('ask'), total: list.length },
  };
}

// ---------------------------------------------------------------- 一张卡的详情

export function trapLines(c) {
  const d = (c && c.diagnosis) || {};
  const mine = String((c && c.mySentence) || '').trim();
  const remember = String(d.remember || '').trim();
  if (mine) return { main: mine, remember: remember && remember !== mine ? remember : '' };
  return { main: remember || String(d.why || '').trim(), remember: '' };
}

export function keyStep(c) {
  const p = (c && c.problem) || {};
  const d = (c && c.diagnosis) || {};
  const work = Array.isArray(p.her_work) ? p.her_work.filter(Boolean).map(String) : [];
  const mine = work.length ? work : p.her_answer ? [String(p.her_answer)] : [];
  let wrong = Number.isInteger(d.wrong_line) && d.wrong_line >= 0 && d.wrong_line < work.length ? d.wrong_line : -1;
  if (wrong < 0 && d.wrong_step && work.length) wrong = work.findIndex(l => l.trim() === String(d.wrong_step).trim());
  if (wrong < 0 && !work.length && mine.length) wrong = 0;   // 只写了答案（比如选择题）：错的就是答案
  const right = Array.isArray(d.solution) && d.solution.length ? d.solution.filter(Boolean).map(String) : d.answer ? [String(d.answer)] : [];
  return { mine, wrong, right, answer: String(d.answer || ''), unit: String(d.unit || ''), answerOnly: !work.length };
}

export const asMath = t => { const x = String(t || ''); return !x || /\\\(|\\\[|\$/.test(x) ? x : `\\(${x}\\)`; };

const itemName = r => (r && r.kind === 'redo' ? '原题' : (r && r.level) || '新题');
const markOf = r => (r && r.ok && r.firstTry !== false && !r.hints ? 'ok' : r && r.ok ? 'hint' : 'again');
export function historyRows(c) {
  const reviews = Array.isArray(c && c.reviews) ? c.reviews : [];
  return reviews.filter(r => r && isDay(r.day)).map(r => ({
    day: r.day, passed: !!r.passed,
    items: (Array.isArray(r.results) ? r.results : []).map(x => ({ name: itemName(x), mark: markOf(x) })),
  }));
}

export const FOUND_TEXT = {
  self: '你自己找到、改对的。',
  located: '我指了是哪一行，你自己改对的。',
  hint: '看了提示，你自己做对的。',
  explain: '讲清楚以后收进本子的。',
};
export const foundText = f => FOUND_TEXT[f] || '收进本子。';

export function nextText(c, today = dayOf()) {
  const k = cardKind(c);
  if (k === 'ask') return '这道先问老师，不排练习。';
  if (k === 'beaten') return '攻克了。期中、期末前各回来一次。';
  if (k === 'rest') return '先休息，考前再来一道。';
  if (!c.due) return '';
  const when = c.due <= today ? '今天' : relDay(c.due, today);
  const plan = reviewPlan(c);
  let what = '一道新题。';
  if (plan.some(p => p.kind === 'redo')) what = '原题再做一遍，再加一道新题。';
  else if (plan.length >= 2) what = '两道新题，混在别的题里。';
  else if (plan[0] && plan[0].level === '远变式') what = '一道新题，藏在一道大一点的题里。';
  return `下次复习：${when}。${what}`;
}

// “这题有问题”：下架（不排练习、不计分），进问老师；原来的排程留在 askTeacher.prev，家长区以后能恢复
export function flagCard(c, { today = dayOf(), at = new Date().toISOString() } = {}) {
  const x = structuredClone(c);
  x.flagged = [...(Array.isArray(x.flagged) ? x.flagged : []), { day: today, at, what: 'card' }];
  x.askTeacher = { reason: 'flagged', day: today, prev: { status: c.status, stage: c.stage, due: c.due || '', light: !!c.light } };
  x.status = 'ask';
  x.due = '';
  return x;
}

// ---------------------------------------------------------------- 视图共用

const todayOf = ctx => (ctx && typeof ctx.today === 'function' ? ctx.today() : dayOf());
async function loadCards(ctx) {
  const all = ctx.store && typeof ctx.store.all === 'function' ? await ctx.store.all('items') : [];
  return (Array.isArray(all) ? all : []).filter(c => c && typeof c === 'object' && c.id != null);
}
function navbar(ctx, label) {
  const lab = h('span', { className: 'back-label', text: label });
  const title = h('span', { className: 'nav-title' });
  const bar = h('header', { className: 'navbar' }, h('div', { className: 'inner' },
    h('button', { type: 'button', className: 'back', on: { click: () => ctx.back() } }, icon('back'), lab),
    title, h('span', { className: 'nav-end' })));
  return { bar, lab, title };
}
const dotsEl = (n, { beaten = false, just = false } = {}) => h('span', {
  className: 'book-dots' + (beaten ? ' beaten' : '') + (just ? ' just' : ''), role: 'img', 'aria-label': beaten ? '三档都过了' : `第 ${n} 档`,
}, [0, 1, 2].map(i => h('i', { className: i < n ? 'on' : '' })));

// 卡上的图：dataURL 字符串直接用；Blob 转成临时地址，离开时释放
function imageSrc(v, urls) {
  if (typeof v === 'string' && /^(data:image\/|blob:)/.test(v)) return v;
  if (v && typeof Blob !== 'undefined' && v instanceof Blob) { const u = URL.createObjectURL(v); urls.push(u); return u; }
  return '';
}

// ---------------------------------------------------------------- 错题本

export function createBook(ctx) {
  const root = document.getElementById('view-book');
  root.replaceChildren();
  const nav = navbar(ctx, '首页');
  const page = h('div', { className: 'page book' });
  root.append(nav.bar, page);

  let by = ctx.kv.peek('bookBy', 'trap') === 'chapter' ? 'chapter' : 'trap';
  let cards = null;
  let token = 0;

  function goPending() {
    const p = pendingList(ctx.kv);
    if (p.length) ctx.go('confirm', { photoId: p[0].photoId, idx: p[0].idx });
  }

  function seg() {
    const b = (key, text) => h('button', { type: 'button', className: 'text-btn book-seg-btn' + (by === key ? ' on' : ''), 'aria-pressed': String(by === key), text,
      on: { click: () => { if (by === key) return; by = key; ctx.kv.set('bookBy', key).catch(() => {}); render(); } } });
    return h('div', { className: 'book-seg', role: 'group', 'aria-label': '怎么看' }, b('trap', '按坑'), h('span', { className: 'book-seg-sep', 'aria-hidden': 'true', text: '|' }), b('chapter', '按章'));
  }

  // 今天刚攻克的那一行，三个点亮起来的动画只放一次（换看法、回来都不再放）
  const lit = new Set();
  function rowEl(r) {
    const just = r.just && !lit.has(r.id);
    if (just) lit.add(r.id);
    return h('li', {}, h('button', { type: 'button', className: `book-row ${r.kind}`, on: { click: () => ctx.go('card', { id: r.id }) } },
      h('span', { className: 'book-name', text: r.name }),
      r.dots ? dotsEl(r.dots, { beaten: r.kind === 'beaten', just }) : h('span', { className: 'book-dots none', 'aria-hidden': 'true' }),
      h('span', { className: 'book-state', text: r.text }),
      icon('chev', 'book-chev')));
  }

  function render() {
    const name = bookName(ctx.kv);
    nav.title.textContent = name;
    const head = h('div', { className: 'book-head' }, h('h1', { className: 'page-title', text: name }), seg());
    if (!cards) { page.replaceChildren(head, h('div', { className: 'book-loading' }, h('div', { className: 'sk-bars', 'aria-hidden': 'true' }, [88, 70, 80].map(w => h('i', { style: `width:${w}%` }))))); return; }
    const v = bookView(cards, { by, today: todayOf(ctx), curriculum: ctx.curriculum || null });
    const pending = pendingList(ctx.kv);
    const out = [head];
    if (!v.counts.total) {
      out.push(h('div', { className: 'book-empty' },
        h('p', { className: 'lede', text: '这里还空着。' }),
        h('p', { className: 'lead', text: '讲完的错题会收在这里，一个坑一行。同一个坑再遇到，也收在同一行里。' })));
    }
    for (const g of v.groups) {
      out.push(h('section', { className: 'book-group' },
        g.title ? h('h2', { className: 'sec-h book-ch', text: g.title }) : null,
        h('ul', { className: 'book-rows' }, g.rows.map(rowEl))));
    }
    if (v.ask.length) {
      out.push(h('section', { className: 'book-group book-ask', id: 'book-ask' },
        h('h2', { className: 'sec-h' }, h('span', { text: '问老师' }), h('span', { className: 'st', text: `${v.ask.length} 道` })),
        h('p', { className: 'small book-ask-lead', text: '这几道我拿不准，不讲也不排练习。带去问学校老师。' }),
        h('ul', { className: 'book-rows' }, v.ask.map(r => h('li', {}, h('button', { type: 'button', className: 'book-row ask', on: { click: () => ctx.go('card', { id: r.id }) } },
          h('span', { className: 'book-name', text: r.name }),
          h('span', { className: 'book-reason', text: r.reason }),
          icon('chev', 'book-chev')))))));
    }
    const shelfCount = v.counts.learning + v.counts.light + v.counts.beaten;
    out.push(h('footer', { className: 'book-foot' },
      pending.length ? h('button', { type: 'button', className: 'text-btn accent book-pending', on: { click: goPending } }, h('span', { text: `待讲 ${pending.length} 道` }), icon('chev')) : h('span'),
      shelfCount ? h('span', { className: 'book-count', text: `在练 ${v.counts.learning} · 攻克 ${v.counts.beaten}` }) : null));
    out.push(h('p', { className: 'book-promise' }, h('button', { type: 'button', className: 'text-btn', text: '老师和你的约定', on: { click: () => ctx.go('onboard', { review: true }) } })));
    page.replaceChildren(...out);
  }

  return {
    async show(params = {}, { from, back } = {}) {
      if (params.tab === 'trap' || params.tab === 'chapter') by = params.tab;
      // 返回按钮回到来的地方（nav.js 的栈）：从首页来写“首页”，从别处来写“返回”
      if (!back) nav.lab.textContent = !from || from === 'home' ? '首页' : '返回';
      const mine = ++token;
      render();   // 先画上次的（或骨架），读完再画一次
      try {
        const list = await loadCards(ctx);
        if (mine !== token) return;
        cards = list;
      } catch (e) {
        console.warn('book:', (e && e.message) || e);
        if (mine !== token) return;
        cards = cards || [];
      }
      render();
      if (params.tab === 'ask') { const el = document.getElementById('book-ask'); if (el) el.scrollIntoView({ block: 'start' }); }
    },
    hide() { token++; },
  };
}

// ---------------------------------------------------------------- 一张卡

export function createCard(ctx) {
  const root = document.getElementById('view-card');
  root.replaceChildren();
  const nav = navbar(ctx, DEFAULT_BOOK_NAME);
  const page = h('div', { className: 'page book-card' });
  const barInner = h('div', { className: 'inner book-bar' });
  const bar = h('div', { className: 'ebar' }, barInner);
  root.classList.add('with-bar');
  root.append(nav.bar, page, bar);

  let card = null;
  let token = 0;
  let confirming = false;
  let urls = [];
  const freeUrls = () => { for (const u of urls) URL.revokeObjectURL(u); urls = []; };

  function section(title, ...kids) {
    return h('section', { className: 'book-sec' }, h('h2', { className: 'sec-h', text: title }), ...kids);
  }

  function lines(arr, { mark = -1, cls = '' } = {}) {
    return h('ol', { className: 'book-lines ' + cls }, arr.map((t, i) => h('li', { className: i === mark ? 'is-wrong' : '' },
      i === mark ? mathText(t, { tag: 'mark', className: 'marked' }) : mathText(t))));
  }

  // 底部操作条；有条时 body 加 has-bar，提示浮在条上面（base.css）
  function renderBar() {
    const ask = !!card && cardKind(card) === 'ask';
    if (card && confirming) {
      barInner.replaceChildren(
        h('p', { className: 'book-bar-q', text: '这道题先放进“问老师”，不再排练习。家长也会看到。' }),
        h('div', { className: 'book-bar-btns' },
          h('button', { type: 'button', className: 'btn', text: '放进问老师', on: { click: doFlag } }),
          h('button', { type: 'button', className: 'text-btn', text: '算了', on: { click: () => { confirming = false; renderBar(); } } })));
    } else if (card && !ask) {
      barInner.replaceChildren(h('div', { className: 'book-bar-btns' },
        h('button', { type: 'button', className: 'btn', text: '我会了，考考我', on: { click: () => ctx.go('practice', { cardId: card.id }) } }),
        askMeBtn(),
        h('button', { type: 'button', className: 'text-btn', text: '这题有问题', on: { click: () => { confirming = true; renderBar(); } } })));
    } else if (card && askConfused(card)) {
      // 讲完还是不太懂的题：诊断是可靠的，可以接着问老师（拿不准的、她点了“这题有问题”的不接）
      barInner.replaceChildren(h('div', { className: 'book-bar-btns' }, askMeBtn()));
    } else {
      barInner.replaceChildren();
    }
    bar.hidden = !barInner.childElementCount;
    document.body.classList.toggle('has-bar', !bar.hidden);
  }

  // v0.3：这道题还有不明白的，问老师（chat problem 模式带上这道题和当时的诊断）
  function askMeBtn() {
    return h('button', { type: 'button', className: 'text-btn accent book-askme', on: { click: () => ctx.go('chat', { mode: 'problem', cardId: card.id }) } },
      icon('chat'), h('span', { text: '问我' }));
  }

  async function doFlag() {
    if (!card) return;
    const mine = token;
    try {
      const fresh = (await ctx.store.get('items', card.id)) || card;
      const next = flagCard(fresh, { today: todayOf(ctx) });
      await ctx.store.put('items', next);
      if (mine !== token) return;
      card = next;
      confirming = false;
      render();
      ctx.toast('放进问老师了。');
    } catch (e) {
      console.warn('card flag:', (e && e.message) || e);
      ctx.toast('没存上，再点一次。');
    }
  }

  function render() {
    freeUrls();
    if (!card) {
      page.replaceChildren(h('p', { className: 'lede book-gone', text: '这张卡找不到了。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn quiet', text: '回到本子', on: { click: () => ctx.back() } })));
      renderBar();
      return;
    }
    const today = todayOf(ctx);
    const cur = ctx.curriculum || null;
    const name = shortName(card, cur);
    nav.title.textContent = name;
    const k = cardKind(card);
    const ask = k === 'ask';
    const p = card.problem || {};
    const ch = chapterOf(card, cur);
    const sec = cur && typeof cur.title === 'function' && (card.section || (card.diagnosis && card.diagnosis.section)) ? cur.title(card.section || card.diagnosis.section) : '';
    const meta = [ch.n >= 0 ? chapterName(ch.n, '') : '', sec, card.source || '', isDay(card.day) ? `${dateCn(card.day, toDate(today))}收进本子` : ''].filter(Boolean).join(' · ');
    const out = [
      h('h1', { className: 'page-title', text: name }),
      meta ? h('p', { className: 'small book-meta', text: meta }) : null,
      h('p', { className: 'book-status' }, dotsOf(card) ? dotsEl(dotsOf(card), { beaten: k === 'beaten' }) : null, h('span', { text: statusText(card, today) })),
    ];
    if (ask) out.push(h('p', { className: 'status-line book-ask-note' }, icon('ask'), h('span', { text: `${askReason(card)}记下来，带去问学校老师。` })));

    const shot = imageSrc(card.crop, urls) || imageSrc(card.thumb, urls);
    if (shot) out.push(h('figure', { className: 'book-shot' }, h('img', { src: shot, alt: '原题截图', decoding: 'async' })));
    const stem = [mathText(p.stem || '', { tag: 'p', className: 'book-stem' })];
    if (Array.isArray(p.options) && p.options.length) stem.push(h('ol', { className: 'book-options' }, p.options.map(o => h('li', {}, mathText(o)))));
    if (p.figure && !shot) stem.push(h('p', { className: 'small', text: '图：' + p.figure }));
    out.push(section('题目', ...stem));

    if (!ask) {
      const t = trapLines(card);
      if (t.main) out.push(section('这题的坑', mathText(t.main, { tag: 'p', className: 'book-trap' }), t.remember ? h('p', { className: 'book-remember' }, h('span', { className: 'label', text: '记住' }), mathText(t.remember)) : null));
      const ks = keyStep(card);
      if (ks.mine.length || ks.right.length) {
        out.push(section('关键一步', h('div', { className: 'book-compare' },
          h('div', { className: 'book-col' }, h('p', { className: 'label', text: '你写的' }), ks.mine.length ? lines(ks.answerOnly ? ks.mine.map(asMath) : ks.mine, { mark: ks.wrong }) : h('p', { className: 'small', text: '没写过程。' })),
          h('div', { className: 'book-col right' }, h('p', { className: 'label', text: '正确的' }), lines(ks.right.length === 1 && ks.right[0] === ks.answer ? [asMath(ks.answer)] : ks.right),
            ks.answer && ks.right.length > 1 ? h('p', { className: 'book-answer' }, h('span', { className: 'label', text: '答案' }), mathText(asMath(ks.answer) + (ks.unit ? ' ' + ks.unit : ''))) : null))));
      }
    } else if (Array.isArray(p.her_work) && p.her_work.length) {
      out.push(section('你写的', lines(p.her_work)));
    }

    const hist = historyRows(card);
    const histList = h('ol', { className: 'book-hist' },
      isDay(card.day) ? h('li', {}, h('span', { className: 'book-hist-day', text: dateCn(card.day, toDate(today)) }), h('span', { className: 'book-hist-what', text: foundText(card.found) })) : null,
      hist.map(r => h('li', {}, h('span', { className: 'book-hist-day', text: dateCn(r.day, toDate(today)) }),
        h('span', { className: 'book-hist-what' }, r.items.map(it => h('span', { className: 'book-hist-item ' + it.mark },
          h('span', { text: it.name }),
          it.mark === 'ok' ? icon('check', 'book-ok') : h('span', { className: 'book-hist-note', text: it.mark === 'hint' ? '提示后做对' : '再练' })))))));
    out.push(section('复习记录', histList, h('p', { className: 'book-next', text: nextText(card, today) })));

    const others = (Array.isArray(card.originals) ? card.originals : []).filter(Boolean);
    if (others.length) {
      out.push(section(`同一个坑的其他题 · ${others.length} 道`, h('ul', { className: 'book-others' }, others.map(o => {
        const src = imageSrc(o.thumb, urls) || imageSrc(o.crop, urls);
        const st = o.problem && o.problem.stem;
        return h('li', {}, src ? h('img', { src, alt: '', decoding: 'async' }) : null, st ? mathText(st, { tag: 'p', className: 'book-other-stem' }) : null,
          isDay(o.day) ? h('p', { className: 'small', text: dateCn(o.day, toDate(today)) }) : null);
      }))));
    }
    page.replaceChildren(...out.filter(Boolean));
    renderBar();
  }

  return {
    async show(params = {}, { from, back } = {}) {
      const mine = ++token;
      confirming = false;
      if (!back) nav.lab.textContent = !from || from === 'book' ? bookName(ctx.kv) : '返回';
      const id = params.id;
      if (!card || card.id !== id) { card = null; page.replaceChildren(h('div', { className: 'sk-bars', 'aria-hidden': 'true' }, [80, 60, 90].map(w => h('i', { style: `width:${w}%` })))); bar.hidden = true; }
      let found = null;
      try { found = id != null && ctx.store ? await ctx.store.get('items', id) : null; } catch (e) { console.warn('card:', (e && e.message) || e); }
      if (mine !== token) return;
      card = found || null;
      render();
    },
    hide() { token++; confirming = false; freeUrls(); document.body.classList.remove('has-bar'); },
  };
}
