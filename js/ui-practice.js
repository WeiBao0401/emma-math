// 到期复习（路由 practice，CONTRACTS 11；方案 C 2.2、4.4-4.6、5.2-5.3、7.3）：今天到期的错因卡，原题重做和变式题
// 混着出，一题一屏，顶上一条细进度，没有倒计时、没有分数。草稿纸上算，小键盘填结果（keypad.js）。
// 负责：练习界面 agent（ui-practice.js、keypad.js、css/practice.css、css/keypad.css）。
//
// 一轮怎么走
//   排队    notebook.todayQueue，上限上学日 6 题、周末 10 题、轻松版 3 题，按“今天已经做了几题”扣掉（attempts 里数）。
//           一张卡这一轮的题要么全出、要么不出：复习只有整张卡做完才算一次（recordReview）。
//   原题    kind 'redo'：她确认过的题目文字和截图，不显示她当时的写法和讲解。她当时的答案就是这道的“坑”答案。
//   变式题  kind 'variant'：卡的 pool 里没用过、层级对得上的；没有就取任意没用过的；池子空了当场调
//           ctx.pipeline.variants 补（开局就在后台先补，她多半不用等），等的时候说“我在出一道新题”。
//           补不出来就改做原题，原题也做过了就跳过这一题（不算数）。
//   判题    mathcheck.check。对了说一句具体的话；第一次错给 pipeline.localHint（不花钱），第二次错用
//           ctx.pipeline.retryHint 要一句提示，第三次错把答案给她看。用了提示就不算第一次对。
//           答案等于 trap_answer（她的那个坑会得出的答案）时点名“又是那个坑”。读不懂的写法不算错，请她换个写法。
//   纸上题  kind text（说理、找规律）：她点“对照看”，看答案，自己点“一样 / 不一样”，记自评（self）。
//           自评的题不单独算攻克（全是自评的那次复习，最多把卡推到第 3 档）。
//   这题有问题  每题角上都有。点了先问一句，再记进卡的 flagged、变式题从 pool 下架，这题跳过、不计。
//   问我这道  同一道题错了两次、看了答案、或者纸上对照“不一样”以后，题下面出“问我这道”（v0.3.1）：带着这道题、她最后
//           的答案、正确答案和卡上的“记住”进 chat 的 problem 模式。去之前这题先收尾（还没看答案就给她看答案，
//           算没做对），作答和复习先记下来，她问完直接回首页也不丢；从 chat 返回时这一轮原样接着，点“下一题”往下走。
//   记录    每题离开时 store.addAttempt 一条；一张卡这一轮的题都做完，notebook.recordReview 更新卡并存回。
//   收尾    “今天推进了 N 个坑”；攻克的卡有一个安静的完成动画（prefers-reduced-motion 时不动）。
//   考考我  params.cardId：只练这一张卡，出 1 道没用过的远变式或近变式；第一次就对、没用提示，recordReview 记通过一次。
//           没做对不记复习（她自己要考的，不罚），只记作答。
//   模拟    设置里 mock 或地址带 ?mock=1：没有到期的卡时可以点“用样例卡练一轮”，样例卡只在内存里，不存、不记；
//           补题走 ai.js 的模拟回答，不发请求。
//
// 导出
//   createPractice(ctx) -> { show(params, { from, back }), hide() }      params：{ cardId?, light?, demo? }
//                                         back 为真、这一轮是去问我这道停下的：不重开，原样接着
//   以下是纯函数（tests/practice.test.mjs）
//   CAP, isWeekend(day), reviewCap(day, { light }), doneToday(attempts, day)
//   planRound(cards, today, { max }) -> [{ cardId, kind, level }]       整张卡进队，再混排（remix(queue, keyOf)）
//   pickVariant(card, levels, taken) -> variant | null,  freeVariants(card, taken), refillLevels(level), mergePool(card, variants)
//   variantSource(card) -> pipeline.variants / prompts.userVariants 要的平铺字段
//   redoQuestion(card), variantQuestion(card, v, level) -> Question
//   inputKind(q), lettersFor(q), variableOf(q), judge(given, q) -> { ok, reason, trap }
//   afterSubmit(state, verdict) -> state + action：'right' | 'self' | 'unreadable' | 'hint-local' | 'hint-remote' | 'reveal'
//   praiseLine(state, q), missLine(verdict, q), revealLines(q), wrapLines({ passed, practiced, dueTomorrow }), testLines(...)
//   applyReview(card, results, today), flagCard(card, q, { day, at }), trapName(card, curriculum), checkpointLine(card, curriculum), demoCards(today)
//   askMeReady(st) -> bool                 这一题该不该出“问我这道”（st 是一题的作答状态：tries、revealed、selfDiff）
//   herAnswerText(given, q) -> string      她交的答案写成 chat 顶上能画的样子（小键盘的输入行转成公式）
//   askMeParams(q, { cardId, given }) -> go('chat', …) 的 params：{ mode: 'problem', cardId, problem, diagnosis }
//     ui-chat 现在要靠 cardId 从错题本里取卡（取不到就说“这道题找不到了”），problem、diagnosis 用这里传的这道
//
// Question = { cardId, kind: 'redo' | 'variant', level, q, options, crop, answer, answer_kind, form, unit, trap, trap_answer,
//              remember, steps, input（keypad 的 kind）, letters, variable }
// 依赖：notebook.js、mathcheck.js、pipeline.js（localHint）、keypad.js、ui-dom.js、kid-errors.js、mock.js（只有样例卡用）。
// 模块顶层不碰 document。
import { h, icon, mathText, toast, skBars, prefersReducedMotion, dateCn } from './ui-dom.js';
import { createAnswer, DEFAULT_LETTERS, toLatex } from './keypad.js';
import { check } from './mathcheck.js';
import { todayQueue, reviewPlan, recordReview, due, dayOf, addDays, STAGES, QUOTA, quotaFor, isWeekend, shortName } from './notebook.js';
import { localHint } from './pipeline.js';
import { kidMessage } from './kid-errors.js';
import { mockAnswer } from './mock.js';

const str = v => (v == null ? '' : String(v)).trim();
const CHECK_KINDS = new Set(['number', 'expr', 'equation', 'set', 'choice', 'compare', 'text']);

// ---------------------------------------------------------------- 排队和名额

// 名额的数字在 notebook.quotaFor（首页和这里同一个口径）：上学日 6、周末 10、轻松版 3
export const CAP = { school: QUOTA.school.reviewMax, weekend: QUOTA.weekend.reviewMax, light: QUOTA.lightReviewMax };
export { isWeekend };
export const reviewCap = (day, { light = false, exam = null } = {}) => quotaFor(day, { light, exam }).reviewMax;
// 今天已经做了几道复习题（考考我、跳过的不算）
export const doneToday = (attempts, day) => (attempts || [])
  .filter(a => a && a.day === day && (a.kind === 'redo' || a.kind === 'variant') && !a.test && !a.skipped).length;

// 到期最久的卡先进，一张卡的题全进或者不进（复习按整张卡算），然后交给 todayQueue 排，再 remix 一遍：
// todayQueue 每步只看“和上一题不同坑”，到最后常剩一张卡的两题挨着；remix 每步挑剩得最多的那个坑，能隔开就隔开
export function planRound(cards, today = dayOf(), { max = CAP.school } = {}) {
  if (!(max > 0)) return [];
  const picked = [];
  let n = 0;
  for (const c of due(cards || [], today)) {
    const k = Math.min(2, reviewPlan(c).length);
    if (!k || n + k > max) continue;
    picked.push(c);
    n += k;
    if (n >= max) break;
  }
  if (!n) return [];
  const byId = new Map(picked.map(c => [c.id, c]));
  return remix(todayQueue(picked, today, { max: n }), it => { const c = byId.get(it.cardId) || {}; return c.tag || c.type || it.cardId; });
}

// 相邻两题尽量不同坑；同一个坑里的题保持原来的先后（原题在变式题前面），坑和坑之间按第一次出现的先后
export function remix(queue, keyOf) {
  const lanes = new Map();
  for (const it of queue) { const k = keyOf(it); if (!lanes.has(k)) lanes.set(k, []); lanes.get(k).push(it); }
  const keys = [...lanes.keys()];
  const out = [];
  let last = null;
  while (out.length < queue.length) {
    const open = keys.filter(k => lanes.get(k).length);
    const others = open.filter(k => k !== last);
    const from = others.length ? others : open;
    const best = from.reduce((a, b) => (lanes.get(b).length > lanes.get(a).length ? b : a));
    out.push(lanes.get(best).shift());
    last = best;
  }
  return out;
}

// ---------------------------------------------------------------- 变式题池

const flaggedSet = card => new Set((card.flagged || []).map(f => f && f.q).filter(Boolean));
export function freeVariants(card, taken = new Set()) {
  const used = new Set([...(card.used || []), ...taken]);
  const bad = flaggedSet(card);
  return (card.pool || []).filter(v => v && str(v.q) && str(v.answer) && !used.has(v.q) && !bad.has(v.q));
}
export function pickVariant(card, levels = [], taken = new Set()) {
  const free = freeVariants(card, taken);
  for (const l of levels) { const v = free.find(x => x.level === l); if (v) return v; }
  return free[0] || null;
}
// 补题时要哪几道：要用的那一层放第一个，凑满 4 道（近变式、辨析、远变式各有）
export function refillLevels(level) {
  const base = ['近变式', '辨析', '远变式', '近变式'];
  const i = base.indexOf(level);
  return i < 0 ? base : [level, ...base.slice(0, i), ...base.slice(i + 1)];
}
export function mergePool(card, variants) {
  const c = { ...card, pool: [...(card.pool || [])] };
  const have = new Set(c.pool.map(v => v && v.q));
  for (const v of variants || []) if (v && str(v.q) && !have.has(v.q)) { c.pool.push(v); have.add(v.q); }
  return c;
}
// prompts.userVariants 读平铺的 stem / answer / wrong_step …；错因卡把它们放在 problem、diagnosis 里
export function variantSource(card) {
  const p = card.problem || {}, d = card.diagnosis || {};
  return {
    id: card.id, tag: card.tag || d.tag || '',
    stem: str(card.stem || p.stem), options: card.options || p.options || [], answer: str(card.answer || d.answer),
    wrong_step: str(card.wrong_step || d.wrong_step), error_type: str(card.error_type || d.error_type || card.type),
    why: str(card.why || d.why), section: str(card.section || d.section),
  };
}

// ---------------------------------------------------------------- 一道题

// 答案的样子：去掉 LaTeX 外壳和单位，只看字
function bare(answer, unit = '') {
  let s = str(answer).split(/\r?\n/)[0];
  s = s.replace(/\\[()[\]]|\$/g, ' ').replace(/\\(?:text|mathrm)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\(?:frac|dfrac|tfrac)/g, ' ').replace(/\\(?:times|div|cdot|circ|degree|prime|left|right|pm)/g, ' ').replace(/\\[a-zA-Z]+/g, ' ');
  s = s.replace(/[{}]/g, ' ');
  if (unit) s = s.split(unit).join(' ');
  s = s.replace(/(?:cm²|cm|mm|dm|km|kg|min)(?![a-zA-Z])/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function inputKind(q) {
  const opts = (q.options || []).filter(Boolean);
  const a = bare(q.answer, q.unit);
  if (q.answer_kind === 'choice' || (opts.length >= 2 && /^[A-H](?:\s*[,，、]?\s*[A-H])*$/.test(a))) return opts.length >= 2 ? 'choice' : 'text';
  if (CHECK_KINDS.has(q.answer_kind)) return q.answer_kind;
  if (!a) return 'text';
  if (/^(?:<|>|=|≤|≥|<=|>=)$/.test(a)) return 'compare';
  if (/[一-鿿]/.test(a.replace(/[或和及]/g, ''))) return 'text';   // 一句话的答案（说理、判断）：她在纸上写
  if (/或|,|，|、|±/.test(a)) return 'set';
  if (/^[a-zA-Z]\s*=/.test(a)) return 'equation';
  if (/[a-zA-Z]/.test(a)) return 'expr';
  return 'number';
}
export function variableOf(q) {
  const m = /^\s*([a-zA-Z])\s*=/.exec(bare(q.answer, q.unit));
  return m ? m[1] : 'x';
}
// 小键盘上出哪些字母：答案里用到的一定有；化简题再补默认的 a b x y m n
export function lettersFor(q) {
  const k = q.input || inputKind(q);
  const inAns = [...new Set(bare(q.answer, q.unit).match(/[a-zA-Z]/g) || [])];
  if (k === 'expr') return [...inAns, ...DEFAULT_LETTERS.filter(l => !inAns.includes(l))].slice(0, Math.max(6, inAns.length));
  if (k === 'equation') { const v = variableOf(q); return inAns.filter(l => l !== v); }
  if (k === 'set') return inAns;
  return [];
}

function finishQuestion(q) {
  q.unit = str(q.unit) || (/°/.test(str(q.answer)) ? '°' : '');
  q.input = inputKind(q);
  q.letters = lettersFor(q);
  q.variable = variableOf(q);
  return q;
}

export function redoQuestion(card) {
  const p = card.problem || {}, d = card.diagnosis || {};
  const q = {
    cardId: card.id, kind: 'redo', level: '原题', q: str(p.stem), options: p.options || [], crop: card.crop || '',
    answer: str(d.answer), answer_kind: str(d.answer_kind), form: str(d.form), unit: str(d.unit),
    trap: '', trap_answer: '', remember: str(d.remember), steps: Array.isArray(d.solution) ? d.solution : [],
  };
  // 她当时的答案就是这道的坑答案（半对的题，她的答案可能是对的那一部分，照样算坑：少了一种情况）
  const her = str(p.her_answer);
  if (her && q.answer && her !== '[?]') {
    const kind = CHECK_KINDS.has(q.answer_kind) ? q.answer_kind : '';
    if (check(her, q.answer, { kind, form: q.form }).ok !== true) q.trap_answer = her;
  }
  return finishQuestion(q);
}

export function variantQuestion(card, v, level = '') {
  return finishQuestion({
    cardId: card.id, kind: 'variant', level: str(v.level) || level, q: str(v.q), options: Array.isArray(v.options) ? v.options : [], crop: '',
    answer: str(v.answer), answer_kind: str(v.answer_kind), form: str(v.form), unit: str(v.unit),
    trap: str(v.trap), trap_answer: str(v.trap_answer), remember: str(card.diagnosis && card.diagnosis.remember), steps: Array.isArray(v.steps) ? v.steps : [],
  });
}

export function judge(given, q) {
  const kind = CHECK_KINDS.has(q.answer_kind) ? q.answer_kind : q.input === 'choice' || q.input === 'compare' ? q.input : '';
  const opts = { kind, form: q.form || '' };
  const r = check(given, q.answer, opts);
  const trap = r.ok === false && !!str(q.trap_answer) && check(given, q.trap_answer, opts).ok === true;
  return { ok: r.ok, reason: r.reason || '', trap };
}

// 交上来以后怎么走。state = { tries（错了几次，读不懂的不算）, hints（给过几次提示）, trapHit }
export function afterSubmit(state, verdict) {
  const s = { tries: 0, hints: 0, trapHit: false, ...state };
  if (verdict.ok === true) return { ...s, action: 'right', done: true, ok: true, firstTry: s.tries === 0 && s.hints === 0 };
  if (verdict.ok === null) return { ...s, action: 'self' };
  if (verdict.reason === 'unreadable') return { ...s, action: 'unreadable' };
  s.tries += 1;
  if (verdict.trap) s.trapHit = true;
  if (s.tries === 1) return { ...s, hints: s.hints + 1, action: 'hint-local' };
  if (s.tries === 2) return { ...s, hints: s.hints + 1, action: 'hint-remote' };
  return { ...s, action: 'reveal', done: true, ok: false, firstTry: false };
}

// ---------------------------------------------------------------- 她看到的话（中文，弯引号，不用破折号和感叹号）

const sentence = s => { const t = str(s).replace(/[。.，,；;\s]+$/, ''); return t ? t + '。' : ''; };

// 给她看的答案：没写公式符号的式子（4a+3b、3或7）包成公式画，一句话的答案原样；单位跟在后面（° 已经在答案里）
export function answerText(q) {
  const a = str(q && q.answer);
  if (!a) return '';
  const unit = str(q.unit) && !/°/.test(q.unit) && !a.includes(q.unit) ? ' ' + str(q.unit) : '';
  if (/\\\(|\\\[|\$/.test(a) || /[一-鿿]/.test(a.replace(/或/g, ''))) return a + unit;
  return `\\(${a}\\)` + unit;
}

export function praiseLine(state, q) {
  if (state.firstTry) return q.kind === 'redo' ? '对了。上次掉进去的坑，这次绕过去了。' : '对了。这个坑你绕过去了。';
  if (state.trapHit && state.hints <= 1) return '对了。看清了那个坑，你自己改过来了。';
  if (state.hints <= 1) return '对了。看了提示，你自己改对了。';
  return '对了。这一步记住，明天再练一道。';
}
// 第一次错：撞上坑答案就点名；不然用 mathcheck 看出来的原因（不花钱）
export function missLine(verdict, q) {
  if (verdict.trap) return '又是那个坑。' + sentence(q.trap || q.remember);
  return localHint(verdict.reason) || '再从第一步看一遍，草稿纸上一步一步写。';
}
export function revealLines(q) {
  return [q.remember ? '记住：' + sentence(q.remember) : '', '明天再换一道题练。'].filter(Boolean);
}
export function wrapLines({ passed = 0, practiced = 0, dueTomorrow = 0 } = {}) {
  const main = passed > 0 ? `今天推进了 ${passed} 个坑。` : `今天练了 ${practiced} 个坑。`;
  const sub = practiced > passed ? '没做对的，明天换道题再来。' : '';
  const next = dueTomorrow > 0 ? `明天要复习 ${dueTomorrow} 个坑。` : '明天没有到期的题。';
  return { main, sub, next };
}
export function testLines({ passed, card, today }) {
  if (!passed) return { main: '这道还差一点。', sub: '没关系，这个坑照原来的安排练。' };
  if (card && card.status === 'beaten') return { main: '对了。', sub: '这个坑你确实会了。' };
  const when = card && card.due ? dateCn(card.due) : '';
  return { main: '对了。', sub: when && card.due !== today ? `这个坑往前走了一档，下次复习在 ${when}。` : '这个坑往前走了一档。' };
}

// 坑的短名（12 字以内），收尾时点名用：和错题本同一个名字（notebook.shortName）
export const trapName = (card, curriculum = null) => shortName(card, curriculum);

// 升过级的轻卡（同一个坑一周自己改对 3 次）复习题旁边出一句“检查点”（方案 C 4.4）：错因表里的那句提示，没有就用“记住”那句
export function checkpointLine(card, curriculum = null) {
  if (!card || !card.checkpoint) return '';
  const e = curriculum && typeof curriculum.error === 'function' && card.tag ? curriculum.error(card.tag) : null;
  const s = str((e && e.hint) || (card.diagnosis && card.diagnosis.remember));
  return s ? '检查点：' + sentence(s) : '';
}

// ---------------------------------------------------------------- 卡的更新

// recordReview，外加一条：全是纸上自评的那次复习不让卡攻克（方案 C 5.3“不单独算攻克”）
export function applyReview(card, results, today = dayOf()) {
  const next = recordReview(card, { results, today });
  if (next.status === 'beaten' && results.length && results.every(r => r.self)) {
    const last = STAGES[STAGES.length - 1];
    next.status = 'learning';
    delete next.beatenOn;
    next.stage = last.stage;
    next.due = addDays(today, last.gap);
  }
  return next;
}

// 一张卡这一轮的题都离开以后怎么记：
//   一题都没算数（全跳过）、或者有一题出不了新题（incomplete）：不记复习，卡明天还到期
//   考考我：第一次就对、没用提示才记一次通过；没做对、或卡不在练（攻克了）都不动卡
//   平时：applyReview
// -> { card: 新卡 | null（不改）, passed, beaten }
export function reviewOutcome(card, results, { today = dayOf(), test = false, incomplete = false } = {}) {
  const res = (results || []).filter(Boolean);
  if (test) {
    const passed = res.length > 0 && res.every(x => x.ok && x.firstTry && !x.hints);
    if (!passed || card.status !== 'learning') return { card: null, passed, beaten: false };
  } else if (!res.length || incomplete) return { card: null, passed: false, beaten: false };
  const next = applyReview(card, res, today);
  const passed = !!(next.reviews.length && next.reviews[next.reviews.length - 1].passed);
  return { card: next, passed, beaten: next.status === 'beaten' && card.status !== 'beaten' };
}

export function flagCard(card, q, { day = dayOf(), at = new Date().toISOString() } = {}) {
  const c = { ...card };
  c.flagged = [...(card.flagged || []), { q: q.q, kind: q.kind, level: q.level, answer: q.answer, day, at }];
  if (q.kind === 'variant') c.pool = (card.pool || []).filter(v => v && v.q !== q.q);
  return c;
}

// ---------------------------------------------------------------- 问我这道（v0.3.1）
// 错一次有本机提示、错两次有一句老师的提示，再不懂就该当面问了：第二次错、看过答案、纸上对照“不一样”时出按钮。
// 第一次错不出：先让她自己顺着提示改（DESIGN 4.7）
export const askMeReady = st => !!st && ((st.tries || 0) >= 2 || !!st.revealed || !!st.selfDiff);

// 小键盘的输入行（(1)/(3)、-3^2）在 chat 顶上画成公式；点选的字母、符号、纸上的题原样
export function herAnswerText(given, q = {}) {
  if (given === null || given === undefined || typeof given === 'object') return '';
  const g = str(given);
  if (!g) return '';
  const kind = q.input || inputKind(q);
  if (kind === 'choice' || kind === 'compare' || kind === 'text') return g;
  return `\\(${toLatex(g)}\\)`;
}

// 进 chat problem 模式要的东西：这道题（复习时的题面，变式题就是变式题）、她最后交的答案、正确答案、卡上的“记住”
export function askMeParams(q, { cardId = '', given = '' } = {}) {
  const opts = (q.options || []).map(str).filter(Boolean);
  const unit = str(q.unit);
  const answer = str(q.answer) + (unit && !/°/.test(unit) && !str(q.answer).includes(unit) ? ' ' + unit : '');
  const problem = { stem: str(q.q), her_answer: herAnswerText(given, q), type: '' };
  if (opts.length) problem.options = opts;
  const diagnosis = { answer };
  if (str(q.remember)) diagnosis.remember = str(q.remember);
  return { mode: 'problem', cardId: str(cardId || q.cardId), problem, diagnosis };
}

// ---------------------------------------------------------------- 样例卡（只在模拟模式，只在内存里）
// 五张今天到期的卡，把每种作答都走一遍：数（乘方）、比大小、补题（乘除顺序，池子是空的）、化简（去括号）、
// 两个答案带单位（点在直线上）、选择题和纸上说理（−a 的正负）。
export function demoCards(today = dayOf()) {
  const t1 = mockAnswer('recognize', { mockCase: '' }).problems;
  const br = mockAnswer('recognize', { mockCase: 'brackets' }).problems;
  const half = mockAnswer('recognize', { mockCase: 'half' }).problems;
  const variants = topic => mockAnswer('variants', { mockCase: topic }).variants.map(v => ({ ...v, checked: 'program' }));
  const card = (n, problem, diagnosis, stage, pool) => ({
    id: 'demo-' + n, demo: true, at: `${addDays(today, -9)}T0${n}:00:00.000Z`, day: addDays(today, -9),
    photoId: '', crop: '', thumb: '', source: '练习册', problem: { idx: 0, ...problem }, diagnosis: { ...diagnosis, checked: 'program' },
    tag: diagnosis.tag || '', type: diagnosis.error_type || '', section: diagnosis.section || '',
    status: 'learning', askTeacher: false, stage, due: today, streak: stage - 1, streakFrom: stage > 1 ? addDays(today, -8) : '',
    reviews: [], pool, used: [], flagged: [], originals: [],
  });
  const ex = topic => mockAnswer('explain', { mockCase: topic });
  const powers = variants('powers').filter(v => v.level !== '辨析');
  powers.splice(1, 0, { level: '辨析', q: '比较大小：\\(-3^2\\) ___ \\((-3)^2\\)', answer: '<', answer_kind: 'compare', form: '', unit: '',
    trap: '把 \\(-3^2\\) 当成 \\((-3)^2\\)，以为两边一样大', trap_answer: '=', steps: [], checked: 'program' });
  const neg = {
    answer: 'C', answer_kind: 'choice', form: '', unit: '', solution: ['\\(-a\\) 是 \\(a\\) 的相反数，正负要看 \\(a\\) 自己。'], wrong_line: -1,
    wrong_step: 'A', error_type: '概念误解', tag: 'E-neg-has-minus', section: '1.2.1', why: '她把带负号的都当成负数。',
    remember: '\\(-a\\) 读作“\\(a\\) 的相反数”，正负要看 \\(a\\) 自己。', doubt: '',
  };
  return [
    card(1, t1[1], ex('powers'), 2, powers),
    card(2, t1[4], ex('order'), 3, []),
    card(3, br[0], ex('brackets'), 1, variants('brackets')),
    card(4, half[0], ex('geometry'), 1, variants('geometry')),
    card(5, {
      no: '3', type: '选择', stem: '若 \\(a\\) 是一个有理数，那么 \\(-a\\)（　）', figure: '', her_work: [], her_answer: 'A', mark: 'wrong', teacher_note: '', circled: '', unclear: false,
      options: ['A. 一定是负数', 'B. 一定是正数', 'C. 可能是正数、负数或 0', 'D. 一定不是 0'],
    }, neg, 1, [{
      level: '近变式', q: '判断：\\(-a\\) 一定是负数吗？在纸上写出你的判断和理由。', answer: '不一定。\\(a\\) 是负数时，\\(-a\\) 是正数；\\(a=0\\) 时，\\(-a=0\\)。',
      answer_kind: 'text', form: '', unit: '', trap: '带负号就当成负数', trap_answer: '', steps: ['举一个 \\(a\\) 是负数的例子：\\(a=-2\\)，\\(-a=2\\)。'], checked: 'models',
    }]),
  ];
}

// ---------------------------------------------------------------- 界面

const LEVEL_LABEL = { 原题: '原题再做一遍', 同构: '一道新题', 近变式: '一道新题', 辨析: '一道新题', 远变式: '一道新题' };
const isAbort = e => !!e && (e.code === 'abort' || e.name === 'AbortError');

export function createPractice(ctx) {
  let root = null;     // <section id="view-practice">
  let stage = null;    // 这个界面画在里面
  let token = 0;
  let R = null;        // 这一轮
  let answer = null;   // 当前这题的作答控件
  let objectURL = '';
  let paused = null;   // 点了“问我这道”的那一轮：去 chat 时不收，从 chat 返回（back）时原样接着

  const todayOf = () => (typeof ctx.today === 'function' ? ctx.today() : dayOf());
  const isMock = () => { try { return !!((ctx.settings && ctx.settings().mock) || (ctx.mockForced && ctx.mockForced())); } catch { return false; } };

  function mount() {
    if (!root) {
      root = document.getElementById('view-practice');
      if (!root) {   // 接线前也能打开：自己补一个 section
        root = h('section', { id: 'view-practice', className: 'view' });
        (document.getElementById('main') || document.body).append(root);
      }
    }
    if (!stage || !stage.isConnected) { stage = h('div', { className: 'pr' }); root.replaceChildren(stage); }
  }
  function clearAnswer() {
    if (answer) { answer.destroy(); answer = null; }
  }
  function releaseURL() {
    if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = ''; }
  }
  function stop() {
    if (R && R.ctl) R.ctl.abort();
    R = null;
    clearAnswer();
    releaseURL();
  }
  function paint(...nodes) {
    clearAnswer();
    stage.replaceChildren(...nodes.flat().filter(Boolean));
    window.scrollTo(0, 0);
  }
  const header = (count = '') => h('header', { className: 'runhead pr-head' },
    h('button', { type: 'button', className: 'text-btn pr-end', text: R && R.test ? '回去' : '结束', on: { click: quit } }),
    h('span', { className: 'runhead-title', text: R && R.test ? '考考我' : '复习' }),
    h('span', { className: 'pr-count', text: count }));
  function quit() { stop(); ctx.back ? ctx.back() : ctx.go('home'); }
  const homeBtn = (label = '回首页', big = false) => h('button', { type: 'button', className: 'btn' + (big ? ' btn-big' : ''), text: label, on: { click: () => { stop(); ctx.go('home'); } } });

  // ---------------------------------------------------------------- 数据
  async function loadCards() {
    const all = await ctx.store.all('items');
    return (all || []).filter(c => c && c.id && typeof c.status === 'string');
  }
  async function countToday(today) {
    try {
      if (!ctx.store || typeof ctx.store.byIndex !== 'function') return 0;
      const [y, m, d] = today.split('-').map(Number);
      const rows = await ctx.store.byIndex('attempts', 'at', { lo: new Date(y, m - 1, d).toISOString() });
      return doneToday(rows, today);
    } catch { return 0; }
  }
  function save(r, card) {
    if (r.demo) return;
    Promise.resolve().then(() => ctx.store.put('items', card)).catch(e => console.warn('practice: save card', e));
  }
  function log(r, rec) {
    if (r.demo) return;
    Promise.resolve().then(() => ctx.store.addAttempt(rec)).catch(e => console.warn('practice: attempt', e));
  }

  // ---------------------------------------------------------------- 开始
  async function show(params = {}) {
    stop();
    const my = ++token;
    mount();
    paint(header(), h('div', { className: 'pr-body' }, h('p', { className: 'pr-wait' }, h('span', { className: 'dots', text: '正在打开错题本' })), skBars([70, 52])));
    const today = todayOf();
    const p = params || {};
    let cards;
    if ((p.demo || String(p.cardId || '').startsWith('demo-')) && isMock()) cards = demoCards(today);
    else {
      try { cards = await loadCards(); } catch (e) {
        if (my !== token) return;
        console.warn(e);
        return paintMsg('错题本没打开。', '回首页，过一会儿再进来试试。');
      }
    }
    if (my !== token) return;
    if (p.cardId) return startTest(my, cards, String(p.cardId), today);
    let max;
    if (p.demo && isMock()) max = CAP.weekend;
    else {
      const used = await countToday(today);
      if (my !== token) return;
      const exam = ctx.kv && typeof ctx.kv.peek === 'function' ? ctx.kv.peek('exam', null) : null;
      max = Math.max(0, reviewCap(today, { light: !!p.light, exam }) - used);
    }
    const queue = planRound(cards, today, { max });
    if (!queue.length) return paintEmpty(cards, today, max);
    startRound(my, cards, today, { queue, demo: !!(p.demo && isMock()) });
  }

  function paintMsg(main, sub, btn = homeBtn()) {
    paint(header(), h('div', { className: 'pr-body pr-empty' },
      h('p', { className: 'lede', text: main }), sub ? h('p', { className: 'lead', text: sub }) : null, h('div', { className: 'btn-row' }, btn)));
  }

  function paintEmpty(cards, today, max) {
    const live = cards.filter(c => c.status === 'learning' || c.status === 'beaten');
    const dueNow = due(cards, today).length;
    const later = cards.filter(c => c.status === 'learning' && c.due && c.due > today).map(c => c.due).sort()[0];
    let main, sub = '';
    const btns = [];
    if (!live.length) {
      main = '错题本里还没有题。';
      sub = '拍一页学校老师批过的作业，我们从那里开始。';
      btns.push(h('button', { type: 'button', className: 'btn', text: '拍错题', on: { click: () => { stop(); ctx.go('capture'); } } }), homeBtnText());
    } else if (dueNow && max <= 0) {
      main = '今天的复习做完了。';
      sub = '剩下的明天接着来。';
      btns.push(homeBtn());
    } else {
      main = '今天没有要复习的题。';
      sub = later ? `下一次复习在 ${dateCn(later)}。` : '';
      btns.push(homeBtn());
    }
    const demo = isMock() ? h('button', { type: 'button', className: 'text-btn accent pr-demo', text: '用样例卡练一轮（模拟模式，不存进错题本）', on: { click: () => show({ demo: true }) } }) : null;
    paint(header(), h('div', { className: 'pr-body pr-empty' },
      h('p', { className: 'lede', text: main }), sub ? h('p', { className: 'lead', text: sub }) : null, h('div', { className: 'btn-row' }, btns), demo));
  }
  const homeBtnText = () => h('button', { type: 'button', className: 'text-btn', text: '回首页', on: { click: () => { stop(); ctx.go('home'); } } });

  function startTest(my, cards, id, today) {
    const card = cards.find(c => c.id === id);
    if (!card) return paintMsg('这张卡找不到了。', '', backBtn());
    if (card.status === 'ask' || !str(card.diagnosis && card.diagnosis.answer)) return paintMsg('这道题要先问学校老师。', '问完学校老师，再来考自己。', backBtn());
    startRound(my, cards, today, { queue: [{ cardId: id, kind: 'variant', level: '远变式', levels: ['远变式', '近变式'] }], test: true, demo: !!card.demo });
  }
  const backBtn = () => h('button', { type: 'button', className: 'btn', text: '回去', on: { click: quit } });

  function startRound(my, cards, today, { queue, demo = false, test = false }) {
    R = {
      my, today, demo, test, queue, i: 0, ctl: new AbortController(),
      cards: new Map(cards.map(c => [c.id, c])), taken: new Map(), results: new Map(), left: new Map(), redoDone: new Set(), incomplete: new Set(),
      prefetch: new Map(), passed: 0, practiced: new Set(), beaten: [], testPassed: false,
    };
    for (const it of queue) R.left.set(it.cardId, (R.left.get(it.cardId) || 0) + 1);
    const keys = new Set(queue.map(it => { const c = R.cards.get(it.cardId) || {}; return c.tag || c.type || it.cardId; }));
    R.mixed = keys.size >= 2;
    prefetchAll(R);
    present();
  }

  // ---------------------------------------------------------------- 补题
  // 开局先看哪张卡的池子不够这一轮用，在后台补上；每张卡这一轮最多补一次
  function prefetchAll(r) {
    const need = new Map();
    for (const it of r.queue) if (it.kind === 'variant') need.set(it.cardId, [...(need.get(it.cardId) || []), ...(it.levels || [it.level])]);
    for (const [id, levels] of need) {
      const card = r.cards.get(id);
      if (card && freeVariants(card).length < (r.queue.filter(it => it.cardId === id && it.kind === 'variant').length)) ensurePool(r, id, levels[0]);
    }
  }
  function ensurePool(r, id, level) {
    if (r.prefetch.has(id)) return r.prefetch.get(id);
    const p = (async () => {
      if (!ctx.pipeline || typeof ctx.pipeline.variants !== 'function') throw Object.assign(new Error('pipeline missing'), { code: 'http' });
      const got = await ctx.pipeline.variants(variantSource(r.cards.get(id)), refillLevels(level), { signal: r.ctl.signal });
      if (r !== R) return 0;
      const next = { ...mergePool(r.cards.get(id), got), updated: new Date().toISOString() };
      r.cards.set(id, next);
      save(r, next);
      return (got || []).length;
    })();
    p.catch(() => {});   // 等的人自己处理；没人等也不报未处理
    r.prefetch.set(id, p);
    return p;
  }

  // ---------------------------------------------------------------- 一题
  const takenFor = (r, id) => { if (!r.taken.has(id)) r.taken.set(id, new Set()); return r.taken.get(id); };
  const redoOK = card => !!(card && card.problem && str(card.problem.stem) && card.diagnosis && str(card.diagnosis.answer));
  const progress = r => h('div', { className: 'pr-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(r.queue.length), 'aria-valuenow': String(r.i) },
    h('i', { style: `width:${Math.round((r.i / Math.max(1, r.queue.length)) * 100)}%` }));
  const countText = r => (r.test ? '' : `第 ${Math.min(r.i + 1, r.queue.length)} / ${r.queue.length} 题`);

  async function present() {
    const r = R;
    if (!r) return;
    if (r.i >= r.queue.length) return r.test ? wrapTest(r) : wrap(r);
    const it = r.queue[r.i];
    const taken = takenFor(r, it.cardId);
    let q = null, note = '';
    if (it.kind === 'redo') {
      const card = r.cards.get(it.cardId);
      if (!r.redoDone.has(it.cardId) && redoOK(card)) q = redoQuestion(card);
    } else {
      const levels = it.levels || [it.level];
      let v = pickVariant(r.cards.get(it.cardId), levels, taken);
      if (!v) {
        paint(header(countText(r)), progress(r), h('div', { className: 'pr-body' },
          h('p', { className: 'pr-wait' }, h('span', { className: 'dots', text: '我在出一道新题' })), skBars([88, 64, 76])));
        try { await ensurePool(r, it.cardId, levels[0]); } catch (e) {
          if (isAbort(e) || r !== R) return;
          note = r.test ? kidMessage(e) : kidMessage(e, { where: 'practice' });
        }
        if (r !== R) return;
        v = pickVariant(r.cards.get(it.cardId), levels, taken);
        if (!v && !note) note = r.test ? '现在出不了新题，等一下再来考。' : kidMessage('empty', { where: 'practice' });
      }
      if (v) q = variantQuestion(r.cards.get(it.cardId), v, it.level);
      else if (r.test) return paintMsg('这次没考成。', note || '现在出不了新题，等一下再来考。', backBtn());
      else {
        // 出不了新题：这张卡今天不记复习（明天还到期），能做原题就先做原题
        r.incomplete.add(it.cardId);
        if (!r.redoDone.has(it.cardId) && redoOK(r.cards.get(it.cardId))) q = redoQuestion(r.cards.get(it.cardId));
      }
    }
    if (!q) {   // 出不了题：跳过，不算数
      if (it.kind === 'variant') toast('这道新题没出好，先跳过。', 3000);
      leave(r, it, null, { skipped: true });
      return;
    }
    taken.add(q.q);
    if (q.kind === 'redo') r.redoDone.add(it.cardId);
    ask(r, it, q, note);
  }

  function ask(r, it, q, note) {
    // gone：她已经离开这题（下一题、跳过）。还在路上的提示回来时看这个，不去碰下一题的控件
    const st = { tries: 0, hints: 0, trapHit: false, givens: [], t0: Date.now(), out: null, gone: false };
    const label = r.test ? '考一道新题' : LEVEL_LABEL[q.level] || (q.kind === 'redo' ? '原题再做一遍' : '一道新题');
    const flagBtn = h('button', { type: 'button', className: 'text-btn pr-flag', text: '这题有问题', on: { click: () => confirmFlag() } });
    const flagBox = h('div', { className: 'pr-flagask', hidden: true });
    let img = null;
    clearAnswer();
    releaseURL();
    if (q.crop) {
      let src = '';
      if (typeof q.crop === 'string') src = q.crop;
      else if (typeof Blob !== 'undefined' && q.crop instanceof Blob) src = objectURL = URL.createObjectURL(q.crop);
      if (src) img = h('img', { className: 'pr-crop', src, alt: '原题截图' });
    }
    const hints = h('ol', { className: 'pr-hints', 'aria-live': 'polite' });
    const say = h('div', { className: 'pr-say', 'aria-live': 'polite' });
    const actions = h('div', { className: 'pr-actions' });
    const askSlot = h('div', { className: 'pr-askme', hidden: true });   // “问我这道”，到时候才出，在提示下面
    const host = h('div', { className: 'pr-answer' });
    const first = r.i === 0 && q.input !== 'text' && q.input !== 'choice' && q.input !== 'compare';
    const cp = r.test ? '' : checkpointLine(r.cards.get(it.cardId), ctx.curriculum);
    paint(header(countText(r)), progress(r), h('div', { className: 'pr-body' },
      h('div', { className: 'pr-q' },
        h('div', { className: 'pr-qtop' }, h('span', { className: 'label pr-kind', text: label }), flagBtn),
        flagBox,
        img,
        mathText(q.q, { tag: 'div', className: 'pr-stem' }),
        cp ? h('p', { className: 'pr-check', text: cp }) : null,
        first ? h('p', { className: 'small pr-tip', text: '草稿纸上算，答案填在下面。' }) : null,
        note ? h('p', { className: 'small pr-note', text: note }) : null),
      hints, askSlot, host, say, actions));
    const ans = answer = createAnswer(host, {
      kind: q.input, options: q.options, unit: q.unit, letters: q.letters, variable: q.variable,
      onSubmit: given => submit(given),
    });
    ans.focus();

    function addHint(text, { wait = false, trap = false } = {}) {
      const li = h('li', { className: 'pr-hint' + (wait ? ' wait' : '') + (trap ? ' trap' : '') });
      if (wait) li.append(h('span', { className: 'dots', text }));
      else li.append(mathText(text, { className: 'pr-hint-t' }));
      hints.append(li);
      return li;
    }

    async function submit(given) {
      if (st.out || r !== R) return;
      if (given && typeof given === 'object' && given.self) return selfCheck();
      // 和上一次交的一模一样（多按了一次“好了”）：不算又错一次
      if (st.givens.length && String(given) === String(st.givens[st.givens.length - 1]) && !st.out) {
        say.replaceChildren(h('p', { className: 'pr-soft', text: '和上一次一样。改一改再交。' }));
        ans.focus();
        return;
      }
      const v = judge(given, q);
      st.givens.push(given);
      const s = afterSubmit(st, v);
      Object.assign(st, { tries: s.tries, hints: s.hints, trapHit: s.trapHit, reason: v.reason || st.reason || '' });
      offerAsk();
      say.replaceChildren();
      if (s.action === 'right') return finish({ ok: true, firstTry: s.firstTry, lines: [praiseLine(s, q)], reason: '' });
      if (s.action === 'self') return selfCheck();
      if (s.action === 'unreadable') { say.append(h('p', { className: 'pr-soft', text: localHint('unreadable') })); ans.focus(); return; }
      if (s.action === 'reveal') return finish({ ok: false, firstTry: false, reveal: true, reason: v.reason, trapNow: v.trap });
      if (q.input === 'choice' || q.input === 'compare') ans.clear();
      if (s.action === 'hint-local') { addHint(missLine(v, q), { trap: v.trap }); ans.focus(); return; }
      // 第二次错：要一句提示（模拟模式不花钱）
      ans.lock(true);
      const li = addHint('我在想一个提示', { wait: true });
      let text = '';
      try {
        if (!ctx.pipeline || typeof ctx.pipeline.retryHint !== 'function') throw Object.assign(new Error('pipeline missing'), { code: 'http' });
        text = await ctx.pipeline.retryHint({ q: q.q, given: String(given), answer: q.answer, reason: v.reason }, { signal: r.ctl.signal, local: false });
      } catch (e) {
        if (isAbort(e) || r !== R || st.gone) return;
        text = kidMessage(e, { where: 'hint' }) || '再想一想。';
      }
      if (r !== R || st.out || st.gone) return;
      li.className = 'pr-hint' + (v.trap ? ' trap' : '');
      li.replaceChildren(mathText((v.trap ? '又是那个坑。' : '') + text, { className: 'pr-hint-t' }));
      ans.lock(false);
      ans.focus();
    }

    // 纸上的题、程序判不了的题：给她看答案，她自己对照
    function selfCheck() {
      ans.lock(true);
      ans.fold(true);
      say.replaceChildren(
        h('p', { className: 'pr-soft', text: '和你纸上写的对照一下。' }),
        h('div', { className: 'pr-key' }, h('span', { className: 'label', text: '答案' }), mathText(answerText(q), { tag: 'div', className: 'pr-key-a' }),
          q.steps && q.steps.length ? h('ol', { className: 'pr-steps' }, q.steps.slice(0, 5).map(s => h('li', {}, mathText(s)))) : null));
      const same = h('button', { type: 'button', className: 'btn', text: '一样', on: { click: () => finish({ ok: true, firstTry: st.tries === 0 && st.hints === 0, self: true, lines: ['好。纸上写清楚，考试也是这样写。'], reason: 'self' }) } });
      const diff = h('button', { type: 'button', className: 'btn quiet', text: '不一样', on: { click: () => finish({ ok: false, firstTry: false, self: true, lines: ['没关系。照着答案在纸上改一遍，明天再练一道。'], reason: 'self' }) } });
      actions.replaceChildren(same, diff);
      same.focus({ preventScroll: true });
    }

    function finish({ ok, firstTry, lines = [], reveal = false, self = false, reason = '', trapNow = false }) {
      if (st.out) return;
      st.out = { ok, firstTry: !!firstTry, self, reason, ms: Date.now() - st.t0 };
      if (reveal) st.revealed = true;
      if (self && !ok) st.selfDiff = true;
      for (const li of hints.querySelectorAll('.pr-hint.wait')) li.remove();   // 还在路上的提示用不上了
      ans.lock(true);
      ans.fold(true);
      const nodes = [];
      if (reveal) {
        nodes.push(h('p', { className: 'pr-soft', text: trapNow ? '又是那个坑。这道先看答案。' : '这道先看答案。' }),
          h('div', { className: 'pr-key' }, h('span', { className: 'label', text: '答案' }), mathText(answerText(q), { tag: 'div', className: 'pr-key-a' })),
          ...revealLines(q).map(t => mathText(t, { tag: 'p', className: 'pr-soft' })));
      } else if (!self) {
        nodes.push(h('p', { className: 'pr-good', text: lines[0] || '对了。' }));
      } else {
        // 自评：答案留在屏上，下面加一句
        nodes.push(...[...say.childNodes], h('p', { className: ok ? 'pr-good' : 'pr-soft', text: lines[0] || '' }));
      }
      say.replaceChildren(...nodes);
      const last = r.i >= r.queue.length - 1;
      const nextBtn = h('button', { type: 'button', className: 'btn', text: last ? (r.test ? '看看结果' : '看看今天') : '下一题', on: { click: () => leave(r, it, q, { st }) } });
      actions.replaceChildren(nextBtn);
      actions.after(askSlot);   // 做题时它跟在提示下面；这题收尾后挪到“下一题”下面，先看答案再决定问不问
      offerAsk();
      nextBtn.focus({ preventScroll: true });
      if (actions.scrollIntoView) actions.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }

    // 问我这道：到了时候才出，出了就一直在（第三次做对了也可以去问为什么）
    function offerAsk() {
      if (r !== R || st.gone || !askSlot.hidden || !askMeReady(st)) return;
      askSlot.replaceChildren(h('button', { type: 'button', className: 'text-btn accent', on: { click: askNow } }, icon('chat'), h('span', { text: '问我这道' })));
      askSlot.hidden = false;
    }
    function askNow() {
      if (r !== R || st.gone) return;
      const given = st.givens.length ? st.givens[st.givens.length - 1] : '';
      // 还没看答案就去问：这题先收尾，答案留在屏上，回来点“下一题”接着走
      if (!st.out) finish({ ok: false, firstTry: false, reveal: true, reason: st.reason || '' });
      settle(r, it, q, { st });
      paused = r;
      ctx.go('chat', askMeParams(q, { cardId: it.cardId, given }));
    }

    function confirmFlag() {
      if (flagBox.hidden === false) return;
      flagBox.hidden = false;
      flagBox.replaceChildren(
        h('p', { text: '这题有问题？我先跳过它，记下来给家长看。' }),
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn quiet', text: '跳过这题', on: { click: doFlag } }),
          h('button', { type: 'button', className: 'text-btn', text: '接着做', on: { click: () => { flagBox.hidden = true; flagBox.replaceChildren(); if (!st.out) ans.focus(); } } })));
    }
    function doFlag() {
      if (r !== R) return;
      const card = flagCard(r.cards.get(it.cardId), q, { day: r.today });
      card.updated = new Date().toISOString();
      r.cards.set(it.cardId, card);
      save(r, card);
      toast('记下了。');
      leave(r, it, q, { st, flagged: true });
    }
  }

  // 离开一题：记下来，再出下一题
  function leave(r, it, q, { st = null, flagged = false } = {}) {
    if (r !== R || (st && st.gone)) return;
    if (st) st.gone = true;
    settle(r, it, q, { st, flagged });
    present();
  }

  // 记一题：一条作答；这张卡这一轮的题都做完了就记一次复习。每题只记一次：“问我这道”去问之前先记，回来点“下一题”不再记
  function settle(r, it, q, { st = null, flagged = false } = {}) {
    if (st) {
      if (st.settled) return;
      st.settled = true;
    }
    const out = st && st.out;
    const counted = !!(q && out && !flagged);
    if (q && st) {
      log(r, {
        itemId: it.cardId, at: new Date().toISOString(), day: r.today, kind: q.kind, level: q.level, q: q.q,
        given: st.givens.length ? String(st.givens[st.givens.length - 1]) : '', givens: st.givens.map(String),
        ok: counted ? out.ok : null, reason: out ? out.reason : '', firstTry: counted ? out.firstTry : false, hints: st.hints,
        ms: out ? out.ms : Date.now() - st.t0, trap: st.trapHit, self: !!(out && out.self), where: q.input === 'text' ? 'paper' : 'ipad',
        skipped: !counted || undefined, flagged: flagged || undefined, test: r.test || undefined,
      });
    }
    if (counted) {
      if (!r.results.has(it.cardId)) r.results.set(it.cardId, []);
      r.results.get(it.cardId).push({ ok: out.ok, firstTry: out.firstTry, hints: st.hints, kind: q.kind, level: q.level, q: q.q, mixed: r.mixed || r.test, self: out.self });
      r.practiced.add(it.cardId);
    }
    const left = (r.left.get(it.cardId) || 1) - 1;
    r.left.set(it.cardId, left);
    if (left <= 0) closeCard(r, it.cardId);
    r.i += 1;
  }

  function closeCard(r, id) {
    const res = r.results.get(id) || [];
    const card = r.cards.get(id);
    if (!card) return;
    const out = reviewOutcome(card, res, { today: r.today, test: r.test, incomplete: r.incomplete.has(id) });
    if (r.test) r.testPassed = out.passed;
    if (!out.card) return;
    const next = { ...out.card, updated: new Date().toISOString() };
    r.cards.set(id, next);
    save(r, next);
    if (out.passed) r.passed += 1;
    if (out.beaten) r.beaten.push(next);
  }

  // ---------------------------------------------------------------- 收尾
  function wrap(r) {
    const cards = [...r.cards.values()];
    const lines = wrapLines({ passed: r.passed, practiced: r.practiced.size, dueTomorrow: due(cards, addDays(r.today, 1)).length });
    const motion = !prefersReducedMotion();
    const beaten = r.beaten.map(c => {
      const name = trapName(c, ctx.curriculum);
      return h('div', { className: 'pr-beat' + (motion ? ' play' : '') },
        h('span', { className: 'pr-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('p', { className: 'pr-beat-t' }, name ? [h('mark', { className: 'marked pr-mk', text: name }), '，攻克了。'] : '有一个坑攻克了。'));
    });
    const done = h('div', { className: 'pr-bar done' }, h('i', { style: 'width:100%' }));
    paint(header(''), done, h('div', { className: 'pr-body pr-wrap' + (motion ? ' reveal' : '') },
      r.practiced.size ? h('p', { className: 'lede', text: lines.main }) : h('p', { className: 'lede', text: '这一轮的题都跳过了。' }),
      lines.sub ? h('p', { className: 'lead', text: lines.sub }) : null,
      beaten.length ? h('div', { className: 'pr-beats' }, beaten) : null,
      h('p', { className: 'small pr-next', text: lines.next }),
      r.demo ? h('p', { className: 'small pr-demo-note', text: '这一轮是样例卡，没有存进错题本。' }) : null,
      h('div', { className: 'btn-row' }, homeBtn('回首页', true))));
    R = null;
  }

  function wrapTest(r) {
    const card = [...r.cards.values()].find(c => c.id === (r.queue[0] && r.queue[0].cardId));
    const done = r.results.size > 0;
    const t = done ? testLines({ passed: r.testPassed, card, today: r.today }) : { main: '这题跳过了。', sub: '想考的时候再来。' };
    paint(header(''), h('div', { className: 'pr-body pr-wrap' },
      h('p', { className: 'lede', text: t.main }), t.sub ? h('p', { className: 'lead', text: t.sub }) : null,
      h('div', { className: 'btn-row' }, backBtn())));
    R = null;
  }

  // 从 chat 回来：屏上还是那道题（答案、“下一题”都在），焦点放回“下一题”
  function resume() {
    const next = stage && stage.querySelector('.pr-actions .btn');
    if (next) next.focus({ preventScroll: true });
  }

  return {
    show(params, opts) {
      if (opts && opts.back && paused && paused === R) { paused = null; resume(); return; }
      paused = null;
      show(params || {});
    },
    hide() {
      token++;
      if (paused && paused === R) return;   // 去问我这道：这一轮留着，回来接着做
      stop();
    },
  };
}
