// 考前错题卷（DESIGN 2.4、4.9、6.1，C 9.3，调研 03 2.11）：范围里每个犯过的坑出一道新题，混着排，打印在 A4 纸上做，
// 像考试一样。拆成两半，每半 15 分钟以内（考前复习单要提前几天做，错了还来得及纠正）。做完回 iPad 逐题点 ✓ ✗，
// 记作一次混排复习：对了往前走一档，错了回第 1 档明天再见。
// 负责：错题卷 agent（paper.js、ui-paper.js、css/paper.css、tests/paper.test.mjs）。这里全是纯函数，node 能测。
//
// 出卷
//   rankCards(cards, { sections }) -> 范围内要出题的卡，最需要的在前：在练第 1 档 > 第 2 档 > 第 3 档 > 轻卡 > 攻克；
//       同一档里到期早的在前。问学校老师的卡（status 'ask'）不出
//   inRange(card, sections)         section 前缀在 sections 里（'2.3.1' 算在 '2' 和 '2.3' 里）；没给范围就全部。
//       卡上没有节的也算（和 notebook.inExamRange 一个口径：宁可多出一道，别让一个坑考前没碰过）
//   pickProblem(card, taken) -> 池里的一道题 | null   没用过、没被点过“这题有问题”、已核对（checked 'program' 或 'models'）；
//       远变式 > 辨析 > 近变式 > 同构（同构只在别的都没有时用，总比这个坑不上卷子好）
//   buildPaper(cards, { sections, today, max = 12, curriculum }) -> { items, missing }
//       items: [{ no, cardId, q, answer, answer_kind, form, unit, level, trap, trap_answer, pit, tag, section, tier, need, minutes, options? }]
//       每张卡最多 1 道；超过 max 按需要程度截；混排：相邻两题不同坑，尽量不同章；第一题放她最有把握的。
//       missing: 范围内没有可用题的卡 id（按需要程度排）
//   fillTargets(cards, built, { sections, max, limit }) -> [cardId]   要先补题的卡：排得进前 max 名、却没有题的，最多 limit 张
//   fillSource(card), FILL_LEVELS     补题时给 pipeline.variants 的平铺字段和层级；addToPool(card, variants) 合进池子
//   splitInHalves(items, { maxMinutes = 15 }) -> { halves: [[...], [...]?], minutes: [m, m?], dropped: [...] }
//       连着切成两半（混排顺序不变），两半时间尽量一样、每半不超过 maxMinutes；总时间放不下时先去掉最不急的题。
//       总共 10 分钟以内（oneGo）就不拆，一次做完。题号从 1 连着编，item.half 是第几半
//   minutesFor(item)                 一道题大约几分钟（按答案的样子、层级和字数估）
//   previewPaper(cards, { sections }) -> { count, minutes, two, fill }   选范围时那一行“这份卷子 N 道，约 M 分钟”
//   chapterCounts(cards) -> { 章: 坑数 }    sectionsFor(chapters, examSections), chaptersOf(sections), rangeLabel(chapters)
//   askParams(item) -> go('chat', …) 的 params：{ mode: 'problem', cardId, problem: { stem }, diagnosis: { answer, remember? } }
//
// 卷子
//   newPaper({ id, made, at, chapters, sections, items, halves, minutes, demo }) -> kv 'paper' 的样子：
//       { id, made, at, title, range, chapters, sections, items, minutes, marks: { [no]: 'ok' | 'wrong' }, done: ['', ''], short, demo }
//   paperState(paper) -> { halves, done: [bool], all, pending }      pending：做了卷子还没对完答案
//   sheetsHTML(paper) -> 卷子的 HTML（每半一张、最后一页答案），所有字都过 esc() 或 mathview.renderText（它先转义）
//   paperHTML(paper) -> 完整独立的一页（内联样式、公式已画好、没有脚本），分享和下载用
//   paperFileName(day) -> 'emma-math-paper-2026-10-31.html'
//   SHEET_CSS（卷子的版式，App 里由 ui-paper 放进 <style>，文件里内联）、MATH_CSS（css/math.css 的一份拷贝，测试查两边一致）
//
// 对答案
//   paperResult(item, ok) -> recordReview 的一条 result：{ ok, firstTry, hints: 0, kind: 'variant', level, q, mixed: true, paper: true }
//   applyPaperResult(card, item, ok, today) -> card     notebook.recordReview；攻克的卡这次错了，relapses 加 1（DESIGN 4.5）
//   paperAttempt(item, ok, { paperId, today, at }) -> store.addAttempt 的一条（kind 'paper'）
//   halfReady(paper, half) -> { ready, left }            这一半每题都点了 ✓ 或 ✗ 才能交
//
// 模拟模式
//   demoPaperCards(today) -> 七张样例卡（mock.js 的仿真题，第 1、2、4、5、6 章，各档都有，一张池子是空的，用来走补题），只在内存里
//
// 文案 COPY：她看到的字。中文弯引号，不用破折号和感叹号，句子短；App 自称“我”，真老师叫“学校老师”。
// 依赖：notebook.js（recordReview、shortName）、mathview.js（renderText）、mock.js（只有样例卡用）。模块顶层不碰 document。
import { recordReview, shortName, dayOf } from './notebook.js';
import { renderText } from './mathview.js';
import { mockAnswer } from './mock.js';

// ONE_GO_MINUTES：卷子总共 10 分钟以内就不拆，一次做完（那天还剩几分钟做别的，一天照样守 15 分钟）
export const PAPER_MAX = 12, HALF_MINUTES = 15, ONE_GO_MINUTES = 10, FILL_WAIT_MS = 60000, FILL_MAX = 5;
export const LEVEL_ORDER = ['远变式', '辨析', '近变式', '同构'];
export const FILL_LEVELS = ['远变式', '辨析', '近变式'];
export const HALF_NAMES = ['第一半', '第二半'];
export const DEFAULT_CHAPTERS = [1, 2, 3];   // 期中多半考第 1 到 3 章（调研 01）
export const CHAPTER_TITLES = { 1: '有理数', 2: '有理数的运算', 3: '代数式', 4: '整式的加减', 5: '一元一次方程', 6: '几何图形初步' };

const str = v => (v == null ? '' : String(v)).trim();
const CHECKED = new Set(['program', 'models']);

// ---------------------------------------------------------------- 文案

export const COPY = {
  title: '错题卷',
  rangeTitle: '考前错题卷',
  rangeLead: '范围里的每个坑，我出一道新题。打印出来在纸上做，像考试一样。',
  rangeHead: '考哪几章',
  pits: n => (n > 0 ? `${n} 个坑` : '还没有坑'),
  summary: (n, m, two) => `这份卷子 ${n} 道，约 ${m} 分钟，${two ? '拆成两半做' : '一次做完'}。`,
  summarySub: '每半 15 分钟以内，可以分两天做。',
  none: '这几章还没有坑。先拍几道学校老师批过的错题。',
  noChapter: '先选至少一章。',
  make: '出卷子',
  demo: '用样例卡出一份（模拟模式，不存进错题本）',
  filling: n => `我在给 ${n} 个坑出新题`,
  fillingSub: '最多等一分钟。',
  skip: '不等了，先出卷子',
  short: n => `有 ${n} 个坑这次没出上新题，下次再补。`,
  sheetLead: (n, two) => (two ? `${n} 道，分成两半。每半 15 分钟以内，可以分两天做。` : `${n} 道，一次做完。`),
  print: '打印',
  share: '分享',
  printHelp: '打印不出来的话，点“分享”，存成文件，发到电脑上打印。',
  toCheck: '做完了，对答案',
  checkTitle: '对答案',
  checkLead: '对着纸上写的，每题点 ✓ 或 ✗。',
  answer: '答案',
  right: '做对了',
  wrong: '做错了',
  askMe: '问我这道',
  submitHalf: i => (HALF_NAMES[i] ? `${HALF_NAMES[i]}对完了` : '对完了'),
  left: n => `还有 ${n} 道没点。`,
  halfDone: '对完了',
  openHalf: i => `对${HALF_NAMES[i] || '这一半'}的答案`,
  lookAgain: '再看一眼',
  keyHidden: '最后一页是答案，打印和分享时会带上，屏幕上先不给你看。',
  wrapPassed: n => `推进了 ${n} 个坑。`,
  wrapNone: '对完了。',
  wrapMiss: '没做对的，明天换道题再来。',
  wrapAllRight: '都做对了。',
  wrapOther: i => `${HALF_NAMES[i] || '另一半'}做完了，再来对答案。`,
  wrapAll: '整份卷子对完了。',
  demoNote: '这一份是样例卡，没有存进错题本。',
  home: '回首页',
  resume: when => `${when}出的卷子，还没对完答案。`,
  resumeCheck: '接着对答案',
  resumeSheet: '再看一眼卷子',
  fresh: '出一份新的',
  back: '首页',
  shareFail: '没分享出去，再试一次。',
  printFail: '这台 iPad 现在打印不了，点“分享”试试。',
  loadFail: '错题本没打开。',
  loadFailSub: '回首页，过一会儿再进来试试。',
  saveFail: '没存上，再点一次。',
  // 印在纸上的字
  sheetNote: (n, m) => `这一半 ${n} 道，约 ${m} 分钟。过程写在每题下面的空白处，做完回 iPad 对答案。`,
  sheetNoteOne: (n, m) => `${n} 道，约 ${m} 分钟。过程写在每题下面的空白处，做完回 iPad 对答案。`,
  keyTitle: '答案',
  keyNote: '做完再看。每题后面一句是这题的坑。',
  trap: '这题的坑：',
  answerLine: '答：',
};

// ---------------------------------------------------------------- 范围

const secOf = card => str(card && (card.section || (card.diagnosis && card.diagnosis.section))).split(/\s+/)[0];

export function inRange(card, sections = []) {
  const list = (Array.isArray(sections) ? sections : []).map(str).filter(Boolean);
  if (!list.length) return true;
  const sec = secOf(card);
  if (!sec) return true;
  return list.some(s => sec === s || sec.startsWith(s + '.') || s.startsWith(sec + '.'));
}

export const chapterOf = section => { const n = parseInt(str(section), 10); return Number.isFinite(n) ? n : null; };

// 范围里有哪几章（只算七上 1 到 6 章）；没给就第 1 到 3 章
export function chaptersOf(sections = []) {
  const set = new Set((Array.isArray(sections) ? sections : []).map(chapterOf).filter(n => n >= 1 && n <= 6));
  return set.size ? [...set].sort((a, b) => a - b) : [...DEFAULT_CHAPTERS];
}

// 按章勾的范围 -> buildPaper 的 sections。家长在考试设置里只选了这一章的几节，就照那几节；没选的章整章算
export function sectionsFor(chapters = [], picked = []) {
  const exact = (Array.isArray(picked) ? picked : []).map(str).filter(Boolean);
  const out = [];
  for (const ch of [...new Set((chapters || []).map(Number).filter(n => n >= 1))].sort((a, b) => a - b)) {
    const mine = exact.filter(s => chapterOf(s) === ch && s.includes('.'));
    if (mine.length) out.push(...mine); else out.push(String(ch));
  }
  return out;
}

// [1, 2, 3] -> '第 1-3 章'；[1, 3] -> '第 1、3 章'；[1, 2, 3, 5] -> '第 1-3、5 章'
export function rangeLabel(chapters = []) {
  const list = [...new Set((chapters || []).map(Number).filter(n => n >= 1))].sort((a, b) => a - b);
  if (!list.length) return '';
  const runs = [];
  for (const n of list) {
    const last = runs[runs.length - 1];
    if (last && last[1] === n - 1) last[1] = n; else runs.push([n, n]);
  }
  return `第 ${runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join('、')} 章`;
}

export const paperTitle = chapters => `Emma 的错题卷 · ${rangeLabel(chapters) || '全部'}`;

// ---------------------------------------------------------------- 出卷

// 需要程度：0 最需要。在练第 1 档 0、第 2 档 1、第 3 档 2、轻卡 3、攻克 4；不出题的 -1
export function needTier(card) {
  if (!card || !card.id) return -1;
  if (card.status === 'beaten') return 4;
  if (card.status !== 'learning') return -1;
  if (card.light) return 3;
  const s = Number(card.stage) || 1;
  return s <= 1 ? 0 : s === 2 ? 1 : 2;
}

export function rankCards(cards = [], { sections = [] } = {}) {
  return (Array.isArray(cards) ? cards : [])
    .filter(c => needTier(c) >= 0 && inRange(c, sections))
    .sort((a, b) => needTier(a) - needTier(b)
      || (str(a.due) || '9999').localeCompare(str(b.due) || '9999')
      || str(a.at).localeCompare(str(b.at))
      || str(a.id).localeCompare(str(b.id)));
}

const levelRank = l => { const i = LEVEL_ORDER.indexOf(str(l)); return i < 0 ? LEVEL_ORDER.length : i; };

export function pickProblem(card, taken = new Set()) {
  if (!card) return null;
  const used = new Set((card.used || []).map(str));
  const bad = new Set((card.flagged || []).map(f => str(f && typeof f === 'object' ? f.q : f)).filter(Boolean));
  const free = (card.pool || []).filter(v => v && str(v.q) && str(v.answer) && CHECKED.has(v.checked)
    && !used.has(str(v.q)) && !bad.has(str(v.q)) && !taken.has(str(v.q)));
  if (!free.length) return null;
  // 稳定排序：同一层保留池子里的先后
  return free.map((v, i) => ({ v, i })).sort((a, b) => levelRank(a.v.level) - levelRank(b.v.level) || a.i - b.i)[0].v;
}

// 一道题大约几分钟：比大小、选择最快，化简、方程、两个答案的慢一些；远变式多一步；字多的应用题要读题
const KIND_MIN = { compare: 0.5, choice: 0.75, number: 1, expr: 1.5, equation: 2, set: 2, text: 2 };
const zhCount = s => (str(s).replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, '').match(/[一-鿿]/g) || []).length;
export function minutesFor(item) {
  if (!item) return 0;
  if (Number(item.minutes) > 0) return Number(item.minutes);
  let m = KIND_MIN[str(item.answer_kind)] ?? 1.5;
  if (str(item.level) === '远变式') m += 0.5;
  if (zhCount(item.q) > 24) m += 1;
  return m;
}
// 纸上留多大的空：s 比大小和选择，m 一般计算，l 化简、方程，xl 说理和长应用题
export function roomOf(item) {
  const k = str(item && item.answer_kind);
  if (k === 'compare' || k === 'choice') return 's';
  const m = minutesFor(item);
  if (k === 'text' || m >= 2.5) return 'xl';
  if (m >= 2) return 'l';
  return 'm';
}

const trapKey = it => str(it.tag) || str(it.cardId);
const chKey = it => chapterOf(it.section);

// 混排：第一题放最有把握的（档数最高的），之后每步挑和上一题不同坑的，尽量也不同章；
// 剩得多的坑、剩得多的章先出，免得最后剩下同一个坑挨着（同 ui-practice.remix 的想法）
export function mixOrder(items = []) {
  const rest = items.slice();
  if (rest.length < 2) return rest;
  const out = [];
  let first = 0;
  rest.forEach((it, i) => { if ((it.tier ?? 0) > (rest[first].tier ?? 0)) first = i; });
  out.push(rest.splice(first, 1)[0]);
  const count = (key, val) => rest.filter(x => key(x) === val).length;
  while (rest.length) {
    const last = out[out.length - 1];
    let cand = rest.filter(x => trapKey(x) !== trapKey(last));
    if (!cand.length) cand = rest;
    const other = cand.filter(x => chKey(x) !== chKey(last));
    if (other.length) cand = other;
    let best = cand[0];
    for (const x of cand) {
      const d = count(trapKey, trapKey(x)) - count(trapKey, trapKey(best)) || count(chKey, chKey(x)) - count(chKey, chKey(best));
      if (d > 0) best = x;
    }
    out.push(rest.splice(rest.indexOf(best), 1)[0]);
  }
  return out;
}

function itemOf(card, v, need, curriculum) {
  const it = {
    no: 0, cardId: card.id, q: str(v.q), answer: str(v.answer), answer_kind: str(v.answer_kind), form: str(v.form), unit: str(v.unit),
    level: str(v.level), trap: str(v.trap), trap_answer: str(v.trap_answer), pit: shortName(card, curriculum),
    remember: str(card.diagnosis && card.diagnosis.remember),
    tag: str(card.tag || (card.diagnosis && card.diagnosis.tag)), section: secOf(card), tier: needTier(card), need,
  };
  if (Array.isArray(v.options) && v.options.filter(Boolean).length) it.options = v.options.map(str).filter(Boolean);
  it.minutes = minutesFor(it);
  return it;
}

// today 现在只是约定里的参数：同一档里按卡上的 due 排（到期早的在前），用不着今天的日期
export function buildPaper(cards = [], { sections = [], max = PAPER_MAX, curriculum = null } = {}) {
  const ranked = rankCards(cards, { sections });
  const items = [], missing = [], taken = new Set();
  ranked.forEach((card, need) => {
    const v = pickProblem(card, taken);
    if (!v) { missing.push(card.id); return; }
    if (items.length >= max) return;
    taken.add(str(v.q));
    items.push(itemOf(card, v, need, curriculum));
  });
  return { items: mixOrder(items).map((it, i) => ({ ...it, no: i + 1 })), missing };
}

// 要先补题的卡：按需要程度排得进前 max 名、池子里却没有能用的题。排不进的不补（卷子满了，补了也上不了卷）
export function fillTargets(cards = [], built = { missing: [] }, { sections = [], max = PAPER_MAX, limit = FILL_MAX } = {}) {
  const miss = new Set((built && built.missing) || []);
  return rankCards(cards, { sections }).slice(0, max).filter(c => miss.has(c.id)).slice(0, limit).map(c => c.id);
}

// pipeline.variants（prompts.userVariants）读平铺的 stem / answer / wrong_step …，卡把它们放在 problem、diagnosis 里
export function fillSource(card) {
  const p = (card && card.problem) || {}, d = (card && card.diagnosis) || {};
  return {
    id: card && card.id, tag: str(card && (card.tag || d.tag)), stem: str(p.stem), options: p.options || [], answer: str(d.answer),
    wrong_step: str(d.wrong_step), error_type: str(d.error_type || (card && card.type)), why: str(d.why), section: secOf(card),
  };
}

// 新出的题合进卡的池子：不重复、做过的不要
export function addToPool(card, variants = []) {
  const c = { ...card, pool: [...((card && card.pool) || [])] };
  const seen = new Set([...c.pool.map(v => str(v && v.q)), ...((card && card.used) || []).map(str)]);
  for (const v of variants || []) if (v && str(v.q) && !seen.has(str(v.q))) { c.pool.push(v); seen.add(str(v.q)); }
  return c;
}

// ---------------------------------------------------------------- 拆两半

const sum = list => list.reduce((a, it) => a + minutesFor(it), 0);
const round5 = n => Math.round(n * 2) / 2;

export function splitInHalves(items = [], { maxMinutes = HALF_MINUTES, oneGo = ONE_GO_MINUTES } = {}) {
  const list = (items || []).slice();
  const dropped = [];
  // 去掉最不急的一道（need 最大的；没有 need 就最后一道）
  const dropOne = () => {
    let k = list.length - 1;
    list.forEach((it, i) => { if ((it.need ?? -1) > (list[k].need ?? -1)) k = i; });
    dropped.push(list.splice(k, 1)[0]);
  };
  while (list.length && sum(list) > maxMinutes * 2) dropOne();
  let halves = null;
  while (list.length) {
    const total = sum(list);
    if (total <= Math.min(oneGo, maxMinutes) || list.length < 2) { halves = [list]; break; }
    let best = -1, gap = Infinity;
    for (let k = 1; k < list.length; k++) {
      const a = sum(list.slice(0, k)), b = total - a;
      if (a > maxMinutes || b > maxMinutes) continue;
      const g = Math.abs(a - b) + Math.abs(k - list.length / 2) * 0.01;   // 时间一样时，题数也尽量一样
      if (g < gap) { gap = g; best = k; }
    }
    if (best > 0) { halves = [list.slice(0, best), list.slice(best)]; break; }
    dropOne();
  }
  if (!halves) halves = [[]];
  let no = 0;
  halves = halves.map((h, half) => h.map(it => ({ ...it, no: ++no, half })));
  return { halves, minutes: halves.map(h => round5(sum(h))), dropped };
}

// 选范围那一屏的一行字：补完题以后大概几道、几分钟、拆不拆。还没出的题按 1.5 分钟估
export function previewPaper(cards = [], { sections = [], max = PAPER_MAX, curriculum = null } = {}) {
  const built = buildPaper(cards, { sections, max, curriculum });
  const targets = fillTargets(cards, built, { sections, max });
  const rank = new Map(rankCards(cards, { sections }).map((c, i) => [c.id, i]));
  const guess = targets.map(id => ({ cardId: id, need: rank.get(id), minutes: 1.5 }));
  const { halves } = splitInHalves([...built.items, ...guess].sort((a, b) => a.need - b.need).slice(0, max));
  const all = halves.flat();
  return { count: all.length, minutes: Math.max(1, Math.round(sum(all))), two: halves.length > 1, fill: targets.length };
}

// 每一章有几个要出题的坑（选范围时每行后面的数）。卡上没有节的不算进哪一章
export function chapterCounts(cards = []) {
  const out = {};
  for (const c of rankCards(cards)) { const ch = chapterOf(secOf(c)); if (ch) out[ch] = (out[ch] || 0) + 1; }
  return out;
}

// ✗ 的那道“问我这道”：进 chat 的 problem 模式，带着卷上的题、正确答案和卡上讲题时的要点
export function askParams(item) {
  const u = str(item.unit);
  const answer = str(item.answer) + (u && !/°/.test(u) && !str(item.answer).includes(u) ? ' ' + u : '');
  const diagnosis = { answer };
  if (str(item.remember)) diagnosis.remember = str(item.remember);
  const problem = { stem: str(item.q) };
  if (item.options && item.options.length) problem.options = item.options.slice();
  return { mode: 'problem', cardId: str(item.cardId), problem, diagnosis };
}

// ---------------------------------------------------------------- 一份卷子（kv 'paper'）

export function newPaper({ id = '', made = dayOf(), at = new Date().toISOString(), chapters = DEFAULT_CHAPTERS, sections = [], halves = [[]], short = 0, demo = false } = {}) {
  const items = halves.flat();
  return {
    id: id || 'paper-' + made + '-' + Date.parse(at).toString(36), made, at, title: paperTitle(chapters), range: rangeLabel(chapters),
    chapters: [...chapters], sections: [...sections], items, minutes: halves.map(h => round5(sum(h))),
    marks: {}, done: halves.map(() => ''), short, demo: !!demo,
  };
}

export const halvesOf = paper => {
  const n = Math.max(1, ((paper && paper.done) || []).length || 1);
  return Array.from({ length: n }, (_, i) => ((paper && paper.items) || []).filter(it => (it.half || 0) === i));
};

export function paperState(paper) {
  if (!paper || !Array.isArray(paper.items) || !paper.items.length) return { halves: 0, done: [], all: false, pending: false };
  const done = (paper.done || ['']).map(Boolean);
  const all = done.every(Boolean);
  return { halves: done.length, done, all, pending: !all };
}

export function halfReady(paper, half) {
  const list = halvesOf(paper)[half] || [];
  const marks = (paper && paper.marks) || {};
  const left = list.filter(it => marks[it.no] !== 'ok' && marks[it.no] !== 'wrong').length;
  return { ready: list.length > 0 && left === 0, left };
}

// ---------------------------------------------------------------- 对答案以后

export const paperResult = (item, ok) => ({ ok: !!ok, firstTry: !!ok, hints: 0, kind: 'variant', level: str(item.level), q: str(item.q), mixed: true, paper: true });

export function applyPaperResult(card, item, ok, today = dayOf()) {
  const next = recordReview(card, { results: [paperResult(item, ok)], today });
  if (card.status === 'beaten' && !ok) next.relapses = (Number(card.relapses) || 0) + 1;
  return next;
}

export function paperAttempt(item, ok, { paperId = '', today = dayOf(), at = new Date().toISOString() } = {}) {
  return {
    itemId: item.cardId, at, day: today, kind: 'paper', q: str(item.q), given: '', ok: !!ok, firstTry: !!ok, hints: 0, reason: '',
    level: str(item.level), trap: false, self: true, where: 'paper', mixed: true, paperId, no: item.no, tag: str(item.tag),
  };
}

// ---------------------------------------------------------------- 印出来的样子

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sentence = s => { const t = str(s).replace(/[。.，,；;\s]+$/, ''); return t ? t + '。' : ''; };
export const dayCn = day => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(day)); return m ? `${+m[2]} 月 ${+m[3]} 日` : ''; };
export const paperFileName = day => `emma-math-paper-${/^\d{4}-\d{2}-\d{2}$/.test(str(day)) ? str(day) : dayOf()}.html`;

// 给她看的答案：没写公式符号的（4a+3b、3或7）包成公式画，一句话的答案原样；单位跟在后面（° 已经在答案里）
export function answerShown(item) {
  const a = str(item && item.answer);
  if (!a) return '';
  const u = str(item.unit);
  const unit = u && !/°/.test(u) && !a.includes(u) ? ' ' + u : '';
  if (/\\\(|\\\[|\$/.test(a) || /[一-鿿]/.test(a.replace(/或/g, ''))) return a + unit;
  return `\\(${a}\\)` + unit;
}
export const trapLine = item => { const s = sentence(item && (item.trap || item.pit)); return s ? COPY.trap + s : ''; };

function itemHTML(it) {
  const opts = it.options && it.options.length ? `<div class="pp-opts">${it.options.map(o => `<span>${renderText(o)}</span>`).join('')}</div>` : '';
  const u = str(it.unit);
  const unit = u && !/°/.test(u) ? ` ${esc(u)}` : '';
  const line = str(it.answer_kind) === 'text' ? '' : `<div class="pp-ans">${COPY.answerLine}<span class="pp-blank"></span>${unit}</div>`;
  return `<li class="pp-item pp-room-${roomOf(it)}"><div class="pp-q"><span class="pp-no">${Number(it.no) || ''}.</span>`
    + `<div class="pp-stem">${renderText(it.q)}${opts}</div></div><div class="pp-space"></div>${line}</li>`;
}

export function sheetsHTML(paper) {
  const halves = halvesOf(paper).filter(h => h.length);
  const title = esc(paper.title || paperTitle(paper.chapters || DEFAULT_CHAPTERS));
  const date = esc(dayCn(paper.made));
  const two = halves.length > 1;
  const sheets = halves.map((list, i) => {
    const m = round5(sum(list));
    const note = two ? COPY.sheetNote(list.length, m) : COPY.sheetNoteOne(list.length, m);
    return `<section class="pp-sheet"><header class="pp-head"><span class="pp-head-t">${title}</span>`
      + `<span class="pp-head-m">${two ? esc(HALF_NAMES[i]) + ' · ' : ''}${date}</span></header>`
      + `<p class="pp-note">${esc(note)}</p><ol class="pp-items">${list.map(itemHTML).join('')}</ol></section>`;
  });
  const keys = halves.flat().map(it => `<li class="pp-k"><span class="pp-no">${Number(it.no) || ''}.</span>`
    + `<span class="pp-a">${renderText(answerShown(it))}</span><span class="pp-trap">${renderText(trapLine(it))}</span></li>`).join('');
  const key = `<section class="pp-sheet pp-key"><header class="pp-head"><span class="pp-head-t">${esc(COPY.keyTitle)}</span>`
    + `<span class="pp-head-m">${title} · ${date}</span></header><p class="pp-note">${esc(COPY.keyNote)}</p><ol class="pp-keys">${keys}</ol></section>`;
  return `<div class="pp-doc">${sheets.join('')}${key}</div>`;
}

// css/math.css 的一份拷贝：分享出去的文件没有 App 的样式表。tests/paper.test.mjs 查它和 math.css 一模一样（去掉注释）
export const MATH_CSS = `.m { font-family: "Times New Roman", "Songti SC", var(--serif, serif); font-size: 1.08em; white-space: nowrap; }
.m i { font-style: italic; padding-right: .04em; }
.m-text { font-family: var(--sans, sans-serif); font-style: normal; font-size: .92em; }
.m-op { margin: 0 .22em; }
.m-sign { margin-right: .04em; }
.m-sup { font-size: .68em; vertical-align: .62em; line-height: 0; margin-left: .04em; }
.m-sub { font-size: .68em; vertical-align: -.3em; line-height: 0; }
.m-frac { display: inline-flex; flex-direction: column; align-items: center; vertical-align: .55em; margin: 0 .12em; font-size: .92em; line-height: 1.12; }
.m-num { padding: 0 .16em .04em; }
.m-den { padding: .06em .16em 0; border-top: .07em solid currentColor; align-self: stretch; text-align: center; }
.m-sqrt { white-space: nowrap; }
.m-rad { border-top: .07em solid currentColor; padding: 0 .08em; }
.m-ol { border-top: .07em solid currentColor; }
.m-ul { border-bottom: .07em solid currentColor; }
.m-box { border: .07em solid currentColor; padding: 0 .2em; }
.m-display { display: block; text-align: center; margin: .5em 0; font-size: 1.12em; white-space: normal; }`;

// 卷子的版式：A4，每题不拆页，每半从新的一页开始，答案在最后一页。屏幕上看是一张张白纸（暗色模式也是白纸），
// 打印时去掉纸的边框和阴影。颜色写死成黑白，不用 App 的 token：文件里没有 base.css。
// .pp-doc .m-frac：math.css 的 vertical-align:-.62em 让分数整个沉到字下面（竖排的 inline-flex 以分子的基线对齐，
// 应该往上抬），STATUS 里记过“分数在 iPad 上可能偏低”。卷子上先在这里抬起来；math.css 改好以后这一行可以删
export const SHEET_CSS = `@page{size:A4;margin:14mm 15mm 16mm}
.pp-doc{color:#161616;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pp-sheet{background:#fff;color:#161616;width:100%;max-width:210mm;margin:0 auto 24px;padding:clamp(18px,6vw,15mm);border-radius:2px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 8px 28px rgba(0,0,0,.07);font:12pt/1.6 "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;text-align:left}
.pp-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2mm 6mm;padding-bottom:2.5mm;border-bottom:1pt solid #161616}
.pp-head-t{font:600 15pt/1.3 "Songti SC","STSong","SimSun",serif;letter-spacing:.02em}
.pp-head-m{font-size:11pt;color:#333;white-space:nowrap}
.pp-note{margin:3mm 0 6mm;font-size:10.5pt;line-height:1.5;color:#444}
.pp-items,.pp-keys{list-style:none;margin:0;padding:0}
.pp-item{break-inside:avoid;page-break-inside:avoid;margin:0 0 5mm;padding:0 0 4mm;border-bottom:.5pt dotted #aaa}
.pp-item:last-child{border-bottom:0}
.pp-q{display:flex;align-items:baseline;gap:2.5mm}
.pp-no{flex:none;min-width:7mm;font-weight:600;font-variant-numeric:tabular-nums}
.pp-stem{flex:1;min-width:0;font:13pt/1.75 "Songti SC","STSong","SimSun",serif;overflow-wrap:anywhere}
.pp-opts{display:flex;flex-wrap:wrap;gap:1mm 8mm;margin-top:1.5mm}
.pp-doc .m-frac{vertical-align:.55em}
.pp-space{height:26mm}
.pp-room-s .pp-space{height:12mm}
.pp-room-l .pp-space{height:38mm}
.pp-room-xl .pp-space{height:50mm}
.pp-ans{display:flex;justify-content:flex-end;align-items:baseline;gap:1.5mm;font-size:12pt}
.pp-blank{display:inline-block;width:44mm;height:1.3em;border-bottom:.6pt solid #555}
.pp-sheet+.pp-sheet{break-before:page;page-break-before:always}
.pp-k{display:grid;grid-template-columns:7mm minmax(0,max-content) minmax(0,1fr);align-items:baseline;gap:1mm 5mm;padding:2.2mm 0;border-bottom:.5pt solid #ddd;break-inside:avoid;page-break-inside:avoid}
.pp-a{font:13pt/1.6 "Songti SC","STSong","SimSun",serif}
.pp-trap{font-size:10.5pt;line-height:1.5;color:#444}
@media (max-width:520px){.pp-k{grid-template-columns:7mm minmax(0,1fr)}.pp-trap{grid-column:2}}
@media print{.pp-sheet{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}.pp-k{grid-template-columns:7mm minmax(0,max-content) minmax(0,1fr)}.pp-trap{grid-column:auto}}`;

const FILE_CSS = `*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{background:#ECEAE4;padding:24px 12px}
@media print{body{background:#fff;padding:0}}`;

export function paperHTML(paper) {
  const title = esc(`${paper.title || paperTitle(paper.chapters || DEFAULT_CHAPTERS)} · ${dayCn(paper.made)}`);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${FILE_CSS}
${MATH_CSS}
${SHEET_CSS}
</style>
</head>
<body>
${sheetsHTML(paper)}
</body>
</html>
`;
}

// ---------------------------------------------------------------- 样例卡（模拟模式，只在内存里）

// 七张卡把错题卷的各种情况走一遍：第 1 档、第 2 档（池子空的，走补题）、第 3 档、轻卡、攻克；数、式子、方程、两个答案、
// 比大小、说理、应用题。题目和变式题都是 mock.js 的仿真题（答案测试核过），只有 −a 那张是这里写的
export function demoPaperCards(today = dayOf()) {
  const page = c => mockAnswer('recognize', { mockCase: c }).problems;
  const t1 = page(''), br = page('brackets'), eq = page('equation'), half = page('half'), side = page('sideways');
  const pool = topic => mockAnswer('variants', { mockCase: topic }).variants.map(v => ({ ...v, checked: 'program' }));
  const diag = topic => ({ ...mockAnswer('explain', { mockCase: topic }), checked: 'program' });
  const back = n => { const [y, m, d] = today.split('-').map(Number); const t = new Date(y, m - 1, d - n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const card = (n, problem, diagnosis, extra) => ({
    id: 'demo-paper-' + n, demo: true, at: `${back(20)}T0${n}:00:00.000Z`, day: back(20), photoId: '', crop: '', thumb: '', source: '练习册',
    problem: { idx: 0, ...problem }, diagnosis, tag: diagnosis.tag || '', type: diagnosis.error_type || '', section: diagnosis.section || '',
    status: 'learning', askTeacher: false, stage: 1, due: today, streak: 0, streakFrom: '', reviews: [], pool: [], used: [], flagged: [], originals: [], ...extra,
  });
  const neg = {
    answer: 'C', answer_kind: 'choice', form: '', unit: '', solution: ['\\(-a\\) 是 \\(a\\) 的相反数，正负要看 \\(a\\) 自己。'], wrong_line: -1,
    wrong_step: 'A', error_type: '概念误解', tag: 'E-neg-has-minus', section: '1.2.1', why: '她把带负号的都当成负数。',
    remember: '\\(-a\\) 读作“\\(a\\) 的相反数”，正负要看 \\(a\\) 自己。', doubt: '', checked: 'program',
  };
  const negProblem = {
    no: '3', type: '选择', stem: '若 \\(a\\) 是一个有理数，那么 \\(-a\\)（　）', figure: '', her_work: [], her_answer: 'A', mark: 'wrong', teacher_note: '', circled: '', unclear: false,
    options: ['A. 一定是负数', 'B. 一定是正数', 'C. 可能是正数、负数或 0', 'D. 一定不是 0'],
  };
  const negPool = [
    { level: '辨析', q: '比较大小：\\(-(-3)\\) ___ \\(-|-3|\\)', answer: '>', answer_kind: 'compare', form: '', unit: '', trap: '看到负号就当成负数，以为两边一样', trap_answer: '=', steps: [], checked: 'program' },
    { level: '近变式', q: '判断：\\(-a\\) 一定是负数吗？在纸上写出你的判断和理由。', answer: '不一定。\\(a\\) 是负数时，\\(-a\\) 是正数；\\(a=0\\) 时，\\(-a=0\\)。',
      answer_kind: 'text', form: '', unit: '', trap: '带负号就当成负数', trap_answer: '', steps: [], checked: 'models' },
  ];
  return [
    card(1, t1[1], diag('powers'), { stage: 1, pool: pool('powers') }),
    card(2, t1[4], diag('order'), { stage: 2, due: back(-3), streak: 1, streakFrom: back(6), pool: [] }),
    card(3, negProblem, neg, { stage: 2, due: back(-2), pool: negPool }),
    card(4, br[0], diag('brackets'), { light: true, due: '', restOn: back(5), found: 'self', pool: pool('brackets') }),
    card(5, eq[0], diag('equation'), { stage: 3, due: back(-9), streak: 2, streakFrom: back(16), pool: pool('equation') }),
    card(6, half[0], diag('geometry'), { status: 'beaten', stage: 3, due: '', streak: 3, streakFrom: back(19), beatenOn: back(2), pool: pool('geometry') }),
    card(7, side[0], diag('wordproblem'), { stage: 1, pool: pool('wordproblem') }),
  ];
}
