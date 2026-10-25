// 讲一道错题（屏 6-10；CONTRACTS 第 9-12 节，C-practical 3.1、3.2、3.3、7.1、7.3）：
//   先自己找（第 0 级只指位置）→ 提示 1 级（二选一）→ 提示 2 级（讲为什么，她接着做）→ 讲清楚（第 3 级，左右对照）
//   → 一句话（我错在：……）→ 同构题 → 收进本子。
// 诊断 pipeline.diagnose 只调一次：确认屏点“对，就是这样”时就发出去了（promise 在 ctx.flow 里），这里接着用；
// 她在“先自己找”这一屏点行的时候，诊断在后台跑。checked 'unsure' 一律不讲，进“问老师”。
// 负责：界面 agent（ui-explain.js、css/explain.css、tests/explain.test.mjs）。
//
// 导出
//   createExplain(ctx) -> { show(params, { from, back }), hide(), onResume() }   画进 <section id="view-explain">
//     params { photoId, idx }：哪张照片（photos 的 id）的第几道题（page.problems 的下标）
//   以下是纯函数（node 测试用，模块顶层不碰 document）
//   COPY                                   她看到的所有固定文案（测试检查禁用词）
//   initState({ photoId, idx, problem })   一道题讲题过程的状态（存进 ctx.flow 的 explain，切走再回来接着做）
//   entryStep(problem)                     'find' 先自己找 | 'redo' 没写过程，在纸上再做一遍 | 'hint1' 选择题直接第 1 级
//   reduce(state, event, env) -> state     状态机，见下面“步骤”
//   judge(given, { answer, kind, form, trap, options }) -> { ok: true|false|null, reason, trap }
//   contrast(problem, diag)                第 8 屏左右对照的两列，只高亮分叉的那一行
//   matchLine(line, solution, fallback)    正确过程里和她写错的那一行最像的一行（字的两两组合重合度）
//   planSave({ st, problem, diag, cards, id, ... }) -> { put, cardId, quota, result, variants }   收进本子：新卡、同坑合并、轻卡
//   directOffer(st, diag, problem, { late }) -> '' | 'text' | 'big'   提示屏上的“直接讲吧”：不出 | 右下角文字按钮 | 21:00 以后最上面的大按钮
//   quotaAfter(quota, day, n)、countsForQuota(st)、isLight(st)、pitName(diag, curriculum)（先用 notebook.shortName）
//   findMergeTarget、mergeLocal、attachLocal：notebook.fileProblem 不在时的最小同坑合并
//   nextInQueue(queue, photoId, idx)、addPending(pending, items, { front })、doneView(result, hasNext)
//   lineLabel(i)（①②③）、keyOf(photoId, idx)、answerKind(diag, problem)、guessKind(text)、choiceLetter(given, options)
//
// 步骤（state.step）
//   find      列出她写的每一行，点“从哪一行开始不对”，或“我看不出来”。诊断回来前就能点；回来后：
//             点对了 → fix（“对，就是第 ① 行”）；点错了或看不出 → fix，第 0 级（“问题在第 ① 行”）；
//             诊断说不出是哪一行 → redo
//   redo      没写过程（或诊断没给行号）：“在纸上再做一遍，答案写这里”
//   fix       改那一行，填新答案。对了 → save（found 'self' 或 'located'，轻卡，跳过提示）；错了 → hint1
//             自己改对的当天不做同构题（DESIGN 第 1 节“自己改对的题当天做不做同构题”、4.4）：隔一天比当天多做有用，
//             也更快。直接收成轻卡，第 2 天再来一道。讲题时核对过的 twin 放进卡的池子，明天不用等。
//   hint1     第 1 级二选一。选对：“对。”；选错：点明不对的是哪个、对的是哪个。都进 hint2
//   hint2     第 2 级：讲为什么，她从这一步接着做。对了 → sentence（found 'hint'）；同一步错 2 次 → explain
//             “直接讲吧”（DESIGN 第 1 节、3.2 屏 7、7.3）：她改过一次、点过一次二选一以后，提示屏都有这个按钮，
//             点了直接 explain，found 'explain'，之后照样做同构题。21:00 以后（notebook.isLate）它是最上面的大按钮。
//             先试再讲证据更强，所以前两级要她自己碰过；选择题没有“改一行”这一级，那一级不用等
//   explain   第 3 级：左右对照 + 3-5 步一步一张 + remember。“懂了，做一道” → sentence；“还是不太懂” → 再给一遍
//             hint2 和最后一步，卡上记 confused，可以“先收进本子”（不做同构题）或“记下来问老师”；“这题有问题” → 收进问老师
//   sentence  self_explain 二选一补全“我错在：……”，选错轻轻纠正；mySentence 存补全后的那句
//   twin      同构题（没有 twin 就用后台变式池的第一道同构题，再没有就跳过）。对 → save；答案等于 trap_answer
//             马上点名“这正是刚才那个坑”；错两次：“今天先到这儿，明天换个讲法再来”
//   ask       诊断 checked 'unsure'：“这道我拿不准，记下来问老师。”建 status 'ask' 的卡
//   save      建卡、存、名额加一（自己改对的不加）、后台出变式题 → done
//   done      “收进本子了。坑：…。明天：把原题再做一遍，再加一道新题。”“下一道”“今天先到这儿”
//             轻卡收尾一句“你自己改对了。明天我再给你一道新的，换个样子看看。”；底下一直有“还有不明白的？问我”（v0.3）
//   error     诊断失败：kidMessage(err, { where: 'explain' })，“再试一次”或“先放进待讲”
// 每次作答先记在 state.attempts，收进本子时连同卡的 id 一起写进 attempts（store.addAttempt，CONTRACTS 12 的字段）。
//
// v0.6.0（Emma 用了以后的两条反馈）
//   不参考以前的步骤：她在卷子上订正过，确认屏选了直接讲（problem.useWork === false）。pipeline.diagnose 已经不看她的过程，
//             这里跳过“先自己找”和提示阶梯，直接进讲清楚（一步步点开，只有正确的一栏），然后 self_explain 二选一（问的是
//             关键一步，mySentence 存成“关键一步：……”），然后同构题，往下照旧。found 'explain'，算名额。
//   有问题？问我：讲题的每一屏（先自己找、提示、讲清楚、一句话、同构题、举一反三）导航栏右上角常驻一个按钮；收进本子那一屏
//             照旧是底下的“还有不明白的？问我”。点了 go('chat', askParams(...))：problem、diagnosis（回来了才带，拿不准的不带）、
//             step（askStep：她停在哪一步、那一屏写着什么）、cardId（有就带）、chatId（这道题第一次问时生成，存在状态里，
//             同一道题接着同一段聊）。从 chat 返回时讲题屏原样停在那一步：状态在 cur 和 flow 里，hide 时记下小键盘里没交的字，
//             回来再填上；诊断没回来时去问也行，回来照样接上（同一个 promise 只挂一次）。
//   举一反三：收进本子以后（做完同构题、自己改对的轻卡也一样）出“举一反三，再来一道”。题从这张卡的 pool 里取（没用过、
//             核对过、优先近变式，其次辨析、远变式，不取同构题：同构题留给明天）；pool 还在后台补就等它，再没有当场出 3 道
//             （EXTRA_MAKE）。一题一屏，小键盘作答：错一次本机提示（撞上 trap_answer 点名“又是那个坑”），错两次要一句老师的
//             提示（retryHint），错三次看答案。做完问“再来一道”还是“够了”；一次最多 3 道，第 3 道做完说“今天练够了，过两天
//             我再考你，记得更牢。”用过的题进卡的 used；作答写 attempts（kind 'extra'），不调 recordReview。
//   步骤（state.step）多了 extra：举一反三的一道题（state.extra，见 reduce）。从 done 进、回 done。
//   状态另加 noWork、chatId、extra；事件另加 chat-id、extra-start / extra-q / extra-answer / extra-hint / extra-flag / extra-more / extra-end。
//   新导出（纯函数，tests/explain.test.mjs）：noWorkOf、sentenceHead、sentenceOf、askable、askStep、askParams、extraOffer、
//   pickExtra、extraQuestion、useExtra、extraAttempt、extraSummary、EXTRA_MAX、EXTRA_LEVELS、EXTRA_MAKE、EXTRA_WAIT_MS。
//   出题、判对错、提示的话用 ui-practice 的 variantQuestion、judge、afterSubmit、praiseLine、missLine、answerText、flagCard、freeVariants。
//
// 读 ctx.flow.get() 的这些字段（确认屏写）：problem（她确认过的题）、diagnose 的 promise（diagnose / diagnosing /
// diagnosePromise 任一个名字）或已经回来的 diagnosis、crop（这道题的截图 dataURL，可没有）、source、queue（这一页她挑了
// 要讲的题，按顺序：[idx] 或 [{ photoId, idx }]）。写回：explain（本文件的状态，纯数据）、queue。
import { h, icon, mathText, toast, skBars, teacherAvatar } from './ui-dom.js';
import { createWaitFun } from './waitfun.js';
import { check, compute } from './mathcheck.js';
import { plain } from './mathview.js';
import * as NB from './notebook.js';
import { kidMessage, canRetry } from './kid-errors.js';
import { createPipeline, boxToRect, localHint, wrongProblems } from './pipeline.js';
import { crop as cropImage, thumb as thumbImage } from './image.js';
import { newId, dataURLToBlob } from './db.js';
import { TRIAGE, beyondSelfFix, parkedState, progressLine, finishLine } from './triage.js';
// 举一反三的题和复习的变式题是同一种题：出题、判对错、三次提示、夸她的话都照复习（ui-practice 的纯函数）
import { variantQuestion, judge as judgeQuestion, afterSubmit, praiseLine, missLine, answerText as questionAnswer, flagCard, freeVariants } from './ui-practice.js';

// 变式题池：近变式 2、辨析 1、远变式 2、备用 1（C 5.1）。没有同构题时，先在最前面加一道同构题当作当天的同构题。
export const LEVELS = ['近变式', '近变式', '辨析', '远变式', '远变式', '近变式'];
export const TWIN_LEVELS = ['同构', ...LEVELS];
export const SLOW_MS = 25000;        // 等诊断超过这么久，说一句“还在想”，给“先放进待讲”
export const TWIN_WAIT_MS = 45000;   // 等变式池里的同构题最多这么久，再没有就跳过同构题
export const HINT2_TRIES = 2;        // 同一步最多追 2 次，还不对就直接讲（C 7.1）
// 举一反三：一次最多 3 道（研究说同一天多练没有长期好处，隔几天再考记得更牢）；池子里先取近变式，其次辨析、远变式；
// 池子没有就当场出这 3 道；后台正在补池子时最多等它这么久
export const EXTRA_MAX = 3;
export const EXTRA_LEVELS = ['近变式', '辨析', '远变式'];
export const EXTRA_MAKE = ['近变式', '辨析', '近变式'];
export const EXTRA_WAIT_MS = 60000;

// 她看到的固定文案：弯引号，不用破折号和感叹号，句子短；App 自称“我”，真老师叫“学校老师”（DESIGN 7.6）
export const COPY = {
  find: '先自己找找：从哪一行开始不对？点那一行。',
  half: '这题你做对了一大半。',
  cantSee: '我看不出来',
  looking: '我也在看这道题……',
  almost: '好，我也快看完了……',
  slow: '还在想，再等我一下。',
  park: '先放进待讲',
  parked: '放进待讲了。',
  redo: '在纸上再做一遍，答案写这里。',
  herOld: '你原来写的是 ',
  redoInstead: '这道我们换个办法：在纸上从头再做一遍，答案写这里。',
  fixHere: '在草稿纸上改一改，新答案写这里。',
  selfFixed: '你自己改对的。',
  stepByStep: '还差一点。我们一步一步看。',
  think: '想一想',
  right: '对。',
  commonWrong: '很多初一同学都在这儿掉过。',
  continueHere: '从这一步接着做，答案写这里。',
  almostThere: '还差一点。',
  lookAgain: '再从这一步慢慢看一遍。',
  hintDone: '对了，这一步你接着做出来了。',
  together: '我们一起完整看一遍。',
  keyStep: '这题的关键一步',
  mine: '你写的', correct: '正确的', myAnswer: '你的答案', rightAnswer: '正确答案', notWritten: '（没写）',
  nextStep: '下一步',
  remember: '记住这一句',
  understood: '懂了，做一道',
  confused: '还是不太懂',
  againIntro: '没关系。再看一遍这两句。',
  againLater: '先收进本子，明天换个讲法再来。',
  saveNow: '先收进本子',
  askTeacher: '放进“我的问题”，换个讲法',
  flag: '这题有问题',
  softSplit: '这道题几种算法得出的答案不太一样，我按最可能对的讲。拿不准的话，也可以问问学校老师。',
  flaggedTwin: '记下了，这道题不算。',
  sentenceLabel: '补全这句话',
  sentenceRight: '对，就是这样。',
  sentenceFix: '差一点。更准确的说法是：',
  twinLabel: '换个数，自己做一道（这道没有提示）',
  twinMaking: '我在出一道新题……',
  twinRight: '对了。这个坑你绕过去了。',
  twinStop: '今天先到这儿，明天换个讲法再来。',
  trap: '这正是刚才那个坑',
  tryAgain: '再试一次。',
  saving: '正在收进本子……',
  saveFailed: '没存上，再试一次。',
  unsure: '这道我放进“我的问题”了。',
  unsureMore: '点“问我”，我们一起把它核对清楚。',
  flaggedTitle: '记下了。',
  flaggedMore: '这道题先不练，放进“我的问题”。点“问我”，我们一起看看它哪里有问题。',
  confusedTitle: '放进“我的问题”了。',
  confusedMore: '没关系，有的地方要换个讲法才通。点“问我”，我们现在就聊，或者以后从“我的问题”里点开。',
  direct: '直接讲吧',
  saved: '收进本子了。',
  merged: '这个坑本子里已经有了，这道题放在它下面。',
  pit: '坑：',
  tomorrow: '明天：把原题再做一遍，再加一道新题。',
  lightClose: '你自己改对了。明天我再给你一道新的，换个样子看看。',
  tomorrowRetell: '明天换个讲法再来，把原题再做一遍。',
  nextOne: '下一道',
  askMe: '还有不明白的？问我',
  teachBack: '讲给我听',
  stop: '今天先到这儿',
  backToPage: '回到这一页',
  retry: '再试一次',
  missing: '这道题找不到了。回到这一页再选一次。',
  home: '回首页',
  compare: '对照一下，正确答案是：',
  sameQ: '和你写的一样吗？',
  same: '一样', notSame: '不一样',
  showCrop: '看原题', hideCrop: '收起原题',
  waitFirst: '好，我先看看。',
  ok: '好了',
  paperDone: '在纸上写好了，对照看',
  backLabel: '返回',
  // v0.6.0
  askAny: '有问题？问我',
  noWork: '你已经订正过了。这次不看原来写的，直接讲正确的思路。',
  noWorkWait: '这道直接讲正确的思路。我先想一想……',
  howTo: '正确的思路',
  fullWork: '完整过程',
  keyLead: '关键一步：',
  extra: '举一反三，再来一道',
  extraLabel: '举一反三',
  extraMaking: '我在出一道新的……',
  extraNone: '这会儿出不了新题。下次复习再练。',
  extraMore: '再来一道',
  extraEnough: '够了',
  extraFull: '今天练够了，过两天我再考你，记得更牢。',
  extraBack: '好',
  extraSeeAnswer: '这道先看答案。',
  extraKey: '答案',
  extraThinking: '我在想一个提示……',
  extraSame: '和上一次一样。改一改再交。',
  extraSelfOk: '好。纸上写清楚，考试也是这样写。',
  extraSelfNo: '没关系。照着答案在纸上改一遍。',
  extraTrap: '又是那个坑。',
};

// ---------------------------------------------------------------- small pure helpers

const str = v => (v == null ? '' : String(v)).trim();
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const lineLabel = i => (Number.isInteger(i) && i >= 0 && i < CIRCLED.length ? CIRCLED[i] : `${Number(i) + 1}.`);
export const keyOf = (photoId, idx) => `${str(photoId)}#${Number(idx) || 0}`;
const problemNo = p => str(p && p.no).replace(/[()（）.．、]/g, '').trim();

export function isChoice(problem = {}, diag = null) {
  if (diag && diag.answer_kind) return diag.answer_kind === 'choice';
  return /选择/.test(str(problem && problem.type)) || (Array.isArray(problem && problem.options) && problem.options.length >= 2);
}

// she corrected it on paper and chose “直接讲” on screen 5: her lines are not what she thought then, so no finding,
// no ladder built on them; straight to the explanation of the right way
export const noWorkOf = (problem = {}) => !!(problem && problem.useWork === false);

export function entryStep(problem = {}) {
  if (noWorkOf(problem)) return 'explain';
  if (isChoice(problem)) return 'hint1';
  return (problem && problem.her_work || []).length ? 'find' : 'redo';
}

// the keypad kind for a written answer, from its look: “3或7” set, “x=2” equation, “-1/3” number, else expr
export function guessKind(text) {
  const t = str(text).replace(/\\\(|\\\)/g, '');
  if (!t) return '';
  if (/或|,|，|、/.test(t)) return 'set';
  if (/^[A-Ha-h]$/.test(t)) return 'choice';
  if (/^[<>=]$|^[≤≥]$/.test(t)) return 'compare';
  if (/=/.test(t)) return 'equation';
  if (/^[-−+]?\s*[\d.]+(\s*\/\s*[\d.]+)?\s*(°|cm|m|厘米|米)?$/.test(t)) return 'number';
  if (/[一-鿿]/.test(t)) return 'text';
  return 'expr';
}

export function answerKind(diag = null, problem = {}) {
  if (diag && diag.answer_kind) return diag.answer_kind;
  if (isChoice(problem, diag)) return 'choice';
  if (diag && diag.answer) return guessKind(diag.answer) || 'expr';
  // before the diagnosis: what the program can work out itself, else what her own answer looks like
  let c = null;
  try { c = compute(str(problem && problem.stem)); } catch { c = null; }
  return (c && c.kind) || guessKind(problem && problem.her_answer) || 'expr';
}

// a tapped option ("B. −3" or just "B") -> its letter, for mathcheck's choice kind
export function choiceLetter(given, options = []) {
  const g = str(given);
  if (/^[A-Ha-h]$/.test(g)) return g.toUpperCase();
  const i = (options || []).findIndex(o => str(o) === g);
  if (i >= 0) {
    const m = /^\s*([A-Ha-h])\s*[.．、:：)）\s]/.exec(options[i]);
    return m ? m[1].toUpperCase() : 'ABCDEFGH'[i];
  }
  const m = /^\s*([A-Ha-h])(?![A-Za-z])/.exec(g);
  return m ? m[1].toUpperCase() : g;
}

// her answer against an expected one. ok null: the program cannot tell (text answers), she compares herself.
export function judge(given, { answer = '', kind = '', form = '', trap = '', options = [] } = {}) {
  const k = kind || guessKind(answer) || '';
  const g = k === 'choice' ? choiceLetter(given, options) : str(given);
  const r = check(g, answer, { kind: k, form });
  const isTrap = !!(str(trap) && r.ok === false && check(g, trap, { kind: k, form }).ok === true);
  return { ok: r.ok, reason: r.reason || '', trap: isTrap };
}

// the keypad's letter keys and the “x =” key, from the expected answer (4a+3b -> a, b; m=5 -> m)
export function keysFor(answer, kind) {
  const t = plain(str(answer)).replace(/[\u4e00-\u9fff]/g, '');
  const letters = [...new Set((t.match(/[a-z]/g) || []))];
  const v = /^\s*([a-z])\s*=/.exec(t);
  return { letters: kind === 'expr' || kind === 'equation' || kind === 'set' ? (letters.length ? letters : null) : null, variable: v ? v[1] : 'x' };
}

// the order two options are shown in, fixed per problem: [0, 1] or [1, 0]. Models tend to put the right one first.
export function optionOrder(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 2 ? [1, 0] : [0, 1];
}

// a bare answer like 4a+3b drawn as math; anything with Chinese or its own \( \) stays as it is
const asMath = s => { const t = str(s); return !t || /\\\(|\$|[一-鿿]/.test(t) ? t : `\\(${t}\\)`; };
const answerText = (d = {}) => `${asMath(d.answer)}${str(d.unit) ? ' ' + str(d.unit) : ''}`;

const pairs = s => {
  const t = plain(String(s || '')).replace(/\s+/g, '').replace(/^(解|答|原式)[:：]?/, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};
// the line of the correct working that answers her wrong one: most shared character pairs (Dice), ties to the earlier
export function matchLine(line, solution = [], fallback = 0) {
  if (!solution.length) return -1;
  const a = pairs(line);
  let best = -1, at = Math.max(0, Math.min(fallback, solution.length - 1));
  solution.forEach((s, i) => {
    const b = pairs(s);
    let n = 0;
    for (const x of a) if (b.has(x)) n++;
    const score = a.size + b.size ? (2 * n) / (a.size + b.size) : 0;
    if (score > best + 1e-9) { best = score; at = i; }
  });
  return best > 0 ? at : Math.max(0, Math.min(fallback, solution.length - 1));
}

const wlOf = (diag, problem = {}) => {
  const wl = diag ? Number(diag.wrong_line) : -1;
  const n = (problem && problem.her_work || []).length;
  return Number.isInteger(wl) && wl >= 0 && wl < n ? wl : -1;
};

// 第 8 屏：她写的（或她的答案）和正确的左右对照，只高亮分叉的那一行
export function contrast(problem = {}, diag = {}) {
  const work = (problem && problem.her_work) || [];
  const sol = (diag && diag.solution) || [];
  // 订正过、直接讲：她纸上的已经是改过的，不放“你写的”，只有正确的一栏（only），全部写完以后再看
  if (noWorkOf(problem)) {
    return {
      only: true, mineLabel: '', mine: [], rightLabel: sol.length ? COPY.fullWork : COPY.rightAnswer,
      right: sol.length ? sol.map(t => ({ text: t, hi: false })) : [{ text: answerText(diag), hi: true }],
    };
  }
  const wl = wlOf(diag, problem);
  if (wl < 0) {
    return {
      mineLabel: COPY.myAnswer, rightLabel: COPY.rightAnswer,
      mine: [{ text: str(problem.her_answer) || COPY.notWritten, hi: true }],
      right: [{ text: answerText(diag), hi: true }],
    };
  }
  const j = matchLine(work[wl], sol, wl);
  return {
    mineLabel: COPY.mine, rightLabel: COPY.correct,
    mine: work.map((t, i) => ({ text: t, hi: i === wl })),
    right: sol.length ? sol.map((t, i) => ({ text: t, hi: i === j })) : [{ text: answerText(diag), hi: true }],
  };
}

// the short name of her pit: notebook.shortName when it is there, else the catalog's short name or the start of its
// “wrong” sentence (12 characters), else the error type
export function shortPit(tag, curriculum, errorType = '') {
  let e = null;
  try { e = tag && curriculum && typeof curriculum.error === 'function' ? curriculum.error(tag) : null; } catch { e = null; }
  const named = e && str(e.short || e.name);
  if (named) return named.slice(0, 12);
  if (e && e.wrong) {
    const t = str(String(e.wrong).split(/[；;。，,（]/)[0].replace(/[“”"「」]/g, ''));
    if (t) return t.length > 12 ? t.slice(0, 12) + '…' : t;
  }
  return str(errorType);
}

// the pit name she sees: notebook.shortName (its table of short names) when it is there, else shortPit
export function pitName(diag = {}, curriculum = null, nb = NB) {
  const d = diag || {};
  if (typeof nb.shortName === 'function') {
    try { const s = str(nb.shortName({ tag: d.tag || '', section: d.section || '', diagnosis: d }, curriculum)); if (s) return s; } catch { /* fall through */ }
  }
  return shortPit(d.tag, curriculum, d.error_type);
}

// 名额（CONTRACTS 12、C 4.4）：kv quota { day, used }，换了一天从 0 算
export function quotaAfter(quota, day, n = 1) {
  const used = quota && quota.day === day ? Number(quota.used) || 0 : 0;
  return { day, used: used + n };
}
// 只算走了提示阶梯的题：她在第 6 屏自己改对的不占名额，拿不准没讲的也不占
export const countsForQuota = st => !!st && st.level >= 1 && st.ask !== 'unsure';
// 轻卡：自己改对（指了位置后改对也算），同构题没有两次都错（现在自己改对的当天不做同构题；v0.3 留下的半路状态还会走到这里）
export const isLight = st => !!st && (st.found === 'self' || st.found === 'located') && st.twinOk !== false && !st.ask;

// “直接讲吧”出不出、出成什么样。前两级她都自己碰过才出：改过一次（fixTries，选择题没有这一级），
// 点过一次二选一（这道题的讲解没有二选一时不等）。只在提示屏（hint1、hint2）上，讲清楚那一屏本身就是第 4 级。
const LADDER = new Set(['hint1', 'hint2']);
export function directOffer(st, diag, problem = {}, { late = false } = {}) {
  if (!st || !diag || diag.checked === 'unsure' || !LADDER.has(st.step)) return '';
  const fixed = (Number(st.fixTries) || 0) >= 1 || isChoice(problem, diag);
  const picked = (st.hint1Pick !== null && st.hint1Pick !== undefined) || !diag.hint1;
  if (!fixed || !picked) return '';
  return late ? 'big' : 'text';
}

// 同坑合并：同一个错因标签、还在练的卡（最近的那张）
export function findMergeTarget(cards = [], tag = '') {
  if (!str(tag)) return null;
  const list = cards.filter(c => c && c.status === 'learning' && c.tag === tag);
  list.sort((a, b) => str(b.at).localeCompare(str(a.at)));
  return list[0] || null;
}

const clone = o => JSON.parse(JSON.stringify(o));
const original = info => ({
  at: info.at, day: info.today, photoId: info.photoId || '', problemIdx: info.problemIdx ?? null, problem: info.problem,
  crop: info.crop || '', thumb: info.thumb || '', source: info.source || '', found: info.found || '', mySentence: info.mySentence || '',
});
// the smallest merge (notebook.mergeInto takes over when it exists): hang the new problem on the card, back to stage 1, due tomorrow
export function mergeLocal(card, info) {
  const c = clone(card);
  c.originals = [...(c.originals || []), original(info)];
  Object.assign(c, { stage: 1, streak: 0, streakFrom: '', status: 'learning', due: NB.addDays(info.today, 1), light: false, updated: info.at });
  return c;
}
// a self-fixed problem of a pit already in practice: hang it on the card, the schedule stays. A light card whose pit she
// fixed herself 3 times within a week becomes a normal card (C 4.4).
export function attachLocal(card, info) {
  const c = clone(card);
  c.originals = [...(c.originals || []), original(info)];
  c.updated = info.at;
  if (c.light) {
    const weekAgo = NB.addDays(info.today, -6);
    const selfFixes = [c, ...c.originals].filter(x => (x.found === 'self' || x.found === 'located') && str(x.day) >= weekAgo).length;
    if (selfFixes >= 3) Object.assign(c, { light: false, stage: 1, streak: 0, streakFrom: '', due: NB.addDays(info.today, 1), promotedOn: info.today });
  }
  return c;
}

// 订正过、直接讲的题没有她错的那一行：出题时把“这类题最容易卡在哪”（why）当作她的坑
export const flatForVariants = (problem = {}, diag = {}) => ({
  stem: problem.stem || '', options: problem.options || [], answer: diag.answer || '',
  wrong_step: diag.wrong_step || (noWorkOf(problem) ? diag.why || '' : ''),
  error_type: diag.error_type || '', why: diag.why || '', section: diag.section || '', tag: diag.tag || '',
});

export function twinFromPool(list = []) {
  const v = (list || []).find(x => x && x.level === '同构') || null;
  return v ? { q: v.q, answer: v.answer, answer_kind: v.answer_kind || '', form: v.form || '', unit: v.unit || '', trap_answer: v.trap_answer || '', fromPool: true } : null;
}

// merge new variants into a card's pool: no repeats, nothing she has already done
export function poolFrom(list = [], existing = [], exclude = []) {
  const seen = new Set([...(exclude || []).map(str)]);
  const out = [];
  for (const v of [...(existing || []), ...(list || [])]) {
    if (!v || !str(v.q) || seen.has(str(v.q))) continue;
    seen.add(str(v.q));
    out.push(v);
  }
  return out;
}

// 收进本子（第 10 屏）。纯函数：决定建新卡、合并到同坑的卡还是挂上去，名额加不加，结果页说什么，后台出不出题。
export function planSave({ st, problem = {}, diag = {}, cards = [], id, photoId = '', crop = '', thumb = '', source = '',
  today, at, curriculum = null, nb = NB } = {}) {
  const ask = st.ask || (diag.checked === 'unsure' ? 'unsure' : '');
  const light = isLight(st);
  const info = { problem, diagnosis: diag, crop, thumb, source, today, at, found: st.found, mySentence: st.mySentence, photoId, problemIdx: st.idx };
  let card, how = 'new', changed = [];
  if (!ask && typeof nb.fileProblem === 'function') {
    // notebook.js files it: same pit -> merge (back to stage 1), self-fixed -> light card, 3 self-fixes a week -> promote.
    // It keys the light card on found 'self'; a self-fix whose twin failed twice is not light, so it goes in as 'located'
    // (a normal card) and the card gets her real found afterwards.
    const nbFound = light ? 'self' : st.found === 'self' ? 'located' : st.found;
    const r = nb.fileProblem(cards, { id, problem, diagnosis: diag, photoId, crop, thumb, source, found: nbFound, today, at,
      extra: { mySentence: st.mySentence || '', problemIdx: st.idx } });
    card = clone(r.card);
    changed = (r.changed || []).map(clone);
    how = r.merged ? 'merged' : 'new';
    if (r.merged) { const o = (card.originals || [])[card.originals.length - 1]; if (o) o.found = st.found; } else card.found = st.found;
  } else {
    const target = ask ? null : findMergeTarget(cards, diag.tag);
    if (target && light) {
      card = attachLocal(target, info);
      how = 'merged';
    } else if (target) {
      card = mergeLocal(target, info);
      how = 'merged';
    } else {
      const args = { id, problem, diagnosis: diag, photoId, crop, today, at };
      let base = null;
      if (light && typeof nb.lightCard === 'function') { try { base = nb.lightCard(args); } catch { base = null; } }
      if (!base || typeof base !== 'object') base = nb.newCard(args);
      card = { ...base, id, thumb, source, originals: base.originals || [], flagged: [...(base.flagged || [])], light: !ask && light };
    }
    if (how === 'new') Object.assign(card, { found: st.found || '', mySentence: st.mySentence || '', problemIdx: st.idx });
  }
  if (ask) Object.assign(card, { status: 'ask', due: '', light: false, askTeacher: { reason: ask, day: today } });
  // 今天没做的同构题（自己改对的不做，或讲完先收进本子）：讲题时已经核对过，放进卡的池子。
  // 明天的复习先取近变式；后台出题没成功时，这道就在手边，不用等也不用再花钱（C 4.4）
  const dt = diag && diag.twin;
  if (!ask && !st.twin && dt && str(dt.q) && str(dt.answer)) card.pool = poolFrom([{ ...dt, level: '同构' }], card.pool || [], card.used || []);
  // what this session learned about the pit goes on the card either way
  if (st.flagged && st.flagged.length) card.flagged = [...(card.flagged || []), ...st.flagged];
  if (st.confused) card.confused = true;
  if (st.mySentence && !card.mySentence) card.mySentence = st.mySentence;
  card.hintLevel = Math.max(Number(card.hintLevel ?? -1), st.level);
  if (st.twinOk === false) card.retell = true;   // 明天换个讲法再来（v1 的“换个讲法”看这个）
  card.updated = at;

  const short = pitName(diag, curriculum, nb);
  let section = str(diag.section);
  try { if (section && curriculum && typeof curriculum.title === 'function') section = str(curriculum.title(section)); } catch { /* keep the id */ }

  // the background pool: a new card gets its six; a card she merged into gets more only when it is running low
  let variants = null;
  if (!ask) {
    if (how === 'new') variants = { flat: flatForVariants(problem, diag), fresh: true, exclude: st.twin ? [st.twin.q] : [] };
    else {
      const used = new Set((card.used || []).map(str));
      const left = (card.pool || []).filter(v => !used.has(str(v.q))).length;
      if (left < 2) variants = { flat: flatForVariants(card.problem || problem, card.diagnosis || diag), fresh: false, exclude: [] };
    }
  }
  return {
    put: [card, ...changed], cardId: card.id, quota: countsForQuota(st), variants,
    result: { ask, light: !ask && light && !!card.light, how, short, section, twinOk: st.twinOk, twinSkipped: !!st.twinSkipped, cardId: card.id },
  };
}

// “下一道”：她在这一页挑的题（flow.queue），去掉这一道
export function nextInQueue(queue, photoId, idx) {
  const norm = (Array.isArray(queue) ? queue : []).map(x => (x && typeof x === 'object'
    ? { photoId: str(x.photoId ?? photoId), idx: Number(x.idx) } : { photoId: str(photoId), idx: Number(x) }))
    .filter(x => Number.isInteger(x.idx) && x.idx >= 0);
  const rest = norm.filter(x => !(x.photoId === str(photoId) && x.idx === Number(idx)));
  return { next: rest[0] || null, rest };
}

// 待讲 kv pending：[{ photoId, idx, at }]，同一道不重复；front 放最前面（今天讲不了的，明天先讲）
export function addPending(pending, items = [], { front = false, at = new Date().toISOString() } = {}) {
  const list = Array.isArray(pending) ? pending.filter(Boolean) : [];
  const add = items.map(x => ({ photoId: str(x.photoId), idx: Number(x.idx), at: x.at || at })).filter(x => x.photoId && Number.isInteger(x.idx));
  const same = (a, b) => a.photoId === b.photoId && Number(a.idx) === Number(b.idx);
  const uniq = arr => arr.filter((x, i) => arr.findIndex(y => same(x, y)) === i);
  if (front) return uniq([...add, ...list]);
  return uniq([...list, ...add]);
}

// 第 10 屏说什么
export function doneView(result = {}) {
  const r = result || {};
  if (r.ask === 'unsure') return { title: COPY.unsure, lines: [COPY.unsureMore] };
  if (r.ask === 'flagged') return { title: COPY.flaggedTitle, lines: [COPY.flaggedMore] };
  if (r.ask === 'confused') return { title: COPY.confusedTitle, lines: [COPY.confusedMore] };
  const pit = [r.short ? COPY.pit + r.short : '', r.section].filter(Boolean);
  const merged = r.how === 'merged' ? [COPY.merged] : [];
  if (r.light) return { title: COPY.saved, lines: [...merged, ...pit, COPY.lightClose] };
  const tomorrow = r.twinOk === false || r.twinSkipped ? COPY.tomorrowRetell : COPY.tomorrow;
  return { title: COPY.saved, lines: [...merged, ...pit, tomorrow].filter(Boolean) };
}

// ---------------------------------------------------------------- 一句话（self_explain）

// 平常是补全“我错在：……”；订正过、直接讲的题问的是“这道题的关键一步是什么”，模型可能写成问句
const isQuestion = q => /[？?]\s*$/.test(str(q));
export function sentenceHead(se = {}, noWork = false) {
  const q = str(se && se.q);
  if (isQuestion(q)) return q;
  return (q || (noWork ? COPY.keyLead : '我错在：')) + '……';
}
// the sentence that goes on the card (mySentence): the stem with the right option filled in
export function sentenceOf(se = {}, noWork = false) {
  const right = str(((se && se.options) || [])[se && se.answer === 1 ? 1 : 0]);
  const q = str(se && se.q);
  if (!q || isQuestion(q)) return (noWork || /关键/.test(q) ? COPY.keyLead : '我错在：') + right;
  return q + right;
}

// ---------------------------------------------------------------- 有问题？问我（v0.6.0）

const clip = (t, n = 90) => { const s = str(t).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n) + '…' : s; };

// 哪几屏有右上角的“有问题？问我”：讲题的每一屏。收进本子那一屏用底下那个；拿不准的不讲（CONTRACTS 9），也不接着问
const ASK_STEPS = new Set(['find', 'redo', 'fix', 'hint1', 'hint2', 'explain', 'sentence', 'twin', 'extra']);
export const askable = st => !!st && ASK_STEPS.has(st.step) && !(st.diagnosis && st.diagnosis.checked === 'unsure');

// 带给老师的一句话（teacher.problemContext 的 step）：她停在讲题的哪一步、那一屏上写着什么。同构题和举一反三的题
// 带上答案，请老师先别直接说：老师坐在她旁边陪她做，不替她做
export function askStep(st = {}, problem = {}, { twin = null } = {}) {
  const d = st.diagnosis && st.diagnosis.checked !== 'unsure' ? st.diagnosis : null;
  const work = (problem && problem.her_work) || [];
  const doing = (t, given) => `（这道的答案是 ${str(t.answer)}，她还在做，先别直接告诉她${given ? `；她刚才答的是 ${given}，不对` : ''}）`;
  switch (st.step) {
    case 'find': return '先自己找：她在看自己写的每一行，找从哪一行开始不对';
    case 'redo': return '她在纸上把这道题从头再做一遍';
    case 'fix': {
      const wl = wlOf(d, problem);
      const at = wl >= 0 ? `第 ${lineLabel(wl)} 行（${clip(work[wl], 60)}）` : '那一行';
      return `改错：问题在${at}，她在草稿纸上改这一行${st.fixTries ? `，已经改了 ${st.fixTries} 次还不对` : ''}`;
    }
    case 'hint1': return d && d.hint1 ? `提示第 1 级，一道二选一：${clip(d.hint1.q)}` : '提示第 1 级，讲解还没出来';
    case 'hint2':
      return d && str(d.hint2) ? `提示第 2 级：${clip(d.hint2)}。她要从这一步接着做${st.tries ? `，已经做了 ${st.tries} 次还不对` : ''}` : '提示第 2 级，讲解还没出来';
    case 'explain': {
      const lead = st.noWork ? '她订正过这道题，选了直接讲正确思路。' : '';
      const steps = (d && d.explain) || [];
      if (!d) return `${lead}讲清楚这一屏，讲解还没出来`;
      if (st.again) return `${lead}讲清楚：${steps.length} 步都看完了，她说还是不太懂`;
      const n = Math.min(st.explainShown || 1, Math.max(1, steps.length));
      return steps.length ? `${lead}讲清楚第 ${n} 步（共 ${steps.length} 步）：${clip(steps[n - 1])}` : `${lead}讲清楚这一屏`;
    }
    case 'sentence': {
      const se = d && d.self_explain;
      const what = st.noWork ? '说出这道题的关键一步' : '用一句话说出自己错在哪';
      return se ? `${what}，一道二选一：${clip(se.q, 30)}“${clip(se.options[0], 40)}”还是“${clip(se.options[1], 40)}”` : what;
    }
    case 'twin': {
      const t = st.twin || twin;
      if (!t || !str(t.q)) return '同构题，题目还在出';
      const last = [...(st.attempts || [])].reverse().find(a => a.kind === 'twin');
      return `同构题（换个数自己做一道）：${clip(t.q)}${doing(t, st.twinTries && last ? str(last.given) : '')}`;
    }
    case 'extra': {
      const e = st.extra || {};
      const no = (e.count || 0) + (e.out ? 0 : 1);
      if (!e.q) return `举一反三第 ${no} 道，题目还在出`;
      if (e.out) {
        const how = e.out.flagged ? '她说这道题有问题，跳过了' : e.out.ok ? '她做对了' : '她没做对，看过答案了';
        return `举一反三第 ${no} 道：${clip(e.q.q)}（答案 ${str(e.q.answer)}，${how}）`;
      }
      const g = (e.givens || []).length ? str(e.givens[e.givens.length - 1]) : '';
      return `举一反三第 ${no} 道：${clip(e.q.q)}${doing(e.q, g)}`;
    }
    case 'done': return st.result && st.result.light ? '这道题她自己改对了，已经收进错题本' : '这道题讲完了，已经收进错题本';
    default: return '讲这道题';
  }
}

// go('chat', …) 的 params（ui-chat problem 模式）。诊断回来了才带；拿不准的答案不给老师当真
export function askParams(st = {}, problem = {}, { twin = null } = {}) {
  const d = st.diagnosis && typeof st.diagnosis === 'object' && st.diagnosis.checked !== 'unsure' ? st.diagnosis : null;
  return {
    mode: 'problem', problem, ...(d ? { diagnosis: d } : {}), step: askStep(st, problem, { twin }),
    ...(st.cardId ? { cardId: st.cardId } : {}), ...(st.chatId ? { chatId: st.chatId } : {}),
  };
}

// ---------------------------------------------------------------- 举一反三（v0.6.0）

// 收进本子以后出不出“举一反三，再来一道”：有卡、不是问老师、讲完不是还不懂、同构题没有两次都错（那时说的是“今天先到这儿”），
// 这一次还没做满 3 道
export function extraOffer(st) {
  if (!st || st.step !== 'done' || !st.cardId) return false;
  const r = st.result || {};
  if (r.ask || st.ask || st.confused || st.twinOk === false) return false;
  return ((st.extra && st.extra.count) || 0) < EXTRA_MAX;
}

// 从卡的池子里挑一道：没用过、没被她说有问题、核对过；不要同构题（留给明天的复习），不要今天见过的（exclude）。
// 先近变式，其次辨析、远变式，都没有再取别的层级
export function pickExtra(card, { exclude = [] } = {}) {
  if (!card) return null;
  const free = freeVariants(card, new Set(exclude.map(str).filter(Boolean)))
    .filter(v => (v.checked === 'program' || v.checked === 'models') && str(v.level) !== '同构');
  for (const l of EXTRA_LEVELS) { const v = free.find(x => str(x.level) === l); if (v) return v; }
  return free[0] || null;
}

// the question she sees (ui-practice's variant question, plain data so it goes into the flow)
export const extraQuestion = (card, v) => ({ ...variantQuestion(card || {}, v), checked: str(v && v.checked) });

// 用过的题进卡的 used：隔天的复习、错题卷都不会再出这一道
export function useExtra(card, q, at = new Date().toISOString()) {
  const used = (card.used || []).map(str);
  const t = str(q && q.q);
  return { ...card, used: t && !used.includes(t) ? [...(card.used || []), t] : [...(card.used || [])], updated: at };
}

// 一道做完写进 attempts 的那一条（kind 'extra'；不调 recordReview，不算进间隔复习）
export function extraAttempt(st = {}, { at = new Date().toISOString(), day = '' } = {}) {
  const e = st.extra || {}, q = e.q || {}, o = e.out || {};
  const givens = (e.givens || []).map(String);
  return {
    itemId: st.cardId || '', at, day, kind: 'extra', level: str(q.level), q: str(q.q), given: givens.length ? givens[givens.length - 1] : '', givens,
    ok: !!o.ok, reason: o.self ? 'self' : str(e.reason), firstTry: !!o.firstTry, hints: Number(e.hints) || 0, ms: Number(e.ms) || 0,
    trap: !!e.trapHit, self: !!o.self, where: 'explain',
  };
}

// 回到收进本子那一屏时的一句：做了几道、对了几道（她说有问题的那道不算）
export function extraSummary(extra) {
  const res = ((extra && extra.results) || []).filter(r => r && !r.flagged);
  if (!res.length) return '';
  const ok = res.filter(r => r.ok).length;
  return `${COPY.extraLabel}做了 ${res.length} 道${ok === res.length ? '，都对了。' : ok ? `，对了 ${ok} 道。` : '。'}`;
}

const freshExtra = () => ({ q: null, making: true, tries: 0, hints: 0, trapHit: false, givens: [], reason: '', notes: [], waiting: false,
  pendingTrap: false, say: '', out: null, ms: 0 });

// ---------------------------------------------------------------- the state machine

// what she confirmed on screen 5: when she goes back and changes the problem, the explanation starts over
// （v0.6.0：选了“直接讲”也算改了，诊断不一样；没选的签名和以前一样，讲到一半的题不会因为升级重来）
export const problemSig = (p = {}) => JSON.stringify([p.stem, p.her_work, p.her_answer, p.mark, p.options, p.teacher_note, p.type].map(x => x ?? '')
  .concat(noWorkOf(p) ? ['no-work'] : []));

export function initState({ photoId = '', idx = 0, problem = {}, now = new Date().toISOString() } = {}) {
  const noWork = noWorkOf(problem);
  return {
    v: 1, key: keyOf(photoId, idx), photoId: str(photoId), idx: Number(idx) || 0, step: entryStep(problem), prev: '', psig: problemSig(problem),
    picked: null, level: noWork ? 3 : -1, found: noWork ? 'explain' : '', fixTries: 0, tries: 0, hint1Pick: null, direct: false, explainShown: 1, again: false,
    sentencePick: null, mySentence: '', twin: null, twinTries: 0, twinOk: null, twinSkipped: false, confused: false,
    flagged: [], ask: '', error: '', note: null, attempts: [], diagnosis: null, cardId: '', result: null, startedAt: now,
    noWork, chatId: '', extra: null,
  };
}

const note = (tone, text) => ({ tone, text });
// 讲完的几步：诊断、错误、“这题有问题”都不再改它们。举一反三在收进本子以后，也算讲完了
const ENDED = new Set(['ask', 'save', 'done', 'extra']);
// 这些事件不把屏上那句话（note）清掉：诊断回来、计时、存好了、记下对话 id（她去问我再回来，那句话还在）
const KEEP_NOTE = new Set(['diag', 'tick', 'saved', 'chat-id']);

function toExplain(s, text = '') {
  s.step = 'explain';
  s.level = 3;
  if (!s.found) s.found = 'explain';
  s.explainShown = Math.max(1, s.explainShown || 1);
  if (text) s.note = note('info', text);
}

function resolvePick(s, d, problem) {
  const wl = wlOf(d, problem);
  if (wl < 0) { s.step = 'redo'; s.note = note('info', COPY.redoInstead); return; }
  const at = `第 ${lineLabel(wl)} 行`;
  if (s.picked === wl) { s.step = 'fix'; s.note = note('ok', `对，就是${at}。${COPY.fixHere}`); return; }
  s.level = Math.max(s.level, 0);   // 第 0 级：只指位置
  s.step = 'fix';
  const p = s.picked;
  const lead = !Number.isInteger(p) ? `问题在${at}。`
    : p < wl ? `第 ${lineLabel(p)} 行没问题，问题在${at}。`
    : `第 ${lineLabel(p)} 行是跟着前面错的，问题从${at}就开始了。`;
  s.note = note('info', lead + COPY.fixHere);
}

// event: { type, at, day, ... }   env: { problem, diag, short, twin }
//   twin: the twin problem to use (object), null (none: skip it) or undefined (still being made)
export function reduce(s0, ev = {}, env = {}) {
  const problem = env.problem || {};
  const s = { ...s0, flagged: [...(s0.flagged || [])], attempts: [...(s0.attempts || [])] };
  if (!KEEP_NOTE.has(ev.type)) s.note = null;
  if (ev.type === 'diag' && ev.diag) s.diagnosis = ev.diag;
  const d = s.diagnosis || env.diag || null;
  const short = env.short || '';
  const twin = s.twin || env.twin;

  switch (ev.type) {
    case 'diag': {
      if (!d || ENDED.has(s.step)) break;
      if (s.step === 'error') { s.step = s.prev || entryStep(problem); s.error = ''; }
      if (d.checked === 'unsure') { s.step = 'ask'; s.ask = 'unsure'; s.note = null; break; }
      if ((s.step === 'find' || s.step === 'redo') && !s.fixTries && isChoice(problem, d)) { s.step = 'hint1'; break; }
      if (s.step === 'find' && s.picked !== null) resolvePick(s, d, problem);
      break;
    }
    case 'pick': {
      if (s.step !== 'find' || s.picked !== null) break;
      s.picked = Number.isInteger(ev.line) ? ev.line : 'none';
      if (d) resolvePick(s, d, problem); else s.note = note('wait', COPY.almost);
      break;
    }
    case 'answer': {
      if (!['fix', 'redo', 'hint2', 'twin'].includes(s.step)) break;
      const isTwin = s.step === 'twin';
      s.attempts.push({
        at: ev.at || '', day: ev.day || '', kind: isTwin ? 'twin' : 'self-fix', q: str(isTwin ? twin && twin.q : problem.stem),
        given: str(ev.given), ok: !!ev.ok, reason: ev.reason || '', firstTry: isTwin ? s.twinTries === 0 : s.fixTries === 0,
        hints: isTwin ? 0 : s.level + 1, level: s.level, ms: Math.max(0, Math.round(Number(ev.ms) || 0)), trap: !!ev.trap, step: s.step,
      });
      if (isTwin) {
        s.twinTries++;
        if (ev.ok) { s.twinOk = true; s.step = 'save'; s.note = note('ok', COPY.twinRight); }
        else if (s.twinTries >= 2) { s.twinOk = false; s.step = 'save'; s.note = note('info', COPY.twinStop); }
        else if (ev.trap) s.note = note('trap', `${COPY.trap}${short ? '：' + short : ''}。${COPY.tryAgain}`);
        else s.note = note('info', COPY.almostThere + (localHint(ev.reason) || '') + COPY.tryAgain);
        break;
      }
      s.fixTries++;
      if (s.step === 'hint2') {
        s.tries++;
        if (ev.ok) { s.found = 'hint'; s.step = 'sentence'; s.note = note('ok', COPY.hintDone); }
        else if (s.tries < HINT2_TRIES) s.note = note('info', COPY.almostThere + (localHint(ev.reason) || COPY.lookAgain));
        else toExplain(s, COPY.together);
        break;
      }
      // 自己改对的：当天不做同构题，直接收成轻卡（第 1 节冲突表、4.4）
      if (ev.ok) { s.found = s.step === 'fix' && s.level === 0 ? 'located' : 'self'; s.step = 'save'; s.note = note('ok', COPY.selfFixed); }
      else { s.level = Math.max(s.level, 1); s.step = 'hint1'; s.tries = 0; s.note = note('info', COPY.stepByStep); }
      break;
    }
    case 'hint1': {
      if (s.step !== 'hint1' || !d || !d.hint1 || s.hint1Pick !== null) break;
      const h1 = d.hint1;
      const c = Number(ev.choice) === 1 ? 1 : 0;
      s.hint1Pick = c;
      s.level = Math.max(s.level, 1);
      s.note = c === h1.answer ? note('ok', COPY.right)
        : note('info', `不是“${h1.options[c]}”，是“${h1.options[h1.answer]}”。${COPY.commonWrong}`);
      s.step = 'hint2';
      s.tries = 0;
      break;
    }
    case 'direct': {   // “直接讲吧”：跳到讲清楚（第 4 级），之后照样一句话和同构题
      if (!directOffer(s, d, problem)) break;
      s.direct = true;
      s.found = 'explain';
      toExplain(s);
      break;
    }
    case 'next-step': if (s.step === 'explain') s.explainShown = Math.min((s.explainShown || 1) + 1, Math.max(1, (d && d.explain || []).length)); break;
    case 'understood': if (s.step === 'explain') { s.step = 'sentence'; s.again = false; } break;
    case 'confused':
      if (s.step === 'explain') { s.confused = true; s.again = true; s.explainShown = Math.max(1, (d && d.explain || []).length); }
      break;
    case 'skip-twin': if (s.step === 'explain') { s.twinSkipped = true; s.step = 'save'; s.note = note('info', COPY.againLater); } break;
    case 'ask-teacher': if (s.step === 'explain') { s.ask = 'confused'; s.step = 'save'; } break;
    case 'flag': {
      if (ENDED.has(s.step) || s.step === 'error') break;
      s.flagged.push({ at: ev.at || '', day: ev.day || '', where: s.step, q: str(ev.q) });
      if (s.step === 'twin') { s.twinSkipped = true; s.step = 'save'; s.note = note('info', COPY.flaggedTwin); }
      else { s.ask = 'flagged'; s.step = 'save'; }
      break;
    }
    case 'sentence': {
      if (s.step !== 'sentence' || !d || !d.self_explain || s.sentencePick !== null) break;
      const se = d.self_explain;
      const c = Number(ev.choice) === 1 ? 1 : 0;
      const right = se.options[se.answer];
      s.sentencePick = c;
      s.mySentence = sentenceOf(se, s.noWork);
      s.note = c === se.answer ? note('ok', COPY.sentenceRight) : note('info', `${COPY.sentenceFix}“${right}”。`);
      break;
    }
    case 'continue': if (s.step === 'sentence' && s.sentencePick !== null) s.step = 'twin'; break;
    case 'saved':
      if (s.step === 'save' || s.step === 'ask') {
        s.step = 'done'; s.cardId = ev.cardId || ''; s.result = ev.result || null; s.attempts = [];
        if (s.result && s.result.light) s.note = null;   // 收尾那句已经说了“你自己改对了”，上面不再重复
      }
      break;
    case 'error':
      if (ENDED.has(s.step)) break;
      if (s.step !== 'error') s.prev = s.step;
      s.step = 'error';
      s.error = str(ev.code) || 'http';
      break;
    case 'retry': if (s.step === 'error') { s.step = s.prev || entryStep(problem); s.error = ''; } break;

    // 有问题？问我：这道题第一次去问时记下对话的 id，再问接着同一段
    case 'chat-id': if (!s.chatId && str(ev.id)) s.chatId = str(ev.id); break;

    // 举一反三（state.extra）：{ count 这一次见过几道（做完或说有问题）, results [{ ok, firstTry } | { flagged }], seen [题目],
    //   q 这一道（extraQuestion）, making 正在出, tries, hints, trapHit, givens, reason, notes [{ text, trap }] 题下面的提示,
    //   waiting 在等老师的提示, pendingTrap, say 一句小话（读不懂、和上次一样）, out 这一道的结果 { ok, firstTry, self?, revealed?,
    //   trapNow?, flagged?, line? }, ms }
    case 'extra-start':
    case 'extra-more': {
      const e0 = s.extra || { count: 0, results: [], seen: [] };
      const can = ev.type === 'extra-start' ? extraOffer(s) : s.step === 'extra' && !!e0.out && (e0.count || 0) < EXTRA_MAX;
      if (!can) break;
      s.step = 'extra';
      s.extra = { count: e0.count || 0, results: [...(e0.results || [])], seen: [...(e0.seen || [])], ...freshExtra() };
      break;
    }
    case 'extra-q': {
      const e = s.extra;
      if (s.step !== 'extra' || !e || !e.making) break;
      if (ev.q && str(ev.q.q)) s.extra = { ...e, making: false, q: ev.q, seen: [...(e.seen || []), str(ev.q.q)] };
      else { s.extra = { ...e, making: false, q: null }; s.step = 'done'; s.note = note('info', COPY.extraNone); }
      break;
    }
    case 'extra-answer': {
      const e = s.extra;
      if (s.step !== 'extra' || !e || !e.q || e.out || e.waiting) break;
      const given = str(ev.given);
      const x = { ...e, say: '', givens: [...(e.givens || [])], notes: [...(e.notes || [])], ms: (Number(e.ms) || 0) + Math.max(0, Math.round(Number(ev.ms) || 0)) };
      if (ev.self) {   // 纸上的题、程序判不了的：她自己对照了答案
        if (given) x.givens.push(given);
        x.out = { ok: !!ev.ok, firstTry: !!ev.ok && !x.tries && !x.hints, self: true };
      } else {
        if (x.givens.length && given === str(x.givens[x.givens.length - 1])) { x.say = COPY.extraSame; s.extra = x; break; }   // 多按了一次
        x.givens.push(given);
        const v = { ok: ev.ok, reason: str(ev.reason), trap: !!ev.trap };
        const r = afterSubmit({ tries: x.tries, hints: x.hints, trapHit: x.trapHit }, v);
        Object.assign(x, { tries: r.tries, hints: r.hints, trapHit: r.trapHit, reason: v.reason || x.reason });
        if (r.action === 'right') x.out = { ok: true, firstTry: !!r.firstTry, line: praiseLine(r, x.q) };
        else if (r.action === 'unreadable') x.say = localHint('unreadable');
        else if (r.action === 'hint-local') x.notes.push({ text: missLine(v, x.q), trap: v.trap });   // 撞上坑答案：“又是那个坑。”
        else if (r.action === 'hint-remote') Object.assign(x, { waiting: true, pendingTrap: v.trap });   // 界面去要 retryHint
        else if (r.action === 'reveal') x.out = { ok: false, firstTry: false, revealed: true, trapNow: v.trap };
      }
      if (x.out) { x.count = (Number(x.count) || 0) + 1; x.results = [...(x.results || []), { ok: x.out.ok, firstTry: x.out.firstTry }]; }
      s.extra = x;
      break;
    }
    case 'extra-hint': {
      const e = s.extra;
      if (s.step !== 'extra' || !e || !e.waiting) break;
      const text = (e.pendingTrap ? COPY.extraTrap : '') + (str(ev.text) || COPY.lookAgain);
      s.extra = { ...e, waiting: false, pendingTrap: false, notes: [...(e.notes || []), { text, trap: !!e.pendingTrap }] };
      break;
    }
    case 'extra-flag': {
      const e = s.extra;
      if (s.step !== 'extra' || !e || !e.q || e.out) break;
      s.extra = { ...e, waiting: false, out: { ok: null, flagged: true }, count: (Number(e.count) || 0) + 1, results: [...(e.results || []), { flagged: true }] };
      break;
    }
    case 'extra-end': if (s.step === 'extra') { s.step = 'done'; s.extra = { ...s.extra, making: false, waiting: false }; } break;
    default: break;
  }

  // steps the diagnosis has nothing for are skipped
  if (d && !ENDED.has(s.step)) {
    if (s.step === 'hint1' && !d.hint1) { s.step = 'hint2'; s.level = Math.max(s.level, 1); }
    if (s.step === 'hint2' && !str(d.hint2)) toExplain(s);
    if (s.step === 'explain') { s.level = 3; if (!s.found) s.found = 'explain'; }
    if (s.step === 'sentence' && !d.self_explain) s.step = 'twin';
  }
  if (s.step === 'twin' && !s.twin) {
    const t = env.twin;
    if (t === null) { s.twinSkipped = true; s.step = 'save'; }
    else if (t && typeof t === 'object') s.twin = t;   // keep the one she started (a pool twin would be lost after a reload)
  }
  return s;
}

// ---------------------------------------------------------------- the view

const inflight = new Map();   // key -> Promise<Diagnosis>, outlives the view (she can go back and come in again)
const early = new Map();      // key -> { p, list, done, timedOut }: variants made early because the diagnosis had no twin
const failed = new WeakSet(); // diagnosis promises that failed: “再试一次” must not pick the flow's old one up again
const filling = new Map();    // cardId -> Promise: the card's pool being filled in the background (举一反三 waits for it first)

const withTimeout = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);

export function createExplain(ctx) {
  const root = document.getElementById('view-explain') || document.createElement('section');
  const keypad = import('./keypad.js').catch(() => null);   // ui-practice 写；没有时用下面的简易输入
  const localFlow = (() => { let v = {}; return { get: () => v, set: p => { v = { ...v, ...p }; }, clear: () => { v = {}; } }; })();
  const flowApi = () => ctx.flow || localFlow;
  const flowGet = () => { try { return flowApi().get() || {}; } catch { return {}; } };
  const flowSet = patch => { try { const r = flowApi().set(patch); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (e) { console.warn('flow', e); } };
  let localPipeline = null;
  const pipeline = () => ctx.pipeline || localPipeline || (localPipeline = createPipeline({ ai: ctx.ai, curriculum: ctx.curriculum || {} }));
  const today = () => { try { return typeof ctx.today === 'function' ? ctx.today() : NB.dayOf(); } catch { return NB.dayOf(); } };
  const store = () => ctx.store;

  const backBtn = h('button', { type: 'button', className: 'back', on: { click: () => ctx.back() } }, icon('back'), h('span', { className: 'back-label', text: COPY.backLabel }));
  const navTitle = h('span', { className: 'nav-title' });
  // v0.6.0：讲题的每一屏右上角都有“有问题？问我”（askable），点了带着这一步去问
  const askBtn = h('button', { type: 'button', className: 'text-btn accent ex-ask', hidden: true, on: { click: () => { if (cur) askChat(cur); } } },
    icon('chat'), h('span', { text: COPY.askAny }));
  const bar = h('header', { className: 'navbar' }, h('div', { className: 'inner' }, backBtn, navTitle, h('span', { className: 'nav-end' }, askBtn)));
  const head = h('div', { className: 'ex-prob' });
  const body = h('div', { className: 'ex-body' });
  const status = h('div', { className: 'ex-status', role: 'status', 'aria-live': 'polite' });
  const page = h('div', { className: 'page ex' }, head, body, status);
  root.replaceChildren(bar, page);

  let cur = null;        // { key, photoId, idx, problem, photo, st, cropP, crop, showCrop, pending, selfCheck, slow, sig, saving,
                         //   watch（在等的诊断 promise）, draft（去问我时小键盘里没交的字）, extraBusy, hintBusy }
  let epoch = 0;
  let shown = false;     // 这一屏在不在眼前：去问我时 hide，状态照常往前走，回来再画（小键盘不在看不见的地方挂着）
  let answerCtl = null, answerTok = null, answerStart = 0, answerWhich = '';

  // ------------------------------------------------ data

  async function getPhoto(photoId) {
    if (!photoId || !store()) return null;
    try { return (await store().get('photos', photoId)) || null; } catch { return null; }
  }
  const flowMatches = (f, photoId, idx) => (f.idx == null || Number(f.idx) === Number(idx)) && (!f.photoId || str(f.photoId) === str(photoId));
  function problemFromFlow(f, photoId, idx) {
    if (f.problem && typeof f.problem === 'object' && flowMatches(f, photoId, idx)) return f.problem;
    if (Array.isArray(f.problems) && f.problems[idx]) return f.problems[idx];
    return null;
  }

  function ensureCrop(c) {
    if (c.cropP) return c.cropP;
    const f = flowGet();
    const given = [flowMatches(f, c.photoId, c.idx) ? f.crop : '', f.crops && f.crops[c.idx], c.problem.crop, c.problem.cropURL]
      .find(x => typeof x === 'string' && x.startsWith('data:'));
    c.cropP = (async () => {
      if (given) return { dataURL: given, blob: null };
      const photo = c.photo || (c.photo = await getPhoto(c.photoId));
      if (!photo || !photo.blob || !c.problem.box) return null;
      // the box is on the photo as it was sent; the photo was stored upright, turned by page.rotation (ui-capture)
      const rect = boxToRect(c.problem.box, (photo.page && photo.page.rotation) || 0);
      if (!rect) return null;
      const shot = await cropImage(photo.blob, rect, { maxSide: 1200 });
      return shot && shot.dataURL ? { dataURL: shot.dataURL, blob: shot.blob || null } : null;
    })().catch(() => null);
    c.cropP.then(r => { c.crop = r; if (cur === c) renderHead(c); });
    return c.cropP;
  }

  async function makeThumb(cr) {
    if (!cr || !cr.dataURL) return '';
    try { return await thumbImage(cr.blob || dataURLToBlob(cr.dataURL), 320); } catch { return ''; }
  }

  function ensureDiag(c) {
    if (c.st.diagnosis) { dispatch({ type: 'diag', diag: c.st.diagnosis }); afterDiag(c); return; }
    let p = inflight.get(c.key);
    if (!p) {
      const f = flowGet();
      if (flowMatches(f, c.photoId, c.idx)) {
        p = [f.diagnose, f.diagnosing, f.diagnosePromise, f.diagnosisPromise].find(x => x && typeof x.then === 'function' && !failed.has(x)) || null;
        if (!p && f.diagnosis && typeof f.diagnosis === 'object' && f.diagnosis.checked) p = Promise.resolve(f.diagnosis);
      }
    }
    if (!p) p = ensureCrop(c).then(cr => pipeline().diagnose(c.problem, cr ? cr.dataURL : ''));
    inflight.set(c.key, p);
    if (c.watch === p) return;   // 去问我再回来：还是等的这一个，不再挂一遍
    c.watch = p;
    clearTimeout(c.slowTimer);
    c.slowTimer = setTimeout(() => { if (!c.st.diagnosis) { c.slow = true; if (cur === c) updateStatus(c); } }, SLOW_MS);
    p.then(d => {
      if (!d || typeof d !== 'object') throw Object.assign(new Error('empty'), { code: 'empty' });
      onDiag(c, d);
    }).catch(err => {
      if (inflight.get(c.key) === p) inflight.delete(c.key);
      failed.add(p);
      if (err && err.code === 'abort') return;
      console.warn('diagnose', err);
      clearTimeout(c.slowTimer);
      c.slow = false;
      if (cur === c) dispatch({ type: 'error', code: (err && err.code) || 'http' });
    });
  }

  function onDiag(c, d) {
    clearTimeout(c.slowTimer);
    c.slow = false;
    if (cur !== c) {   // she left this problem: keep the answer in the flow, the next show() picks it up
      c.st = { ...c.st, diagnosis: d };
      const f = flowGet();
      if (f.explain && f.explain.key === c.key) flowSet({ explain: { ...f.explain, diagnosis: d } });
      return;
    }
    dispatch({ type: 'diag', diag: d });
    afterDiag(c);
  }

  function afterDiag(c) {
    const d = c.st.diagnosis;
    if (!d || cur !== c) return;
    if (d.checked !== 'unsure' && !d.twin) startEarly(c);
    if (c.pending) { const p = c.pending; c.pending = null; submit(c, p.which, p.given, p.ms); }
  }

  // no twin in the diagnosis: ask for the pool now, with one 同构 first, so the twin step has something to give her
  function startEarly(c) {
    if (early.has(c.key) || c.st.twin || c.st.cardId) return;
    const d = c.st.diagnosis;
    const e = { done: false, timedOut: false, list: [] };
    early.set(c.key, e);
    e.p = Promise.resolve().then(() => pipeline().variants(flatForVariants(c.problem, d), TWIN_LEVELS))
      .then(list => { e.list = Array.isArray(list) ? list : []; }, () => { e.list = []; })
      .finally(() => { e.done = true; if (cur === c) dispatch({ type: 'tick' }); });
    setTimeout(() => { if (!e.done) { e.timedOut = true; if (cur === c) dispatch({ type: 'tick' }); } }, TWIN_WAIT_MS);
  }

  function twinEnv(c) {
    const d = c.st.diagnosis;
    if (c.st.twin) return c.st.twin;
    if (!d) return undefined;
    if (d.checked === 'unsure') return null;
    if (d.twin) return d.twin;
    const e = early.get(c.key);
    if (!e) { startEarly(c); return undefined; }
    if (e.done) return twinFromPool(e.list);
    return e.timedOut ? null : undefined;
  }

  function shortFor(c) {
    const d = c.st.diagnosis;
    if (!d) return '';
    if (c.short === undefined || c.shortTag !== d.tag) { c.short = pitName(d, ctx.curriculum); c.shortTag = d.tag; }
    return c.short;
  }

  const envOf = c => ({ problem: c.problem, diag: c.st.diagnosis, short: shortFor(c), twin: twinEnv(c) });

  function dispatch(ev) {
    const c = cur;
    if (!c) return;
    const prev = c.st;
    c.st = reduce(c.st, { at: new Date().toISOString(), day: today(), ...ev }, envOf(c));
    flowSet({ explain: { ...c.st, problem: c.problem } });   // the problem too: after a reload the photo may already be gone
    render();
    if ((c.st.step === 'save' || c.st.step === 'ask') && !c.saving && !c.saveFailed) saveCard(c);
    extraEffects(c, prev);
  }

  // ------------------------------------------------ 有问题？问我（v0.6.0）

  // 第一次问时记下对话 id（存进 flow），带着这一步去 chat；回来时 show() 原样接着
  function teachBack(c) {
    if (cur !== c) return;
    ctx.go('chat', { ...askParams(c.st, c.problem, { twin: null }), chatId: '', step: '', settle: 'teachback', fresh: Date.now() });
  }

  function askChat(c) {
    if (cur !== c) return;
    if (!c.st.chatId) dispatch({ type: 'chat-id', id: newId('c') });
    ctx.go('chat', askParams(c.st, c.problem, { twin: c.st.step === 'twin' ? twinEnv(c) : null }));
  }

  // ------------------------------------------------ 举一反三（v0.6.0）

  // 卡的读改写排成一队：后台补池子、记用过的题、她说有问题的题，谁也不盖掉谁
  let cardChain = Promise.resolve();
  function updateCard(id, fn) {
    const run = cardChain.then(async () => {
      if (!id || !store()) return null;
      const card = await store().get('items', id);
      if (!card) return null;
      const next = fn(card);
      if (next) await store().put('items', next);
      return next;
    });
    cardChain = run.catch(e => { console.warn('card', e); });
    return run;
  }

  // 每次状态变了以后：新出的题记进 used，一道做完写 attempts（或记下她说有问题），还要出题、要提示的去要
  function extraEffects(c, prev) {
    if (c.st.step !== 'extra') return;
    const a = (prev && prev.extra) || {}, b = c.st.extra || {};
    if (b.q && !(a.q && a.q.q === b.q.q)) updateCard(c.st.cardId, card => useExtra(card, b.q)).catch(() => {});
    if (b.q && b.out && !a.out) {
      if (b.out.flagged) updateCard(c.st.cardId, card => ({ ...flagCard(card, b.q, { day: today() }), updated: new Date().toISOString() })).catch(() => {});
      else if (store()) Promise.resolve().then(() => store().addAttempt(extraAttempt(c.st, { at: new Date().toISOString(), day: today() }))).catch(e => console.warn('attempt', e));
    }
    ensureExtra(c);
  }

  function ensureExtra(c) {
    const e = c.st.extra;
    if (c.st.step !== 'extra' || !e) return;
    if (e.making && !c.extraBusy) makeExtra(c);
    if (e.waiting && !c.hintBusy) extraHint(c);
  }

  // 出一道：池子里有就用；后台还在补就等它（最多 EXTRA_WAIT_MS）；再没有当场出 EXTRA_MAKE，放进池子再挑
  async function makeExtra(c) {
    const st0 = c.st, e0 = st0.extra;
    if (c.extraBusy || st0.step !== 'extra' || !e0 || !e0.making) return;
    c.extraBusy = true;
    const id = st0.cardId;
    const exclude = [st0.twin && st0.twin.q, c.problem && c.problem.stem, ...(e0.seen || [])].filter(Boolean);
    let q = null;
    try {
      let card = id && store() ? await store().get('items', id) : null;
      let v = pickExtra(card, { exclude });
      if (!v && card && filling.has(id)) {
        await withTimeout(filling.get(id), EXTRA_WAIT_MS);
        card = (await store().get('items', id)) || card;
        v = pickExtra(card, { exclude });
      }
      if (!v && card) {
        const list = await pipeline().variants(flatForVariants(c.problem || card.problem || {}, st0.diagnosis || card.diagnosis || {}), EXTRA_MAKE,
          { local: true, avoid: [...(card.used || []), ...(card.pool || []).map(x => x && x.q)] });
        const next = await updateCard(id, fresh => ({ ...fresh, pool: poolFrom(list, fresh.pool || [], fresh.used || []), updated: new Date().toISOString() }));
        if (next) card = next;
        v = pickExtra(card, { exclude });
      }
      q = v && card ? extraQuestion(card, v) : null;
    } catch (err) { console.warn('extra', err && (err.code || err.message)); }
    c.extraBusy = false;
    if (cur === c) dispatch({ type: 'extra-q', q });
  }

  // 错第二次：要一句老师的提示（模拟模式不花钱）；出错就说一句孩子听得懂的
  async function extraHint(c) {
    const e = c.st.extra;
    if (c.hintBusy || !e || !e.waiting || !e.q) return;
    c.hintBusy = true;
    let text = '';
    try {
      text = await pipeline().retryHint({ q: e.q.q, given: str((e.givens || [])[e.givens.length - 1]), answer: e.q.answer, reason: e.reason }, { local: false });
    } catch (err) { text = kidMessage(err, { where: 'hint' }) || ''; }
    c.hintBusy = false;
    if (cur === c) dispatch({ type: 'extra-hint', text });
  }

  // ------------------------------------------------ saving (第 10 屏)

  async function saveCard(c) {
    if (c.saving) return;
    if (c.st.cardId) { dispatch({ type: 'saved', cardId: c.st.cardId, result: c.st.result }); return; }
    c.saving = true;
    c.saveFailed = false;
    try {
      const st = c.st, d = st.diagnosis || {};
      const day = today(), at = new Date().toISOString();
      const cr = await withTimeout(ensureCrop(c), 8000);
      const thumb = await withTimeout(makeThumb(cr), 8000);
      const photo = c.photo || (c.photo = await getPhoto(c.photoId));
      const f = flowGet();
      const source = str((photo && photo.source) || f.source);
      const cards = await store().all('items');
      const plan = planSave({ st, problem: c.problem, diag: d, cards, id: newId('q'), photoId: c.photoId, crop: (cr && cr.dataURL) || '',
        thumb: thumb || '', source, today: day, at, curriculum: ctx.curriculum });
      for (const card of plan.put) await store().put('items', card);
      for (const a of st.attempts) { try { await store().addAttempt({ ...a, itemId: plan.cardId }); } catch (e) { console.warn('attempt', e); } }
      if (plan.quota && ctx.kv) {
        try { await ctx.kv.set('quota', quotaAfter(await ctx.kv.get('quota', null), day, 1)); } catch (e) { console.warn('quota', e); }
      }
      if (photo) {   // ui-capture / 首页看这个，知道这一页哪几道已经讲过
        try {
          const next = { ...photo, done: [...new Set([...(photo.done || []), c.idx])] };
          await store().put('photos', next);
          c.photo = next;
        } catch (e) { console.warn('photo', e); }
      }
      c.saving = false;
      if (cur === c) dispatch({ type: 'saved', cardId: plan.cardId, result: plan.result });
      else { c.st = reduce(c.st, { type: 'saved', cardId: plan.cardId, result: plan.result }, envOf(c)); flowSet({ explain: { ...c.st, problem: c.problem } }); }
      if (plan.variants) fillPool(plan.cardId, plan.variants, c.key);
    } catch (e) {
      console.error('save', e);
      c.saving = false;
      c.saveFailed = true;
      if (cur === c) render(true);
    }
  }

  // the background pool: never bothers her; a failure leaves the card as it is (practice makes new ones when it needs).
  // While it runs it sits in `filling`, so 举一反三 waits for it instead of paying for the same questions twice
  function fillPool(cardId, plan, key) {
    const p = (async () => {
      try {
        let list = null;
        const e = early.get(key);
        if (plan.fresh && e) { await e.p; list = e.list; early.delete(key); }
        if (!list || list.length < 2) list = await pipeline().variants(plan.flat, LEVELS);
        await updateCard(cardId, card => {
          const pool = poolFrom(list, card.pool, [...(card.used || []), ...(plan.exclude || [])]);
          return { ...card, pool, poolLow: pool.length < 4, updated: new Date().toISOString() };
        });
      } catch (err) { console.warn('variants', err && (err.code || err.message)); }
    })();
    filling.set(cardId, p);
    p.then(() => { if (filling.get(cardId) === p) filling.delete(cardId); });
    return p;
  }

  // ------------------------------------------------ leaving

  // 分拣（triage.js，DESIGN 4.9）：flow.triage 有值时，每道只走“我看到的题对吗”和“先自己找”。自己改对的照常收成轻卡；
  // 走到提示或讲解的（或点了“这道我先不改”），这道放进待讲，直接去下一道，不讲
  const triageOn = () => !!flowGet().triage;
  async function parkTriage(c) {
    const f = flowGet();
    const { next, rest } = nextInQueue(f.queue, c.photoId, c.idx);
    try {
      const pending = await ctx.kv.get('pending', []);
      await ctx.kv.set('pending', addPending(pending, [{ photoId: c.photoId, idx: c.idx }]));
    } catch (e) { console.warn('pending', e); }
    const tri = parkedState(f.triage);
    flowSet({ triage: tri });
    if (next) { ctx.toast(TRIAGE.parkedOne); goNext(c, next, rest); return; }
    ctx.toast(finishLine(tri));
    leave();
    ctx.go('home');
  }
  const triageSkipBtn = c => (triageOn()
    ? h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn ex-skip', text: TRIAGE.skip, on: { click: () => { c.triageParked = true; parkTriage(c); } } }))
    : null);

  async function parkPending(c) {
    const f = flowGet();
    const { rest } = nextInQueue(f.queue, c.photoId, c.idx);
    try {
      const pending = await ctx.kv.get('pending', []);
      await ctx.kv.set('pending', addPending(addPending(pending, rest), [{ photoId: c.photoId, idx: c.idx }], { front: true }));
    } catch (e) { console.warn('pending', e); }
    leave();
    ctx.toast(COPY.parked);
    ctx.go('home');
  }
  async function stopToday(c) {
    const { rest } = nextInQueue(flowGet().queue, c.photoId, c.idx);
    if (rest.length && ctx.kv) { try { await ctx.kv.set('pending', addPending(await ctx.kv.get('pending', []), rest)); } catch (e) { console.warn('pending', e); } }
    leave();
    ctx.go('home');
  }
  function goNext(c, next, rest) {
    flowSet({ explain: null, queue: rest });
    cur = null;
    ctx.go('confirm', { photoId: next.photoId, idx: next.idx });
  }
  function leave() {
    try { flowApi().clear(); } catch (e) { console.warn('flow', e); }
    cur = null;
  }

  // ------------------------------------------------ answering

  function destroyAnswer() {
    answerTok = null;
    if (answerCtl && typeof answerCtl.destroy === 'function') { try { answerCtl.destroy(); } catch { /* gone */ } }
    answerCtl = null;
    answerWhich = '';
  }

  function mountAnswer(host, o) {
    const tok = {};
    answerTok = tok;
    answerStart = Date.now();
    keypad.then(mod => {
      if (answerTok !== tok) return;
      if (mod && typeof mod.createAnswer === 'function') {
        try {
          // 举一反三的题自己带字母键（ui-practice.lettersFor）；别的从答案里看
          const k = Array.isArray(o.letters) ? { letters: o.letters.length ? o.letters : null, variable: o.variable || 'x' } : keysFor(o.answer, o.kind);
          answerCtl = mod.createAnswer(host, { kind: o.kind, options: o.options || [], unit: o.unit || '', placeholder: '', onSubmit: o.onSubmit, context: o.context || '',
            ...(k.letters ? { letters: k.letters } : {}), variable: k.variable });
          // 去问我之前没交的字，回来填回去
          if (o.draft && typeof answerCtl.set === 'function') { try { answerCtl.set(o.draft); } catch { /* not a line */ } }
          return;
        } catch (e) { console.warn('keypad', e); }
      }
      answerCtl = simpleAnswer(host, o);
    });
  }

  // used only when keypad.js is missing: option buttons, or one line and “好了”
  function simpleAnswer(host, o) {
    if (o.kind === 'choice' || o.kind === 'compare') {
      const opts = o.kind === 'compare' ? ['<', '=', '>'] : o.options || [];
      host.append(h('div', { className: 'ex-opts' }, opts.map(t => h('button', { type: 'button', className: 'ex-opt', on: { click: () => o.onSubmit(t) } }, mathText(t)))));
      return { destroy() {} };
    }
    if (o.kind === 'text') {
      host.append(h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: COPY.paperDone, on: { click: () => o.onSubmit({ self: true }) } })));
      return { destroy() {} };
    }
    const input = h('input', { className: 'field ex-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const send = () => { if (input.value.trim()) o.onSubmit(input.value.trim()); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    host.append(h('div', { className: 'ex-simple' }, input, o.unit ? h('span', { className: 'ex-unit', text: o.unit }) : null,
      h('button', { type: 'button', className: 'btn', text: COPY.ok, on: { click: send } })));
    return { destroy() {} };
  }

  function targetOf(c, which) {
    const d = c.st.diagnosis || {};
    if (which === 'extra') {
      const q = (c.st.extra && c.st.extra.q) || {};
      return { answer: q.answer, kind: q.input || 'expr', form: q.form || '', trap: q.trap_answer || '', options: q.options || [], unit: q.unit || '',
        letters: Array.isArray(q.letters) ? q.letters : [], variable: q.variable || 'x', q };
    }
    if (which === 'twin') {
      const t = c.st.twin || twinEnv(c) || {};
      return { answer: t.answer, kind: t.answer_kind || guessKind(t.answer) || 'expr', form: t.form || '', trap: t.trap_answer || '', options: [], unit: t.unit || '' };
    }
    return { answer: d.answer, kind: answerKind(c.st.diagnosis, c.problem), form: d.form || '', trap: '', options: c.problem.options || [], unit: d.unit || '' };
  }

  function submit(c, which, given, ms = Date.now() - answerStart) {
    if (cur !== c || c.saving) return;
    if (which === 'extra') {   // 举一反三：照复习的判法（ui-practice.judge，含坑答案）
      const e = c.st.extra;
      if (!e || !e.q || e.out || e.waiting) return;
      const selfOnly = given && typeof given === 'object' && given.self;
      const r = selfOnly ? { ok: null, reason: 'self', trap: false } : judgeQuestion(String(given ?? ''), e.q);
      if (r.ok === null) { c.selfCheck = { which, given: selfOnly ? '' : String(given ?? ''), ms }; render(true); return; }
      dispatch({ type: 'extra-answer', ok: r.ok, reason: r.reason, trap: r.trap, given: String(given ?? ''), ms });
      return;
    }
    if (which === 'orig' && !c.st.diagnosis) { c.pending = { which, given, ms }; render(true); return; }   // judged when it is back
    const self = given && typeof given === 'object' && given.self;
    const t = targetOf(c, which);
    const r = self ? { ok: null, reason: 'self', trap: false } : judge(String(given ?? ''), t);
    if (r.ok === null) { c.selfCheck = { which, given: self ? '' : String(given ?? ''), ms }; render(true); return; }
    dispatch({ type: 'answer', ok: r.ok, reason: r.reason, trap: r.trap, given: String(given ?? ''), ms });
  }

  // ------------------------------------------------ drawing

  const noteEl = n => (n && n.text ? mathText(n.text, { tag: 'p', className: `ex-note ${n.tone || 'info'}` }) : null);
  const label = text => h('p', { className: 'label ex-label', text });
  const optButtons = (options, picked, rightIdx, onPick, seed) => h('div', { className: 'ex-opts' }, optionOrder(seed).filter(i => i < options.length).map(i => {
    const t = options[i];
    const cls = ['ex-opt'];
    if (picked !== null && picked !== undefined) {
      if (i === rightIdx) cls.push('right');
      else if (i === picked) cls.push('picked');
    }
    return h('button', { type: 'button', className: cls.join(' '), disabled: picked !== null && picked !== undefined, on: { click: () => onPick(i) } }, mathText(t));
  }));
  const instr = text => h('p', { className: 'ex-instr', text });

  function workLines(c, { pickable = false, mark = -1 } = {}) {
    const st = c.st;
    return h('ol', { className: 'ex-lines' + (pickable ? ' pickable' : '') }, (c.problem.her_work || []).map((line, i) => {
      const cls = ['ex-line'];
      if (pickable && st.picked === i) cls.push('picked');
      if (i === mark) cls.push('is-wrong');
      const inner = [h('span', { className: 'ex-n', text: lineLabel(i) }), mathText(line, { className: 'ex-line-t' + (i === mark ? ' marked' : '') })];
      return h('li', null, pickable
        ? h('button', { type: 'button', className: cls.join(' '), disabled: st.picked !== null, on: { click: () => dispatch({ type: 'pick', line: i }) } }, inner)
        : h('div', { className: cls.join(' ') }, inner));
    }));
  }

  // v0.9 等讲解的时候玩一个小东西（waitfun）：这道题一张，重画时同一张挪过来，玩到一半不丢
  const funOf = c => (c.fun || (c.fun = createWaitFun(ctx)));

  function answerBox(c, which) {
    const host = h('div', { className: 'ex-answer' });
    if (c.pending) { host.append(h('p', { className: 'ex-wait', text: COPY.waitFirst }), funOf(c)); return host; }
    const sc = c.selfCheck && c.selfCheck.which === which ? c.selfCheck : null;
    const t = targetOf(c, which);
    if (sc) {
      const type = which === 'extra' ? 'extra-answer' : 'answer';
      const say = ok => { c.selfCheck = null; dispatch({ type, ok, reason: 'self', trap: false, given: sc.given, ms: sc.ms, self: true }); };
      const shownAnswer = t.q ? questionAnswer(t.q) : `${asMath(t.answer)}${t.unit ? ' ' + t.unit : ''}`;
      const steps = t.q && Array.isArray(t.q.steps) ? t.q.steps.slice(0, 5) : [];
      host.append(...[
        h('p', { className: 'ex-compare' }, COPY.compare, mathText(shownAnswer, { className: 'ex-compare-a' })),
        steps.length ? h('ol', { className: 'ex-xsteps' }, steps.map(x => h('li', null, mathText(x)))) : null,
        h('p', { className: 'ex-compare-q', text: COPY.sameQ }),
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: COPY.same, on: { click: () => say(true) } }),
          h('button', { type: 'button', className: 'btn quiet', text: COPY.notSame, on: { click: () => say(false) } })),
      ].filter(Boolean));
      return host;
    }
    const draft = c.draft && c.draft.step === c.st.step && c.draft.which === which ? c.draft.text : '';
    c.draft = null;
    answerWhich = which;
    mountAnswer(host, { kind: t.kind, options: t.options, unit: t.unit, answer: t.answer, letters: t.letters, variable: t.variable, draft, context: `${t.q || ''} ${t.answer || ''}`,
      onSubmit: given => submit(c, which, given) });
    return host;
  }

  // 21:00 以后算晚（notebook.isLate；没有它就看本地钟点）
  const lateNow = () => { try { return typeof NB.isLate === 'function' ? !!NB.isLate(new Date()) : new Date().getHours() >= 21; } catch { return false; } };
  const directKind = c => directOffer(c.st, c.st.diagnosis, c.problem, { late: lateNow() });
  // “直接讲吧”：平时是右下角的文字按钮；晚了是这一屏最上面的大按钮
  function directEl(c, kind) {
    const tap = () => dispatch({ type: 'direct' });
    if (kind === 'big') {
      return h('div', { className: 'ex-direct big' }, h('button', { type: 'button', className: 'btn btn-big', on: { click: tap } },
        h('span', { text: COPY.direct }), icon('chev')));
    }
    if (kind === 'text') {
      return h('div', { className: 'ex-direct' }, h('button', { type: 'button', className: 'text-btn accent', on: { click: tap } },
        h('span', { text: COPY.direct }), icon('chev')));
    }
    return null;
  }
  // 提示屏（第 2、3 级）都套这一层：晚上大按钮放最上面，平时文字按钮放最下面
  function withDirect(c, parts) {
    const kind = directKind(c);
    if (kind === 'big') return [directEl(c, kind), ...parts];
    if (kind === 'text') return [...parts, directEl(c, kind)];
    return parts;
  }

  function flagBtn(c, q) {
    return h('div', { className: 'ex-flag-row' }, h('button', { type: 'button', className: 'text-btn ex-flag', text: COPY.flag, on: { click: () => dispatch({ type: 'flag', q }) } }));
  }

  const HEAD_STEPS = new Set(['find', 'redo', 'fix', 'hint1', 'hint2', 'explain', 'error']);
  function renderHead(c) {
    const p = c.problem;
    if (!HEAD_STEPS.has(c.st.step)) { head.replaceChildren(); head.hidden = true; return; }
    head.hidden = false;
    const no = problemNo(p);
    const showCrop = c.showCrop ?? !!str(p.figure);
    const parts = [
      h('p', { className: 'label ex-prob-no', text: no ? `第 ${no} 题` : '这道题' }),
      p.stem ? mathText(p.stem, { tag: 'p', className: 'ex-stem' }) : null,
      (p.options || []).length ? h('ul', { className: 'ex-prob-opts' }, p.options.map(o => mathText(o, { tag: 'li' }))) : null,
    ];
    if (str(p.figure) && !(c.crop && c.crop.dataURL)) parts.push(h('p', { className: 'ex-figure', text: `图：${str(p.figure)}` }));
    if (c.crop && c.crop.dataURL) {
      parts.push(h('button', { type: 'button', className: 'text-btn ex-crop-btn', text: showCrop ? COPY.hideCrop : COPY.showCrop,
        on: { click: () => { c.showCrop = !showCrop; renderHead(c); } } }));
      if (showCrop) parts.push(h('img', { className: 'ex-crop', src: c.crop.dataURL, alt: '' }));
    }
    head.replaceChildren(...parts.filter(Boolean));
  }

  function updateStatus(c) {
    const st = c.st;
    const waiting = !st.diagnosis && !ENDED.has(st.step) && st.step !== 'error';
    if (!waiting) { status.replaceChildren(); status.hidden = true; return; }
    status.hidden = false;
    const text = c.slow ? COPY.slow : (st.picked !== null || c.pending) ? COPY.almost : COPY.looking;
    status.replaceChildren(...[
      h('span', { className: 'ex-status-t', text }),
      c.slow ? h('button', { type: 'button', className: 'text-btn', text: COPY.park, on: { click: () => parkPending(c) } }) : null,
    ].filter(Boolean));
  }

  function sigOf(c) {
    const st = c.st;
    const t = st.step === 'twin' ? twinEnv(c) : 0;
    return JSON.stringify([st.step, st.note, st.picked, st.hint1Pick, st.sentencePick, st.explainShown, st.again, st.fixTries,
      st.twinTries, st.tries, st.step === 'redo' ? answerKind(st.diagnosis, c.problem) : !!st.diagnosis, st.error, st.result,
      t === undefined ? 'loading' : t ? t.q : t, c.selfCheck, !!c.pending, !!c.saveFailed, directKind(c), st.extra || null, askable(st)]);
  }

  function render(force = false) {
    const c = cur;
    if (!c) return;
    if (!shown) { c.sig = ''; return; }   // 在问我那边：回来时 show() 整屏重画
    if (triageOn() && !c.triageParked && beyondSelfFix(c.st)) { c.triageParked = true; Promise.resolve().then(() => parkTriage(c)); return; }
    askBtn.hidden = !askable(c.st);
    const sig = sigOf(c);
    if (!force && sig === c.sig) { updateStatus(c); return; }
    c.sig = sig;
    if (c.drawnStep !== c.st.step) { c.drawnStep = c.st.step; if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0); }
    destroyAnswer();
    const no = problemNo(c.problem);
    navTitle.textContent = no ? `讲第 ${no} 题` : '讲这道题';
    renderHead(c);
    body.replaceChildren(...stepView(c).filter(Boolean));
    body.className = 'ex-body ex-' + c.st.step;
    updateStatus(c);
  }

  function stepView(c) {
    const st = c.st, d = st.diagnosis, p = c.problem;
    switch (st.step) {
      case 'find':
        return [
          h('h1', { className: 'ex-q', text: (p.mark === 'half' ? COPY.half : '') + COPY.find }),
          workLines(c, { pickable: true }),
          noteEl(st.note),
          h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn ex-none' + (st.picked === 'none' ? ' on' : ''),
            text: COPY.cantSee, disabled: st.picked !== null, on: { click: () => dispatch({ type: 'pick', line: 'none' }) } })),
          triageSkipBtn(c),
        ];
      case 'redo':
        return [
          st.note ? mathText(st.note.text, { tag: 'h1', className: 'ex-q' }) : h('h1', { className: 'ex-q', text: COPY.redo }),
          (p.her_work || []).length ? workLines(c) : str(p.her_answer) ? h('p', { className: 'ex-instr' }, COPY.herOld, mathText(asMath(p.her_answer))) : null,
          answerBox(c, 'orig'),
          triageSkipBtn(c),
        ];
      case 'fix': {
        const wl = wlOf(d, p);
        return [
          st.note ? mathText(st.note.text, { tag: 'h1', className: 'ex-q' }) : h('h1', { className: 'ex-q', text: `第 ${lineLabel(wl)} 行。${COPY.fixHere}` }),
          workLines(c, { mark: wl }),
          answerBox(c, 'orig'),
          triageSkipBtn(c),
        ];
      }
      case 'hint1': {
        if (!d) return [h('h1', { className: 'ex-q', text: COPY.looking }), skBars([88, 64]), funOf(c)];
        const h1 = d.hint1;
        const wl = wlOf(d, p);
        return withDirect(c, [
          noteEl(st.note),
          label(COPY.think),
          mathText((wl >= 0 ? `第 ${lineLabel(wl)} 行：` : '') + h1.q, { tag: 'h1', className: 'ex-q' }),
          optButtons(h1.options, st.hint1Pick, h1.answer, i => dispatch({ type: 'hint1', choice: i }), c.key + '#h1'),
        ]);
      }
      case 'hint2':
        return withDirect(c, [
          noteEl(st.note),
          mathText(d.hint2, { tag: 'p', className: 'ex-hint' }),
          instr(COPY.continueHere),
          answerBox(c, 'orig'),
        ]);
      case 'explain': return explainView(c);
      case 'sentence': {
        const se = d.self_explain;
        const out = [
          st.sentencePick === null ? noteEl(st.note) : null,
          label(isQuestion(se.q) ? COPY.think : COPY.sentenceLabel),
          mathText(st.sentencePick === null ? sentenceHead(se, st.noWork) : st.mySentence, { tag: 'h1', className: 'ex-q' }),
          optButtons(se.options, st.sentencePick, se.answer, i => dispatch({ type: 'sentence', choice: i }), c.key + '#se'),
        ];
        if (st.sentencePick !== null) {
          out.push(noteEl(st.note), h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: COPY.nextStep, on: { click: () => dispatch({ type: 'continue' }) } })));
        }
        return out;
      }
      case 'twin': {
        const t = twinEnv(c);
        if (!t) return [noteEl(st.note), h('h1', { className: 'ex-q', text: COPY.twinMaking }), skBars([80, 56])];
        return [
          noteEl(st.note),
          instr(COPY.twinLabel),
          mathText(t.q, { tag: 'h1', className: 'ex-q ex-twin-q' }),
          answerBox(c, 'twin'),
          flagBtn(c, t.q),
        ];
      }
      case 'ask':
      case 'save':
        if (c.saveFailed) {
          return [noteEl(st.note), h('h1', { className: 'ex-q', text: COPY.saveFailed }),
            h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: COPY.retry, on: { click: () => { c.saveFailed = false; render(true); saveCard(c); } } }))];
        }
        return [noteEl(st.note), h('p', { className: 'ex-wait', text: COPY.saving })];
      case 'done': return doneViewEl(c);
      case 'extra': return extraView(c);
      case 'error': {
        const code = st.error || 'http';
        const retry = canRetry(code);
        return [
          h('h1', { className: 'ex-q', text: kidMessage(code, { where: 'explain' }) || COPY.saveFailed }),
          h('div', { className: 'btn-row' },
            retry ? h('button', { type: 'button', className: 'btn', text: COPY.retry, on: { click: () => { dispatch({ type: 'retry' }); ensureDiag(c); } } }) : null,
            h('button', { type: 'button', className: retry ? 'text-btn' : 'btn', text: COPY.park, on: { click: () => parkPending(c) } })),
        ];
      }
      default: return [];
    }
  }

  function explainView(c) {
    const st = c.st, p = c.problem;
    // 订正过、直接讲：一进来就是这一屏，诊断还没回来时先说一句、放两条灰条（底下那行“我也在看这道题……”照旧）
    if (!st.diagnosis) return [h('h1', { className: 'ex-q', text: st.noWork ? COPY.noWorkWait : COPY.looking }), skBars([88, 64, 72]), funOf(c)];
    const d = st.diagnosis;
    const cv = contrast(p, d);
    // 核对没能确认（核对失败、核对的模型拿不准、文字答案比不了）：照样讲，提一句她可以说（Wei 10-25）
    // 只有极大的不确定（三家模型三个答案）才提一句学校老师；其余照常讲，不加提醒（Wei 10-25）
    const soft = d.checked === 'soft' && d.checkWhy === 'split' ? h('p', { className: 'small ex-soft', text: COPY.softSplit }) : null;
    const col = (lab, rows) => h('div', { className: 'ex-vs-col' }, h('p', { className: 'label', text: lab }),
      rows.map(r => h('p', { className: 'ex-vs-line' + (r.hi ? ' hi' : '') }, mathText(r.text, { className: r.hi ? 'marked' : '' }))));
    const steps = d.explain || [];
    const shown = Math.min(st.explainShown || 1, Math.max(1, steps.length));
    const allShown = shown >= steps.length;
    const stepList = steps.length ? h('ol', { className: 'ex-steps' }, steps.slice(0, shown).map((t, i) =>
      h('li', { className: 'ex-step' + (i === shown - 1 ? ' last' : '') }, h('span', { className: 'ex-step-n', text: String(i + 1) }), mathText(t, { className: 'ex-step-t' })))) : null;
    const out = cv.only
      // 只有正确的一栏：先一步步讲思路，全部点开以后再给完整过程
      ? [noteEl(st.note), soft, h('p', { className: 'ex-instr ex-nowork', text: COPY.noWork }), h('h2', { className: 'sec-h ex-sec', text: COPY.howTo }), stepList,
        allShown ? h('div', { className: 'ex-solo' }, h('p', { className: 'label', text: cv.rightLabel }),
          cv.right.map(r => h('p', { className: 'ex-vs-line' }, mathText(r.text)))) : null]
      : [noteEl(st.note), soft, h('h2', { className: 'sec-h ex-sec', text: COPY.keyStep }),
        h('div', { className: 'ex-vs' }, col(cv.mineLabel, cv.mine), col(cv.rightLabel, cv.right)), stepList];
    if (!allShown) {
      out.push(h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: COPY.nextStep, on: { click: () => dispatch({ type: 'next-step' }) } })));
    } else {
      if (str(d.remember)) out.push(h('div', { className: 'ex-remember' }, h('p', { className: 'label', text: COPY.remember }), mathText(d.remember, { tag: 'p', className: 'ex-remember-t' })));
      if (st.again) {
        const last = steps[steps.length - 1];
        out.push(h('div', { className: 'ex-again' },
          h('p', { className: 'ex-again-h', text: COPY.againIntro }),
          str(d.hint2) ? mathText(d.hint2, { tag: 'p', className: 'ex-hint' }) : null,
          last ? mathText(last, { tag: 'p', className: 'ex-hint' }) : null,
          h('p', { className: 'ex-again-later', text: COPY.againLater }),
          h('div', { className: 'btn-row' },
            h('button', { type: 'button', className: 'btn', text: COPY.understood, on: { click: () => dispatch({ type: 'understood' }) } }),
            h('button', { type: 'button', className: 'btn quiet', text: COPY.saveNow, on: { click: () => dispatch({ type: 'skip-twin' }) } }),
            h('button', { type: 'button', className: 'text-btn', text: COPY.askTeacher, on: { click: () => dispatch({ type: 'ask-teacher' }) } }))));
      } else {
        out.push(h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: COPY.understood, on: { click: () => dispatch({ type: 'understood' }) } }),
          h('button', { type: 'button', className: 'text-btn', text: COPY.confused, on: { click: () => dispatch({ type: 'confused' }) } })));
      }
    }
    out.push(flagBtn(c, p.stem));
    return out;
  }

  function doneViewEl(c) {
    const st = c.st;
    const v = doneView(st.result);
    const { next, rest } = nextInQueue(flowGet().queue, c.photoId, c.idx);
    const pageLeft = !next && c.photo && c.photo.page
      ? wrongProblems(c.photo.page).some(p => p.idx !== c.idx && !(c.photo.done || []).includes(p.idx)) : false;
    const stop = h('button', { type: 'button', className: 'text-btn', text: COPY.stop, on: { click: () => stopToday(c) } });
    let buttons;
    if (next && st.twinOk !== false) {
      buttons = [h('button', { type: 'button', className: 'btn', text: COPY.nextOne, on: { click: () => goNext(c, next, rest) } }), stop];
    } else if (next) {
      buttons = [h('button', { type: 'button', className: 'btn', text: COPY.stop, on: { click: () => stopToday(c) } }),
        h('button', { type: 'button', className: 'text-btn', text: COPY.nextOne, on: { click: () => goNext(c, next, rest) } })];
    } else if (pageLeft) {
      buttons = [h('button', { type: 'button', className: 'btn', text: COPY.backToPage, on: { click: () => { flowSet({ explain: null }); cur = null; ctx.go('page', { photoId: c.photoId }); } } }), stop];
    } else {
      buttons = [h('button', { type: 'button', className: 'btn', text: COPY.stop, on: { click: () => stopToday(c) } })];
    }
    // v0.3：讲完还有不明白的，接着问老师（chat problem 模式带上这道题和诊断：同坑合并时卡上存的是第一道题，所以直接传刚讲的这道）。
    // 诊断拿不准、她说“这题有问题”的不接（CONTRACTS 9）。v0.6.0：和讲题中途问的是同一段对话（askChat，chatId）
    const r = st.result || {};
    // v0.7 讲给我听：她当小老师，用自己的话讲一遍关键那一步（老师先开口，另开一段）
    const askMe = st.cardId && r.ask !== 'unsure' && r.ask !== 'flagged'
      ? h('div', { className: 'ex-askme' },
        h('button', { type: 'button', className: 'text-btn accent', on: { click: () => askChat(c) } }, icon('chat'), h('span', { text: COPY.askMe })),
        !r.ask ? h('button', { type: 'button', className: 'text-btn accent', on: { click: () => teachBack(c) } }, teacherAvatar('sm'), h('span', { text: COPY.teachBack })) : null)
      : null;
    // v0.6.0：举一反三，再来一道（做满 3 道就不出了）；做过的说一句
    const sum = extraSummary(st.extra);
    const more = extraOffer(st)
      ? h('div', { className: 'btn-row ex-extra-row' }, h('button', { type: 'button', className: 'btn quiet', text: COPY.extra, on: { click: () => dispatch({ type: 'extra-start' }) } }))
      : null;
    return [
      noteEl(st.note),
      h('div', { className: 'ex-done reveal' },
        h('h1', { className: 'ex-done-title', text: v.title }),
        v.lines.map(t => h('p', { className: 'ex-done-line', text: t }))),
      sum ? h('p', { className: 'ex-extra-sum', text: sum }) : null,
      triageOn() ? h('p', { className: 'small ex-triage', text: next ? progressLine(flowGet().triage, rest.length) : finishLine(flowGet().triage) }) : null,
      more,
      h('div', { className: 'btn-row' }, buttons),
      askMe,
    ];
  }

  // 举一反三的一道题：题目、题下面的提示、小键盘；做完了是一句话（没做对的给答案和过程），再问“再来一道”还是“够了”
  function extraView(c) {
    const e = c.st.extra || {};
    const no = Math.max(1, (Number(e.count) || 0) + (e.out ? 0 : 1));
    const top = label(`${COPY.extraLabel}　第 ${no} 道`);
    const enough = text => h('button', { type: 'button', className: 'text-btn', text, on: { click: () => dispatch({ type: 'extra-end' }) } });
    if (!e.q) return [top, h('h1', { className: 'ex-q', text: COPY.extraMaking }), skBars([80, 56]), h('div', { className: 'btn-row' }, enough(COPY.extraEnough))];
    const q = e.q;
    const out = [top, mathText(q.q, { tag: 'h1', className: 'ex-q ex-twin-q' })];
    if ((e.notes || []).length) {
      out.push(h('ol', { className: 'ex-xhints' }, e.notes.map(n => h('li', { className: 'ex-xhint' + (n.trap ? ' trap' : '') }, mathText(n.text)))));
    }
    if (!e.out) {
      if (e.waiting) out.push(h('p', { className: 'ex-wait', text: COPY.extraThinking }));
      else {
        if (e.say) out.push(h('p', { className: 'ex-instr', text: e.say }));
        out.push(answerBox(c, 'extra'));
      }
      out.push(h('div', { className: 'ex-flag-row' }, h('button', { type: 'button', className: 'text-btn ex-flag', text: COPY.flag, on: { click: () => dispatch({ type: 'extra-flag' }) } })));
      return out;
    }
    const o = e.out;
    if (o.flagged) out.push(noteEl(note('info', COPY.flaggedTwin)));
    else if (o.ok) out.push(noteEl(note('ok', o.self ? COPY.extraSelfOk : o.line || COPY.right)));
    else {
      out.push(noteEl(o.self ? note('info', COPY.extraSelfNo) : note(o.trapNow ? 'trap' : 'info', (o.trapNow ? COPY.extraTrap : '') + COPY.extraSeeAnswer)));
      const steps = Array.isArray(q.steps) ? q.steps.slice(0, 5) : [];
      out.push(h('div', { className: 'ex-key' }, h('p', { className: 'label', text: COPY.extraKey }), mathText(questionAnswer(q), { tag: 'p', className: 'ex-key-a' }),
        steps.length ? h('ol', { className: 'ex-xsteps' }, steps.map(x => h('li', null, mathText(x)))) : null));
    }
    if ((Number(e.count) || 0) < EXTRA_MAX) {
      out.push(h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: COPY.extraMore, on: { click: () => dispatch({ type: 'extra-more' }) } }), enough(COPY.extraEnough)));
    } else {   // 第 3 道做完：今天就到这儿，隔几天再考记得更牢
      out.push(h('p', { className: 'ex-extra-full', text: COPY.extraFull }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: COPY.extraBack, on: { click: () => dispatch({ type: 'extra-end' }) } })));
    }
    return out;
  }

  function renderMissing() {
    destroyAnswer();
    askBtn.hidden = true;
    head.replaceChildren(); head.hidden = true;
    status.replaceChildren(); status.hidden = true;
    navTitle.textContent = '讲这道题';
    body.className = 'ex-body ex-missing';
    body.replaceChildren(h('h1', { className: 'ex-q', text: COPY.missing }),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: COPY.home, on: { click: () => ctx.go('home') } })));
  }

  // ------------------------------------------------ the view object

  async function show(params = {}) {
    shown = true;
    const f = flowGet();
    const photoId = str(params.photoId ?? f.photoId);
    const idx = Number(params.idx ?? f.idx ?? 0) || 0;
    const key = keyOf(photoId, idx);
    const token = ++epoch;
    const fromFlow = problemFromFlow(f, photoId, idx);
    // she went back to screen 5 and changed the problem: what was worked out for the old one does not count
    const changed = st => !!(fromFlow && st && st.step !== 'done' && st.step !== 'extra' && st.psig && st.psig !== problemSig(fromFlow));
    if (cur && (cur.key !== key || changed(cur.st))) { clearTimeout(cur.slowTimer); if (cur.key === key) inflight.delete(key); cur = null; }
    if (!cur) {
      let problem = fromFlow;
      const photo = await getPhoto(photoId);
      if (token !== epoch) return;
      if (!problem && photo && photo.page) problem = (photo.page.problems || [])[idx] || null;
      let saved = f.explain && f.explain.key === key ? f.explain : null;
      if (saved && changed(saved)) { saved = null; inflight.delete(key); }
      if (!problem && saved && saved.problem) problem = saved.problem;
      if (!problem) { renderMissing(); return; }
      // 订正过、选了直接讲的那一下只在确认屏的 flow 里；flow 里的题没了、从照片里取题时别把它丢了
      if (saved && saved.noWork && !noWorkOf(problem)) problem = { ...problem, useWork: false };
      const st = saved ? { ...initState({ photoId, idx, problem }), ...saved } : initState({ photoId, idx, problem });
      cur = { key, photoId, idx, problem, photo, st, sig: '' };
    }
    const c = cur;
    render(true);
    ensureCrop(c);
    if (c.st.step === 'done') return;
    if (c.st.step === 'extra') { ensureExtra(c); return; }   // 举一反三：从问我回来，或者重新打开后接着出题、要提示
    if ((c.st.step === 'save' || c.st.step === 'ask') && !c.saving) { saveCard(c); return; }
    if (c.st.step !== 'error') ensureDiag(c);
  }

  // 去问我（或者别的界面）：小键盘里打了没交的字记在 cur 上，回到同一屏、同一个输入框时填回去
  function hide() {
    shown = false;
    if (cur && answerCtl && answerWhich && typeof answerCtl.value === 'function') {
      try { const t = str(answerCtl.value()); cur.draft = t ? { step: cur.st.step, which: answerWhich, text: t } : null; } catch { /* gone */ }
    }
    destroyAnswer();
    if (cur) cur.sig = '';   // draw again from scratch next time (the keypad was taken down)
  }

  return { show, hide, onResume() { if (cur) updateStatus(cur); } };
}
