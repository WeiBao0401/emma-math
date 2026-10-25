// 启动和接线（CONTRACTS.md 第 8、10、11 节）：打开数据库，读设置和课本目录，建每个界面都拿到的 ctx，按路由显示界面，
// 注册 Service Worker。
// 负责：外壳。其他 agent 不改这个文件，需要什么写进 needs。
//
// ctx（每个界面拿到同一个对象）
//   version, appName
//   store                 db.js openStore() 的结果
//   kv                    { peek(key, fallback), get(key, fallback), set(key, value), delete(key), keys(prefix) }
//                         启动时把整张 kv 表读进内存（很小），界面可以同步 peek()；set 同时写内存和 IndexedDB。
//                         budget.js 用的就是这个 kv（get / set）。
//   ai, budget            ai.js createAI()、budget.js createBudget() 的结果
//   pipeline              pipeline.js createPipeline({ ai, curriculum })：看照片、诊断、出变式题、核对、提示
//   curriculum            curriculum.js loadCurriculum() 的结果（课本目录和错因表；读不到时是空目录，界面照样能用）
//   today()               notebook.dayOf()，本地日期 'YYYY-MM-DD'
//   flow                  flow.js createFlow()：{ get(), set(patch), clear(), flush() }，拍照到讲完这一路的状态。
//                         内存一份，写 kv 'flow'；诊断的 Promise 只留在内存（写 kv 前去掉，见 flow.js）
//   settings()            当前设置（缺的字段用 DEFAULT_SETTINGS 补）。只读，改用 saveSettings
//   saveSettings(patch)   -> Promise<settings>   合并后存 kv 'settings'。taskModels 按任务合并，改回默认模型的任务去掉；
//                         poeUrl 统一格式（ai.js normalizePoeUrl）；poeKey 去掉空白
//   mockForced()          地址带 ?mock=1：不发请求、不花钱（浏览器里检查界面用）
//   go(route, params), back(), route()
//   toast(msg, ms)
//
// 界面对象：{ show(params, { from, back }), hide?(), onResume?() }。每个路由一个，VIEW_FACTORIES 里登记（路由表在 nav.js），
// 各画进 index.html 里自己的 <section id="view-<section>">。第一次打开（或约定改了版本）先去约定页。
import { importFromEnglish } from './voice-input.js';
import { VERSION, APP_NAME, DEFAULT_SETTINGS, TASKS } from './config.js';
import { openStore } from './db.js';
import { createAI, normalizePoeUrl } from './ai.js';
import { createBudget } from './budget.js';
import { createPipeline } from './pipeline.js';
import { loadCurriculum, makeCurriculum } from './curriculum.js';
import { dayOf } from './notebook.js';
import { createFlow } from './flow.js';
import { SECTIONS, sectionId, resolveRoute, createNav } from './nav.js';
import { h, icon, toast } from './ui-dom.js';
import { createHome } from './ui-home.js';
import { createBook, createCard } from './ui-book.js';
import { createOnboard, needsOnboard } from './ui-onboard.js';
import { createCapture, createPage, createConfirm } from './ui-capture.js';
import { createExplain } from './ui-explain.js';
import { createPractice } from './ui-practice.js';
import { createParent } from './ui-parent.js';
import { createChat } from './ui-chat.js';
import { createBookmap } from './ui-bookmap.js';
import { createQuiz } from './ui-quiz.js';
import { createPaper } from './ui-paper.js';

const params = new URLSearchParams(location.search);
const mockForced = params.get('mock') === '1';

let store = null;
let settings = withDefaults(null);
let updateReady = false;

// ---------------------------------------------------------------- kv：异步存储 + 同步缓存
const kvCache = new Map();
const copy = v => (v === undefined ? v : structuredClone(v));
const kv = {
  peek: (key, fallback = undefined) => (kvCache.has(key) ? copy(kvCache.get(key)) : fallback),
  async get(key, fallback = undefined) {
    if (kvCache.has(key)) return copy(kvCache.get(key));
    const v = await store.kvGet(key);
    if (v !== undefined) kvCache.set(key, v);
    return v === undefined ? fallback : copy(v);
  },
  async set(key, value) { kvCache.set(key, copy(value)); await store.kvSet(key, value); },
  async delete(key) { kvCache.delete(key); await (store.kvDel ? store.kvDel(key) : store.del('kv', key)); },
  keys: (prefix = '') => [...kvCache.keys()].filter(k => k.startsWith(prefix)),
};

// ---------------------------------------------------------------- 设置
function withDefaults(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return { ...structuredClone(DEFAULT_SETTINGS), ...r, taskModels: { ...(DEFAULT_SETTINGS.taskModels || {}), ...(r.taskModels || {}) } };
}
async function saveSettings(patch = {}) {
  const next = { ...settings, ...patch, taskModels: { ...settings.taskModels, ...(patch.taskModels || {}) } };
  // 不是 https 的地址 normalizePoeUrl 给 null：原样留着（去掉空白），家长能看到自己填了什么再改；ai.js 会报 badrelay
  if ('poeUrl' in patch) {
    const n = normalizePoeUrl(patch.poeUrl || '');
    next.poeUrl = n === null ? String(patch.poeUrl || '').replace(/\s+/g, '') : n;
  }
  // Key 里不会有空白；从备忘录、微信复制过来常带换行或空格
  if ('poeKey' in patch) next.poeKey = String(patch.poeKey || '').replace(/\s+/g, '');
  // 改回默认模型的任务去掉，以后 config.js 换了默认模型，这个任务也跟着换
  for (const [task, model] of Object.entries(next.taskModels)) {
    if (!model || (TASKS[task] && TASKS[task].model === model)) delete next.taskModels[task];
  }
  settings = next;
  await kv.set('settings', settings);
  return settings;
}
// ai.js 读的设置：地址带 ?mock=1 时强制模拟
const liveSettings = () => ({ ...settings, mock: !!settings.mock || mockForced });

// ---------------------------------------------------------------- ctx
const ctx = {
  version: VERSION,
  appName: APP_NAME,
  store: null,
  kv,
  ai: null,
  budget: null,
  pipeline: null,
  curriculum: null,
  today: () => dayOf(),
  flow: null,
  settings: () => structuredClone(settings),
  saveSettings,
  mockForced: () => mockForced,
  go: (route, p) => nav.go(route, p || null),
  back: () => nav.back(),
  route: () => nav.current(),
  toast: (msg, ms) => toast(msg, ms),
};

// ---------------------------------------------------------------- 路由
const views = {};
const scrollPos = {};
const nav = createNav({ onShow: showView });

function showView(name, p, { from, back }) {
  const r = resolveRoute(name);
  if (from) scrollPos[from] = window.scrollY;
  const prev = from && views[from];
  if (prev && prev !== views[r.name] && prev.hide) prev.hide();
  for (const s of SECTIONS) {
    const el = document.getElementById(sectionId(s));
    if (el) el.hidden = s !== r.section;
  }
  const v = views[r.name];
  if (v && v.show) v.show(p || {}, { from, back });
  window.scrollTo(0, back ? scrollPos[r.name] || 0 : 0);
  markNavbar();
}
// 推进来的页面：大标题滚上去以后，顶栏出小标题和细线
function markNavbar() {
  const bar = document.querySelector('.view:not([hidden]) .navbar');
  if (bar) bar.classList.toggle('ruled', window.scrollY > 36);
}

// ---------------------------------------------------------------- 界面
// 路由名 -> 工厂（nav.js ROUTES 里的每个路由都要有一个，测试检查）。capture、page、confirm 三屏同在 ui-capture.js。
const VIEW_FACTORIES = {
  home: createHome,
  capture: createCapture,
  page: createPage,
  confirm: createConfirm,
  explain: createExplain,
  practice: createPractice,
  book: createBook,
  bookmap: createBookmap,
  quiz: createQuiz,
  card: createCard,
  parent: createParent,
  onboard: createOnboard,
  chat: createChat,           // v0.3 问我：自由问答、老师主动找她聊、讲完错题接着问
  paper: createPaper,         // v0.4 考前错题卷：选范围、补题、A4 卷子、对答案
};

// ---------------------------------------------------------------- Service Worker
// 只在正式网址（https、不是本机）注册；本机预览加 ?sw 才注册，免得改了文件还读旧缓存。
let swReg = null;
let reloaded = false;
function reloadOnce() { if (reloaded) return; reloaded = true; location.reload(); }
// 能直接重新载入的时候：在首页，没有正在输入的字
function isQuiet() {
  const a = document.activeElement;
  const typing = a && /INPUT|TEXTAREA/.test(a.tagName) && a.value;
  return nav.current() === 'home' && !typing;
}
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!((location.protocol === 'https:' && !local) || params.has('sw'))) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 第一次安装也会触发（clients.claim），只有真的更新才重新载入
    if (!hadController || reloaded) return;
    if (isQuiet()) reloadOnce(); else updateReady = true;
  });
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then(r => { swReg = r; }).catch(() => {});
}
// iPad 主屏幕 App 从后台回来不会重新载入页面，所以“下次打开”就是回到前台这一刻
function onResume() {
  if (updateReady && isQuiet()) reloadOnce();
  else if (swReg) swReg.update().catch(() => {});
}

// ---------------------------------------------------------------- 启动
function fatal(err) {
  const box = document.getElementById('boot');
  for (const s of SECTIONS) { const el = document.getElementById(sectionId(s)); if (el) el.hidden = true; }
  box.hidden = false;
  box.className = 'fatal';
  box.replaceChildren(
    h('p', { className: 'runhead-title', text: APP_NAME }),
    h('p', { className: 'status-line', role: 'alert' }, icon('alert'), h('span', { text: '打不开这台 iPad 上的数据。' })),
    h('p', { className: 'small', text: '上滑关掉 App 再打开。还不行的话，告诉家长。' }),
    h('p', { className: 'small muted', text: String((err && err.message) || err) }),
    h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', text: '重新载入', on: { click: () => location.reload() } })));
}

async function boot() {
  registerSW();
  try {
    store = await openStore({ indexedDB: window.indexedDB });
    const all = await store.kvAll();
    const rows = Array.isArray(all) ? all : Object.entries(all || {}).map(([key, value]) => ({ key, value }));
    for (const r of rows) if (r && r.key) kvCache.set(r.key, r.value);
    settings = withDefaults(kv.peek('settings'));
    const budget = createBudget({ kv, getCapUSD: () => settings.dailyCapUSD });
    await budget.load();
    const ai = createAI({ getSettings: liveSettings, budget, fetchImpl: (...a) => fetch(...a) });
    // 课本目录几十 KB，Service Worker 缓存了；读不到（比如第一次打开就断网）用空目录，讲题照样能走，只是少了错因名
    let curriculum;
    try { curriculum = await loadCurriculum(); } catch (e) { console.warn('curriculum:', (e && e.message) || e); curriculum = makeCurriculum({}, {}); }
    const pipeline = createPipeline({ ai, curriculum });
    const flow = createFlow({ kv });
    Object.assign(ctx, { store, budget, ai, curriculum, pipeline, flow });
  } catch (e) {
    console.error(e);
    fatal(e);
    return;
  }
  // 一个界面建不起来不拖垮整个 App（首页除外：首页没了什么都做不了）
  for (const [name, make] of Object.entries(VIEW_FACTORIES)) {
    try { views[name] = make(ctx); } catch (e) {
      console.error('view ' + name, e);
      if (name === 'home') { fatal(e); return; }
    }
  }
  document.getElementById('boot').hidden = true;
  // 首页垫在下面：约定页点“好，开始吧”回首页时，栈退回成只有首页
  nav.go('home');
  if (needsOnboard(kv)) nav.go('onboard');
  // 请求浏览器别在空间紧时清掉 IndexedDB（错题本只在这台 iPad 上）
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  // v0.7 语音和英语 App 同一套豆包凭据：数学这边没填就从英语 App 拿一份
  importFromEnglish(ctx).catch(() => {});
  window.addEventListener('scroll', markNavbar, { passive: true });
  document.addEventListener('visibilitychange', () => {
    // 退到后台：讲到一半的状态马上写进去（iPad 可能直接把 App 关掉）
    if (document.visibilityState !== 'visible') { ctx.flow.flush(); return; }
    const v = views[nav.current()];
    if (v && v.onResume) v.onResume();
    onResume();
  });
  document.documentElement.dataset.ready = '1';
}

boot();
