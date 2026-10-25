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
// 用到的 ctx：store.all('items')、store.byIndex('attempts', 'at', 今天零点起)、kv（peek）、curriculum、today()、budget.canSpend()、settings()、mockForced()、go；
//   老师的笔记本另用 ai.ask('reflect')（notes.runReflect）。
//   homeProbe({ note, profile, today, probeDay, talked }) -> 小卡聊的点 | null   先看笔记的 focus，再看学情档案（v0.5）
// 样式在 css/home.css，类名以 home- 开头（base.css 里占位首页的 .home-main、.home-title、.home-lede、.screen 不用）。
//
// v1 期中季（DESIGN 2.4、4.9，notebook.examPlan）：家长区填了考试日期时，招呼下面一行安静的提示（examPlan 的 note）：
//   season “离期中还有 N 天。……”；paper “考前做一份错题卷吧……”，点了去错题卷（路由 PAPER_ROUTE，还没有这个路由时只是一行字）；
//   rest “考前两天，轻松复习，早点睡。”，主按钮只推轻松版（复习上限 3 道，带 { light: true } 去 practice），不推新讲：
//   今天或明天是考前 2 天到考完时，底部不出“明天先讲 N 道”（newTalkPaused），待讲的题照样在错题本里；
//   after “考完了。卷子发回来，拍进来我们一起看。”。没有考试日期时什么都不显示。
// 每次刷新首页先做一遍期中季的维护（examUpkeep，纯函数）：第一次进 season 时把范围内跨过去的卡、休息的轻卡叫醒一次
//   （notebook.wake，kv 'examWoke' { exam, day } 记着，同一个考试日期只叫一次）；再把每张卡过一遍 notebook.compressDue
//   （考前压缩，排程在 ui-practice 那边漏套了也能在这里补上）。变了的卡存回 items。
//   导出：examUpkeep(cards, exam, today, woke) -> { cards, changed, woke }   newTalkPaused(exam, today) -> bool
//   homePlan 多了 paperDone 参数，返回值多了 light（21:00 以后或考前两天）和 exam（examPlan 的结果）。
//   kv 'examPaper' { exam, done }（错题卷那边写；没有就当不知道）：卷子没做完时考前第 2 天还推错题卷（日历 A）。
import { h, icon, dateCn, teacherAvatar } from './ui-dom.js';
import { textbookMap, buildPoint, progressPoint } from './bookmap.js';
import { dayOf, addDays, due, reviewPlan, quotaFor, shortName, SHORT_NAMES, LATE_HOUR, examPlan, compressDue, wake } from './notebook.js';
import { ROUTES } from './nav.js';
import { kidMessage } from './kid-errors.js';
import { relDay, pendingList, pendingLine, ASK_TITLE } from './ui-book.js';
import { needsOnboard } from './ui-onboard.js';
import { loadProfile, probePoint, probeLine } from './profile.js';
import { paperState } from './paper.js';
import { focusPoint } from './reflect.js';
import { latestNote, runReflect, isMock as mockMode, NOTES_KEY } from './notes.js';

// v0.3 私人老师（CONTRACTS 17）：首页多两样东西，放在复习和拍错题下面：
//   老师主动找她：学情档案里最需要帮的那个点分数够高、今天还没聊过（kv 'probeDay'）时，一张小卡“想和你聊 3 分钟：…”，
//     “好，聊聊”去 chat { mode: 'probe', point }，“今天先不”记下 probeDay，今天不再出
//   “有问题，问我”：一直在，去 chat { mode: 'free' }
// v0.5 老师的笔记本（CONTRACTS 20，notes.js）：
//   小卡先看最新一篇笔记里“下周想和她聊的”（reflect.focusPoint），这篇写好以后已经聊过的点跳过；都没有再用学情档案
//     （homeProbe）。卡上的名字用错因的短名（SHORT_NAMES），没有短名才用笔记里的说法；开场的问法（opener）带给老师
//   首页显示时在后台调 notes.runReflect：到了该写的时候写一篇，不挡界面，不告诉她，写好了下次显示时用
export const ASK_LABEL = '有问题，问我';

// v0.7 更多聊一聊的机会（Wei 10-25）：弱点小卡今天没有（或聊过、跳过了）时，再看课本：
// 进度不知道或一周没更新，问她“课上学到哪了”；否则挑一节学过但还没一起做过题的，摸摸底。一天一次（kv 'checkinDay'）
export const PROGRESS_STALE_DAYS = 7;
export function checkinPoint({ curriculum = null, cards = [], progress = null, toc = null, today = dayOf(), checkinDay = '' } = {}) {
  if (checkinDay === today) return null;
  const upd = String((progress && progress.updated) || '').slice(0, 10);
  if (!progress || !progress.section || !upd || addDays(upd, PROGRESS_STALE_DAYS) <= today) return progressPoint();
  return buildPoint(textbookMap({ curriculum, cards, progress, toc, today }));
}
export function checkinLine(point) {
  if (!point) return { title: '', why: '' };
  if (point.kind === 'progress') return { title: '想和你聊 1 分钟：这几天数学课学到哪了？', why: '我好跟着你们的进度出题。' };
  return { title: `想和你聊 3 分钟：${point.name}。`, why: '这一节你们学过了，我们还没一起做过题。出两道小题摸摸底。' };
}

// 首页小卡聊哪个点。note 是最新一篇笔记，talked 是这篇写好以后主动聊过的点（名字或错因 id）
export function homeProbe({ note = null, profile = null, today = dayOf(), probeDay = '', talked = [] } = {}) {
  const done = new Set((Array.isArray(talked) ? talked : []).map(x => String(x || '')).filter(Boolean));
  const nameOf = f => (f.tag && SHORT_NAMES[f.tag]) || [...String(f.point || '')].slice(0, 16).join('');
  const left = note && Array.isArray(note.focus)
    ? note.focus.filter(f => f && !(f.tag && done.has(f.tag)) && !done.has(String(f.point || '')) && !done.has(nameOf(f))) : [];
  const f = note ? focusPoint({ ...note, focus: left }, { today, probeDay }) : null;
  if (f && f.name) {
    const name = nameOf({ tag: f.tag, point: f.name });
    const w = profile && Array.isArray(profile.weak) ? profile.weak.find(x => x && ((f.tag && x.tag === f.tag) || x.name === name)) : null;
    // probeUser 用“；”把证据连起来：笔记里的句子去掉句末的句号
    const evidence = [...new Set([...(f.evidence || []), ...((w && w.evidence) || [])].map(t => String(t || '').replace(/[。；;\s]+$/, '')).filter(Boolean))].slice(0, 3);
    const out = { tag: f.tag || (w && w.tag) || '', name, evidence, opener: f.opener || '', fromNote: true };
    if (w) Object.assign(out, { learning: w.learning, stage: w.stage, wrong7: w.wrong7, score: w.score, ...(w.cardId ? { cardId: w.cardId } : {}) });
    return out;
  }
  return probePoint(profile, { today, probeDay });
}

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

export function homePlan({ cards = [], attempts = null, today = dayOf(), hour = new Date().getHours(), exam = null, paperDone } = {}) {
  const list = (Array.isArray(cards) ? cards : []).filter(c => c && c.id != null);
  const late = hour >= LATE_HOUR;
  const season = examPlan(list, exam, today, { paperDone });
  // 考前两天到考完：和 21:00 以后一样只推轻松版（DESIGN 2.4）
  const light = late || season.phase === 'rest';
  const quota = quotaFor(today, { exam, light });
  const done = Array.isArray(attempts) ? reviewsDone(attempts, today) : doneToday(list, today);
  const left = Math.max(0, quota.reviewMax - done);
  const dueCards = due(list, today);
  const round = pickRound(list, today, left);
  const later = list.filter(c => c.status === 'learning' && isDay(c.due) && c.due > today).map(c => c.due).sort();
  return {
    late, light, exam: season, quota, done, left, queue: round.picked,
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
  if (plan.late) return `今晚轻松复习，约 ${plan.minutes} 分钟`;
  return plan.light ? `今天轻松复习，约 ${plan.minutes} 分钟` : `今天复习，约 ${plan.minutes} 分钟`;
}

// ---------------------------------------------------------------- v1 期中季

// 错题卷的路由名。写成常量：路由还没接上时 run.mjs 不会把它当成坏的 go()，首页那一行也就只是字
export const PAPER_ROUTE = 'paper';

// 考前 2 天不讲新错题（DESIGN 2.4）：今天或明天落在考前 2 天到考完之间，就不说“明天先讲 N 道”
export function newTalkPaused(exam, today = dayOf()) {
  return [today, addDays(today, 1)].some(d => examPlan([], exam, d).phase === 'rest');
}

// 首页每次刷新先做的期中季维护。woke 是 kv 'examWoke'（{ exam, day }）：同一个考试日期只叫醒一次。
// -> { cards（新的整张表）, changed（要存回 items 的卡）, woke（要写进 kv 'examWoke' 的值，不用写时 null） }
export function examUpkeep(cards = [], exam = null, today = dayOf(), woke = null) {
  const list = (Array.isArray(cards) ? cards : []).filter(c => c && typeof c === 'object');
  const date = /^\d{4}-\d{2}-\d{2}/.test(String((exam && exam.date) || '')) ? String(exam.date).slice(0, 10) : '';
  if (!date) return { cards: list, changed: [], woke: null };
  let next = list;
  let mark = null;
  const season = examPlan(list, exam, today);
  if (season.phase === 'season' && !(woke && woke.exam === date)) {
    const ids = new Set(season.wake.map(String));
    const up = new Map(wake(list.filter(c => ids.has(String(c.id))), today).map(c => [String(c.id), c]));
    next = list.map(c => up.get(String(c.id)) || c);
    mark = { exam: date, day: today };
  }
  next = next.map(c => compressDue(c, exam, today));
  return { cards: next, changed: next.filter((c, i) => c !== list[i]), woke: mark };
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
      const when = e.day === today ? '刚才' : relDay(e.day, today);   // 避免“今天那道…今天复习里”
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
  // 错题卷做完没有：错题卷那边写 kv 'examPaper' { exam, done }；没有这一行（或是上一次考试的）就当不知道
  const paperDone = ex => {
    try {
      const p = ctx.kv.peek('examPaper', null);
      if (p && ex && p.exam === ex.date && typeof p.done === 'boolean') return p.done;
      // 错题卷只写 kv 'paper'：最近一份卷子是这次考试前 10 天内出的，就按它两半交没交完算
      const last = ctx.kv.peek('paper', null);
      if (!ex || !ex.date || !last || !last.made || last.made > ex.date || addDays(last.made, 10) < ex.date) return undefined;
      return paperState(last).all;
    } catch (e) { return undefined; }
  };
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
    const ex = exam();
    const done = paperDone(ex);
    const plan = cards ? homePlan({ cards, attempts, today: t, hour: now.getHours(), exam: ex, paperDone: done }) : null;
    let pick = null;
    try { pick = plan && prof ? greetingPick(prof, t, { cards, queue: plan.queue }) : null; } catch (e) { console.warn('home greeting:', (e && e.message) || e); }
    let season = null;
    try { season = plan ? plan.exam : examPlan([], ex, t, { paperDone: done }); } catch (e) { console.warn('home exam:', (e && e.message) || e); }

    const out = [h('p', { className: 'home-hello', text: greeting(now.getHours()) })];
    if (pick) out.push(h('p', { className: 'home-greet', text: pick.text }));
    out.push(examLine(season));
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
          h('button', { type: 'button', className: 'btn btn-big home-start', text: reviewLabel(plan), on: { click: () => ctx.go('practice', plan.light ? { light: true } : {}) } }))));
      out.push(h('div', { className: 'home-snap' }, capture(false), h('p', { className: 'small', text: '学校老师发回批改过的作业，随时拍，先放进待讲。' })));
    } else {
      out.push(h('div', { className: 'home-review' },
        h('p', { className: 'lede home-line' }, withNumbers(reviewLine(plan, t))),
        h('div', { className: 'home-actions' }, capture(true))));
    }
    if (budgetOut()) out.push(h('p', { className: 'status-line home-note' }, icon('info'), h('span', { text: kidMessage('budget-day', { where: 'photo' }) })));
    out.push(teacherEl());
    body.replaceChildren(...out.filter(Boolean));

    // 底部入口不放欠账数字：待讲只说明天先讲几道（点了照样马上讲），问学校老师只带一个小圆点。考前两天不推新讲
    let paused = false;
    try { paused = newTalkPaused(ex, t); } catch (e) { paused = false; }
    const later = paused ? '' : pendingLine(pendingList(ctx.kv).length, t, ex);
    const ask = cards ? cards.filter(c => c && c.status === 'ask').length : 0;
    links.replaceChildren(...[
      // 字和数字包在一个 span 里：按钮是 flex，零散的字和数字之间会被 gap 撑开
      later ? h('button', { type: 'button', className: 'text-btn home-link accent', on: { click: goPending } }, h('span', {}, withNumbers(later))) : null,
      h('button', { type: 'button', className: 'text-btn home-link', on: { click: () => ctx.go('book') } }, icon('book'), h('span', { text: '错题本' })),
      h('button', { type: 'button', className: 'text-btn home-link', on: { click: () => ctx.go('bookmap') } }, icon('note'), h('span', { text: '课本地图' })),
      ask ? h('button', { type: 'button', className: 'text-btn home-link home-askteacher', 'aria-label': `${ASK_TITLE}，有要问的题`, on: { click: () => ctx.go('book', { tab: 'ask' }) } },
        h('span', { text: ASK_TITLE }), h('span', { className: 'home-dot', 'aria-hidden': 'true' })) : null,
    ].filter(Boolean));
  }

  // 期中季那一行：安静的一句，不抢主按钮。错题卷那天是个文字按钮（有错题卷这个界面时）
  function examLine(season) {
    if (!season || !season.note) return null;
    if (season.phase === 'paper' && ROUTES[PAPER_ROUTE]) {
      return h('button', { type: 'button', className: 'text-btn home-exam home-exam-go', on: { click: () => ctx.go(PAPER_ROUTE) } },
        h('span', {}, withNumbers(season.note)), icon('chev'));
    }
    return h('p', { className: 'home-exam' }, withNumbers(season.note));
  }

  // 私人老师：主动找她聊的小卡，和一直在的“有问题，问我”
  function teacherEl() {
    // 弱点小卡优先；没有就看课本（checkinPoint），两张都是老师主动找她，带头像
    let chk = null;
    if (!probe && cards) {
      try {
        chk = checkinPoint({ curriculum: ctx.curriculum, cards, progress: ctx.kv.peek('progress', null), toc: (ctx.kv.peek('textbook', null) || {}).toc || null,
          today: today(), checkinDay: ctx.kv.peek('checkinDay', '') });
      } catch (e) { chk = null; }
    }
    const point = probe || chk;
    const line = probe ? probeLine(probe) : checkinLine(chk);
    const card = point ? h('div', { className: 'home-probe' },
      teacherAvatar('home-probe-av'),
      h('div', { className: 'home-probe-body' },
        h('p', { className: 'home-probe-title', text: line.title }),
        line.why ? h('p', { className: 'home-probe-why', text: line.why }) : null,
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: '好，聊聊', on: { click: () => ctx.go('chat', { mode: 'probe', point }) } }),
          h('button', { type: 'button', className: 'text-btn', text: '今天先不', on: { click: probe ? skipProbe : skipCheckin } })))) : null;
    return h('div', { className: 'home-teacher' }, card,
      h('button', { type: 'button', className: 'btn quiet home-ask', on: { click: () => ctx.go('chat', { mode: 'free' }) } }, teacherAvatar('sm'), h('span', { text: ASK_LABEL })));
  }
  async function skipCheckin() {
    try { await ctx.kv.set('checkinDay', today()); } catch (e) { console.warn('checkinDay', e); }
    render();
  }
  // 期中季维护（examUpkeep）：叫醒、考前压缩，变了的卡存回去。存不上只记 console，首页照样按新排程显示，下次再存
  async function keepExam(list) {
    const ex = exam();
    if (!ex || !ex.date) return list;
    let up;
    try { up = examUpkeep(list, ex, today(), ctx.kv.peek('examWoke', null)); } catch (e) { console.warn('home exam:', (e && e.message) || e); return list; }
    if (!up.changed.length && !up.woke) return up.cards;
    try {
      for (const c of up.changed) await ctx.store.put('items', c);
      if (up.woke) await ctx.kv.set('examWoke', up.woke);
    } catch (e) { console.warn('home exam save:', (e && e.message) || e); }
    return up.cards;
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
      const list = (Array.isArray(all) ? all : []).filter(c => c && typeof c === 'object' && c.id != null);
      const kept = await keepExam(list);
      if (mine !== token) return;
      cards = kept;
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
      const note = latestNote(ctx.kv.peek(NOTES_KEY, []), { mock: mockMode(ctx) });
      probe = homeProbe({ note, profile: next, today: today(), probeDay: ctx.kv.peek('probeDay', ''), talked: talkedSince(note) });
      render();
    } catch (e) { console.warn('home profile:', (e && e.message) || e); }
    // 老师的笔记本：该写的时候在后台写一篇（约半分钟），不挡界面、不提示她；失败就算了，明天再试
    if (mine === token) runReflect(ctx).catch(e => console.warn('reflect:', (e && e.code) || '', (e && e.message) || e));
  }

  // 这篇笔记写好以后，老师主动找她聊过的点（kv 'chats' 里 probe 的那几段，读 chat:<id> 的 point）
  function talkedSince(note) {
    if (!note) return [];
    const since = String(note.at || note.day || '');
    const out = [];
    try {
      for (const x of ctx.kv.peek('chats', []) || []) {
        if (!x || x.mode !== 'probe' || String(x.at || '') < since) continue;
        const c = ctx.kv.peek('chat:' + x.id, null);
        const p = c && c.point;
        if (p) out.push(p.name, p.tag);
        if (c && c.tag) out.push(c.tag);
      }
    } catch (e) { console.warn('home talked:', (e && e.message) || e); }
    return out.filter(Boolean);
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
