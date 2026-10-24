// 首页（C 2.1 的骨架，CONTRACTS 11）：书眉是日期，右上角“家长”；一句招呼；“今天要复习 N 道，约 M 分钟”和一个主按钮
// “开始复习”（go practice），没有到期的题就不出这一块；一句“为什么先练这个”，来自到期最久的那张卡；“拍错题”
// （go capture），有复习时是第二个按钮，没有复习时它就是主按钮；底部一行文字入口：待讲 N 道（kv 'pending'，点了去
// confirm 第一道）、错题本、问老师 N 道。
// 第一次打开（kv 'onboarded' 不为真，或约定改了版本）先去约定页。21:00 以后只推轻松版：复习上限 3 道
// （notebook.quotaFor 的 light），主按钮带 { light: true } 去 practice。今天已经做过的复习题从上限里扣掉，
// 做满了说“今天的复习够了，剩下的明天接着来”（C 2.5）。
// 负责：首页 / 错题本 / 约定页 agent（ui-home.js、ui-book.js、ui-onboard.js、css/home.css、book.css、onboard.css）。
//
// 导出
//   createHome(ctx) -> { show(), onResume() }     画在 #view-home（换掉 index.html 里的占位内容）
//   纯函数（node 能测，tests/ui-home.test.mjs）：
//     homePlan({ cards, attempts, today, hour, exam }) -> { late, quota, done, left, queue, reviewCount, minutes, dueCount,
//                                                  capped, first, nextDue, askCount, total }
//     pickRound(cards, today, max) -> { picked, n }   reviewsDone(attempts, today) -> n   和 ui-practice 的 planRound、doneToday 同口径
//     reviewLine(plan, today) -> 一句话（没有卡时 ''）    whyLine(card, today, curriculum) -> '先练“乘方前面的负号”，你周二在这儿掉过坑。'
//     doneToday(cards, today) -> 卡上今天复习了几道（没有 attempts 时用）   reviewMinutes(n) -> 分钟
//     greeting(hour, name) -> '晚上好，Emma。'            dateLine(date) -> '10 月 24 日 星期六'
//     withNumbers(text) -> 节点数组：数字包进 <span class="n">（只在浏览器里用）
//
// 用到的 ctx：store.all('items')、store.byIndex('attempts', 'at', 今天零点起)、kv（peek）、curriculum、today()、budget.canSpend()、settings()、mockForced()、go。
// 样式在 css/home.css，类名以 home- 开头（base.css 里占位首页的 .home-main、.home-title、.home-lede、.screen 不用）。
import { h, icon, dateCn } from './ui-dom.js';
import { dayOf, due, reviewPlan, quotaFor, shortName, LATE_HOUR } from './notebook.js';
import { kidMessage } from './kid-errors.js';
import { relDay, pendingList } from './ui-book.js';
import { needsOnboard } from './ui-onboard.js';

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

export function reviewLine(plan, today = dayOf()) {
  if (!plan || !plan.total) return '';
  if (plan.reviewCount) {
    return plan.late ? `今晚轻松一点：复习 ${plan.reviewCount} 道，约 ${plan.minutes} 分钟。` : `今天要复习 ${plan.reviewCount} 道，约 ${plan.minutes} 分钟。`;
  }
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
  let token = 0;
  const today = () => (typeof ctx.today === 'function' ? ctx.today() : dayOf());
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
    const hello = h('p', { className: 'home-hello', text: greeting(now.getHours()) });
    const capture = big => h('button', { type: 'button', className: big ? 'btn btn-big home-capture' : 'btn quiet home-capture', on: { click: () => ctx.go('capture') } }, icon('camera'), h('span', { text: '拍错题' }));

    const out = [hello];
    if (!cards) {
      out.push(h('div', { className: 'home-review' }, h('div', { className: 'sk-bars', 'aria-hidden': 'true' }, [70, 52].map(w => h('i', { style: `width:${w}%` })))));
    } else {
      const plan = homePlan({ cards, attempts, today: t, hour: now.getHours(), exam: ctx.kv.peek('exam', null) });
      const line = reviewLine(plan, t);
      if (!plan.total) {
        out.push(h('div', { className: 'home-review' },
          h('p', { className: 'lede home-line', text: '拍下老师批改过的那一页，我们把错题一道一道弄明白。' }),
          h('div', { className: 'home-actions' }, capture(true))));
      } else if (plan.reviewCount) {
        const why = whyLine(plan.first, t, ctx.curriculum || null);
        out.push(h('div', { className: 'home-review' },
          h('p', { className: 'lede home-line' }, withNumbers(line)),
          why ? h('p', { className: 'home-why', text: why }) : null,
          h('div', { className: 'home-actions' },
            h('button', { type: 'button', className: 'btn btn-big home-start', text: '开始复习', on: { click: () => ctx.go('practice', plan.late ? { light: true } : {}) } }))));
        out.push(h('div', { className: 'home-snap' }, capture(false), h('p', { className: 'small', text: '老师发回批改过的作业，随时拍，先放进待讲。' })));
      } else {
        out.push(h('div', { className: 'home-review' },
          h('p', { className: 'lede home-line' }, withNumbers(line)),
          h('div', { className: 'home-actions' }, capture(true))));
      }
    }
    if (budgetOut()) out.push(h('p', { className: 'status-line home-note' }, icon('info'), h('span', { text: kidMessage('budget-day', { where: 'photo' }) })));
    body.replaceChildren(...out);

    const pending = pendingList(ctx.kv);
    const ask = cards ? cards.filter(c => c && c.status === 'ask').length : 0;
    links.replaceChildren(...[
      pending.length ? h('button', { type: 'button', className: 'text-btn home-link accent', on: { click: goPending } }, withNumbers(`待讲 ${pending.length} 道`)) : null,
      h('button', { type: 'button', className: 'text-btn home-link', on: { click: () => ctx.go('book') } }, icon('book'), h('span', { text: '错题本' })),
      ask ? h('button', { type: 'button', className: 'text-btn home-link', on: { click: () => ctx.go('book', { tab: 'ask' }) } }, withNumbers(`问老师 ${ask} 道`)) : null,
    ].filter(Boolean));
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
