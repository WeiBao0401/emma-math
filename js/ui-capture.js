// 拍错题到核对题目：第 1 到 5 屏（CONTRACTS 第 11 节的路由 capture、page、confirm；设计 C 3.1 到 3.3）。
// 负责：拍照确认 agent（ui-capture.js、css/capture.css、image.js 的 mask、tests/ui-capture.test.mjs）。
//
// 导出（界面，各画进 index.html 的 <section id="view-<路由>">）
//   createCapture(ctx) -> { show(params), hide() }            路由 'capture'，#view-capture，屏 1 到 3
//     屏 1 拍照：“拍一张”（相机）、“从相册选”；模拟模式多一个“用示例照片”（画一张假作业，不用真照片也能走完）。
//          照片用 image.prepare 摆正、缩到长边 1600；打不开按 photoErrorText 给一句孩子话。
//     屏 2 遮名字：照片铺满，黑条默认盖顶部 12%，拖中间上下移，拖上下边拉高拉低；↻ 转 90 度；来源一行小按钮。
//          每种来源记住上次黑条的位置（kv 'capture'）。“盖好了，给老师看”：image.mask 从原始照片一次画出转好、涂黑的
//          JPEG，黑条画死在像素里。发出去的、存下来的都是这一张；没涂黑的原图只在内存里，涂完马上丢掉。
//     屏 3 等识别：ctx.pipeline.readPhoto，8 到 12 秒。等的时候请她想“最想弄懂哪道”，轮换拍照小贴士，一条细进度线。
//          失败：kidMessage(err, { where: 'photo' })，能重试的给“再试一次”（不用重拍，涂黑的照片还在内存里）。
//          成功：没认出题或全看不清 → 请她靠近重拍；没批改 → 拦下（这两种照片都不存）；
//          否则 rotation 不为 0 先 image.rotate 转正，存 photos（CONTRACTS 12，另存 turned: true），go('page', { photoId })。
//     params { retake: true, photoId, idx }：屏 5 的“重拍这道”。认出来的内容并进原来那一题（mergeRetake），
//          近照存成 photo.recrops[idx]（dataURL），然后 go('confirm', { photoId, idx })。
//   createPage(ctx) -> { show({ photoId }), hide() }           路由 'page'，#view-page，屏 4 这页的题
//     每道题：题号、批改、按 pipeline.boxToRect 裁的小截图；默认勾打叉和半对的。讲过的（items 里有这页这题的卡）、
//     问老师的不能再勾。今天的名额（kv 'quota'，上学日 2 道、周末 5 道）不够时，前几道今天讲，其余标“待讲”，
//     “先讲这道”把一道提到最前。“开始讲第 X 题”：其余勾上的进 kv 'pending'，flow.queue 记下今天还要讲的，去 confirm。
//     订正过的题（识别的 corrected，或她在屏 5 选了“我已经订正过了”）题号后面一个小标“订正过”（showCorrected）。
//   createConfirm(ctx) -> { show({ photoId, idx }), hide() }  路由 'confirm'，#view-confirm，屏 5 我看到的题对吗
//     题目、她写的每一行、她的答案、老师批改（错 / 半对 / 对，可改）、老师写的字；带 [?] 的黄底。点哪一行改哪一行：
//     答案用 keypad.js 的 createAnswer（kind 'expr'，没有 keypad.js 或答案里有中文时用普通输入框），其余用输入框。
//     “对，就是这样”：先 doubtCheck（程序算出的答案等于她的答案、老师却批错），是就问“是我看错了你的字，还是老师批错了？”，
//     选“我觉得我是对的”建一张 status 'ask' 的卡（askCard）进问老师，回这页。否则把确认后的题写进 flow，
//     **立刻**调 ctx.pipeline.diagnose(problem, 这道题的截图) 并把 promise 放进 flow.diagnosing，go('explain', { photoId, idx })。
//     v0.6.0 两选一（她写了过程才出，askUseWork）：“按我原来写的找错”和“我已经订正过了，直接讲正确思路”。识别出 corrected
//     默认第二个，上面说一句“我看到这道题你已经订正过了。”；否则默认第一个。选的写进 problem.useWork（true / false），
//     随 flow.problem 到讲题屏（pipeline.diagnose 看它），也跟着存进卡。选“直接讲”时过程和答案折成一行、变淡，不再一行行核对，
//     也不问“是我看错了还是学校老师批错了”（订正后的答案本来就该是对的）。
//   createCaptureScreens(ctx) -> { capture, page, confirm }   三个一起建
//
// flow（ctx.flow，CONTRACTS 10）里这几屏写的字段
//   page 屏：{ stage: 'page', photoId, queue: [idx] }       queue：今天勾了、还没讲的题，讲完一道回这页时接着勾上
//   confirm 屏：{ stage: 'explain', photoId, idx, problem, source, crop（长边 1200 的 dataURL）, thumb（长边 320，稍后补上）,
//               diagnosing（Promise<Diagnosis>，只在内存）, diagnosis（回来后补上）, diagnoseError（失败时的 code）, startedAt }
// kv：'capture' { source, bands: { 来源: { y, h } } }、'pending' [{ photoId, idx, at }]、'quota' { day, used }（这里只读）
// photos 记录比 CONTRACTS 12 多三个字段：turned（存的图已经转正，boxToRect 照样用 page.rotation）、recrops { idx: dataURL }、
//   page.problems[i] 上的 confirmed（她点过“对”）和 edits [{ field, from, to, at }]（改过的字，用来校识别），
//   useWork（她在屏 5 点过两选一才有；确认时 confirmedProblem 一定写成 true / false）
//
// 导出（纯函数，node 能测）：见下面“纯函数”一节每个函数前的注释。COPY 是孩子看到的全部文字（测试查禁用词）。
//
// 为什么这样做
// - 名字要在发出去之前从像素里消失（调研 04 发现 29），所以先遮再识别，遮的是原图一次画出来的 JPEG，不是盖一层 CSS。
// - 识别会把 1 认成 7、把半对认成错（bakeoff），第 5 屏不能跳；程序能算的题先算一遍，防止把老师批错的题当错题讲。
// - 等识别的 10 秒让她先想“最想弄懂哪道”，等会儿第 4 屏她就知道挑哪道（设计 C 3.1）。
// - 名额只挡“需要讲解的新题”，挡下来的进待讲，不丢。
import { h, icon, mathText, skBars } from './ui-dom.js';
import { plain } from './mathview.js';
import { prepare, rotate as rotateImg, crop as cropImg, mask as maskImg } from './image.js';
import { createPipeline, boxToRect, wrongProblems } from './pipeline.js';
import { compute, check } from './mathcheck.js';
import { newCard, dayOf } from './notebook.js';
import { kidMessage, canRetry } from './kid-errors.js';
import { newId } from './db.js';

// ---------------------------------------------------------------- 常量和文字

export const SOURCES = ['作业本', '练习册', '单元测', '试卷', '其他'];
export const DEFAULT_BAND = Object.freeze({ y: 0, h: 0.12 });   // 作业本和卷子的名字多在顶上（设计 C 3.2）
export const BAND_MIN = 0.04, BAND_MAX = 0.6;
export const KV_CAPTURE = 'capture', KV_PENDING = 'pending', KV_QUOTA = 'quota';
export const READ_EXPECT_MS = 11000;   // 看照片一般 8 到 12 秒（bakeoff）
export const READ_SLOW_MS = 20000;     // 超过这个说一句“网有点慢”

// 孩子看到的字：中文，弯引号，不用破折号和感叹号，句子短；App 自称“我”，真老师一律叫“学校老师”（v0.3.1，DESIGN 第 2 节）。
export const COPY = {
  startTitle: '拍错题',
  startLede: '拍学校老师批改过的那一页。我只讲学校老师批改过的错题。',
  retakeTitle: '重拍这一道',
  retakeLede: '离近一点，让这道题占满屏幕。旁边没有名字的话，黑条拖到空白的地方就行。',
  tips: ['纸铺平，iPad 正对着纸。', '光线亮一点，别让影子挡住字。', '一次拍一页，整页都拍进来。'],
  shoot: '拍一张',
  album: '从相册选',
  sample: '用示例照片',
  mockNote: '模拟模式：照片不发出去，看到的结果是练习用的。',
  preparing: '正在整理照片…',
  maskTitle: '遮住名字',
  maskAsk: '名字、学校、班级都在黑条下面了吗？',
  maskWhy: '黑条盖住的地方不会发出去。',
  maskHow: '拖黑条中间可以上下移，拖上下两条边可以拉高拉低。',
  bandLabel: '黑条',
  sourceLabel: '这是',
  maskGo: '盖好了，给我看',
  retakeShort: '重拍',
  rotate: '转一下',
  readTitle: '我在看这一页',
  readTime: '大约 10 秒。',
  readSlow: '网有点慢，再等一会儿。',
  readAsk: '趁这会儿想一想：学校老师批过的那几道，你最想弄懂哪道？等会儿先讲它。',
  tipLabel: '拍照小贴士',
  waitTips: ['纸铺平，iPad 正对着纸，字就不会斜。', '光从侧面来，影子就不会挡住字。', '离近一点，让题目占满屏幕。', '一页拍一张就够，不用连拍。'],
  stopWaiting: '不等了',
  readFailTitle: '这次没看成',
  retry: '再试一次',
  retakeAll: '重拍',
  home: '回首页',
  homeBack: '首页',
  unclearTitle: '这张有点看不清',
  unclear: '纸铺平、iPad 正对、别挡光，靠近一点再拍一次。',
  ungradedTitle: '这页学校老师还没批改',
  ungraded: '做完、学校老师批过之后再拍，我们一起看错在哪。',
  shootAgain: '再拍一张',
  otherPage: '拍另一页',
  saving: '正在存…',
  saveFail: '没存上，再试一次。',
  pageTitle: '这一页的题',
  pageSub: src => `${src || '这一页'} · 学校老师批过了`,
  personal: '照片里好像还有名字，下次黑条拉低一点。',
  missed: '学校老师批的错题漏勾了？点一下就勾上。',
  noWrong: '这一页没有打叉的题。漏勾的错题，点一下就勾上。',
  left: n => `今天还能讲 ${n} 道。`,
  noneLeft: '今天的新题讲够了。勾上的题放进待讲，明天接着讲。',
  overQuota: (n, m) => `今天讲 ${n} 道，你挑最想弄懂的。其余 ${m} 道放进待讲，以后每天接着讲。`,
  promote: '先讲这道',
  start: label => `开始讲${label}`,
  pickSome: '勾上要讲的题',
  later: '先放进待讲',
  allLater: '放进待讲',
  laterDone: '放进待讲了，以后接着讲。',
  allDone: '这一页的错题都看过了。',
  photoGone: '这一页找不到了，再拍一次吧。',
  st: { card: '讲过了', ask: '问学校老师', pending: '在待讲里', today: '今天讲', later: '待讲' },
  marks: { wrong: '错', half: '半对', right: '对', none: '没批' },
  confirmTitle: label => `我看到的${label}是这样，对吗？`,
  backShort: '返回',
  noStem: '（没看清，点一下补上）',
  stem: '题目',
  options: '选项',
  figure: '图',
  work: '你写的',
  noWork: '（没写过程）',
  answer: '你的答案',
  noAnswer: '（没写）',
  mark: '学校老师批的',
  note: '学校老师写的',
  nowMark: m => `现在选的：${m}`,
  pickMark: '学校老师批的是哪种？先选一个。',
  unclearHint: '黄底的字我没看清，点一下就能改。',
  editHint: '点你想改的那一行。',
  finishEdit: '先点“好了”，改的字才算数。',
  yes: '对，就是这样',
  editLine: '改一行',
  retakeOne: '重拍这道',
  rightSkip: '学校老师批的是对，这道不用讲',
  rightSaved: '好，这道不用讲。',
  doubtQ: '你写的和我算的一样。是我看错了你的字，还是学校老师批错了？',
  doubtMine: '我写的不是这个',
  doubtRight: '我觉得我是对的',
  askSaved: '记下来了，问问学校老师。',
  askNote: '你写的和我算的一样，学校老师批的是错。问问学校老师。',
  done: '好了',
  cancel: '取消',
  typeText: '用键盘打字',
  // 订正过的题（v0.6.0，Emma 10-25 的反馈）：讲题参不参考她写的过程
  correctedTag: '订正过',
  correctedSeen: '我看到这道题你已经订正过了。',
  useWorkQ: '这道题怎么讲？',
  useWorkYes: '按我原来写的找错',
  useWorkNo: '我已经订正过了，直接讲正确思路',
  folded: '订正过的过程，这次不看。',
  peek: '看一眼',
  unpeek: '收起',
  answerPh: '你的答案',
  linePh: '这一行写的是',
  photoFail: {
    format: '这张照片的格式打不开。从“照片”里再选一次，或者直接拍一张。',
    pdf: '这是一个文件，不是照片。直接拍一张吧。',
    memory: '照片太大，没处理好。关掉别的 App，再试一次。',
    other: '这张照片打不开。换一张，或者再拍一张。',
  },
};

// ---------------------------------------------------------------- 纯函数

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r4 = v => Math.round(v * 10000) / 10000;
const num = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

// 黑条 { y, h }：0 到 1 的比例，横贯整张照片。高度在 BAND_MIN 到 BAND_MAX 之间，不出照片
export function clampBand(b) {
  const hh = clamp(num(b && b.h, DEFAULT_BAND.h), BAND_MIN, BAND_MAX);
  const y = clamp(num(b && b.y, DEFAULT_BAND.y), 0, 1 - hh);
  return { y: r4(y), h: r4(hh) };
}
// 拖中间：整条上下移，碰到边就停
export function moveBand(b, dy) {
  const c = clampBand(b);
  return clampBand({ y: c.y + num(dy, 0), h: c.h });
}
// 拖上边或下边：另一条边不动
export function resizeBand(b, edge, dy) {
  const c = clampBand(b);
  const d = num(dy, 0);
  if (edge === 'top') {
    const bottom = c.y + c.h;
    let y = clamp(c.y + d, Math.max(0, bottom - BAND_MAX), bottom - BAND_MIN);
    return clampBand({ y, h: bottom - y });
  }
  return clampBand({ y: c.y, h: clamp(c.h + d, BAND_MIN, Math.min(BAND_MAX, 1 - c.y)) });
}
// image.mask 用的框
export const bandRect = b => { const c = clampBand(b); return { x: 0, y: c.y, w: 1, h: c.h }; };
// kv 'capture'：每种来源上次的黑条
export function bandFor(saved, source) {
  const b = saved && saved.bands && saved.bands[source];
  return b ? clampBand(b) : { ...DEFAULT_BAND };
}
export function rememberBand(saved, source, band) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return { ...s, source, bands: { ...(s.bands || {}), [source]: clampBand(band) } };
}
export const sourceOf = saved => (saved && SOURCES.includes(saved.source) ? saved.source : SOURCES[0]);

// 今天的新讲名额（CONTRACTS 12、设计 C 4.4）：上学日 2 道，周末 5 道。day 是 'YYYY-MM-DD'
export function dailyLimit(day) {
  const [y, m, d] = String(day || '').split('-').map(Number);
  const wd = new Date(y, (m || 1) - 1, d || 1).getDay();
  return wd === 0 || wd === 6 ? 5 : 2;
}
const usedOn = (quota, day) => (quota && quota.day === day ? Math.max(0, Math.floor(num(quota.used, 0))) : 0);
export const quotaLeft = (quota, day) => Math.max(0, dailyLimit(day) - usedOn(quota, day));
// 讲完一道需要讲解的新题时调（ui-explain）：返回新的 kv 'quota'。自己改对的不调
export const useQuota = (quota, day, n = 1) => ({ day, used: usedOn(quota, day) + n });

// 识别结果能不能往下走：'empty' 一道题也没认出 | 'unclear' 每道都有看不清的 | 'ungraded' 没批改 | 'ok'
export function pageVerdict(page) {
  const ps = page && Array.isArray(page.problems) ? page.problems : [];
  if (!ps.length) return 'empty';
  if (ps.every(p => p && p.unclear)) return 'unclear';
  if (!page.graded) return 'ungraded';
  return 'ok';
}

const normNo = s => String(s ?? '').replace(/[()（）.、．\s第题]/g, '');
// “第 5 题”；没有题号的用第几道
export function numberLabel(p) {
  const n = normNo(p && p.no);
  if (n) return `第 ${n} 题`;
  return Number.isInteger(p && p.idx) ? `第 ${p.idx + 1} 道` : '这道题';
}
// “错”“半对（-2）”“对”“没批”：半对且老师只写了扣几分时带上
export function markLabel(p) {
  const base = COPY.marks[p && p.mark] || COPY.marks.none;
  const note = String((p && p.teacher_note) || '').split('\n')[0].trim();
  if (p && p.mark === 'half' && /^[-−]\s*\d+(\.\d+)?\s*分?$/.test(note)) return `${base}（${note.replace('−', '-').replace(/\s+/g, '')}）`;
  return base;
}
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const circled = i => CIRCLED[i] || `(${i + 1})`;
export const hasUnclear = s => /\[\?\]/.test(String(s ?? ''));

// 这页哪些题已经有了着落：{ idx: 'card' | 'ask' }，看 items 里这张照片的卡（卡的 problem.idx，同坑合并挂上的 originals），
// 再加上 photo.done（ui-explain 收进本子后在照片上记的 [idx]）
export function handledMap(items, photoId, done = []) {
  const m = {};
  const idxOf = o => (o && Number.isInteger(o.idx) ? o.idx : o && o.problem && Number.isInteger(o.problem.idx) ? o.problem.idx : null);
  for (const c of Array.isArray(items) ? items : []) {
    if (!c) continue;
    if (c.photoId === photoId) {
      const i = idxOf(c.problem) ?? (Number.isInteger(c.idx) ? c.idx : null);
      if (i !== null) m[i] = c.status === 'ask' ? 'ask' : 'card';
    }
    for (const o of Array.isArray(c.originals) ? c.originals : []) {
      if (o && o.photoId === photoId && idxOf(o) !== null && !m[idxOf(o)]) m[idxOf(o)] = 'card';
    }
  }
  for (const i of Array.isArray(done) ? done : []) if (Number.isInteger(i) && !m[i]) m[i] = 'card';
  return m;
}

// 第 4 屏默认勾哪些（按顺序）：从这页回来时接着 flow.queue；否则打叉、半对、还没着落、不在待讲里的
export function defaultPicks(page, { handled = {}, pending = new Set(), queue = null } = {}) {
  const ps = page && Array.isArray(page.problems) ? page.problems : [];
  const has = i => ps.some(p => p.idx === i);
  if (Array.isArray(queue) && queue.length) {
    const q = queue.filter((i, k) => has(i) && !handled[i] && queue.indexOf(i) === k);
    if (q.length) return q;
  }
  return ps.filter(p => (p.mark === 'wrong' || p.mark === 'half') && !handled[p.idx] && !pending.has(p.idx)).map(p => p.idx);
}
export const togglePick = (order, idx) => (order.includes(idx) ? order.filter(i => i !== idx) : [...order, idx]);
export const promotePick = (order, idx) => [idx, ...order.filter(i => i !== idx)];
export function splitPicks(order, left) {
  const n = Math.max(0, Math.floor(num(left, 0)));
  return { today: order.slice(0, n), later: order.slice(n) };
}

// kv 'pending'（待讲）：[{ photoId, idx, at }]，同一道题只有一条；按给的顺序排在后面（at 依次加 1 毫秒）
export function addPending(list, entries, now = Date.now()) {
  const out = (Array.isArray(list) ? list : []).filter(e => e && e.photoId);
  let k = 0;
  for (const e of entries || []) {
    if (!e || !e.photoId || !Number.isInteger(e.idx)) continue;
    if (out.some(x => x.photoId === e.photoId && x.idx === e.idx)) continue;
    out.push({ photoId: e.photoId, idx: e.idx, at: new Date(now + k++).toISOString() });
  }
  return out;
}
export const dropPending = (list, photoId, idx) => (Array.isArray(list) ? list : []).filter(e => !(e && e.photoId === photoId && e.idx === idx));
export const pendingFor = (list, photoId) => new Set((Array.isArray(list) ? list : []).filter(e => e && e.photoId === photoId).map(e => e.idx));

// 屏 5 的两选一（v0.6.0）：“按我原来写的找错”还是“我已经订正过了，直接讲正确思路”。卷子订正过以后再拍，
// 照片上是改过的步骤，不是她当时的想法；照着它找错会讲偏（Emma 10-25 的反馈）。
// 问不问：她写了过程才问；订正过、只写了答案的也问（改过的答案同样不是当时的）；学校老师批了对的不问
const filled = s => String(s ?? '').trim() !== '';
export const askUseWork = p => !!p && p.mark !== 'right'
  && ((Array.isArray(p.her_work) && p.her_work.some(filled)) || (!!p.corrected && filled(p.her_answer)));
// 选的是哪个（problem.useWork）：她点过的照旧；没点过时识别出订正过（corrected）默认“直接讲”，否则“按原来写的找错”。不问的题都是 true
export function useWorkOf(p) {
  if (!askUseWork(p)) return true;
  return typeof p.useWork === 'boolean' ? p.useWork : !p.corrected;
}
// 第 4 屏题号后面的小标“订正过”：识别出订正过，或她在第 5 屏选了“我已经订正过了”
export const showCorrected = p => !!p && (!!p.corrected || p.useWork === false);

// 程序先算（设计 C 3.2 第 5 屏）：老师批“错”，程序算出的答案却和她的一样，就要先问她。
// 选了“直接讲正确思路”的不问：订正后的答案本来就该是对的
export function doubtCheck(p) {
  const none = { same: false, computed: null };
  if (!p || p.mark !== 'wrong' || !useWorkOf(p)) return none;
  const ans = String(p.her_answer || '').trim();
  if (!ans || hasUnclear(ans) || hasUnclear(p.stem)) return none;
  let c = null;
  try { c = compute(p.stem); } catch { c = null; }
  if (!c) return none;
  let r = null;
  try { r = check(ans, c.answer, { kind: c.kind }); } catch { r = null; }
  return { same: !!(r && r.ok === true), computed: c };
}

// 输入框里显示的字：公式换成能读能改的样子（−3²、(x−1)/2）
export const editableText = s => plain(String(s ?? ''));
// 小键盘里显示的答案：keypad.js 输入行的写法（-3^2、分数写成 (x-1)/(2)），小键盘能接着改
const wrapPart = x => { const t = x.trim(); return /^[\w.]+$/.test(t) ? t : `(${t})`; };
export function asciiMath(s) {
  let t = String(s ?? '').replace(/\\\(|\\\)|\\\[|\\\]|\$/g, '');
  for (let k = 0; k < 4; k++) t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => `(${a.trim()})/(${b.trim()})`);
  t = t.replace(/\^\{([^{}]*)\}/g, (_, e) => '^' + wrapPart(e));
  t = t.replace(/\\text\s*\{([^{}]*)\}/g, '$1').replace(/\\times/g, '×').replace(/\\div/g, '÷').replace(/\\cdot/g, '·')
    .replace(/\\pm/g, '±').replace(/\\circ|\\degree/g, '°').replace(/\\left|\\right/g, '').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '');
  return t.replace(/\s+/g, ' ').trim();
}
// 答案适合用小键盘改吗：有中文（“共分 8 组”）、是应用题或几何题时用普通输入框
export const answerKeypadOK = p => !/[一-鿿]/.test(String((p && p.her_answer) || '')) && !/应用|几何|证明|说理/.test(String((p && p.type) || ''));

// 屏 5“重拍这道”：近照里认出来的那一道（同题号优先，其次第一道错题，再其次第一道）
export function pickProblem(page, no) {
  const ps = page && Array.isArray(page.problems) ? page.problems : [];
  const n = normNo(no);
  return (n && ps.find(p => normNo(p.no) === n)) || ps.find(p => p.mark === 'wrong' || p.mark === 'half') || ps[0] || null;
}
// 近照认出的内容并进原来那一题：题号、位置框、序号不变；认出来是空的字段保留原来的；新照片没批改时保留原批改
export function mergeRetake(old, fresh) {
  const o = old || {};
  if (!fresh) return { ...o };
  const pick = (a, b) => (b !== undefined && b !== null && String(b).trim() ? b : a);
  return {
    ...o,
    type: pick(o.type, fresh.type), stem: pick(o.stem, fresh.stem), figure: pick(o.figure, fresh.figure),
    options: Array.isArray(fresh.options) && fresh.options.length ? [...fresh.options] : o.options || [],
    her_work: Array.isArray(fresh.her_work) && fresh.her_work.length ? [...fresh.her_work] : o.her_work || [],
    her_answer: pick(o.her_answer, fresh.her_answer),
    mark: fresh.mark === 'wrong' || fresh.mark === 'half' || fresh.mark === 'right' ? fresh.mark : o.mark,
    teacher_note: pick(o.teacher_note, fresh.teacher_note), circled: pick(o.circled, fresh.circled),
    unclear: !!fresh.unclear, corrected: typeof fresh.corrected === 'boolean' ? fresh.corrected : !!o.corrected, retaken: true,
  };
}

// 交给 diagnose 和 flow 的那一份：她核对过，所以 unclear 去掉；useWork 定下来（true / false），随 flow 到讲题屏、存进卡
export function confirmedProblem(p) {
  const q = JSON.parse(JSON.stringify(p || {}));
  q.unclear = [q.stem, q.her_answer, q.teacher_note, ...(q.her_work || [])].some(hasUnclear);
  q.confirmed = true;
  q.useWork = useWorkOf(q);
  return q;
}

// 她点“我觉得我是对的”：一张 status 'ask' 的卡（notebook.newCard，诊断 checked 'unsure'），进问老师，不讲、不排复习
export function askCard({ id, problem, photoId, crop = '', thumb = '', source = '', today = dayOf(), at = new Date().toISOString(), computed = null }) {
  const card = newCard({ id, problem, diagnosis: { checked: 'unsure', answer: '', other: computed ? computed.answer : '' }, photoId, crop, today, at });
  return { ...card, thumb, source, found: '', originals: [], flagged: [],
    askTeacher: { reason: 'maybe-right', day: today, note: COPY.askNote, computed: computed ? computed.answer : '' } };
}

// 等识别的进度线：先快后慢，最多走到 92%，回来了才走满（不假装知道还剩几秒）
export const progressAt = (ms, expect = READ_EXPECT_MS) => Math.min(0.92, 1 - Math.exp(-Math.max(0, num(ms, 0)) / (expect / 2)));

// 照片打不开时给她的一句（image.js 的 ImageError：format、stage）
export function photoErrorText(e) {
  const f = e && e.format, st = e && e.stage;
  if (f === 'heic' || f === 'avif') return COPY.photoFail.format;
  if (f === 'pdf') return COPY.photoFail.pdf;
  if (st === 'canvas' || st === 'encode') return COPY.photoFail.memory;
  return COPY.photoFail.other;
}

// 这张照片的第 idx 题
export function problemOf(photo, idx) {
  const ps = photo && photo.page && Array.isArray(photo.page.problems) ? photo.page.problems : [];
  return ps.find(p => p && p.idx === idx) || null;
}
// 裁一道题用的框和转向：存的图转正过（turned）就不用再转；没转正就让 crop 一起转
export function cropPlan(photo, idx) {
  const p = problemOf(photo, idx);
  const rot = (photo && photo.page && photo.page.rotation) || 0;
  const rect = p && p.box ? boxToRect(p.box, rot) : null;
  return { rect, turns: photo && photo.turned ? 0 : rot / 90 };
}

// ---------------------------------------------------------------- 和 ctx 打交道的小工具

const isMock = ctx => !!((ctx.mockForced && ctx.mockForced()) || (ctx.settings && (ctx.settings() || {}).mock));
const todayOf = ctx => (typeof ctx.today === 'function' ? ctx.today() : dayOf());
const say = (ctx, msg, ms) => { if (ctx.toast) ctx.toast(msg, ms); };
const kvPeek = (ctx, key, d) => { try { return ctx.kv && ctx.kv.peek ? ctx.kv.peek(key, d) : d; } catch { return d; } };
async function kvGet(ctx, key, d) {
  try { return ctx.kv && ctx.kv.get ? await ctx.kv.get(key, d) : kvPeek(ctx, key, d); } catch { return d; }
}
async function kvSet(ctx, key, value) {
  try { if (ctx.kv && ctx.kv.set) await ctx.kv.set(key, value); } catch (e) { console.warn('kv ' + key, e); }
}
// ctx.flow 还没接上时用一份只在内存的
const memFlow = (() => { let s = {}; return { get: () => s, set: p => { s = { ...s, ...p }; return s; }, clear: () => { s = {}; } }; })();
const flowOf = ctx => (ctx.flow && typeof ctx.flow.get === 'function' ? ctx.flow : memFlow);
const flowNow = ctx => { try { return flowOf(ctx).get() || {}; } catch { return {}; } };
const pipes = new WeakMap();
function pipeOf(ctx) {
  if (ctx.pipeline) return ctx.pipeline;
  let p = pipes.get(ctx);
  if (!p) { p = createPipeline({ ai: ctx.ai, curriculum: ctx.curriculum || {} }); pipes.set(ctx, p); }
  return p;
}
const sectionEl = name => (typeof document !== 'undefined' ? document.getElementById('view-' + name) : null);
const setBar = on => { if (typeof document !== 'undefined') document.body.classList.toggle('has-bar', !!on); };

// 每道题的截图：按“照片 id、题、长边、近照”缓存（一页 6 道题，列表和确认屏都要用）
const crops = new Map();
function cropURL(photo, idx, side, { whole = false } = {}) {
  const re = photo.recrops && photo.recrops[idx];
  if (re) return Promise.resolve(re);
  const { rect, turns } = cropPlan(photo, idx);
  if (!rect && !whole) return Promise.resolve('');
  const key = `${photo.id}:${idx}:${side}:${rect ? 'box' : 'page'}`;
  if (!crops.has(key)) {
    crops.set(key, cropImg(photo.blob, rect || { x: 0, y: 0, w: 1, h: 1 }, { maxSide: side, quality: side <= 320 ? 0.7 : 0.8, maxBytes: 0, turns })
      .then(s => s.dataURL)
      .catch(e => { crops.delete(key); console.warn('crop', e); return ''; }));
  }
  return crops.get(key);
}
const forgetCrops = photoId => { for (const k of [...crops.keys()]) if (k.startsWith(photoId + ':')) crops.delete(k); };

async function savePhotoProblem(ctx, photoId, problem) {
  const photo = await ctx.store.get('photos', photoId);
  if (!photo || !photo.page) return null;
  const ps = photo.page.problems;
  const at = ps.findIndex(p => p && p.idx === problem.idx);
  if (at < 0) return photo;
  ps[at] = problem;
  photo.updated = new Date().toISOString();
  await ctx.store.put('photos', photo);
  return photo;
}

// ---------------------------------------------------------------- 共用的界面零件

const btn = (text, onClick, cls = 'btn', extra = {}) => h('button', { type: 'button', className: cls, text, on: { click: onClick }, ...extra });

function navbar({ backLabel, onBack, title, end = null, show = false }) {
  return h('header', { className: 'navbar' + (show ? ' cap-nav' : '') }, h('div', { className: 'inner' },
    h('button', { type: 'button', className: 'back', on: { click: onBack } }, icon('back'), h('span', { className: 'back-label', text: backLabel })),
    h('span', { className: 'nav-title', text: title }),
    h('span', { className: 'nav-end' }, end)));
}
const bottomBar = (...kids) => h('div', { className: 'ebar cap-ebar' }, h('div', { className: 'inner' }, ...kids));

// 示例照片（模拟模式）：画一页假的练习册，顶上有姓名栏，不用真照片也能把流程走完
async function samplePhoto() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 1600;
  const g = c.getContext('2d');
  g.fillStyle = '#fbfaf4'; g.fillRect(0, 0, 1200, 1600);
  g.fillStyle = '#333'; g.font = '40px serif';
  g.fillText('姓名：________    班级：初一（   ）班', 70, 110);
  g.strokeStyle = '#ccc'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(60, 160); g.lineTo(1140, 160); g.stroke();
  g.font = '46px serif'; g.fillStyle = '#222';
  const rows = ['(1) (-8)+5 = -3', '(2) -3² = 9', '(3) (-2)³ = -8', '(4) |-5|-|3| = 2', '(5) -6÷2×⅓ = -9', '(6) (-1/2)×(-4) = 2'];
  const marks = ['✓', '✗', '✓', '✓', '✗', '✓'];
  rows.forEach((t, i) => {
    const y = 290 + i * 200;
    g.fillStyle = '#222'; g.fillText(t, 90, y);
    g.fillStyle = '#c0392b'; g.font = '64px serif'; g.fillText(marks[i], 900, y); g.font = '46px serif';
  });
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
  c.width = c.height = 1;
  return typeof File === 'function' ? new File([blob], 'sample.jpg', { type: 'image/jpeg' }) : blob;
}

// ---------------------------------------------------------------- 屏 1 到 3：拍照、遮名字、等识别

export function createCapture(ctx) {
  let el = null, open = false, gen = 0;
  let stage = 'start';            // start | preparing | mask | reading | failed | blocked | saving
  let file = null;                // 原始照片：只在内存，涂黑以后马上丢掉
  let preview = null;             // 遮名字时看的那张（prepare 出来的，已经转过 turns）
  let turns = 0;
  let band = { ...DEFAULT_BAND }, bandMoved = false;
  let source = SOURCES[0];
  let shot = null;                // 涂黑的照片：发出去、存下来的都是它
  let lastPage = null;            // 识别结果（存失败时可以只重存，不再看一遍）
  let errText = '', failCode = null, verdict = '';
  let retake = null;              // { photoId, idx }
  let ctrl = null, timers = [], readStart = 0;
  let camIn = null, albumIn = null;

  function inputs() {
    if (camIn) return;
    const mk = cam => {
      const i = h('input', { type: 'file', accept: 'image/*', className: 'visually-hidden', tabIndex: -1, 'aria-hidden': 'true' });
      if (cam) i.setAttribute('capture', 'environment');
      i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) take(f); });
      return i;
    };
    camIn = mk(true);
    albumIn = mk(false);
  }
  const stopTimers = () => { for (const t of timers) clearInterval(t); timers = []; };
  function reset() {
    gen++;
    if (ctrl) { ctrl.abort(); ctrl = null; }
    stopTimers();
    file = null; preview = null; shot = null; lastPage = null;
    turns = 0; bandMoved = false; errText = ''; failCode = null; verdict = '';
    stage = 'start';
  }

  async function take(f) {
    const my = ++gen;
    file = f; turns = 0; preview = null; shot = null; errText = ''; bandMoved = false;
    const saved = kvPeek(ctx, KV_CAPTURE, null);
    band = bandFor(saved, source);
    stage = 'preparing';
    render();
    try {
      const p = await prepare(f, { maxSide: 1600 });
      if (my !== gen || !open) return;
      // Wei 10-24：不用遮名字，拍完直接给老师看（遮名字那一屏的代码还在，只是不再进去）
      shot = p; preview = null; file = null;
      read();
      return;
    } catch (e) {
      if (my !== gen || !open) return;
      console.warn('prepare', e);
      file = null;
      errText = photoErrorText(e);
      stage = 'start';
    }
    render();
  }

  async function turn() {
    if (!preview || stage !== 'mask') return;
    const my = gen;
    try {
      const p = await rotateImg(preview.blob, 1, { maxSide: 1600 });
      if (my !== gen || !open) return;
      preview = p;
      turns = (turns + 1) % 4;
      render();
    } catch (e) { console.warn('rotate', e); say(ctx, COPY.photoFail.memory); }
  }

  async function send() {
    if (!file) return;
    const my = ++gen;
    if (!retake) await kvSet(ctx, KV_CAPTURE, rememberBand(kvPeek(ctx, KV_CAPTURE, null), source, band));
    stage = 'preparing';
    render();
    try {
      shot = await maskImg(file, [bandRect(band)], { turns, maxSide: 1600 });
    } catch (e) {
      if (my !== gen || !open) return;
      console.warn('mask', e);
      errText = photoErrorText(e); file = null; preview = null; stage = 'start';
      render();
      return;
    }
    if (my !== gen || !open) return;
    file = null; preview = null;   // 没涂黑的原图不再留着
    read();
  }

  async function read() {
    const my = ++gen;
    stage = 'reading'; failCode = null; readStart = Date.now();
    render();
    startWaiting(my);
    const c = ctrl = new AbortController();
    let page;
    try {
      page = await pipeOf(ctx).readPhoto(shot.dataURL, { signal: c.signal });
    } catch (e) {
      if (my !== gen || !open || (e && e.code === 'abort')) return;
      console.warn('readPhoto', e);
      stopTimers();
      failCode = e || 'http'; stage = 'failed';
      render();
      return;
    } finally { if (ctrl === c) ctrl = null; }
    if (my !== gen || !open) return;
    stopTimers();
    lastPage = page;
    verdict = pageVerdict(page);
    const blocked = retake ? verdict === 'empty' || verdict === 'unclear' : verdict !== 'ok';
    if (blocked) { stage = 'blocked'; render(); return; }
    store(my);
  }

  async function store(my = gen) {
    stage = 'saving'; failCode = null;
    render();
    try {
      // 照片要转正：存转正的那张，之后 boxToRect(box, rotation) 量出来的框正好对上
      let img = shot, turned = false;
      const rot = lastPage.rotation || 0;
      if (rot) {
        try { img = await rotateImg(shot.blob, rot / 90, { maxSide: 1600 }); turned = true; } catch (e) { console.warn('rotate', e); }
      }
      if (my !== gen || !open) return;
      if (retake) {
        const { photoId, idx } = retake;
        const photo = await ctx.store.get('photos', photoId);
        if (!photo || !photo.page) throw new Error('photo gone');
        const old = problemOf(photo, idx);
        const fresh = pickProblem(lastPage, old && old.no);
        const merged = mergeRetake(old, fresh);
        const rect = fresh && fresh.box ? boxToRect(fresh.box, rot) : null;
        let url = img.dataURL;
        if (rect) {
          try { url = (await cropImg(img.blob, rect, { maxSide: 1200, turns: turned ? 0 : rot / 90 })).dataURL; } catch (e) { console.warn('crop', e); }
        }
        photo.page.problems = photo.page.problems.map(p => (p && p.idx === idx ? merged : p));
        photo.recrops = { ...(photo.recrops || {}), [idx]: url };
        photo.updated = new Date().toISOString();
        await ctx.store.put('photos', photo);
        forgetCrops(photoId);
        if (my !== gen || !open) return;
        ctx.go('confirm', { photoId, idx });
        return;
      }
      const rec = { id: newId('p'), at: new Date().toISOString(), day: todayOf(ctx), blob: img.blob, width: img.width, height: img.height,
        source, page: lastPage, status: 'read', turned };
      await ctx.store.put('photos', rec);
      if (my !== gen || !open) return;
      flowOf(ctx).set({ stage: 'page', photoId: rec.id, queue: [], idx: null, problem: null, crop: '', thumb: '',
        diagnosing: null, diagnosis: null, diagnoseError: '' });
      ctx.go('page', { photoId: rec.id });
    } catch (e) {
      if (my !== gen || !open) return;
      console.warn('save photo', e);
      failCode = 'save'; stage = 'failed';
      render();
    }
  }

  function startWaiting(my) {
    stopTimers();
    let tip = 0;
    timers.push(setInterval(() => {
      if (my !== gen || !el) return;
      const ms = Date.now() - readStart;
      const bar = el.querySelector('.cap-progress i');
      if (bar) bar.style.width = (progressAt(ms) * 100).toFixed(1) + '%';
      const t = el.querySelector('.cap-time');
      if (t) t.textContent = ms > READ_SLOW_MS ? COPY.readSlow : COPY.readTime;
    }, 250));
    timers.push(setInterval(() => {
      if (my !== gen || !el) return;
      const t = el.querySelector('.cap-tipline span');
      if (t) { tip = (tip + 1) % COPY.waitTips.length; t.textContent = COPY.waitTips[tip]; }
    }, 5000));
  }

  const pickCam = () => { inputs(); camIn.click(); };
  const pickAlbum = () => { inputs(); albumIn.click(); };
  const goHome = () => ctx.go('home');
  async function useSample() {
    try { take(await samplePhoto()); } catch (e) { console.warn('sample', e); errText = COPY.photoFail.other; render(); }
  }
  function again() { reset(); render(); }

  // ---------- 各个样子

  function startView() {
    const mock = isMock(ctx);
    return [
      navbar({ backLabel: retake ? COPY.backShort : COPY.homeBack, onBack: () => (retake ? ctx.back() : goHome()), title: retake ? COPY.retakeTitle : COPY.startTitle }),
      h('div', { className: 'page cap-page cap-start' },
        h('h1', { className: 'page-title', text: retake ? COPY.retakeTitle : COPY.startTitle }),
        h('p', { className: 'cap-lede', text: retake ? COPY.retakeLede : COPY.startLede }),
        errText ? h('p', { className: 'status-line cap-err', role: 'alert' }, icon('alert'), h('span', { text: errText })) : null,
        h('ul', { className: 'cap-tips' }, COPY.tips.map(t => h('li', { text: t }))),
        h('div', { className: 'cap-actions' },
          h('button', { type: 'button', className: 'btn btn-big cap-shoot', on: { click: pickCam } }, icon('camera'), h('span', { text: COPY.shoot })),
          h('button', { type: 'button', className: 'text-btn accent', on: { click: pickAlbum } }, icon('photo'), h('span', { text: COPY.album })),
          mock ? btn(COPY.sample, useSample, 'text-btn') : null),
        mock ? h('p', { className: 'small cap-mock', text: COPY.mockNote }) : null),
    ];
  }

  function busyView(text) {
    return [
      navbar({ backLabel: COPY.retakeShort, onBack: again, title: '' }),
      h('div', { className: 'page cap-page' }, h('p', { className: 'cap-lede muted', text }), skBars([88, 64, 76])),
    ];
  }

  function maskView() {
    const saved = kvPeek(ctx, KV_CAPTURE, null);
    const img = h('img', { className: 'cap-shot', src: preview.dataURL, alt: '刚拍的照片', draggable: 'false' });
    const label = h('span', { className: 'cap-band-label', text: COPY.bandLabel });
    const bandEl = h('div', { className: 'cap-band', role: 'slider', tabIndex: 0, 'aria-label': COPY.bandLabel, 'aria-valuemin': '0', 'aria-valuemax': '100' },
      h('span', { className: 'cap-grip top', dataset: { edge: 'top' }, 'aria-hidden': 'true' }),
      label,
      h('span', { className: 'cap-grip bottom', dataset: { edge: 'bottom' }, 'aria-hidden': 'true' }));
    const stageEl = h('div', { className: 'cap-stage' }, img, bandEl);
    const place = () => {
      const b = clampBand(band);
      bandEl.style.top = (b.y * 100).toFixed(3) + '%';
      bandEl.style.height = (b.h * 100).toFixed(3) + '%';
      bandEl.setAttribute('aria-valuenow', String(Math.round(b.y * 100)));
      bandEl.setAttribute('aria-valuetext', `从 ${Math.round(b.y * 100)}% 到 ${Math.round((b.y + b.h) * 100)}%`);
    };
    place();

    // 拖：中间整条移，上下两条边拉高拉低。按着的时候页面不滚
    let drag = null;
    bandEl.addEventListener('pointerdown', ev => {
      const edge = ev.target && ev.target.closest && ev.target.closest('[data-edge]');
      drag = { id: ev.pointerId, how: edge ? edge.dataset.edge : 'move', y0: ev.clientY, b0: clampBand(band), H: stageEl.getBoundingClientRect().height || 1 };
      try { bandEl.setPointerCapture(ev.pointerId); } catch { /* 老浏览器没有，也能拖 */ }
      bandEl.classList.add('dragging');
      ev.preventDefault();
    });
    bandEl.addEventListener('pointermove', ev => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dy = (ev.clientY - drag.y0) / drag.H;
      band = drag.how === 'move' ? moveBand(drag.b0, dy) : resizeBand(drag.b0, drag.how, dy);
      bandMoved = true;
      place();
    });
    const end = ev => { if (drag && ev.pointerId === drag.id) { drag = null; bandEl.classList.remove('dragging'); } };
    bandEl.addEventListener('pointerup', end);
    bandEl.addEventListener('pointercancel', end);
    // 外接键盘：上下键移，加号减号拉高拉低
    bandEl.addEventListener('keydown', ev => {
      const step = ev.shiftKey ? 0.05 : 0.01;
      if (ev.key === 'ArrowUp') band = moveBand(band, -step);
      else if (ev.key === 'ArrowDown') band = moveBand(band, step);
      else if (ev.key === '+' || ev.key === '=') band = resizeBand(band, 'bottom', step);
      else if (ev.key === '-') band = resizeBand(band, 'bottom', -step);
      else return;
      bandMoved = true;
      ev.preventDefault();
      place();
    });

    const chips = SOURCES.map(s => h('button', { type: 'button', className: 'cap-chip', 'aria-pressed': String(s === source), text: s,
      on: { click: () => {
        source = s;
        if (!bandMoved) { band = bandFor(saved, s); place(); }
        for (const c of chips) c.setAttribute('aria-pressed', String(c.textContent === source));
      } } }));
    return [
      navbar({ backLabel: COPY.retakeShort, onBack: again, title: COPY.maskTitle, show: true,
        end: h('button', { type: 'button', className: 'text-btn cap-turn', 'aria-label': COPY.rotate, on: { click: turn } }, icon('rotate')) }),
      h('div', { className: 'page cap-page cap-maskpage' }, h('div', { className: 'cap-stagewrap' }, stageEl)),
      bottomBar(
        h('p', { className: 'cap-ask' }, h('b', { text: COPY.maskAsk }), ' ', h('span', { text: COPY.maskWhy })),
        h('p', { className: 'small cap-how', text: COPY.maskHow }),
        retake ? null : h('div', { className: 'cap-sources', role: 'group', 'aria-label': COPY.sourceLabel }, h('span', { className: 'cap-sources-k', text: COPY.sourceLabel }), chips),
        h('div', { className: 'cap-barrow' }, btn(COPY.maskGo, send, 'btn cap-go'))),
    ];
  }

  function readingView() {
    return [
      navbar({ backLabel: COPY.stopWaiting, onBack: again, title: COPY.readTitle }),
      h('div', { className: 'page cap-page cap-reading' },
        h('h1', { className: 'page-title', text: COPY.readTitle }),
        h('div', { className: 'cap-progress', 'aria-hidden': 'true' }, h('i')),
        h('p', { className: 'small cap-time', role: 'status', text: COPY.readTime }),
        h('p', { className: 'cap-think', text: COPY.readAsk }),
        shot ? h('figure', { className: 'cap-sent' }, h('img', { src: shot.dataURL, alt: '盖好名字的照片' })) : null,
        h('p', { className: 'small cap-tipline' }, h('b', { text: COPY.tipLabel + '：' }), h('span', { text: COPY.waitTips[0] }))),
    ];
  }

  function failedView() {
    const saveFail = failCode === 'save';
    const msg = saveFail ? COPY.saveFail : kidMessage(failCode, { where: 'photo' }) || COPY.saveFail;
    const retry = saveFail || canRetry(failCode);
    return [
      navbar({ backLabel: COPY.homeBack, onBack: goHome, title: COPY.readFailTitle }),
      h('div', { className: 'page cap-page' },
        h('h1', { className: 'page-title', text: COPY.readFailTitle }),
        h('p', { className: 'cap-lede', role: 'alert', text: msg }),
        h('div', { className: 'cap-actions' },
          retry ? btn(COPY.retry, () => (saveFail ? store() : read()), 'btn cap-main') : null,
          btn(COPY.retakeAll, again, retry ? 'text-btn accent' : 'btn cap-main'),
          btn(COPY.home, goHome, 'text-btn'))),
    ];
  }

  function blockedView() {
    const ungraded = verdict === 'ungraded';
    const title = ungraded ? COPY.ungradedTitle : COPY.unclearTitle;
    return [
      navbar({ backLabel: COPY.homeBack, onBack: goHome, title }),
      h('div', { className: 'page cap-page' },
        h('h1', { className: 'page-title', text: title }),
        h('p', { className: 'cap-lede', text: ungraded ? COPY.ungraded : COPY.unclear }),
        h('div', { className: 'cap-actions' },
          ungraded ? btn(COPY.home, goHome, 'btn cap-main') : btn(COPY.shootAgain, () => { again(); pickCam(); }, 'btn cap-main'),
          ungraded ? btn(COPY.otherPage, again, 'text-btn accent') : btn(COPY.album, () => { again(); pickAlbum(); }, 'text-btn accent'),
          ungraded ? null : btn(COPY.home, goHome, 'text-btn'))),
    ];
  }

  function render() {
    if (!el) return;
    const views = {
      start: startView, preparing: () => busyView(COPY.preparing), mask: maskView, reading: readingView,
      failed: failedView, blocked: blockedView, saving: () => busyView(COPY.saving),
    };
    const kids = (views[stage] || startView)();
    el.replaceChildren(h('div', { className: 'cap-wrap' + (stage === 'mask' ? ' cap-tall' : '') }, ...kids));
    if (camIn) el.append(camIn, albumIn);
    setBar(stage === 'mask');
    if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
  }

  return {
    show(params = {}) {
      el = el || sectionEl('capture');
      open = true;
      inputs();
      reset();
      retake = params && params.retake && params.photoId != null ? { photoId: params.photoId, idx: Number(params.idx) } : null;
      source = sourceOf(kvPeek(ctx, KV_CAPTURE, null));
      band = bandFor(kvPeek(ctx, KV_CAPTURE, null), source);
      render();
    },
    hide() {
      open = false;
      reset();
      setBar(false);
      if (el) el.replaceChildren();
    },
  };
}

// ---------------------------------------------------------------- 屏 4：这页的题

export function createPage(ctx) {
  let el = null, open = false, gen = 0;
  let photo = null, handled = {}, pend = new Set(), order = [], left = 0;

  async function load(photoId) {
    const my = ++gen;
    el.replaceChildren(h('div', { className: 'cap-wrap' },
      navbar({ backLabel: COPY.homeBack, onBack: () => ctx.go('home'), title: COPY.pageTitle }),
      h('div', { className: 'page cap-page' }, h('h1', { className: 'page-title', text: COPY.pageTitle }), skBars())));
    let p = null, items = [];
    try { p = photoId ? await ctx.store.get('photos', photoId) : null; } catch (e) { console.warn('photo', e); }
    try { items = await ctx.store.all('items'); } catch (e) { items = []; }
    const pending = await kvGet(ctx, KV_PENDING, []);
    if (my !== gen || !open) return;
    photo = p;
    if (!photo || !photo.page) { renderGone(); return; }
    handled = handledMap(items, photo.id, photo.done);
    pend = pendingFor(pending, photo.id);
    const f = flowNow(ctx);
    order = defaultPicks(photo.page, { handled, pending: pend, queue: f.photoId === photo.id ? f.queue : null });
    left = quotaLeft(kvPeek(ctx, KV_QUOTA, null), todayOf(ctx));
    markDone();
    render();
  }

  // 错题都有了着落、也没有待讲的：整页记成 done
  function markDone() {
    const wrong = wrongProblems(photo.page);
    if (photo.status === 'done' || !wrong.length || pend.size || !wrong.every(p => handled[p.idx])) return;
    photo.status = 'done';
    ctx.store.put('photos', photo).catch(e => console.warn('photo done', e));
  }

  function renderGone() {
    setBar(false);
    el.replaceChildren(h('div', { className: 'cap-wrap' },
      navbar({ backLabel: COPY.homeBack, onBack: () => ctx.go('home'), title: COPY.pageTitle }),
      h('div', { className: 'page cap-page' },
        h('h1', { className: 'page-title', text: COPY.pageTitle }),
        h('p', { className: 'cap-lede', text: COPY.photoGone }),
        h('div', { className: 'cap-actions' }, btn(COPY.shootAgain, () => ctx.go('capture'), 'btn cap-main'), btn(COPY.home, () => ctx.go('home'), 'text-btn')))));
  }

  async function savePending(idxs) {
    const list = await kvGet(ctx, KV_PENDING, []);
    await kvSet(ctx, KV_PENDING, addPending(list, idxs.map(idx => ({ photoId: photo.id, idx }))));
  }
  async function startNow() {
    const { today, later } = splitPicks(order, left);
    if (!today.length) return;
    await savePending([...today.slice(1), ...later]);
    try { flowOf(ctx).set({ stage: 'page', photoId: photo.id, queue: today.slice(1) }); } catch (e) { console.warn('flow', e); }
    ctx.go('confirm', { photoId: photo.id, idx: today[0] });
  }
  async function allLater() {
    if (!order.length) return;
    await savePending(order);
    try { flowOf(ctx).set({ stage: 'page', photoId: photo.id, queue: [] }); } catch (e) { console.warn('flow', e); }
    say(ctx, COPY.laterDone);
    ctx.go('home');
  }

  function render() {
    if (!el || !photo) return;
    const ps = photo.page.problems || [];
    const verdict = pageVerdict(photo.page);
    if (verdict !== 'ok') {
      setBar(false);
      const ungraded = verdict === 'ungraded';
      el.replaceChildren(h('div', { className: 'cap-wrap' },
        navbar({ backLabel: COPY.homeBack, onBack: () => ctx.go('home'), title: COPY.pageTitle }),
        h('div', { className: 'page cap-page' },
          h('h1', { className: 'page-title', text: ungraded ? COPY.ungradedTitle : COPY.unclearTitle }),
          h('p', { className: 'cap-lede', text: ungraded ? COPY.ungraded : COPY.unclear }),
          h('div', { className: 'cap-actions' }, btn(COPY.shootAgain, () => ctx.go('capture'), 'btn cap-main'), btn(COPY.home, () => ctx.go('home'), 'text-btn')))));
      return;
    }
    const over = order.length > left;
    const { today } = splitPicks(order, left);
    const open1 = ps.filter(p => !handled[p.idx]);
    const wrongOpen = wrongProblems(photo.page).filter(p => !handled[p.idx]);
    const anyUnpicked = open1.some(p => !order.includes(p.idx));
    const thumbs = [];

    const rows = ps.map(p => {
      const st = handled[p.idx];
      const at = order.indexOf(p.idx);
      const picked = at >= 0;
      const isLater = picked && at >= left;
      const status = st ? COPY.st[st] : picked ? (over || !left ? (isLater ? COPY.st.later : COPY.st.today) : '') : pend.has(p.idx) ? COPY.st.pending : '';
      // 有位置框（或近照）的才放小截图的位置；讲过的不用再看
      const canThumb = !st && !!((photo.recrops && photo.recrops[p.idx]) || cropPlan(photo, p.idx).rect);
      const thumbBox = canThumb ? h('span', { className: 'cap-pthumb', 'aria-hidden': 'true' }) : null;
      if (canThumb) thumbs.push([p.idx, thumbBox]);
      const pick = h('button', { type: 'button', className: 'cap-pick', role: 'checkbox', 'aria-checked': String(picked), disabled: !!st,
        on: { click: () => { order = togglePick(order, p.idx); render(); } } },
        h('span', { className: 'cap-check', 'aria-hidden': 'true' }, picked ? icon('check') : null),
        h('span', { className: 'cap-pmain' },
          h('span', { className: 'cap-pline' },
            h('span', { className: 'cap-pno', text: numberLabel(p) }),
            h('span', { className: 'cap-pmark', text: markLabel(p) }),
            showCorrected(p) ? h('span', { className: 'tag cap-pfix', text: COPY.correctedTag }) : null,
            status ? h('span', { className: 'tag cap-pst', text: status }) : null),
          p.stem ? h('span', { className: 'cap-pstem', text: plain(p.stem) }) : null),
        thumbBox);
      return h('li', { className: 'cap-prow' + (st ? ' done' : '') + (picked ? ' on' : '') + (isLater ? ' later' : '') },
        pick,
        isLater && left > 0 ? btn(COPY.promote, () => { order = promotePick(order, p.idx); render(); }, 'text-btn accent cap-promote') : null);
    });

    let quotaLine;
    if (!order.length) quotaLine = left ? COPY.left(left) : COPY.noneLeft;
    else if (!left) quotaLine = COPY.noneLeft;
    else if (over) quotaLine = COPY.overQuota(left, order.length - left);
    else quotaLine = COPY.left(left);

    const allDone = !wrongOpen.length && !order.length && wrongProblems(photo.page).length > 0;
    const primary = !order.length
      ? btn(COPY.pickSome, () => {}, 'btn cap-go', { disabled: true })
      : left ? btn(COPY.start(numberLabel(problemOf(photo, today[0]))), startNow, 'btn cap-go') : btn(COPY.allLater, allLater, 'btn cap-go');
    const secondary = order.length > 0 && left > 0 ? btn(COPY.later, allLater, 'text-btn') : null;

    el.replaceChildren(h('div', { className: 'cap-wrap' },
      navbar({ backLabel: COPY.homeBack, onBack: () => ctx.go('home'), title: COPY.pageTitle }),
      h('div', { className: 'page cap-page cap-pagelist' },
        h('h1', { className: 'page-title', text: COPY.pageTitle }),
        h('p', { className: 'cap-sub', text: COPY.pageSub(photo.source) }),
        allDone ? h('p', { className: 'cap-lede', text: COPY.allDone }) : null,
        h('ul', { className: 'cap-plist' }, rows),
        anyUnpicked ? h('p', { className: 'small cap-missed', text: wrongProblems(photo.page).length ? COPY.missed : COPY.noWrong }) : null,
        allDone ? null : h('p', { className: 'cap-quota', role: 'status', text: quotaLine })),
      allDone
        ? bottomBar(h('div', { className: 'cap-barrow' }, btn(COPY.otherPage, () => ctx.go('capture'), 'btn cap-go'), btn(COPY.home, () => ctx.go('home'), 'text-btn')))
        : bottomBar(h('div', { className: 'cap-barrow' }, primary, secondary))));
    setBar(true);

    // 小截图一张一张裁（一次只解一张 1600 的图，iPad 内存够用）
    const my = gen;
    (async () => {
      for (const [idx, box] of thumbs) {
        const url = await cropURL(photo, idx, 320);
        if (my !== gen || !open) return;
        if (url) box.replaceChildren(h('img', { src: url, alt: '' }));
        else box.classList.add('none');
      }
    })();
  }

  return {
    show(params = {}) {
      el = el || sectionEl('page');
      open = true;
      const id = (params && params.photoId) || flowNow(ctx).photoId || null;
      load(id);
    },
    hide() {
      open = false;
      gen++;
      setBar(false);
      if (el) el.replaceChildren();
    },
  };
}

// ---------------------------------------------------------------- 屏 5：我看到的题对吗

let keypadLoading = null;
const loadKeypad = () => keypadLoading || (keypadLoading = import('./keypad.js').catch(e => { console.warn('keypad.js', e); return null; }));

export function createConfirm(ctx) {
  let el = null, open = false, gen = 0;
  let photo = null, idx = 0, p = null;
  let editing = null;      // { key: 'stem' | 'work' | 'answer' | 'note', i }
  let keypad = null, typed = false;
  let doubt = null, busy = false, editHint = false;
  let peek = false;        // 选了“直接讲”以后，折起来的过程点开看一眼
  let cropImgEl = null;

  async function load(photoId, i) {
    const my = ++gen;
    idx = Number(i);
    editing = null; doubt = null; busy = false; editHint = false; typed = false; peek = false;
    el.replaceChildren(h('div', { className: 'cap-wrap' },
      navbar({ backLabel: COPY.backShort, onBack: () => ctx.back(), title: '' }),
      h('div', { className: 'page cap-page' }, skBars())));
    let ph = null;
    try { ph = await ctx.store.get('photos', photoId); } catch (e) { console.warn('photo', e); }
    if (my !== gen || !open) return;
    photo = ph;
    const q = problemOf(photo, idx);
    if (!photo || !q) {
      setBar(false);
      el.replaceChildren(h('div', { className: 'cap-wrap' },
        navbar({ backLabel: COPY.homeBack, onBack: () => ctx.go('home'), title: '' }),
        h('div', { className: 'page cap-page' }, h('p', { className: 'cap-lede', text: COPY.photoGone }),
          h('div', { className: 'cap-actions' }, btn(COPY.shootAgain, () => ctx.go('capture'), 'btn cap-main'), btn(COPY.home, () => ctx.go('home'), 'text-btn')))));
      return;
    }
    p = JSON.parse(JSON.stringify(q));
    render();
  }

  const val = (key, i) => (key === 'stem' ? p.stem : key === 'answer' ? p.her_answer : key === 'note' ? p.teacher_note : (p.her_work || [])[i]);
  function setVal(key, i, text) {
    const before = val(key, i) || '';
    if (key === 'stem') p.stem = text;
    else if (key === 'answer') p.her_answer = text;
    else if (key === 'note') p.teacher_note = text;
    else if (key === 'work') {
      const w = [...(p.her_work || [])];
      if (text) w[i] = text; else w.splice(i, 1);
      p.her_work = w;
    }
    p.edits = [...(p.edits || []), { field: key === 'work' ? `work${i}` : key, from: before, to: text, at: new Date().toISOString() }];
    p.unclear = [p.stem, p.her_answer, p.teacher_note, ...(p.her_work || [])].some(hasUnclear);
  }
  async function persist() {
    try { photo = (await savePhotoProblem(ctx, photo.id, p)) || photo; } catch (e) { console.warn('save problem', e); }
  }

  function closeEditor() {
    if (keypad && keypad.destroy) { try { keypad.destroy(); } catch { /* 已经拆了 */ } }
    keypad = null; editing = null; typed = false;
  }
  function commit(key, i, raw) {
    const text = String(raw ?? '').replace(/\s+$/g, '').replace(/^\s+/g, '');
    const before = val(key, i) || '';
    const same = text === before || text === editableText(before) || (key === 'answer' && text === asciiMath(before));
    closeEditor();
    if (!same) { setVal(key, i, text); doubt = null; persist(); }
    render();
  }
  function openEditor(key, i = null) {
    if (busy) return;
    closeEditor();
    editing = { key, i };
    doubt = null;
    render();
  }

  // 一个可以点着改的字段：显示公式，带 [?] 的黄底
  function fieldBtn(key, i, text, empty) {
    const t = text || '';
    return h('button', { type: 'button', className: 'cap-val' + (hasUnclear(t) ? ' unclear' : '') + (t ? '' : ' empty'),
      'aria-label': `改${key === 'work' ? `第 ${i + 1} 行` : { stem: COPY.stem, answer: COPY.answer, note: COPY.note }[key]}`,
      on: { click: () => openEditor(key, i) } },
    t ? mathText(t, { className: 'cap-valtext' }) : h('span', { className: 'cap-valtext muted', text: empty }),
    icon('pen', 'cap-pen'));
  }

  // 改的地方：答案用小键盘（keypad.js），别的用输入框
  function editorEl(key, i) {
    const host = h('div', { className: 'cap-editor' });
    const cur = val(key, i) || '';
    const useKeypad = key === 'answer' && !typed && answerKeypadOK(p);
    const cancel = btn(COPY.cancel, () => { closeEditor(); render(); }, 'text-btn');
    if (useKeypad) {
      const pad = h('div', { className: 'cap-keypad' });
      host.append(pad, h('div', { className: 'cap-editrow' }, cancel, btn(COPY.typeText, () => { closeEditor(); editing = { key, i }; typed = true; render(); }, 'text-btn')));
      loadKeypad().then(mod => {
        if (!editing || editing.key !== key || !host.isConnected) return;
        if (mod && typeof mod.createAnswer === 'function') {
          try {
            keypad = mod.createAnswer(pad, { kind: 'expr', placeholder: COPY.answerPh, context: `${(p && p.stem) || ''} ${cur}`, onSubmit: text => commit(key, i, typeof text === 'string' ? text : '') });
            if (keypad && keypad.set) keypad.set(asciiMath(cur));
            if (keypad && keypad.focus) keypad.focus();
            return;
          } catch (e) { console.warn('keypad', e); }
        }
        typed = true;   // 没有小键盘：换成输入框
        render();
      });
      return host;
    }
    const input = h(key === 'answer' ? 'input' : 'textarea', { className: 'cap-input', value: key === 'answer' && answerKeypadOK(p) ? asciiMath(cur) : editableText(cur),
      placeholder: key === 'answer' ? COPY.answerPh : COPY.linePh, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      'aria-label': key === 'answer' ? COPY.answer : COPY.linePh });
    if (input.tagName === 'TEXTAREA') input.rows = 2;
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(key, i, input.value); } });
    host.append(input, h('div', { className: 'cap-editrow' }, btn(COPY.done, () => commit(key, i, input.value), 'btn quiet'), cancel));
    setTimeout(() => { if (input.isConnected) { input.focus(); try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* textarea 也行 */ } } }, 30);
    return host;
  }
  const slot = (key, i, text, empty) => (editing && editing.key === key && (key !== 'work' || editing.i === i) ? editorEl(key, i) : fieldBtn(key, i, text, empty));

  function markSeg() {
    const segs = ['wrong', 'half', 'right'].map(m => h('button', { type: 'button', 'aria-pressed': String(p.mark === m), text: COPY.marks[m],
      on: { click: () => {
        if (p.mark === m) return;
        p.edits = [...(p.edits || []), { field: 'mark', from: p.mark, to: m, at: new Date().toISOString() }];
        p.mark = m; doubt = null; persist(); render();
      } } }));
    return h('div', { className: 'cap-markrow' },
      h('div', { className: 'cap-seg', role: 'group', 'aria-label': COPY.mark }, segs),
      h('span', { className: 'small', text: COPY.marks[p.mark] && p.mark !== 'none' ? COPY.nowMark(COPY.marks[p.mark]) : COPY.pickMark }));
  }

  // ---------- 两选一：按原来写的找错，还是直接讲正确思路（写进 p.useWork，确认时由 confirmedProblem 定下来）

  const folded = () => askUseWork(p) && !useWorkOf(p);
  function pickUseWork(val) {
    if (busy || (p.useWork === val && useWorkOf(p) === val)) return;
    if (!val && editing && (editing.key === 'work' || editing.key === 'answer')) closeEditor();
    p.useWork = val;
    doubt = null; peek = false;
    persist();
    render();
  }
  function useWorkChoice() {
    const on = useWorkOf(p);
    const opt = (val, text) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(on === val),
      className: 'cap-uw' + (on === val ? ' on' : ''), disabled: busy, on: { click: () => pickUseWork(val) } },
    h('span', { className: 'cap-uw-dot', 'aria-hidden': 'true' }, on === val ? icon('check') : null),
    h('span', { className: 'cap-uw-text', text }));
    return h('div', { className: 'cap-usework' },
      p.corrected ? h('p', { className: 'cap-fixed-note', text: COPY.correctedSeen }) : null,
      h('p', { className: 'cap-usework-q', id: 'cap-usework-q', text: COPY.useWorkQ }),
      h('div', { className: 'cap-uw-opts', role: 'radiogroup', 'aria-labelledby': 'cap-usework-q' },
        opt(true, COPY.useWorkYes), opt(false, COPY.useWorkNo)));
  }
  // 选了“直接讲”：她写的过程和答案折成一行、变淡，不用一行行核对；点开只看，不能改
  function foldedRow(work) {
    return h('div', { className: 'cap-dl-row cap-folded' }, h('div', { className: 'cap-dt', text: COPY.work }),
      h('div', { className: 'cap-dd' },
        h('button', { type: 'button', className: 'cap-foldbtn', 'aria-expanded': String(peek), on: { click: () => { peek = !peek; render(); } } },
          h('span', { className: 'cap-foldtext', text: COPY.folded }),
          h('span', { className: 'cap-peek', text: peek ? COPY.unpeek : COPY.peek }),
          icon('chev', 'cap-chev')),
        peek ? h('div', { className: 'cap-peeklist' },
          work.length ? h('ol', { className: 'cap-work cap-work-ro' }, work.map((w, i) => h('li', {},
            h('span', { className: 'cap-ln', text: circled(i) }), mathText(w, { className: 'cap-rotext' })))) : null,
          filled(p.her_answer) ? h('p', { className: 'cap-roans' }, h('span', { className: 'cap-roans-k', text: COPY.answer }),
            mathText(p.her_answer, { className: 'cap-rotext' })) : null) : null));
  }

  // ---------- 三个按钮

  async function yes() {
    if (busy) return;
    if (editing) { say(ctx, COPY.finishEdit); return; }
    if (!['wrong', 'half', 'right'].includes(p.mark)) { say(ctx, COPY.pickMark); return; }
    if (p.mark === 'right') {
      busy = true;
      p.confirmed = true;
      await persist();
      await dropFromPending();
      say(ctx, COPY.rightSaved);
      busy = false;
      ctx.go('page', { photoId: photo.id });
      return;
    }
    const d = doubtCheck(p);
    if (d.same) { doubt = d; render(); return; }
    busy = true;
    render();
    const problem = confirmedProblem(p);
    const crop = await cropURL(photo, idx, 1200, { whole: true });
    if (!open) { busy = false; return; }
    // 点“对”的这一刻就发出去，第 6 屏“先自己找”期间在后台跑（CONTRACTS 界面阶段修正）
    const diagnosing = pipeOf(ctx).diagnose(problem, crop || undefined);
    diagnosing.catch(() => {});   // explain 屏会 await 它；这里只免得没人接时报未处理
    const flow = flowOf(ctx);
    const mine = () => { const f = flowNow(ctx); return f.photoId === photo.id && f.idx === idx; };
    try {
      flow.set({ stage: 'explain', photoId: photo.id, idx, problem, source: photo.source || '', crop, thumb: '', diagnosing,
        diagnosis: null, diagnoseError: '', startedAt: new Date().toISOString() });
    } catch (e) { console.warn('flow', e); }
    diagnosing.then(dg => { if (mine()) flow.set({ diagnosis: dg }); },
      e => { if (mine()) flow.set({ diagnoseError: (e && e.code) || 'http' }); });
    cropURL(photo, idx, 320).then(t => { if (mine()) flow.set({ thumb: t || crop }); });
    p = problem;
    await persist();
    await dropFromPending();
    busy = false;
    ctx.go('explain', { photoId: photo.id, idx });
  }

  async function dropFromPending() {
    const list = await kvGet(ctx, KV_PENDING, []);
    const next = dropPending(list, photo.id, idx);
    if (next.length !== (Array.isArray(list) ? list.length : 0)) await kvSet(ctx, KV_PENDING, next);
  }

  async function iThinkRight() {
    if (busy) return;
    busy = true;
    render();
    try {
      const problem = confirmedProblem(p);
      const crop = await cropURL(photo, idx, 1200, { whole: true });
      const th = (await cropURL(photo, idx, 320)) || crop;
      const card = askCard({ id: newId('q'), problem, photoId: photo.id, crop, thumb: th, source: photo.source || '', today: todayOf(ctx), computed: doubt && doubt.computed });
      await ctx.store.put('items', card);
      p = problem;
      await persist();
      await dropFromPending();
      say(ctx, COPY.askSaved);
      busy = false;
      doubt = null;
      ctx.go('page', { photoId: photo.id });
    } catch (e) {
      console.warn('ask card', e);
      busy = false;
      say(ctx, COPY.saveFail);
      render();
    }
  }

  function editSomething() {
    if (editing) return;
    const fold = folded();   // 折起来的过程和答案不用核对
    const firstUnclear = hasUnclear(p.stem) ? ['stem', null] : !fold && (p.her_work || []).findIndex(hasUnclear) >= 0 ? ['work', p.her_work.findIndex(hasUnclear)]
      : !fold && hasUnclear(p.her_answer) ? ['answer', null] : hasUnclear(p.teacher_note) ? ['note', null] : null;
    if (firstUnclear) { openEditor(firstUnclear[0], firstUnclear[1]); return; }
    editHint = true;
    say(ctx, COPY.editHint);
    render();
  }

  function render() {
    if (!el || !p) return;
    const label = numberLabel(p);
    const work = p.her_work || [];
    const ask = askUseWork(p), fold = folded();
    const anyUnclear = fold ? [p.stem, p.teacher_note].some(hasUnclear) : p.unclear || [p.stem, p.her_answer, p.teacher_note, ...work].some(hasUnclear);
    cropImgEl = h('img', { alt: `${label}的原题`, on: { click: ev => ev.currentTarget.closest('.cap-crop').classList.toggle('big') } });
    const fig = h('figure', { className: 'cap-crop' }, cropImgEl);
    const rows = [
      h('div', { className: 'cap-dl-row' }, h('div', { className: 'cap-dt', text: COPY.stem }), h('div', { className: 'cap-dd' }, slot('stem', null, p.stem, COPY.noStem))),
      p.options && p.options.length ? h('div', { className: 'cap-dl-row' }, h('div', { className: 'cap-dt', text: COPY.options }),
        h('div', { className: 'cap-dd' }, h('ul', { className: 'cap-opts' }, p.options.map(o => h('li', {}, mathText(o)))))) : null,
      p.figure ? h('div', { className: 'cap-dl-row' }, h('div', { className: 'cap-dt', text: COPY.figure }), h('div', { className: 'cap-dd cap-fig', text: p.figure })) : null,
      fold ? foldedRow(work) : [
        h('div', { className: 'cap-dl-row' }, h('div', { className: 'cap-dt', text: COPY.work }),
          h('div', { className: 'cap-dd' }, work.length
            ? h('ol', { className: 'cap-work' }, work.map((w, i) => h('li', {}, h('span', { className: 'cap-ln', text: circled(i) }), slot('work', i, w, ''))))
            : h('p', { className: 'muted cap-nowork', text: COPY.noWork }))),
        h('div', { className: 'cap-dl-row' }, h('div', { className: 'cap-dt', text: COPY.answer }), h('div', { className: 'cap-dd' }, slot('answer', null, p.her_answer, COPY.noAnswer))),
      ],
      ask ? useWorkChoice() : null,
      h('div', { className: 'cap-dl-row' }, h('div', { className: 'cap-dt', text: COPY.mark }), h('div', { className: 'cap-dd' }, markSeg())),
      p.teacher_note ? h('div', { className: 'cap-dl-row' }, h('div', { className: 'cap-dt', text: COPY.note }), h('div', { className: 'cap-dd' }, slot('note', null, p.teacher_note, ''))) : null,
    ];

    const bar = doubt
      ? bottomBar(
        h('p', { className: 'cap-doubt-q', role: 'alert', text: COPY.doubtQ }),
        h('div', { className: 'cap-barrow' },
          btn(COPY.doubtMine, () => { doubt = null; openEditor('answer', null); }, 'btn quiet', { disabled: busy }),
          btn(COPY.doubtRight, iThinkRight, 'btn quiet', { disabled: busy })))
      : bottomBar(h('div', { className: 'cap-barrow' },
        btn(p.mark === 'right' ? COPY.rightSkip : COPY.yes, yes, 'btn cap-go', { disabled: busy }),
        btn(COPY.editLine, editSomething, 'text-btn accent'),
        btn(COPY.retakeOne, async () => { await persist(); ctx.go('capture', { retake: true, photoId: photo.id, idx }); }, 'text-btn')));

    el.replaceChildren(h('div', { className: 'cap-wrap' + (doubt ? ' cap-tall' : '') },
      navbar({ backLabel: COPY.backShort, onBack: () => ctx.back(), title: label }),
      h('div', { className: 'page cap-page cap-confirm' },
        h('h1', { className: 'page-title', text: COPY.confirmTitle(label) }),
        fig,
        anyUnclear ? h('p', { className: 'cap-unclear-hint' }, h('mark', { className: 'cap-swatch', text: '[?]' }), h('span', { text: COPY.unclearHint })) : null,
        h('div', { className: 'cap-dl' + (editHint ? ' cap-editing' : '') }, rows)),
      bar));
    setBar(true);

    const my = gen;
    cropURL(photo, idx, 1200, { whole: true }).then(url => {
      if (my !== gen || !open || !cropImgEl) return;
      if (url) cropImgEl.src = url; else fig.hidden = true;
    });
  }

  return {
    show(params = {}) {
      el = el || sectionEl('confirm');
      open = true;
      const f = flowNow(ctx);
      const photoId = params.photoId != null ? params.photoId : f.photoId;
      const i = params.idx != null ? params.idx : f.idx;
      load(photoId, i);
    },
    hide() {
      open = false;
      gen++;
      closeEditor();
      setBar(false);
      if (el) el.replaceChildren();
    },
  };
}

export function createCaptureScreens(ctx) {
  return { capture: createCapture(ctx), page: createPage(ctx), confirm: createConfirm(ctx) };
}
