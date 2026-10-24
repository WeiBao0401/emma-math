// 首页（C 2.1 的骨架，CONTRACTS 11）：书眉是日期，右上角“家长”；一句招呼，下面一句从学情档案挑的“最近一件具体的事”；
// 有复习时一句“为什么先练这个”（来自到期最久的那张卡）和一个主按钮“今天复习，约 M 分钟”（go practice），不写道数；
// “拍错题”（go capture），有复习时是第二个按钮，没有复习时它就是主按钮；底部一行文字入口：明天先讲 N 道（kv 'pending'，
// 点了照样马上去 confirm 第一道）、错题本、问学校老师（有要问的题时带一个小圆点，不写数字）。
// 第一次打开（kv 'onboarded' 不为真，或约定改了版本）先去约定页。21:00 以后只推轻松版：复习上限 3 道
// （notebook.quotaFor 的 light），主按钮带 { light: true } 去 practice。今天已经做过的复习题从上限里扣掉，
// 做满了说“今天的复习够了，剩下的明天接着来”（C 2.5）。
// v0.3.1：孩子看得到的地方不放欠账数字（DESIGN 1 “评委要求改的”、2.0、7.4）：没有“待讲 N 道”“问老师 N 道”“复习 N 道”；
// 招呼主动一点（greetingLine，程序拼，不调模型）；拿不准、要问真老师的那一组叫“问学校老师”，和“有问题，问我”分开。
// 负责：首页 / 错题本 / 约定页 agent（ui-home.js、ui-book.js、ui-onboard.js、css/home.css、book.css、onboard.css）。
//
// 导出
//   createHome(ctx) -> { show(), onResume() }     画在 #view-home（换掉 index.html 里的占位内容）
//   纯函数（node 能测，tests/ui-home.test.mjs）：
//     homePlan({ cards, attempts, today, hour, exam }) -> { late, quota, done, left, queue, reviewCount, minutes, dueCount,
//                                                  capped, first, nextDue, askCount, total }
//     pickRound(cards, today, max) -> { picked, n }   reviewsDone(attempts, today) -> n   和 ui-practice 的 planRound、doneToday 同口径
//     reviewLabel(plan) -> '今天复习，约 7 分钟' | '今晚轻松复习，约 2 分钟' | ''（今天没有要复习的）   主按钮的字
//     reviewLine(plan, today) -> 没有复习时的那句话（“今天没有要复习的题。下一次在周四。”）；有复习、没有卡时 ''
//     whyLine(card, today, curriculum) -> '先练“乘方前面的负号”，你周二在这儿掉过坑。'
//     greetingLine(profile, today, { cards, queue }) -> '昨天那道 −3² 的题，今天在复习里等你。' | ''（没有可说的，只用普通招呼）
//     greetingPick(profile, today, { cards, queue }) -> { text, day, rank, inReview } | null    greetingLine 的详细版
//     doneToday(cards, today) -> 卡上今天复习了几道（没有 attempts 时用）   reviewMinutes(n) -> 分钟
//     greeting(hour, name) -> '晚上好，Emma。'            dateLine(date) -> '10 月 24 日 星期六'
//     withNumbers(text) -> 节点数组：数字包进 <span class="n">（只在浏览器里用）
//
// 用到的 ctx：store.all('items')、store.byIndex('attempts', 'at', 今天零点起)、kv（peek）、curriculum、today()、budget.canSpend()、settings()、mockForced()、go。
// 样式在 css/home.css，类名以 home- 开头（base.css 里占位首页的 .home-main、.home-title、.home-lede、.screen 不用）。
import { h, icon, dateCn } from './ui-dom.js';
import { dayOf, due, reviewPlan, quotaFor, shortName, LATE_HOUR } from './notebook.js';
import { kidMessage } from './kid-errors.js';
import { relDay, pendingList, pendingLine, ASK_TITLE } from './ui-book.js';
import { needsOnboard } from './ui-onboard.js';
import { loadProfile, probePoint, probeLine } from './profile.js';

// v0.3 私人老师（CONTRACTS 17）：首页多两样东西，放在复习和拍错题下面：
//   老师主动找她：学情档案里最需要帮的那个点分数够高、今天还没聊过（kv 'probeDay'）时，一张小卡“想和你聊 3 分钟：…”，
//     “好，聊聊”去 chat { mode: 'probe', point }，“今天先不”记下 probeDay，今天不再出
//   “有问题，问我”：一直在，去 chat { mode: 'free' }
export const ASK_LABEL = '有问题，问我';

// ---------------------------------------------------------------- 纯函数

const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function dateLine(date = new Date()) {
  const d = new Date(date);
  return `${dateCn(dayOf(d), d)} ${WEEK[d.getDay()]}`;
}
export function greeting(hour = new Date().getHours(), name = 'Emma') {
  const who = name ? `，${name}` : '';
  if (hour < 5) return `夜深了${who}。`;
  if (hour < 11) return `早上好${who}。`;
  if (hour < 13) return `中午好${who}。`;
  if (hour < 18) return `下午好${who}。`;
  return `晚上好${who}。`;
}

// 一道复习题约 1 分多钟（草稿纸上算，iPad 上填结果），上学日 6 道约 7 分钟（C 2.2）
export const reviewMinutes = n => (n > 0 ? Math.max(2, Math.round(n * 1.2)) : 0);

// 今天已经做了几道复习题。和 ui-practice.js 的 doneToday 同一个口径：今天的 attempts 里 kind 是 redo / variant 的，
// “考考我”（test）和跳过的不算。没有 attempts 时（读不到）退回去数卡上今天那次复习的题数。
export function reviewsDone(attempts, today = dayOf()) {
  return (Array.isArray(attempts) ? attempts : [])
    .filter(a => a && a.day === today && (a.kind === 'redo' || a.kind === 'variant') && !a.test && !a.skipped).length;
}
export function doneToday(cards, today = dayOf()) {
  let n = 0;
  for (const c of Array.isArray(cards) ? cards : []) {
    for (const r of (c && Array.isArray(c.reviews) ? c.reviews : [])) if (r && r.day === today) n += Array.isArray(r.results) ? r.results.length : 0;
  }
  return n;
}

// 这一轮练哪几张卡：和 ui-practice.js 的 planRound 同一个规则，到期最久的先进，一张卡的题全进或者不进
export function pickRound(cards, today = dayOf(), max = 6) {
  const picked = [];
  let n = 0;
  if (!(max > 0)) return { picked, n };
  for (const c of due(Array.isArray(cards) ? cards : [], today)) {
    const k = Math.min(2, reviewPlan(c).length);
    if (!k || n + k > max) continue;
    picked.push(c);
    n += k;
  }
  return { picked, n };
}

export function homePlan({ cards = [], attempts = null, today = dayOf(), hour = new Date().getHours(), exam = null } = {}) {
  const list = (Array.isArray(cards) ? cards : []).filter(c => c && c.id != null);
  const late = hour >= LATE_HOUR;
  const quota = quotaFor(today, { exam, light: late });
  const done = Array.isArray(attempts) ? reviewsDone(attempts, today) : doneToday(list, today);
  const left = Math.max(0, quota.reviewMax - done);
  const dueCards = due(list, today);
  const round = pickRound(list, today, left);
  const later = list.filter(c => c.status === 'learning' && isDay(c.due) && c.due > today).map(c => c.due).sort();
  return {
    late, quota, done, left, queue: round.picked,
    reviewCount: round.n, minutes: reviewMinutes(round.n),
    dueCount: dueCards.length, capped: !round.n && dueCards.length > 0,
    first: round.picked[0] || dueCards[0] || null, nextDue: later[0] || '',
    askCount: list.filter(c => c.status === 'ask').length,
    total: list.length,
  };
}

// 中文里数字两边空一格（“下一次在 11 月 14 日”）
const spaced = (before, word) => (/^\d/.test(word) ? `${before} ${word}` : `${before}${word}`);

// 主按钮：只说大约几分钟，不说几道（道数像一笔要还的账；分钟数是她能安排的时间）
export function reviewLabel(plan) {
  if (!plan || !plan.reviewCount) return '';
  return plan.late ? `今晚轻松复习，约 ${plan.minutes} 分钟` : `今天复习，约 ${plan.minutes} 分钟`;
}

// 今天没有可复习的题时的那句话。有复习时主按钮自己说（reviewLabel），这里给 ''
export function reviewLine(plan, today = dayOf()) {
  if (!plan || !plan.total || plan.reviewCount) return '';
  if (plan.capped) return '今天的复习够了，剩下的明天接着来。';
  if (plan.done) return '今天的复习做完了。';
  return plan.nextDue ? `今天没有要复习的题。${spaced('下一次在', relDay(plan.nextDue, today))}。` : '今天没有要复习的题。';
}

// 为什么先练这个：到期最久的那张卡，她最近一次在这个坑里遇到的那天（C 2.1）
export function whyLine(card, today = dayOf(), curriculum = null) {
  if (!card) return '';
  const days = [card.day, ...(Array.isArray(card.originals) ? card.originals.map(o => o && o.day) : [])].filter(isDay).sort();
  const last = days[days.length - 1];
  if (!last || last >= today) return '';
  const name = shortName(card, curriculum);
  const when = relDay(last, today);
  return card.light ? `先练“${name}”，${spaced('你', when)}自己改对过这个坑。` : `先练“${name}”，${spaced('你', when)}在这儿掉过坑。`;
}

// ---------------------------------------------------------------- 主动的一句招呼（v0.3.1）
// 从学情档案（profile.js 的 buildProfile / loadProfile）里挑最近一件具体的事，程序拼一句，不调模型：
//   “昨天那道 −3² 的题，今天在复习里等你。”“上周四的“去括号要变号”，你已经连着做对两次了。”
// 档案里的证据和“最近”是写好的句子（“10-22 作业 −3² 写成 9”“10-24 复习做对了“去括号要变号””，profile.js
// evidenceOfCard 和 buildProfile 的写法），这里按那个写法读回日期、坑名和题；读不懂的句子跳过，不硬猜。
// 只说发生过的事（DESIGN 7.6 夸奖只从事实里选）：
//   连着做对 N 次：只数新题一次就做对的日子（复习原题做对的不算，可能记住了答案），而且这几次在她最近一次掉坑之后；
//     档案里看不到她最近哪天掉过坑时，只说“这几天做对了 N 次”，不说“连着”
//   “在复习里等你”：那张卡在今天这一轮里（opts.queue）才说今天；不在就看它哪天到期（opts.cards）。原题还会重做
//     （第 1 档）才说“那道题在等你”，否则说“有同类的题”。说不出哪天再见的错题不提：只提错、不说接下来做什么没有用
//   讲完还是不懂、聊天里看出的漏洞不在这里说，那是“想和你聊 3 分钟”小卡的事
// 同一天有几件事时：攻克 > 连着做对 > 自己改对 > 一次做对 > 聊天里弄懂 > 错题在复习里等你。13 天以前的事不提。
const GREET_DAYS = 13;
const KIND_WORDS = ['复习原题', '复习', '讲题时的同构题', '改错', '聊天时的练习', '练习'];   // profile.js KIND_WORD
const SOURCE_WORDS = ['作业', '练习册', '单元测', '试卷'];                                    // profile.js SOURCE_WORD
const SELF_TAIL = '（后来自己改对了）';
const CN_TIMES = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
const Q_MAX = 14;   // 题太长就不念题，改说坑名
const cpLen = s => [...String(s || '')].length;
const utcOf = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const ageOf = (day, today) => Math.round((utcOf(today) - utcOf(day)) / 864e5);

// 档案里的日期只有“月-日”：比今天晚的算去年的（1 月初看到的 12-30 是去年的）
function dayFromMd(md, today) {
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  if (!m || !(+m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) || !isDay(today)) return '';
  const y = +today.slice(0, 4);
  return `${y}-${md}` > today ? `${y - 1}-${md}` : `${y}-${md}`;
}
function splitDated(text, today) {
  const m = /^(\d{2}-\d{2}) (.+)$/.exec(String(text || '').trim());
  const day = m ? dayFromMd(m[1], today) : '';
  return day ? { day, rest: m[2].trim() } : null;
}
// 一句证据 -> { day, via: 'card' | KIND_WORDS 之一, self, q }；讲完还是不太懂、聊天里看到的返回 null
function readEvidence(text, today) {
  const s = splitDated(text, today);
  if (!s || s.rest === '讲完还是不太懂' || s.rest.startsWith('聊天里：')) return null;
  let rest = s.rest;
  const self = rest.endsWith(SELF_TAIL);
  if (self) rest = rest.slice(0, -SELF_TAIL.length).trim();
  const sp = rest.indexOf(' ');
  const head = sp > 0 ? rest.slice(0, sp) : '';
  let via = 'card';
  if (KIND_WORDS.includes(head)) { via = head; rest = rest.slice(sp + 1); }
  else if (SOURCE_WORDS.includes(head)) rest = rest.slice(sp + 1);
  const m = /^(.+) 写成 .+$/.exec(rest) || /^(.+) (?:做错了|没做对)$/.exec(rest);
  return { day: s.day, via, self, q: m ? m[1].trim() : '' };
}
// 一句“最近” -> { day, kind: 'beaten' | 'self' | 'got' | 'ok', name, via? }
function readRecent(text, today) {
  const s = splitDated(text, today);
  if (!s) return null;
  let m;
  if ((m = /^攻克了“(.+)”$/.exec(s.rest))) return { day: s.day, kind: 'beaten', name: m[1] };
  if ((m = /^自己改对了一道“(.+)”的题$/.exec(s.rest))) return { day: s.day, kind: 'self', name: m[1] };
  if ((m = /^聊天里弄懂了“(.+)”$/.exec(s.rest))) return { day: s.day, kind: 'got', name: m[1] };
  if ((m = /^(.+?)做对了“(.+)”$/.exec(s.rest))) return { day: s.day, kind: 'ok', via: m[1], name: m[2] };
  return null;
}
// 这个坑接下来哪天在复习里见：今天这一轮里有就是今天，否则是最近一次到期的那天；都没有返回 null
function reviewHook(point, cards, inQueue, today) {
  const tagOf = c => c.tag || (c.diagnosis && c.diagnosis.tag) || '';
  const live = cards.filter(c => c.status === 'learning' && isDay(c.due) &&
    ((point.cardId != null && String(c.id) === String(point.cardId)) || (point.tag && tagOf(c) === point.tag)));
  const now = live.find(c => inQueue.has(String(c.id)));
  if (now) return { card: now, when: '今天' };
  const next = live.filter(c => c.due > today).sort((a, b) => a.due.localeCompare(b.due))[0];
  return next ? { card: next, when: relDay(next.due, today) } : null;
}

export function greetingPick(profile, today = dayOf(), { cards = [], queue = [] } = {}) {
  if (!profile || typeof profile !== 'object' || !isDay(today)) return null;
  const found = [];
  const add = (day, rank, text, inReview = false) => {
    if (text && isDay(day) && day <= today && ageOf(day, today) <= GREET_DAYS) found.push({ text, day, rank, inReview });
  };
  const weak = (Array.isArray(profile.weak) ? profile.weak : []).filter(w => w && typeof w === 'object' && w.name);
  const list = (Array.isArray(cards) ? cards : []).filter(c => c && typeof c === 'object' && c.id != null);
  const inQueue = new Set((Array.isArray(queue) ? queue : []).filter(c => c && c.id != null).map(c => String(c.id)));

  // 最需要帮的几个点：证据里哪天、哪道题；顺便记下每个坑她最近一次掉进去的日子
  const fell = new Map();
  for (const w of weak) {
    for (const t of Array.isArray(w.evidence) ? w.evidence : []) {
      const e = readEvidence(t, today);
      if (!e) continue;
      if (!(fell.get(w.name) >= e.day)) fell.set(w.name, e.day);
      const when = relDay(e.day, today);
      const what = e.q && cpLen(e.q) <= Q_MAX ? `${when}那道 ${e.q} 的题` : `${when}那道“${w.name}”的题`;
      if (e.self) { add(e.day, 3, `${what}，是你自己改对的。`); continue; }
      const hook = reviewHook(w, list, inQueue, today);
      if (!hook) continue;
      const c = hook.card;
      const same = e.via === 'card' && !c.light && c.day === e.day && reviewPlan(c).some(p => p.kind === 'redo');
      add(e.day, 7, same ? `${what}，${hook.when}在复习里等你。` : `${what}，${hook.when}复习里有同类的题。`, hook.when === '今天');
    }
  }

  // 最近的进步：攻克、自己改对、聊天里弄懂，和新题一次做对（按坑攒日子，下面数“连着”）
  const oks = new Map();
  for (const t of Array.isArray(profile.recent) ? profile.recent : []) {
    const r = readRecent(t, today);
    if (!r) continue;
    const when = relDay(r.day, today);
    if (r.kind === 'beaten') add(r.day, 0, `“${r.name}”这个坑，你${when}攻克了。`);
    else if (r.kind === 'self') add(r.day, 4, `${when}你自己改对了一道“${r.name}”的题。`);
    else if (r.kind === 'got') add(r.day, 6, `${when}聊天的时候，你把“${r.name}”弄懂了。`);
    else if (r.via !== '复习原题') {
      if (!oks.has(r.name)) oks.set(r.name, new Map());
      if (!oks.get(r.name).has(r.day)) oks.get(r.name).set(r.day, r.via);
    }
  }
  for (const [name, days] of oks) {
    const last = fell.get(name) || '';
    const after = [...days.keys()].filter(d => d > last).sort();
    const n = Math.min(after.length, CN_TIMES.length - 1);
    if (!n) continue;
    const end = after[after.length - 1];
    if (n >= 2) {
      add(end, last ? 1 : 2, last ? `${relDay(last, today)}的“${name}”，你已经连着做对${CN_TIMES[n]}次了。` : `这几天“${name}”你做对了${CN_TIMES[n]}次。`);
    } else {
      const when = relDay(end, today);
      const via = days.get(end);
      add(end, 5, via === '复习' ? `${when}复习，“${name}”你一次就做对了。` : via === '聊天时的练习' ? `${when}在聊天里练“${name}”，你一次就做对了。` : `${when}练“${name}”，你一次就做对了。`);
    }
  }

  found.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.rank - b.rank));
  return found[0] || null;
}
export function greetingLine(profile, today = dayOf(), opts = {}) {
  const p = greetingPick(profile, today, opts);
  return p ? p.text : '';
}

export function withNumbers(text) {
  return String(text || '').split(/(\d+)/).filter(Boolean).map(s => (/^\d+$/.test(s) ? h('span', { className: 'n', text: s }) : s));
}

// ---------------------------------------------------------------- 视图

export function createHome(ctx) {
  const root = document.getElementById('view-home');
  root.replaceChildren();
  const date = h('span', { className: 'runhead-title home-date' });
  const mockTag = h('span', { className: 'tag home-mock', text: '模拟', hidden: true });
  const head = h('header', { className: 'runhead home-head' }, date,
    h('span', { className: 'home-head-end' }, mockTag,
      h('button', { type: 'button', className: 'text-btn home-parent', text: '家长', on: { click: () => ctx.go('parent') } })));
  const body = h('div', { className: 'home-body' });
  const links = h('nav', { className: 'home-links', 'aria-label': '其他入口' });
  root.append(h('div', { className: 'home-page' }, head, body, links));

  let cards = null;
  let attempts = null;   // 今天的作答记录；读不到时为 null，homePlan 改数卡上的复习
  let probe = null;      // 老师想主动聊的点（profile.probePoint），没有就是 null
  let prof = null;       // 学情档案（profile.loadProfile），招呼那一句从这里挑
  let token = 0;
  const today = () => (typeof ctx.today === 'function' ? ctx.today() : dayOf());
  const exam = () => { try { return ctx.kv.peek('exam', null); } catch (e) { return null; } };
  // 今天零点（本地）以后的作答，at 是 ISO 时间，所以按本地零点换成 ISO 再比
  async function todayAttempts() {
    try {
      if (!ctx.store || typeof ctx.store.byIndex !== 'function') return null;
      const [y, m, d] = today().split('-').map(Number);
      const list = await ctx.store.byIndex('attempts', 'at', { lo: new Date(y, m - 1, d).toISOString() });
      return Array.isArray(list) ? list : null;
    } catch (e) { return null; }
  }
  const isMock = () => {
    try { return !!((typeof ctx.mockForced === 'function' && ctx.mockForced()) || (typeof ctx.settings === 'function' && ctx.settings().mock)); } catch (e) { return false; }
  };
  const budgetOut = () => {
    try { return !!(ctx.budget && typeof ctx.budget.canSpend === 'function' && !ctx.budget.canSpend()); } catch (e) { return false; }
  };

  function goPending() {
    const p = pendingList(ctx.kv);
    if (p.length) ctx.go('confirm', { photoId: p[0].photoId, idx: p[0].idx });
    else ctx.go('book');
  }

  function render() {
    const now = new Date();
    const t = today();
    date.textContent = dateLine(now);
    mockTag.hidden = !isMock();
    const capture = big => h('button', { type: 'button', className: big ? 'btn btn-big home-capture' : 'btn quiet home-capture', on: { click: () => ctx.go('capture') } }, icon('camera'), h('span', { text: '拍错题' }));
    const plan = cards ? homePlan({ cards, attempts, today: t, hour: now.getHours(), exam: exam() }) : null;
    let pick = null;
    try { pick = plan && prof ? greetingPick(prof, t, { cards, queue: plan.queue }) : null; } catch (e) { console.warn('home greeting:', (e && e.message) || e); }

    const out = [h('p', { className: 'home-hello', text: greeting(now.getHours()) })];
    if (pick) out.push(h('p', { className: 'home-greet', text: pick.text }));
    if (!plan) {
      out.push(h('div', { className: 'home-review' }, h('div', { className: 'sk-bars', 'aria-hidden': 'true' }, [70, 52].map(w => h('i', { style: `width:${w}%` })))));
    } else if (!plan.total) {
      out.push(h('div', { className: 'home-review' },
        h('p', { className: 'lede home-line', text: '拍下学校老师批改过的那一页，我们把错题一道一道弄明白。' }),
        h('div', { className: 'home-actions' }, capture(true))));
    } else if (plan.reviewCount) {
      // 招呼已经说了今天复习里等她的那道，就不再说“为什么先练这个”，免得一屏两句说同一件事
      const why = pick && pick.inReview ? '' : whyLine(plan.first, t, ctx.curriculum || null);
      out.push(h('div', { className: 'home-review' },
        why ? h('p', { className: 'home-why', text: why }) : null,
        h('div', { className: 'home-actions' },
          h('button', { type: 'button', className: 'btn btn-big home-start', text: reviewLabel(plan), on: { click: () => ctx.go('practice', plan.late ? { light: true } : {}) } }))));
      out.push(h('div', { className: 'home-snap' }, capture(false), h('p', { className: 'small', text: '学校老师发回批改过的作业，随时拍，先放进待讲。' })));
    } else {
      out.push(h('div', { className: 'home-review' },
        h('p', { className: 'lede home-line' }, withNumbers(reviewLine(plan, t))),
        h('div', { className: 'home-actions' }, capture(true))));
    }
    if (budgetOut()) out.push(h('p', { className: 'status-line home-note' }, icon('info'), h('span', { text: kidMessage('budget-day', { where: 'photo' }) })));
    out.push(teacherEl());
    body.replaceChildren(...out);

    // 底部入口不放欠账数字：待讲只说明天先讲几道（点了照样马上讲），问学校老师只带一个小圆点
    const later = pendingLine(pendingList(ctx.kv).length, t, exam());
    const ask = cards ? cards.filter(c => c && c.status === 'ask').length : 0;
    links.replaceChildren(...[
      // 字和数字包在一个 span 里：按钮是 flex，零散的字和数字之间会被 gap 撑开
      later ? h('button', { type: 'button', className: 'text-btn home-link accent', on: { click: goPending } }, h('span', {}, withNumbers(later))) : null,
      h('button', { type: 'button', className: 'text-btn home-link', on: { click: () => ctx.go('book') } }, icon('book'), h('span', { text: '错题本' })),
      ask ? h('button', { type: 'button', className: 'text-btn home-link home-askteacher', 'aria-label': `${ASK_TITLE}，有要问的题`, on: { click: () => ctx.go('book', { tab: 'ask' }) } },
        h('span', { text: ASK_TITLE }), h('span', { className: 'home-dot', 'aria-hidden': 'true' })) : null,
    ].filter(Boolean));
  }

  // 私人老师：主动找她聊的小卡，和一直在的“有问题，问我”
  function teacherEl() {
    const line = probeLine(probe);
    const card = probe ? h('div', { className: 'home-probe' },
      h('p', { className: 'home-probe-title', text: line.title }),
      line.why ? h('p', { className: 'home-probe-why', text: line.why }) : null,
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '好，聊聊', on: { click: () => ctx.go('chat', { mode: 'probe', point: probe }) } }),
        h('button', { type: 'button', className: 'text-btn', text: '今天先不', on: { click: skipProbe } }))) : null;
    return h('div', { className: 'home-teacher' }, card,
      h('button', { type: 'button', className: 'btn quiet home-ask', on: { click: () => ctx.go('chat', { mode: 'free' }) } }, icon('chat'), h('span', { text: ASK_LABEL })));
  }
  async function skipProbe() {
    probe = null;
    try { await ctx.kv.set('probeDay', today()); } catch (e) { console.warn('probeDay', e); }
    render();
  }

  async function refresh() {
    const mine = ++token;
    render();
    try {
      const [all, att] = await Promise.all([
        ctx.store && typeof ctx.store.all === 'function' ? ctx.store.all('items') : [],
        todayAttempts(),
      ]);
      if (mine !== token) return;
      cards = (Array.isArray(all) ? all : []).filter(c => c && typeof c === 'object' && c.id != null);
      attempts = att;
    } catch (e) {
      console.warn('home:', (e && e.message) || e);
      if (mine !== token) return;
      cards = cards || [];
    }
    render();
    // 学情档案慢一点没关系：算好了再把招呼那一句和小卡放上来
    try {
      const next = await loadProfile(ctx);
      if (mine !== token) return;
      prof = next;
      probe = probePoint(next, { today: today(), probeDay: ctx.kv.peek('probeDay', '') });
      render();
    } catch (e) { console.warn('home profile:', (e && e.message) || e); }
  }

  return {
    show() {
      // 第一次打开（或约定改了）：先看约定。等这一轮显示完再换，nav 不会在 onShow 里套 onShow
      if (needsOnboard(ctx.kv)) {
        token++;
        body.replaceChildren();
        links.replaceChildren();
        setTimeout(() => ctx.go('onboard'), 0);
        return;
      }
      refresh();
    },
    // 从后台回来：可能过了零点或 21:00，重新算
    onResume() { if (typeof ctx.route !== 'function' || ctx.route() === 'home') refresh(); },
    hide() { token++; },
  };
}
