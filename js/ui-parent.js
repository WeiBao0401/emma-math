// 家长区（C-practical 8.3，CONTRACTS 第 11 节路由 parent）：首页右上角“家长”点进来就是。Wei 10-24 去掉了 4 位数字码，
// 门的代码还在（showGate 等），只是不再进去。
// 里面放：连接（中转站地址、Poe Key、测一下连接）、花费（今天、本月、每天上限）、学习设置（进度锚点、考试日期和范围）、
// 问老师和“这题有问题”两张清单（只读）、最近 50 次 AI 调用、每个任务用哪个模型、数据（备份、导入、存储、清除）、模拟模式。
// 负责：家长区 UI agent（ui-parent.js、css/parent.css、tests/parent.test.mjs）。写法照英语老师 App 的 ui-parent.js / ui-me.js。
//
// 导出
//   createParent(ctx) -> { show(params, { from, back }), hide() }
//     画进 <section id="view-parent">（整块自己画，index.html 里原来的占位内容会被换掉）。
//     hide()：离开家长区（app.js 换路由时调用）就重新上锁；App 退到后台、5 分钟没操作、点“锁上”也上锁。
//   纯函数（node 测试用，tests/parent.test.mjs）：
//     数字码  CODE_KEY, CODE_LEN, GATE_COPY（门上的字，她也可能看到）, validCode, weakCode, newSalt, makeCode, checkCode
//     花费    POINTS_PER_USD, SUGGESTED_CAP_USD, usdText, usdShort, pointsText, capText, clampCap, byTaskText
//     连接    maskKey, codeText, pingReport
//     模型    taskRows, modelChoices, priceText
//     学习    chapterGroups, progressText, examRecord, examSummary, rangeText, daysBetween
//     清单    collectFlags, askList, recentRows
//     数据    backupSummary, backupText, emptyExport
//     模拟    MOCK_CASE_LABELS, mockCaseOptions, MOCK_FAIL_OPTIONS
//
// 用到的 ctx：settings / saveSettings、mockForced、kv.peek / set / delete、store.all / exportAll / importAll、
//   budget.today / month、ai.ping / recent、curriculum（没有就自己 loadCurriculum）、go / back / route、toast。
// kv
//   'parentCode'  { v: 1, salt, hash }：4 位码加盐的 SHA-256（不存明文；没有 crypto.subtle 的 http 预览退回 FNV）。
//                 忘了码：只能“清除全部数据”重来（两次确认），防的是她自己清码进来。
//   'progress'    { section: '3.1', updated }        进度锚点（CONTRACTS 12）
//   'exam'        { date: 'YYYY-MM-DD', sections: ['1.1', ...], updated }   考试日期和范围（按课本顺序、去重）
//   'lastExport'  { at, items, photos, attempts }    上次导出备份（这个文件新加）
// 孩子可能会点进门这一屏，所以门上的字不提 Key、积分、模型；门后面是家长看的，可以提。
// 依赖：ui-dom.js、config.js、ai.js、kid-errors.js、db.js、mock.js、curriculum.js、nav.js。模块顶层不碰 document。
import { h, icon, mathText, ago, dateCn, localYmd, fmtBytes, fmtSecs } from './ui-dom.js';
import { VERSION, APP_NAME, TASKS, TASK_LABELS, PRICES_USD, POE_DIRECT_URL } from './config.js';
import { normalizePoeUrl, relayHost, modelFor } from './ai.js';
import { parentDetail } from './kid-errors.js';
import { exportFileName, parseExportText, EXPORT_FORMAT, EXPORT_VERSION } from './db.js';
import { RECOGNIZE_CASES } from './mock.js';
import { loadCurriculum } from './curriculum.js';
import { loadProfile } from './profile.js';

// ---------------------------------------------------------------- 数字码（纯函数）

export const CODE_KEY = 'parentCode';
export const CODE_LEN = 4;
const MAX_WRONG = 5;            // 错 5 次，等 30 秒
// 门上的字：她也可能点进来看到，所以照孩子文案的规矩写（不提 Key、积分、模型，不用感叹号和破折号；测试用 kid-errors 的 BANNED 查）
export const GATE_COPY = {
  title: { set1: '设一个 4 位数字码', set2: '再输一次', enter: '输入家长数字码', forgot: '忘了数字码' },
  sub: { set1: '防止误点进来改设置。不是密码，别用银行卡密码。', set2: '确认一下刚才的 4 位。', enter: '这一页给家长用。', forgot: '' },
  weak: '太好猜了，换一个。别用 1234、0000 这种。',
  mismatch: '两次不一样，重新设一次。',
  wrong: '不对，再试一次。',
  wait: '错了 5 次，30 秒后再试。',
  forgot: '数字码只存在这台 iPad 上，找不回来。只能清除数学老师在这台 iPad 上的全部数据，从头开始：错题本、照片、作答记录、设置和家长数字码都会删掉，连接要重新填。英语老师不受影响。',
  forgotHint: '如果还能想起来，先别清。',
  wipe: '清除全部数据',
  sure: '真的清除吗？删掉的找不回来。',
  sureBtn: '确定清除',
  remembered: '想起来了',
  keep: '不清了',
};
const WAIT_MS = 30000;
const IDLE_MS = 5 * 60 * 1000;  // 5 分钟没操作就锁上

export const validCode = code => new RegExp(`^\\d{${CODE_LEN}}$`).test(String(code ?? ''));
// 0000、1234、9876：谁都会先试这几个
export function weakCode(code) {
  if (!validCode(code)) return true;
  const d = String(code).split('').map(Number);
  if (d.every(x => x === d[0])) return true;
  const steps = d.slice(1).map((x, i) => x - d[i]);
  return steps.every(s => s === 1) || steps.every(s => s === -1);
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function fnv1a(s) {
  let x = 0x811c9dc5;
  for (const c of new TextEncoder().encode(s)) { x ^= c; x = Math.imul(x, 0x01000193) >>> 0; }
  return x.toString(16).padStart(8, '0');
}
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
async function hashWith(fnv, code, salt) {
  const text = `emmamath-parent:${salt}:${code}`;
  if (!fnv && subtle()) return hex(await subtle().digest('SHA-256', new TextEncoder().encode(text)));
  return 'fnv1a:' + fnv1a(text);
}
export function newSalt() {
  const a = new Uint8Array(8);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return hex(a);
}
// -> { v: 1, salt, hash }。https 和 localhost 上用 SHA-256；没有 crypto.subtle（局域网 http 预览）退回 FNV，照样不存明文
export async function makeCode(code, salt = newSalt(), { fnv = !subtle() } = {}) {
  if (!validCode(code)) throw new Error('数字码要 4 位数字');
  return { v: 1, salt, hash: await hashWith(fnv, String(code), salt) };
}
export async function checkCode(rec, code) {
  if (!rec || !rec.salt || !rec.hash || !validCode(code)) return false;
  const fnv = String(rec.hash).startsWith('fnv1a:');
  if (!fnv && !subtle()) return false;
  return (await hashWith(fnv, String(code), rec.salt)) === rec.hash;
}

// ---------------------------------------------------------------- 花费（纯函数）

export const POINTS_PER_USD = 33000;      // 1 美元约 3.3 万积分（Poe 10-24 的价）
export const SUGGESTED_CAP_USD = 0.4;     // C-practical 11 第 7 条
const CAP_MIN = 0.1, CAP_MAX = 5, CAP_STEP = 0.1;
const group3 = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export function usdText(usd) {
  const v = Number(usd) || 0;
  if (v <= 0) return '0 美元';
  if (v < 0.005) return '不到 0.01 美元';
  return v.toFixed(2) + ' 美元';
}
export const usdShort = usd => { const v = Number(usd) || 0; return v <= 0 ? '0' : v < 0.005 ? '<0.01' : v.toFixed(2); };
export function pointsText(usd) {
  const p = Math.round((Number(usd) || 0) * POINTS_PER_USD);
  if (p <= 0) return '0 积分';
  if (p < 10000) return `约 ${group3(p)} 积分`;
  return `约 ${Math.round(p / 1000) / 10} 万积分`;
}
export const capText = c => String(Math.round((Number(c) || 0) * 100) / 100);
// 每天上限加减一步：0.1 美元一格，0.1 到 5 之间。0 不给设（会让她当天一点 AI 都用不了，又看不出原因）
export function clampCap(cur, delta = 0) {
  const n = Number(cur);
  const base = cur !== null && cur !== '' && Number.isFinite(n) && n >= 0 ? n : SUGGESTED_CAP_USD;
  return Math.min(CAP_MAX, Math.max(CAP_MIN, Math.round((base + delta) * 10) / 10));
}
// { explain: 0.03, recognize: 0.012 } -> '讲错题 0.03 · 看照片 0.01'（美元）
export const byTaskText = byTask => Object.entries(byTask || {}).filter(([, v]) => Number(v) > 0).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${TASK_LABELS[k] || k} ${usdShort(v)}`).join(' · ');

// ---------------------------------------------------------------- 连接（纯函数）

// 只露最后 4 位；Key 太短就一位都不露
export function maskKey(key) {
  const k = String(key ?? '').trim();
  if (!k) return '';
  return '····' + (k.length > 8 ? k.slice(-4) : '');
}
// ai.js 的 AIError.code（和 ping 记在 recent 里的 HTTP 状态码）-> 给家长看的技术说明
const CODE_TEXT = {
  nokey: '还没填中转站地址或 Key。',
  badkey: 'Key 不对或已失效（401）。去 poe.com/api_key 复制一个，重新粘贴。',
  badrelay: '中转站地址不对（空的 404，多半是暗号不对），或者中转站没开。',
  billing: 'Poe 积分不够了（402）。到 poe.com 看余额，每月初到账。',
  'budget-day': '今天的估算花费到了每天上限，明天恢复。可以在“花费”里调高。',
  forbidden: 'Poe 拒绝了请求（403）。检查中转站的设置。',
  model: '模型名不对，或者这个 Key 用不了这个模型。到“模型”里换一个。',
  offline: '这台 iPad 没连网。',
  network: '连不上。检查中转站地址，或者换个网络再试。',
  timeout: '等了太久没有回应。网太慢，或者中转站没开。',
  ratelimit: '请求太多被限流了（429），等一会儿再试。',
  server: 'Poe 或中转站出错了（5xx），等一会儿再试。',
  truncated: '回答两次都被截断了（max_tokens 不够）。',
  incomplete: '回答不是能读的 JSON，再要了一次还是不行。',
  empty: '回答是空的。',
  http: 'Poe 返回了别的错误。',
  abort: '取消了（离开了页面，或者她点了停）。',
};
const HTTP_TEXT = { 401: 'badkey', 402: 'billing', 403: 'forbidden', 404: 'badrelay', 429: 'ratelimit' };
export function codeText(code) {
  const c = String(code ?? '');
  if (!c) return '';
  if (CODE_TEXT[c]) return CODE_TEXT[c];
  if (/^\d{3}$/.test(c)) return HTTP_TEXT[c] ? CODE_TEXT[HTTP_TEXT[c]] : +c >= 500 ? CODE_TEXT.server : `HTTP ${c}。`;
  return `出错了（${c}）。`;
}
// ai.ping() 的结果 -> { kind: 'good' | 'bad' | '', lines: [句子] }
export function pingReport(r, { mock = false, aborted = false } = {}) {
  if (aborted) return { kind: 'bad', lines: [CODE_TEXT.timeout] };
  if (!r || typeof r !== 'object') return { kind: 'bad', lines: ['没连上。'] };
  if (r.ok) {
    const isMock = !!(r.mock || mock);
    const missing = Array.isArray(r.missing) ? r.missing.filter(Boolean) : [];
    const ms = Number(r.ms);
    return {
      kind: missing.length ? '' : 'good',
      lines: [
        (isMock ? '模拟模式，没有真的连网。' : '连上了。') + (ms >= 0 ? `用时 ${Math.round(ms)} 毫秒` : '') + (r.count ? `，列表里有 ${r.count} 个模型。` : ms >= 0 ? '。' : ''),
        missing.length ? `要用的模型里，这几个列表里没有：${missing.join('、')}。到“模型”里换一个。` : isMock ? '' : '要用的模型都在。',
        isMock ? '' : '这一步只说明地址通了。Key 对不对，第一次讲题时才知道。',
      ].filter(Boolean),
    };
  }
  const text = codeText(r.code) || '没连上。';
  const detail = r.message && r.message !== text ? String(r.message) : '';
  return { kind: 'bad', lines: [text, detail].filter(Boolean) };
}

// ---------------------------------------------------------------- 模型（纯函数）

// 每个任务一行：现在用哪个、推荐哪个、改没改过
export const taskRows = (settings = {}) => Object.keys(TASKS).map(task => {
  const recommended = TASKS[task].model;
  const model = modelFor(task, settings);
  return { task, label: TASK_LABELS[task] || task, model, recommended, changed: model !== recommended, fallback: TASKS[task].fallback || '' };
});
// 下拉里的模型：config 里有价格的那几个；现在用的不在里面（以前手填的）也列上，免得一打开就被换掉
export function modelChoices(current = '') {
  const list = Object.keys(PRICES_USD);
  return current && !list.includes(current) ? [...list, current] : list;
}
export function priceText(model) {
  const p = PRICES_USD[model];
  return Array.isArray(p) ? `每百万 token：输入 ${p[0]}、输出 ${p[1]} 美元` : '价格不认识，按贵的估算';
}

// ---------------------------------------------------------------- 学习设置（纯函数）

// curriculum.sections -> [{ chapter, label, sections }]，顺序照原样（第 1 到 6 章，小学衔接在最后）
export function chapterGroups(sections = []) {
  const out = [];
  for (const s of sections || []) {
    if (!s || !s.id) continue;
    let g = out.find(x => x.chapter === s.chapter);
    if (!g) {
      g = { chapter: s.chapter, label: s.chapter === 0 || s.chapter === '0' ? String(s.chapterTitle || '小学衔接') : `第 ${s.chapter} 章 ${s.chapterTitle || ''}`.trim(), sections: [] };
      out.push(g);
    }
    g.sections.push(s);
  }
  return out;
}
export function progressText(progress, curriculum = null) {
  const id = progress && progress.section;
  if (!id) return '还没设';
  try { return curriculum && curriculum.title ? curriculum.title(id) : String(id); } catch (e) { return String(id); }
}
// 'YYYY-MM-DD' 之间差几天（按日历日，不受夏令时影响）
export function daysBetween(a, b) {
  const t = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  return Math.round((t(b) - t(a)) / 864e5);
}
// 存进 kv 'exam' 的样子：日期要像日期；章节按课本顺序、去重，不认识的丢掉（课本目录没载入时原样留着）
export function examRecord({ date = '', sections = [] } = {}, allSections = [], now = new Date()) {
  const order = new Map((allSections || []).map((s, i) => [s.id, i]));
  let list = [...new Set((sections || []).map(String).filter(Boolean))];
  if (order.size) list = list.filter(id => order.has(id)).sort((a, b) => order.get(a) - order.get(b));
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : '';
  return { date: d, sections: list, updated: new Date(now).toISOString() };
}
// 选中的节 -> '第 1 到 3 章、4.1'：整章选满的按章说，连着的章合起来
export function rangeText(ids = [], allSections = []) {
  const sel = new Set(ids || []);
  if (!sel.size) return '';
  const bits = [];
  const known = new Set();
  let run = null;
  const flush = () => { if (run) { bits.push(run[0] === run[1] ? `第 ${run[0]} 章` : `第 ${run[0]} 到 ${run[1]} 章`); run = null; } };
  for (const g of chapterGroups(allSections)) {
    const picked = g.sections.filter(s => sel.has(s.id));
    picked.forEach(s => known.add(s.id));
    const full = picked.length && picked.length === g.sections.length;
    if (full && Number(g.chapter) > 0) {
      const c = Number(g.chapter);
      if (run && run[1] === c - 1) run[1] = c; else { flush(); run = [c, c]; }
      continue;
    }
    flush();
    if (full) bits.push(g.label.replace(/（.*）$/, ''));
    else bits.push(...picked.map(s => s.id));
  }
  flush();
  bits.push(...[...sel].filter(id => !known.has(id)));
  return bits.join('、');
}
export function examSummary(exam, allSections = [], today = '') {
  const date = exam && exam.date;
  const ids = (exam && Array.isArray(exam.sections)) ? exam.sections : [];
  if (!date && !ids.length) return '还没设';
  let when = '';
  if (date) {
    when = dateCn(date, today ? new Date(today + 'T12:00:00') : new Date());
    if (today) {
      const n = daysBetween(today, date);
      when += n > 0 ? `（还有 ${n} 天）` : n === 0 ? '（就是今天）' : '（考完了）';
    }
  }
  const range = rangeText(ids, allSections);
  return [when, range || (date ? '范围还没选' : '')].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- 两张清单和最近的调用（纯函数）

// flagged 里一条从哪儿来：ui-practice 写 kind（twin | variant | redo），ui-explain 写 where（讲题流程的哪一步），ui-book 写 what: 'card'
const FLAG_WHAT = { twin: '同构题', variant: '变式题', redo: '原题重做', explain: '讲解', diagnosis: '讲解', hint: '提示', hint1: '提示', hint2: '提示',
  find: '先自己找', fix: '先自己找', sentence: '一句话', save: '收进本子', page: '识别', confirm: '识别', card: '整张卡' };
const tsOf = x => String(x.at || x.day || '');
// 她点“这题有问题”的题：每张卡的 flagged[]（CONTRACTS 12）。一条可以是字符串（题目），也可以是对象
// { at, day, kind | where | what, level, q, answer, reason | note }。-> 新的在前
export function collectFlags(items = []) {
  const out = [];
  for (const it of items || []) {
    if (!it || !Array.isArray(it.flagged)) continue;
    for (const f of it.flagged) {
      if (f === null || f === undefined || f === '') continue;
      const o = typeof f === 'object' ? f : { q: String(f) };
      const at = String(o.at || '');
      out.push({
        itemId: it.id, at, day: String(o.day || at.slice(0, 10) || it.day || ''),
        what: [(() => { const w = o.kind || o.where || o.what || ''; return FLAG_WHAT[w] || String(w); })(), String(o.level || '')].filter(Boolean).join(' · '),
        q: String(o.q || o.stem || ''), note: String(o.reason || o.note || ''), answer: String(o.answer ?? ''),
        stem: String((it.problem && it.problem.stem) || it.stem || ''),
      });
    }
  }
  return out.sort((a, b) => tsOf(b).localeCompare(tsOf(a)));
}
// askTeacher.reason 的几种写法（ui-explain、ui-capture、ui-book 各写各的，这里都认）
const ASK_REASON = {
  unsure: '答案核对不了：程序算不了，两家模型的答案也不一样。',
  'maybe-right': '她写的和程序算的一样，老师却批了错：可能是我看错了字，也可能是老师批错了。',
  'mine-right': '她写的和程序算的一样，老师却批了错：可能是我看错了字，也可能是老师批错了。',
  mine: '她写的和程序算的一样，老师却批了错：可能是我看错了字，也可能是老师批错了。',
  confused: '讲完她还是不太懂，想听老师讲。',
  'still-lost': '讲完她还是不太懂，想听老师讲。',
  flagged: '她觉得题目或讲解有问题（点了“这题有问题”）。',
  wrong: '她觉得题目或讲解有问题（点了“这题有问题”）。',
};
// 问老师：status 'ask' 或带 askTeacher 的卡（askTeacher 可以是 true，也可以是 { reason, at, answer }）。-> 新的在前
export function askList(items = []) {
  return (items || []).filter(it => it && (it.status === 'ask' || it.askTeacher)).map(it => {
    const a = it.askTeacher && typeof it.askTeacher === 'object' ? it.askTeacher : {};
    const d = it.diagnosis || {};
    const p = it.problem || {};
    const why = String(a.reason || '');
    return {
      id: it.id, at: String(a.at || it.at || ''), day: String(a.day || it.day || ''),
      stem: String(p.stem || it.stem || ''), thumb: typeof it.thumb === 'string' && it.thumb.startsWith('data:image/') ? it.thumb : '',
      source: String(it.source || ''), herAnswer: String(p.her_answer || ''), answer: String(a.answer || ''), computed: String(a.computed || ''),
      reason: ASK_REASON[why] || why || (d.checked === 'unsure' ? ASK_REASON.unsure : '') || String(d.doubt || ''),
    };
  }).sort((a, b) => tsOf(b).localeCompare(tsOf(a)));
}
// ai.recent() -> 新的在前，带中文任务名和出错说明。at 是 iPad 本地时间 'YYYY-MM-DDTHH:MM:SS'
export function recentRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice().reverse().map(r => {
    const code = String((r && r.code) || '');
    const ok = !!(r && r.ok);
    const ms = Number(r && r.ms) || 0;
    const pending = !ok && !code && !ms;
    return {
      at: String((r && r.at) || ''), day: String((r && r.at) || '').slice(0, 10), time: String((r && r.at) || '').slice(11, 19),
      task: TASK_LABELS[r && r.task] || (r && r.task === 'ping' ? '测连接' : String((r && r.task) || '')),
      model: String((r && r.model) || ''), ms, ok, pending, code, usd: Number(r && r.usd) || 0,
      detail: ok || pending ? '' : (r && r.message ? parentDetail(r) : codeText(code)),
    };
  });
}

// ---------------------------------------------------------------- 备份（纯函数）

const len = v => (Array.isArray(v) ? v.length : 0);
export function backupSummary(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return {
    at: String(o.at || ''), app: String(o.app || ''), items: len(o.items), photos: len(o.photos), attempts: len(o.attempts),
    kv: Array.isArray(o.kv) ? o.kv.length : o.kv && typeof o.kv === 'object' ? Object.keys(o.kv).length : 0,
    photosOmitted: !!o.photosOmitted,
    hasCode: Array.isArray(o.kv) ? o.kv.some(r => r && r.key === CODE_KEY) : !!(o.kv && typeof o.kv === 'object' && CODE_KEY in o.kv),
  };
}
export function backupText(sum, now = new Date()) {
  const when = sum.at ? `做于 ${dateCn(localYmd(sum.at) || sum.at, now)}` : '没写日期';
  const photos = sum.photosOmitted ? '不含照片' : `${sum.photos} 张照片`;
  return `${when}，${sum.items} 道错题、${photos}、${sum.attempts} 次作答。`;
}
// “清除全部数据”用：一个什么都没有的备份，按替换导入，四张表一起清空（db.js importAll 一个事务）
export const emptyExport = (now = new Date()) => ({ format: EXPORT_FORMAT, version: EXPORT_VERSION, app: APP_NAME, at: new Date(now).toISOString(), photos: [], items: [], attempts: [], kv: [] });

// ---------------------------------------------------------------- 模拟模式（纯数据）

export const MOCK_CASE_LABELS = {
  '': '练习册一页：6 道计算，打叉 2 道（默认）',
  brackets: '作业本：去括号化简，打叉 1 道',
  equation: '作业本：解方程，去分母漏乘了右边',
  half: '作业本：几何题，半对',
  sideways: '作业本：横着拍的应用题',
  ungraded: '老师还没批改的一页',
  unclear: '有两处字看不清',
  empty: '一道题也没认出来',
};
export const mockCaseOptions = () => RECOGNIZE_CASES.map(id => ({ id, label: MOCK_CASE_LABELS[id] || id }));
// ai.js 认 settings.mockFail：模拟模式下每次都假装出这种错（看报错界面用）
export const MOCK_FAIL_OPTIONS = [
  ['', '不出错'], ['network', '连不上'], ['timeout', '超时'], ['offline', '没连网'], ['server', 'Poe 那边出错'],
  ['incomplete', '回答没讲完'], ['budget-day', '到了每天上限'], ['badkey', 'Key 不对'], ['billing', '积分不够'],
];

// ---------------------------------------------------------------- 界面

export function createParent(ctx) {
  const root = document.getElementById('view-parent');
  root.replaceChildren();
  root.classList.add('parent');

  const peek = (k, d) => { const v = ctx.kv.peek(k, d); return v === undefined || v === null ? d : v; };
  const settings = () => ctx.settings();
  const mockOn = () => !!(settings().mock || (ctx.mockForced && ctx.mockForced()));
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const toast = (m, ms) => ctx.toast(m, ms);
  const errText = e => (e && e.message) || String(e);

  // 课本目录：接线以后在 ctx.curriculum；没有就自己载一次（公开文件，Service Worker 缓存了）
  let curriculum = ctx.curriculum || null;
  if (!curriculum) loadCurriculum().then(c => { curriculum = c; softRender(); }, () => {});
  const sections = () => (curriculum && Array.isArray(curriculum.sections) ? curriculum.sections : []);

  // ---------------------------------------------------------------- 顶栏和两块：门、设置
  const backBtn = h('button', { type: 'button', className: 'back', on: { click: () => ctx.back() } }, icon('back'), h('span', { className: 'back-label', text: '首页' }));
  const lockBtn = h('button', { type: 'button', className: 'text-btn parent-lock', hidden: true, on: { click: handOver } }, icon('lock'), h('span', { text: '锁上' }));
  root.append(h('header', { className: 'navbar' }, h('div', { className: 'inner' }, backBtn, h('span', { className: 'nav-title', text: '家长' }), h('span', { className: 'nav-end' }, lockBtn))));
  const gateBox = h('div', { className: 'page parent-gate' });
  const mainBox = h('div', { className: 'page parent-main', hidden: true });
  root.append(gateBox, mainBox);

  let unlocked = false;

  // ---------------------------------------------------------------- 门：设码、输码、忘了
  let mode = 'enter';      // 'set1' | 'set2' | 'enter' | 'forgot'
  let digits = '';
  let first = '';
  let msg = '';
  let wrong = 0;
  let waitUntil = 0;
  let checking = false;
  let shake = false;
  let wipeStep = 0;        // “清除全部数据”的两步确认：0 没开始，1 说明，2 再确认一次

  function press(d) {
    if (checking || Date.now() < waitUntil || digits.length >= CODE_LEN) return;
    digits += d;
    msg = '';
    renderGate();
    if (digits.length === CODE_LEN) setTimeout(submit, 120);   // 让第 4 个点亮一下再判
  }
  function del() { if (!checking) { digits = digits.slice(0, -1); renderGate(); } }
  function fail(text) { msg = text; digits = ''; shake = true; renderGate(); shake = false; }

  async function submit() {
    const code = digits;
    if (mode === 'set1') {
      if (weakCode(code)) { fail(GATE_COPY.weak); return; }
      first = code; digits = ''; mode = 'set2'; renderGate(); return;
    }
    if (mode === 'set2') {
      if (code !== first) { mode = 'set1'; first = ''; fail(GATE_COPY.mismatch); return; }
      checking = true;
      try {
        await ctx.kv.set(CODE_KEY, await makeCode(code));
        toast('数字码设好了');
        unlock();
      } catch (e) { mode = 'set1'; fail('没存上：' + errText(e)); }
      finally { checking = false; }
      return;
    }
    checking = true;
    const ok = await checkCode(peek(CODE_KEY, null), code).catch(() => false);
    checking = false;
    if (ok) { wrong = 0; unlock(); return; }
    if (++wrong >= MAX_WRONG) {
      wrong = 0;
      waitUntil = Date.now() + WAIT_MS;
      setTimeout(() => { msg = ''; if (!unlocked) renderGate(); }, WAIT_MS + 50);
      fail(GATE_COPY.wait);
      return;
    }
    fail(GATE_COPY.wrong);
  }

  function renderGate() {
    const waiting = Date.now() < waitUntil;
    const title = GATE_COPY.title[mode];
    const sub = GATE_COPY.sub[mode];
    const kids = [h('h1', { className: 'page-title', text: '家长' }), h('p', { className: 'parent-gate-title serif', text: title }),
      sub ? h('p', { className: 'small', text: sub }) : null];
    if (mode === 'forgot') {
      kids.push(h('div', { className: 'parent-wipe parent-gate-wipe' }, ...wipeUI({ cancelText: GATE_COPY.remembered, onCancel: () => { mode = 'enter'; wipeStep = 0; renderGate(); }, redraw: renderGate })));
    } else {
      const key = d => h('button', { type: 'button', className: 'parent-key num', text: d, disabled: waiting, on: { click: () => press(d) } });
      kids.push(
        h('div', { className: 'parent-dots' + (shake ? ' shake' : ''), role: 'img', 'aria-label': `已输入 ${digits.length} 位` },
          Array.from({ length: CODE_LEN }, (_, i) => h('span', { className: 'parent-dot' + (i < digits.length ? ' on' : '') }))),
        h('p', { className: 'small parent-msg' + (msg ? ' danger' : ''), role: msg ? 'alert' : null, text: msg }),
        h('div', { className: 'parent-keypad', role: 'group', 'aria-label': '数字键' },
          ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key),
          mode === 'enter' ? h('button', { type: 'button', className: 'parent-key fn', text: '忘了', on: { click: () => { mode = 'forgot'; wipeStep = 1; digits = ''; msg = ''; renderGate(); } } })
            : mode === 'set2' ? h('button', { type: 'button', className: 'parent-key fn', text: '重来', on: { click: () => { mode = 'set1'; first = ''; digits = ''; renderGate(); } } })
              : h('span'),
          key('0'),
          h('button', { type: 'button', className: 'parent-key fn', 'aria-label': '删掉一位', on: { click: del } }, icon('back'))));
    }
    gateBox.replaceChildren(h('div', { className: 'parent-gate-inner' + (waiting ? ' waiting' : '') }, ...kids.filter(Boolean)));
  }

  document.addEventListener('keydown', ev => {
    if (unlocked || mode === 'forgot' || root.hidden || (ctx.route && ctx.route() !== 'parent')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (/^\d$/.test(ev.key)) { ev.preventDefault(); press(ev.key); }
    else if (ev.key === 'Backspace') { ev.preventDefault(); del(); }
  });

  function showGate() {
    gateBox.hidden = false;
    mainBox.hidden = true;
    lockBtn.hidden = true;
    mode = peek(CODE_KEY, null) ? 'enter' : 'set1';
    digits = ''; first = ''; msg = ''; wipeStep = 0;
    renderGate();
  }

  // ---------------------------------------------------------------- 上锁和解锁
  let idleTimer = 0;
  function unlock() {
    unlocked = true;
    digits = ''; first = ''; msg = '';
    gateBox.hidden = true;
    mainBox.hidden = false;
    lockBtn.hidden = true;
    loadItems();
    loadProf();
    refreshStorage();
    render();
    touch();
    window.scrollTo(0, 0);
  }
  function lock() {
    clearTimeout(idleTimer);
    if (ctl) { ctl.abort(); ctl = null; }
    if (!unlocked) return;
    unlocked = false;
    openRows.clear();
    drafts = { url: '' };
    examDraft = null;
    pingState = null;
    prepared = null;
    importState = null;
    wipeStep = 0;
    mainBox.replaceChildren();
    showGate();
  }
  function touch() {
    clearTimeout(idleTimer);
  }
  for (const t of ['pointerdown', 'keydown', 'input', 'wheel']) root.addEventListener(t, touch, { capture: true, passive: true });
  function handOver() { lock(); ctx.go('home'); }

  // ---------------------------------------------------------------- 一组、一行（照英语 App 的 ui-me.js）
  const openRows = new Set();
  let justOpened = '';     // 刚点开的那一行（只有它的输入框自动聚焦，别的重画不抢焦点）
  const toggleRow = key => {
    if (openRows.has(key)) { openRows.delete(key); if (key === 'wipe') wipeStep = 0; if (key === 'exam') examDraft = null; }
    else { openRows.add(key); justOpened = key; }
    render();
  };
  const closeRow = key => { openRows.delete(key); render(); };
  const group = (title, rows, foot) => h('section', { className: 'parent-group' }, h('h2', { className: 'sec-h', text: title }),
    h('ul', { className: 'parent-rows' }, ...rows.filter(Boolean)), foot ? (typeof foot === 'string' ? h('p', { className: 'small parent-foot', text: foot }) : foot) : null);
  // key + panel：点一下在原地展开；value：右边的字；right：放在这一行上的控件；after：行下面一直显示的东西
  function row({ key = '', label, sub = '', value = null, right = null, panel = null, after = null, cls = '' }) {
    const go = !!panel;
    const open = go && openRows.has(key);
    const k = h('span', { className: 'k' }, h('b', { text: label }), sub ? h('span', { text: sub }) : null);
    const v = value !== null && value !== undefined && value !== '' ? h('span', { className: 'v', text: String(value) }) : null;
    const head = go
      ? h('button', { type: 'button', className: 'parent-row-head', 'aria-expanded': String(open), on: { click: () => toggleRow(key) } }, k, v, icon('chev', 'chev'))
      : h('div', { className: 'parent-row-head' + (right ? ' has-right' : '') }, k, v, right);
    return h('li', { className: 'parent-row' + (go ? ' go' : '') + (open ? ' open' : '') + (cls ? ' ' + cls : ''), dataset: key ? { row: key } : null },
      head, open ? h('div', { className: 'parent-panel' }, ...[].concat(panel()).filter(Boolean)) : null, after);
  }
  function toggle(on, onChange, { disabled = false, label = '' } = {}) {
    const b = h('button', { type: 'button', className: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, disabled });
    b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onChange(v); });
    return b;
  }
  function select(options, value, onChange, label) {
    const s = h('select', { className: 'select', 'aria-label': label });
    for (const o of options) {
      if (o.group) s.append(h('optgroup', { label: o.group }, ...o.options.map(x => h('option', { value: x.value, text: x.text }))));
      else s.append(h('option', { value: o.value, text: o.text }));
    }
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  const saveSettings = async (patch, okMsg) => {
    try { await ctx.saveSettings(patch); if (okMsg) toast(okMsg); return true; }
    catch (e) { toast('没存上：' + errText(e), 3500); return false; }
  };

  // ---------------------------------------------------------------- 连接
  let drafts = { url: '' };
  let pingState = null;    // null | { running: true } | { kind, lines }
  let ctl = null;

  function urlPanel() {
    const s = settings();
    const input = h('input', { type: 'url', className: 'field', inputmode: 'url', placeholder: 'https://域名/暗号/v1', autocomplete: 'off',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': '中转站地址', value: drafts.url,
      on: { input: ev => { drafts.url = ev.target.value; } } });
    const err = h('p', { className: 'small danger', role: 'alert', hidden: true });
    const save = async v => {
      const n = normalizePoeUrl(v);
      if (n === '') { err.hidden = false; err.textContent = '先粘贴地址。'; return; }
      if (n === null) { err.hidden = false; err.textContent = '地址不对：要以 https:// 开头，中间不能有空格。'; return; }
      if (await saveSettings({ poeUrl: v }, '地址存好了')) { drafts.url = ''; pingState = null; closeRow('url'); }
    };
    return [
      h('p', { className: 'small', text: '粘贴中转站装好时给的地址，以 https:// 开头，带暗号。末尾的 /v1 没有也行，会自动补上。' }),
      s.poeUrl ? h('p', { className: 'small', text: `现在：${relayHost(s.poeUrl) || s.poeUrl}（暗号不显示）` }) : null,
      input, err,
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '保存', on: { click: () => save(input.value) } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { drafts.url = ''; closeRow('url'); } } }),
        s.poeUrl !== POE_DIRECT_URL ? h('button', { type: 'button', className: 'text-btn accent', text: '改用直连 api.poe.com', on: { click: () => save(POE_DIRECT_URL) } }) : null,
        s.poeUrl ? h('button', { type: 'button', className: 'text-btn danger', text: '清除', on: { click: async () => { if (await saveSettings({ poeUrl: '' }, '地址清掉了')) { pingState = null; closeRow('url'); } } } }) : null),
      h('p', { className: 'small', text: '直连 api.poe.com 在国内要开 VPN，平时用中转站。' }),
    ];
  }
  function keyPanel() {
    const s = settings();
    const input = h('input', { type: 'password', className: 'field mono', placeholder: '粘贴 Poe 的 API Key', autocomplete: 'off', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Poe API Key' });
    if (justOpened === 'key') requestAnimationFrame(() => input.focus());
    const save = async () => {
      // 从备忘录、微信复制过来常带换行和看不见的字符，留着会让请求头出错
      const v = input.value.replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '');
      if (!v) { toast('先粘贴 Key'); return; }
      if (!/^[\x21-\x7e]+$/.test(v)) { toast('Key 里有不认识的字符，回 poe.com/api_key 重新复制一次', 3500); return; }
      if (await saveSettings({ poeKey: v }, 'Key 存在这台 iPad 上了')) { input.value = ''; closeRow('key'); }
    };
    return [
      h('p', { className: 'small', text: '在 poe.com/api_key 复制。只存在这台 iPad 上，不进备份文件；中转站不存 Key，只是原样转给 Poe。存好以后只显示最后 4 位。' }),
      h('p', { className: 'small', text: '建议单独建一个给数学老师用的 Key（名字写 emma-math），用量好分开看。' }),
      input,
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '保存', on: { click: save } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => closeRow('key') } }),
        s.poeKey ? h('button', { type: 'button', className: 'text-btn danger', text: '清除 Key', on: { click: async () => { if (await saveSettings({ poeKey: '' }, 'Key 清掉了')) closeRow('key'); } } }) : null),
    ];
  }
  async function ping() {
    if (ctl) ctl.abort();
    const mine = ctl = new AbortController();
    const timer = setTimeout(() => mine.abort(), 20000);
    pingState = { running: true };
    render();
    let report;
    try {
      // ping 不抛错：连不上时回 { ok: false, code, message }
      const r = await ctx.ai.ping({ signal: mine.signal });
      report = pingReport(r, { mock: mockOn(), aborted: mine.signal.aborted && !(r && r.ok) });
    } catch (e) {
      report = mine.signal.aborted ? pingReport(null, { aborted: true }) : { kind: 'bad', lines: [codeText(e && e.code) || '没连上。', parentDetail(e)].filter(Boolean) };
    } finally { clearTimeout(timer); }
    if (ctl !== mine || !unlocked) return;   // 测到一半离开了家长区，或者又点了一次
    ctl = null;
    pingState = report;
    softRender();
  }
  function connectionGroup() {
    const s = settings();
    const n = normalizePoeUrl(s.poeUrl);
    const urlValue = !s.poeUrl ? '还没填' : n === null ? '格式不对' : relayHost(n) || '已填';
    const running = !!(pingState && pingState.running);
    const result = pingState && !running
      ? h('div', { className: 'result' + (pingState.kind ? ' ' + pingState.kind : ''), role: 'status' }, ...pingState.lines.map((t, i) => h('p', { className: i ? 'small' : '', text: t })))
      : running ? h('p', { className: 'small dots parent-pinging', role: 'status', text: '正在连' }) : null;
    return group('连接', [
      row({ key: 'url', label: '中转站地址', sub: '新加坡中转站，地址里带暗号', value: urlValue, panel: urlPanel }),
      row({ key: 'key', label: 'Poe Key', sub: '只存在这台 iPad 上', value: maskKey(s.poeKey) || '还没填', panel: keyPanel }),
      row({ label: '测一下连接', sub: '看看地址通不通、要用的模型在不在。不花积分。',
        right: h('button', { type: 'button', className: 'text-btn accent', text: running ? '正在测' : '测一下', disabled: running, on: { click: ping } }),
        after: result ? h('div', { className: 'parent-after' }, result) : null }),
    ]);
  }

  // ---------------------------------------------------------------- 花费
  function capPanel() {
    const cap = settings().dailyCapUSD;
    const num = h('span', { className: 'parent-step-n', text: capText(clampCap(cap)) + ' 美元' });
    const step = d => async () => {
      const v = clampCap(settings().dailyCapUSD, d);
      if (await saveSettings({ dailyCapUSD: v })) render();
    };
    return [
      h('p', { className: 'small', text: `建议 ${SUGGESTED_CAP_USD} 美元（${pointsText(SUGGESTED_CAP_USD)}）。一道错题从看照片到讲完，大约 0.04 美元。` }),
      h('p', { className: 'small', text: '到了上限，当天不再找 AI，照片先存着明天看；复习和判题在 iPad 上做，照常。上限防的是程序出错一直调用。' }),
      h('div', { className: 'parent-stepper' },
        h('button', { type: 'button', className: 'parent-step', 'aria-label': '少 0.1 美元', on: { click: step(-CAP_STEP) } }, icon('minus')), num,
        h('button', { type: 'button', className: 'parent-step', 'aria-label': '多 0.1 美元', on: { click: step(CAP_STEP) } }, icon('plus'))),
      Number(cap) !== SUGGESTED_CAP_USD ? h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn accent', text: `改回建议的 ${SUGGESTED_CAP_USD}`,
        on: { click: async () => { if (await saveSettings({ dailyCapUSD: SUGGESTED_CAP_USD })) render(); } } })) : null,
    ];
  }
  function moneyGroup() {
    let t = { usd: 0, byTask: {}, cap: settings().dailyCapUSD, left: 0 }, m = { usd: 0, byTask: {} };
    try { if (ctx.budget) { t = ctx.budget.today(); m = ctx.budget.month(); } } catch (e) { /* 还没载入 */ }
    const line = (x, empty) => [x.usd > 0 ? pointsText(x.usd) : '', byTaskText(x.byTask)].filter(Boolean).join(' · ') || empty;
    return group('花费', [
      row({ label: '今天', sub: line(t, '今天还没花'), value: usdText(t.usd), cls: 'parent-money' }),
      row({ label: '本月', sub: line(m, '这个月还没花'), value: usdText(m.usd), cls: 'parent-money' }),
      row({ key: 'cap', label: '每天上限', sub: `今天还剩 ${usdText(t.left)}`, value: capText(t.cap) + ' 美元', panel: capPanel, cls: 'parent-money' }),
    ], `按每次回答的用量估算（1 美元约 3.3 万积分），以 poe.com 上这个 Key 的用量记录为准。${mockOn() ? '模拟模式不花钱，也不记账。' : ''}`);
  }

  // ---------------------------------------------------------------- 模型
  function modelGroup() {
    const rows = taskRows(settings());
    const changed = rows.some(r => r.changed);
    return group('模型', rows.map(r => {
      const opts = modelChoices(r.model).map(m => ({ value: m, text: m + (m === r.recommended ? '（推荐）' : '') }));
      return row({ label: r.label, sub: (r.changed ? `改过，推荐 ${r.recommended}` : '用推荐的') + ' · ' + priceText(r.model), cls: 'parent-model',
        right: select(opts, r.model, async v => { if (await saveSettings({ taskModels: { [r.task]: v } }, `${r.label}：${v}`)) render(); }, `${r.label}用哪个模型`) });
    }), h('div', { className: 'parent-foot' },
      h('p', { className: 'small', text: '推荐的是 10-24 比拼和实测的结果。换了以后，这个任务的参数跟着新模型走；主模型连着失败时，会换另一家备用模型再试一次。' }),
      changed ? h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn accent', text: '恢复推荐',
        on: { click: async () => { if (await saveSettings({ taskModels: Object.fromEntries(rows.map(r => [r.task, r.recommended])) }, '都换回推荐的了')) render(); } } })) : null));
  }

  // ---------------------------------------------------------------- 学习设置：进度锚点、考试
  let examDraft = null;    // { date, sections: Set } 展开考试那一行时的草稿
  function progressPanel() {
    const list = sections();
    if (!list.length) return [h('p', { className: 'small', text: '课本目录还没载入。连上网后再打开这一行。' })];
    const cur = (peek('progress', {}) || {}).section || '';
    const opts = [{ value: '', text: '选一节' }, ...chapterGroups(list).map(g => ({ group: g.label, options: g.sections.map(s => ({ value: s.id, text: `${s.id} ${s.title}` })) }))];
    return [
      h('p', { className: 'small', text: '她现在课上学到哪一节。出新题、变式题只用这一节和之前学过的；讲题时用到后面的内容，会直接讲清楚。' }),
      select(opts, cur, async v => {
        try {
          await ctx.kv.set('progress', { ...(peek('progress', {}) || {}), section: v, updated: new Date().toISOString() });
          toast(v ? `进度：${progressText({ section: v }, curriculum)}` : '进度清掉了');
        } catch (e) { toast('没存上：' + errText(e), 3500); }
        render();
      }, '学到哪一节'),
      h('p', { className: 'small', text: '一周问她一次“这周讲到哪了”，改这里。' }),
    ];
  }
  function examPanel() {
    const list = sections();
    const saved = peek('exam', {}) || {};
    if (!examDraft) examDraft = { date: saved.date || '', sections: new Set(Array.isArray(saved.sections) ? saved.sections : []) };
    const d = examDraft;
    const date = h('input', { type: 'date', className: 'field', value: d.date, 'aria-label': '考试日期', on: { input: ev => { d.date = ev.target.value; }, change: ev => { d.date = ev.target.value; } } });
    const progressAt = (peek('progress', {}) || {}).section || '';
    const pill = (text, on, onClick, label) => h('button', { type: 'button', className: 'parent-pill', 'aria-pressed': String(!!on), 'aria-label': label || text, text, on: { click: onClick } });
    const chapters = chapterGroups(list).filter(g => Number(g.chapter) > 0);
    const blocks = chapters.map(g => {
      const ids = g.sections.map(s => s.id);
      const all = ids.every(id => d.sections.has(id));
      return h('div', { className: 'parent-ch' },
        h('div', { className: 'parent-ch-head' }, h('span', { className: 'parent-ch-title', text: g.label }),
          h('button', { type: 'button', className: 'text-btn accent', text: all ? '整章不选' : '整章都考', on: { click: () => { for (const id of ids) { if (all) d.sections.delete(id); else d.sections.add(id); } render(); } } })),
        h('div', { className: 'parent-pills' }, ...g.sections.map(s => pill(s.id, d.sections.has(s.id),
          () => { if (d.sections.has(s.id)) d.sections.delete(s.id); else d.sections.add(s.id); render(); }, `${s.id} ${s.title}`))));
    });
    // 第 1 章第一节到进度锚点那一节（小学衔接不算）
    const upToProgress = () => {
      const book = list.filter(s => Number(s.chapter) > 0);
      const at = book.findIndex(s => s.id === progressAt);
      if (at < 0) { toast('先在上面设好进度'); return; }
      d.sections = new Set(book.slice(0, at + 1).map(s => s.id));
      render();
    };
    const picked = rangeText([...d.sections], list);
    return [
      h('p', { className: 'small', text: '问老师要期中的日期和范围（或者看复习提纲）。以后的期中季、错题卷按这个排。' }),
      h('label', { className: 'parent-label', text: '日期' }), date,
      h('label', { className: 'parent-label', text: '范围' }),
      h('p', { className: 'small parent-picked', text: picked ? `选了：${picked}` : '还没选。' }),
      list.length ? h('div', { className: 'btn-row parent-quick' },
        progressAt ? h('button', { type: 'button', className: 'text-btn accent', text: '从第一章到现在的进度', on: { click: upToProgress } }) : null,
        d.sections.size ? h('button', { type: 'button', className: 'text-btn', text: '全不选', on: { click: () => { d.sections.clear(); render(); } } }) : null) : null,
      ...(list.length ? blocks : [h('p', { className: 'small', text: '课本目录还没载入。连上网后再打开这一行。' })]),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '保存', on: { click: async () => {
          try {
            await ctx.kv.set('exam', examRecord({ date: d.date, sections: [...d.sections] }, list));
            toast('考试日期和范围存好了');
            examDraft = null;
            closeRow('exam');
          } catch (e) { toast('没存上：' + errText(e), 3500); }
        } } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { examDraft = null; closeRow('exam'); } } }),
        saved.date || (saved.sections || []).length ? h('button', { type: 'button', className: 'text-btn danger', text: '清除', on: { click: async () => {
          try { await ctx.kv.set('exam', examRecord({}, list)); toast('清掉了'); } catch (e) { toast('没存上：' + errText(e), 3500); }
          examDraft = null;
          closeRow('exam');
        } } }) : null),
    ];
  }
  function studyGroup() {
    return group('学习设置', [
      row({ key: 'progress', label: '学到哪一节', sub: '进度锚点', value: progressText(peek('progress', {}), curriculum), panel: progressPanel }),
      row({ key: 'exam', label: '考试', sub: '日期和范围', value: examSummary(peek('exam', {}), sections(), todayStr()), panel: examPanel }),
    ]);
  }

  // ---------------------------------------------------------------- v0.3 老师眼里的 Emma（学情档案，profile.js）
  // 和对话里老师看到的是同一份：最需要帮的点（带证据）、已经跨过去的、最近的进步、和老师聊过的。只读。
  let prof = null;         // null = 还在算
  function loadProf() {
    loadProfile(ctx).then(p => { prof = p; softRender(); }, e => { console.warn('profile', e); prof = { weak: [], strong: [], recent: [], text: '' }; softRender(); });
  }
  function weakPanel() {
    if (prof === null) return [loading()];
    if (!prof.weak.length) return [h('p', { className: 'small', text: '还没有看出要特别帮的地方。错题讲过几道、复习做过几次以后，这里会列出来。' })];
    return [
      h('p', { className: 'small', text: '按错题卡、近 14 天的复习、对话里老师记下的情况算出来，越靠前越需要帮。老师主动找她聊、回答她的问题时，会参考这几条。' }),
      h('ol', { className: 'parent-list parent-weak' }, ...prof.weak.map(w => h('li', { className: 'parent-item' },
        h('div', { className: 'parent-item-body' },
          h('p', { className: 'parent-q', text: w.name + (w.learning ? (w.stage ? `（在练，第 ${w.stage} 档）` : '（在练）') : '') }),
          ...w.evidence.map(t => h('p', { className: 'small', text: t })),
          h('p', { className: 'small parent-meta', text: `分数 ${w.score}${w.tag ? ' · ' + w.tag : ''}` }))))),
    ];
  }
  function chatsPanel() {
    const list = peek('chats', []);
    if (!list.length) return [h('p', { className: 'small', text: '她还没和老师聊过。' })];
    const MODE = { free: '她问的', probe: '老师找她聊', problem: '讲完错题接着问' };
    return [
      h('p', { className: 'small', text: '最近 50 段，只存在这台 iPad 上。' }),
      h('ul', { className: 'parent-list' }, ...list.slice(0, 20).map(x => h('li', { className: 'parent-item' },
        h('div', { className: 'parent-item-body' },
          h('p', { className: 'parent-q', text: x.title || '问我' }),
          h('p', { className: 'small parent-meta', text: [MODE[x.mode] || '', ago(x.updated || x.at)].filter(Boolean).join(' · ') }))))),
    ];
  }
  function teacherGroup() {
    const n = prof === null ? '' : prof.weak.length ? `${prof.weak.length} 个` : '还没有';
    const chats = peek('chats', []);
    return group('老师眼里的 Emma', [
      row({ key: 'weak', label: '最需要帮的', sub: '带证据，越靠前越需要帮', value: n, panel: weakPanel }),
      row({ key: 'strong', label: '已经跨过去的', value: prof === null ? '' : prof.strong.length ? `${prof.strong.length} 个` : '还没有',
        panel: () => (prof === null ? [loading()] : prof.strong.length ? [h('p', { text: prof.strong.map(x => x.name).join('、') })] : [h('p', { className: 'small', text: '攻克了的坑、对话里弄懂了的点会出现在这里。' })]) }),
      row({ key: 'recent7', label: '最近的进步', sub: '近 7 天', value: prof === null ? '' : prof.recent.length ? `${prof.recent.length} 条` : '还没有',
        panel: () => (prof === null ? [loading()] : prof.recent.length ? prof.recent.map(t => h('p', { className: 'small', text: t })) : [h('p', { className: 'small', text: '近 7 天还没有。' })]) }),
      row({ key: 'chats', label: '和老师聊过的', value: chats.length ? `${chats.length} 段` : '还没有', panel: chatsPanel }),
    ], '只读。老师每次和她对话都带着这份档案。');
  }

  // ---------------------------------------------------------------- v0.3 语音转文字（voice.js）
  function doubaoPanel() {
    const d = settings().doubao || {};
    const appId = h('input', { type: 'text', className: 'field mono', placeholder: 'App ID', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': '豆包 App ID', value: d.appId || '' });
    const key = h('input', { type: 'password', className: 'field mono', placeholder: d.accessKey ? '已填（不显示），要换就粘贴新的' : 'Access Key', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': '豆包 Access Key' });
    if (justOpened === 'doubao') requestAnimationFrame(() => appId.focus());
    const clean = v => String(v || '').replace(/[\s\u200b-\u200d\u2060\ufeff]/g, '');
    const save = async () => {
      const next = { appId: clean(appId.value), accessKey: clean(key.value) || d.accessKey || '' };
      if (!next.appId || !next.accessKey) { toast('App ID 和 Access Key 都要填'); return; }
      if (await saveSettings({ doubao: next, asr: 'doubao' }, '存好了，语音改用豆包')) closeRow('doubao');
    };
    return [
      h('p', { className: 'small', text: '火山引擎控制台“豆包语音”里，开通“大模型录音文件识别极速版”，复制 App ID 和 Access Key。只存在这台 iPad 上，不进备份文件。' }),
      h('p', { className: 'small', text: '还没实测过：豆包没转成（Key 不对、浏览器不让直接调用等），会自动改用 Poe，她感觉不到，“最近的 AI 调用”里能看到原因。' }),
      h('label', { className: 'fld' }, h('span', { className: 'fld-k', text: 'App ID' }), appId),
      h('label', { className: 'fld' }, h('span', { className: 'fld-k', text: 'Access Key' }), key),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn', text: '保存', on: { click: save } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => closeRow('doubao') } }),
        d.appId || d.accessKey ? h('button', { type: 'button', className: 'text-btn danger', text: '清除', on: { click: async () => { if (await saveSettings({ doubao: { appId: '', accessKey: '' }, asr: 'poe' }, '清掉了，语音用 Poe')) closeRow('doubao'); } } }) : null),
    ];
  }
  function voiceGroup() {
    const s = settings();
    const d = s.doubao || {};
    const ready = !!(d.appId && d.accessKey);
    const asr = s.asr === 'doubao' ? 'doubao' : 'poe';
    return group('语音转文字', [
      row({ label: '她说的话用谁转成文字', sub: asr === 'doubao' && !ready ? '选了豆包但还没填 Key，现在用的是 Poe' : '转好的字先放进输入框，她看一眼再发', cls: 'parent-model',
        right: select([{ value: 'poe', text: 'Poe（gemini-3.1-pro）' }, { value: 'doubao', text: '豆包语音' }], asr,
          async v => { if (await saveSettings({ asr: v }, v === 'doubao' && !ready ? '再填上豆包的 App ID 和 Key' : '')) render(); }, '语音转文字') }),
      row({ key: 'doubao', label: '豆包 App ID 和 Key', sub: '火山引擎，录音文件识别极速版', value: ready ? '已填' : '还没填', panel: doubaoPanel }),
    ], 'Poe 转一段 10 秒的话大约 7 到 9 秒。');
  }

  // ---------------------------------------------------------------- 两张清单：问老师、“这题有问题”
  let items = null;        // null = 还在读
  let itemsError = '';
  function loadItems() {
    if (!ctx.store || !ctx.store.all) { items = []; return; }
    ctx.store.all('items').then(list => { items = Array.isArray(list) ? list : []; itemsError = ''; softRender(); },
      e => { items = []; itemsError = errText(e); softRender(); });
  }
  const loading = () => h('p', { className: 'small dots', text: '正在读' });
  function askPanel() {
    if (items === null) return [loading()];
    const list = askList(items);
    if (!list.length) return [h('p', { className: 'small', text: '现在没有要问老师的题。' })];
    return [
      h('p', { className: 'small', text: '这些题我没讲：答案核对不了，或者她觉得我（或老师）判得不对。让她带去问学校老师。' }),
      h('ul', { className: 'parent-list' }, ...list.map(x => h('li', { className: 'parent-item' + (x.thumb ? ' has-thumb' : '') },
        x.thumb ? h('img', { src: x.thumb, alt: '原题截图', loading: 'lazy' }) : null,
        h('div', { className: 'parent-item-body' },
          x.stem ? mathText(x.stem, { tag: 'div', className: 'parent-q' }) : h('div', { className: 'parent-q muted', text: '（没有题目文字）' }),
          x.herAnswer ? h('p', { className: 'small' }, '她的答案：', mathText(x.herAnswer)) : null,
          x.computed ? h('p', { className: 'small' }, '程序算的：', mathText(x.computed)) : null,
          x.reason ? h('p', { className: 'small', text: x.reason }) : null,
          x.answer ? h('p', { className: 'small parent-good', text: '老师给的答案：' + x.answer }) : null,
          h('p', { className: 'small parent-meta', text: [x.day ? dateCn(x.day) : x.at ? dateCn(localYmd(x.at)) : '', x.source].filter(Boolean).join(' · ') }))))),
    ];
  }
  function flagPanel() {
    if (items === null) return [loading()];
    const list = collectFlags(items);
    if (!list.length) return [h('p', { className: 'small', text: '她还没点过“这题有问题”。' })];
    return [
      h('p', { className: 'small', text: '她觉得题目或讲解不对时点的。点了的题已经下架，不计对错。一周超过 2 次，看看是不是哪个模型讲得不好。' }),
      h('ul', { className: 'parent-list' }, ...list.map(x => h('li', { className: 'parent-item' },
        h('div', { className: 'parent-item-body' },
          x.what ? h('p', { className: 'label', text: x.what }) : null,
          x.q ? mathText(x.q, { tag: 'div', className: 'parent-q' }) : x.stem ? mathText(x.stem, { tag: 'div', className: 'parent-q' }) : null,
          x.answer ? h('p', { className: 'small' }, '当时给的答案：', mathText(x.answer)) : null,
          x.note ? h('p', { className: 'small', text: '她说：' + x.note }) : null,
          x.q && x.stem && x.q !== x.stem ? h('p', { className: 'small parent-meta' }, '原题：', mathText(x.stem)) : null,
          h('p', { className: 'small parent-meta', text: x.day ? dateCn(x.day) : '' }))))),
    ];
  }
  function listsGroup() {
    const nAsk = items === null ? null : askList(items).length;
    const nFlag = items === null ? null : collectFlags(items).length;
    const count = (n, unit) => (n === null ? '' : n ? `${n} ${unit}` : '没有');
    return group('她的题', [
      row({ key: 'ask', label: '问老师', sub: '我讲不了、要问学校老师的题', value: count(nAsk, '道'), panel: askPanel }),
      row({ key: 'flags', label: '“这题有问题”', sub: '她点过的题和讲解', value: count(nFlag, '次'), panel: flagPanel }),
    ], itemsError ? `错题本没读出来：${itemsError}` : '只读。改动在她那边的错题本里做。');
  }

  // ---------------------------------------------------------------- 最近的 AI 调用
  function recentPanel() {
    let rows = [];
    try { rows = recentRows(ctx.ai && ctx.ai.recent ? ctx.ai.recent() : []); } catch (e) { rows = []; }
    if (!rows.length) return [h('p', { className: 'small', text: '打开 App 以后还没有调用过。' })];
    const result = r => (r.pending ? '进行中' : r.ok ? '成功' : r.code || '失败');
    return [
      h('div', { className: 'parent-calls-wrap' }, h('table', { className: 'parent-calls' },
        h('thead', {}, h('tr', {}, ...['时间', '任务', '模型', '用时', '结果', '美元'].map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...rows.flatMap(r => [
          h('tr', { className: r.ok || r.pending ? '' : 'bad' },
            h('td', { className: 'num', text: r.time }), h('td', { text: r.task }), h('td', { className: 'mono', text: r.model || '' }),
            h('td', { className: 'num', text: r.ms ? fmtSecs(r.ms) : '' }), h('td', { text: result(r) }), h('td', { className: 'num', text: r.usd ? usdShort(r.usd) : '' })),
          r.detail ? h('tr', { className: 'parent-call-detail' }, h('td', { colSpan: 6, text: r.detail })) : null,
        ].filter(Boolean))))),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn accent', text: '刷新', on: { click: render } })),
    ];
  }
  function recentGroup() {
    let rows = [];
    try { rows = ctx.ai && ctx.ai.recent ? ctx.ai.recent() : []; } catch (e) { rows = []; }
    const bad = rows.filter(r => r && !r.ok && r.code).length;
    return group('最近的 AI 调用', [
      row({ key: 'recent', label: '最近 50 次', sub: '任务、模型、用时、成没成、花了多少。出错时这里有技术说明。',
        value: rows.length ? `${rows.length} 次${bad ? `，${bad} 次出错` : ''}` : '还没有', panel: recentPanel }),
    ], '只记在内存里，关掉 App 就清空。不记提示词和回答。重试、换备用模型各算一次。');
  }

  // ---------------------------------------------------------------- 模拟模式
  function mockGroup() {
    const s = settings();
    const forced = !!(ctx.mockForced && ctx.mockForced());
    const on = mockOn();
    return group('模拟模式', [
      row({ label: '模拟模式', sub: forced ? '地址里带了 ?mock=1，现在一定是模拟模式。去掉它才会真的连网。' : '不连网，不花钱，回答都是假的。检查界面、演示用。',
        right: toggle(on, async v => { if (await saveSettings({ mock: v }, v ? '模拟模式开了' : '模拟模式关了')) render(); }, { disabled: forced, label: '模拟模式' }) }),
      on ? row({ label: '模拟哪一页', sub: '拍照以后“看到”的是哪一页', cls: 'parent-model',
        right: select(mockCaseOptions().map(o => ({ value: o.id, text: o.label })), s.mockCase || '', async v => { if (await saveSettings({ mockCase: v })) render(); }, '模拟哪一页') }) : null,
      on ? row({ label: '模拟出错', sub: '每次找 AI 都假装出这种错，看报错界面用', cls: 'parent-model',
        right: select(MOCK_FAIL_OPTIONS.map(([value, text]) => ({ value, text })), s.mockFail || '', async v => { if (await saveSettings({ mockFail: v }, v ? '记得用完改回“不出错”' : '')) render(); }, '模拟出错') }) : null,
    ]);
  }

  // ---------------------------------------------------------------- 数据：备份、导入、存储、清除
  let prepared = null;     // { file, text, at, sum, downloaded }
  let preparing = false;
  let importState = null;  // null | { busy } | { error } | { name, data, sum }
  let storage = null;      // { persisted, usage, quota }
  const fileIn = h('input', { type: 'file', className: 'visually-hidden', accept: '.json,application/json', tabIndex: -1, 'aria-label': '选择备份文件' });
  fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) readImport(f); });
  root.append(fileIn);

  async function prepare() {
    if (preparing || !ctx.store) return;
    preparing = true;
    render();
    try {
      const at = new Date();
      const data = await ctx.store.exportAll();
      const text = JSON.stringify(data);
      const file = new File([text], exportFileName(at), { type: 'application/json' });
      prepared = { file, size: file.size, at: data.at || at.toISOString(), sum: backupSummary(data) };
    } catch (e) {
      toast('打包没成功：' + errText(e), 4000);
    } finally { preparing = false; render(); }
  }
  async function exported(how) {
    const p = prepared;
    if (!p) return;
    try { await ctx.kv.set('lastExport', { at: p.at, items: p.sum.items, photos: p.sum.photos, attempts: p.sum.attempts }); } catch (e) { /* 只是记录 */ }
    toast(how === 'share' ? '备份好了' : '记下了这次备份', 3000);
    prepared = null;
    render();
  }
  // 分享要在一次点按里发起（iOS 要用户手势），所以打包和分享分成两下
  function share() {
    const p = prepared;
    if (!p) return;
    let can = false;
    try { can = !!(navigator.canShare && navigator.canShare({ files: [p.file] })); } catch (e) { can = false; }
    if (!can || !navigator.share) { download(); return; }
    navigator.share({ files: [p.file], title: p.file.name }).then(() => exported('share'), err => {
      if (err && err.name === 'AbortError') toast('取消了，还没存');
      else toast('没存成：' + errText(err) + '。可以点“改用下载”', 4000);
    });
  }
  function download() {
    const p = prepared;
    if (!p) return;
    const url = URL.createObjectURL(p.file);
    const a = h('a', { href: url, download: p.file.name, className: 'visually-hidden' });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 30000);
    p.downloaded = true;
    render();
  }
  function backupPanel() {
    const le = peek('lastExport', null);
    const out = [
      h('p', { className: 'small', text: le && le.at ? `上次备份：${ago(le.at)}（${le.items || 0} 道错题）` : '上次备份：还没有' }),
      h('p', { className: 'small', text: '错题本、照片、作答记录和设置打包成一个文件（不含 Key），存到“文件”里或发到电脑。删了主屏幕图标、清了 Safari 数据，就靠它找回来。' }),
    ];
    if (!prepared) {
      out.push(h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: preparing ? '正在打包' : '导出备份', disabled: preparing || !ctx.store, on: { click: prepare } })));
      return out;
    }
    const p = prepared;
    out.push(h('div', { className: 'result' }, h('p', { text: `准备好了：${p.file.name}（${fmtBytes(p.size)}）` }), h('p', { className: 'small', text: backupText(p.sum) })));
    if (p.downloaded) {
      out.push(h('p', { className: 'small', text: '已经开始下载。确认文件存好了，再点“存好了”。' }),
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: '存好了', on: { click: () => exported('download') } }),
          h('button', { type: 'button', className: 'text-btn accent', text: '存到“文件”', on: { click: share } }),
          h('button', { type: 'button', className: 'text-btn', text: '再下载一次', on: { click: download } })));
    } else {
      out.push(h('p', { className: 'small', text: '在分享面板里选“存储到文件”，或者用隔空投送发到电脑。' }),
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: '存到“文件”', on: { click: share } }),
          h('button', { type: 'button', className: 'text-btn', text: '改用下载', on: { click: download } }),
          h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { prepared = null; render(); } } })));
    }
    return out;
  }

  async function readImport(file) {
    importState = { busy: `正在读“${file.name}”` };
    openRows.add('import');
    render();
    try {
      const data = parseExportText(await file.text());
      importState = { name: file.name, data, sum: backupSummary(data) };
    } catch (e) {
      importState = { error: '读不了这个文件：' + errText(e) };
    }
    render();
  }
  async function doImport() {
    const s = importState;
    if (!s || !s.data || !ctx.store) return;
    importState = { busy: '正在导入，照片多的话要十几秒' };
    render();
    try {
      await ctx.store.importAll(s.data, { replace: true });
      importState = { done: true };
      render();
      toast('导入好了，马上重新打开', 2500);
      // 设置、进度这些在内存里还有一份旧的：整个 App 重新载入最省事
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      importState = { error: '导入没成功，这台 iPad 上的数据没动：' + errText(e) };
      render();
    }
  }
  function importPanel() {
    const s = importState;
    const out = [h('p', { className: 'small', text: '选一个数学老师导出的备份文件（emmamath-backup-日期.json）。先看一眼里面有什么，再决定导不导。' })];
    if (!s || s.error) out.push(h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '选择文件', on: { click: () => fileIn.click() } })));
    if (!s) return out;
    if (s.error) { out.push(h('p', { className: 'small danger', role: 'alert', text: s.error })); return out; }
    if (s.busy) { out.push(h('p', { className: 'small dots', text: s.busy })); return out; }
    if (s.done) { out.push(h('p', { className: 'small parent-good', text: '导入好了，马上重新打开。' })); return out; }
    out.push(
      h('div', { className: 'result' }, h('p', { text: `“${s.name}”` }), h('p', { className: 'small', text: backupText(s.sum) })),
      h('p', { className: 'small parent-warn', text: (s.sum.photosOmitted ? '导入会用这个备份替换这台 iPad 上现在的错题本、作答记录和设置（这个备份不含照片，照片留着不动）。'
        : '导入会用这个备份替换这台 iPad 上现在的错题本、照片、作答记录和设置。') + 'Key 留着不动' + (s.sum.hasCode ? '，家长数字码换成备份里的那个' : '') + '。现在的数据会被覆盖，想留着就先导出一份。' }),
      h('div', { className: 'btn-row' },
        h('button', { type: 'button', className: 'btn parent-danger', text: '导入并覆盖', on: { click: doImport } }),
        h('button', { type: 'button', className: 'text-btn', text: '取消', on: { click: () => { importState = null; render(); } } })));
    return out;
  }

  async function refreshStorage() {
    const st = { persisted: null, usage: null, quota: null };
    try {
      if (navigator.storage && navigator.storage.persisted) st.persisted = await navigator.storage.persisted();
      if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); st.usage = e.usage ?? null; st.quota = e.quota ?? null; }
    } catch (e) { /* 有的浏览器不给 */ }
    storage = st;
    softRender();
  }
  async function askPersist() {
    let ok = false;
    try { ok = !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); } catch (e) { ok = false; }
    toast(ok ? '开好了：系统不会自动清掉这里的数据' : '浏览器没答应。从主屏幕图标打开时一般会答应', 3500);
    refreshStorage();
  }
  function storageRow() {
    const st = storage;
    const sub = !st ? '检查中' : st.persisted === null ? '这个浏览器不告诉我有没有持久存储'
      : st.persisted ? '已开启：空间紧张时，系统不会自动清掉这里的数据' : '没开启：空间紧张时，系统可能清掉这里的数据。从主屏幕图标打开时一般会自动开';
    return row({ label: '持久存储', sub: sub + (st && st.quota ? `。可用 ${fmtBytes(st.quota)}` : ''), value: st && st.usage !== null ? `用了 ${fmtBytes(st.usage)}` : '',
      right: st && st.persisted === false ? h('button', { type: 'button', className: 'text-btn accent', text: '申请', on: { click: askPersist } }) : null });
  }

  // 清除全部数据（门上的“忘了”和数据里的一行共用）：先说清楚，再确认一次；第二步的按钮停一下才能点，免得连点两下
  function wipeUI({ cancelText = '取消', onCancel, redraw }) {
    if (wipeStep <= 1) {
      return [
        h('p', { className: 'small', text: unlocked ? GATE_COPY.forgot.replace(/^.*?只能清除/, '会清除') : GATE_COPY.forgot }),
        h('p', { className: 'small', text: unlocked ? '想留着错题本，先在上面导出备份。' : GATE_COPY.forgotHint }),
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn parent-danger', text: GATE_COPY.wipe, on: { click: () => { wipeStep = 2; redraw(); } } }),
          h('button', { type: 'button', className: 'text-btn', text: cancelText, on: { click: onCancel } })),
      ];
    }
    const sure = h('button', { type: 'button', className: 'btn parent-danger', text: GATE_COPY.sureBtn, disabled: true, on: { click: wipeAll } });
    setTimeout(() => { sure.disabled = false; }, 1200);
    return [
      h('p', { className: 'parent-wipe-q serif', text: GATE_COPY.sure }),
      h('div', { className: 'btn-row' }, sure, h('button', { type: 'button', className: 'text-btn', text: cancelText === GATE_COPY.remembered ? GATE_COPY.keep : '取消', on: { click: onCancel } })),
    ];
  }
  async function wipeAll() {
    if (!ctx.store || !ctx.store.importAll) { toast('现在清不了：数据还没打开'); return; }
    try {
      await ctx.store.importAll(emptyExport(), { replace: true });
      // 按替换导入会留下这台 iPad 自己的设置（Key 在里面）；清除是全部都清
      await ctx.kv.delete('settings');
      await ctx.kv.delete(CODE_KEY);
      try {
        const ks = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('emmamath.')) ks.push(k); }
        for (const k of ks) localStorage.removeItem(k);
      } catch (e) { /* 没有 localStorage 也没关系 */ }
      toast('清除了，马上重新打开', 2500);
      setTimeout(() => location.reload(), 1000);
    } catch (e) {
      toast('没清掉：' + errText(e), 4000);
    }
  }

  function dataGroup() {
    const le = peek('lastExport', null);
    return group('数据', [
      row({ key: 'backup', label: '导出备份', sub: '错题本、照片、作答记录、设置（不含 Key）', value: le && le.at ? `上次 ${ago(le.at)}` : '还没有', panel: backupPanel }),
      row({ key: 'import', label: '导入备份', sub: '会覆盖这台 iPad 上现在的数据', panel: importPanel }),
      storageRow(),
      row({ key: 'wipe', label: '清除全部数据', sub: '从头开始，删掉的找不回来', cls: 'parent-danger-row',
        panel: () => { if (!wipeStep) wipeStep = 1; return wipeUI({ onCancel: () => { wipeStep = 0; closeRow('wipe'); }, redraw: render }); } }),
    ], '数据只在这台 iPad 上。一直从主屏幕图标打开，别删了图标再重新添加。');
  }

  function aboutGroup() {
    return h('section', { className: 'parent-group parent-about' },
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn quiet', on: { click: handOver } }, icon('lock'), '锁上，交给 Emma')),
      h('p', { className: 'small muted parent-version', text: `${APP_NAME} ${VERSION}` }));
  }

  // ---------------------------------------------------------------- 整页
  // 读完数据、测完连接这些“自己回来”的重画：家长正在输入框里打字时先不画（会把输入框换掉、丢焦点），离开输入框后再画
  let deferredOn = null;   // 等哪个输入框失焦以后再画
  function softRender() {
    if (!unlocked) return;
    const a = document.activeElement;
    if (a && mainBox.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) {
      if (deferredOn !== a) {
        deferredOn = a;
        // 等一下再画：失焦常常是因为点了“保存”，马上重画会把那个按钮换掉、吃掉这次点按。中间已经画过就不再画
        a.addEventListener('blur', () => setTimeout(() => { if (deferredOn === a) render(); }, 400), { once: true });
      }
      return;
    }
    render();
  }
  function render() {
    if (!unlocked) return;
    deferredOn = null;
    mainBox.replaceChildren(
      h('h1', { className: 'page-title', text: '家长' }),
      h('p', { className: 'lead', text: '这里的设置只存在这台 iPad 上。' }),
      mockOn() ? h('p', { className: 'status-line parent-mockline' }, icon('info'), h('span', { text: '模拟模式：不连网，不花钱，回答都是假的。' })) : null,
      connectionGroup(),
      moneyGroup(),
      studyGroup(),
      teacherGroup(),
      listsGroup(),
      recentGroup(),
      modelGroup(),
      voiceGroup(),
      dataGroup(),
      mockGroup(),
      aboutGroup(),
    );
    justOpened = '';
  }

  return {
    show() {
      if (!curriculum && ctx.curriculum) curriculum = ctx.curriculum;
      if (!unlocked) { unlock(); return; }   // Wei 10-24：家长区不要数字码，点进来就是
      loadItems();
      loadProf();
      refreshStorage();
      render();
      touch();
    },
    hide: lock,
  };
}
