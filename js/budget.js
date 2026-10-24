// Spending: estimates what each Poe reply cost from its token usage, keeps a per-day, per-task tally on the iPad and
// stops paid calls once today's total reaches the parent's daily cap (BRIEF 2: about 5 USD a month, capped daily).
// 负责：AI 层 agent。CONTRACTS.md 第 5 节。写法照英语 App 的 budget.js，改成美元、按任务记。
//
// 导出
//   costUSD(usage, model) -> number        纯函数。usage 是接口返回的 { prompt_tokens, completion_tokens }（也认
//                                          input_tokens / output_tokens）；价格用 config.js PRICES_USD，不认识的模型用
//                                          FALLBACK_PRICE_USD（往贵了算）；认不出的 usage 返回 0
//   createBudget({ kv, now, getCapUSD }) -> {
//     load() -> Promise                    启动时读 kv 'budget'
//     record(usage, task, model) -> usd    记一笔（内存马上更新，kv 异步写），返回这笔估算的钱
//     canSpend() -> bool                   今天总花费 < getCapUSD()。上限 0 = 今天一律不花；Infinity = 不封顶；
//                                          空的、不是数、负数、没给 = 默认 0.4
//     today() -> { date, usd, byTask, cap, left }
//     month() -> { month: 'YYYY-MM', usd, byTask }
//     reset()                              清空（家长区用）
//     saved() -> Promise                   最后一次写 kv 完成（测试和导出前用）
//   }
//
// kv：app.js 的 { get(key), set(key, value) }（异步），也认 db.js 的 { kvGet, kvSet }。
// kv 'budget' 的形状：{ days: { 'YYYY-MM-DD': { task: usd } } }，留最近 62 天。日期按 iPad 本地时间。
// 这是估算：Poe 实际按积分扣，单价来自 Poe /v1/models。家长区要看准数，到 poe.com 的用量记录（按 Key 名字分开）。
import { PRICES_USD, FALLBACK_PRICE_USD } from './config.js';

const KEEP_DAYS = 62;
const DEFAULT_CAP = 0.4;   // 和 config.js DEFAULT_SETTINGS.dailyCapUSD 一致（DESIGN 第 11 节：每天 0.4 美元）

export function costUSD(usage, model = '') {
  if (!usage || typeof usage !== 'object') return 0;
  const p = Array.isArray(PRICES_USD[model]) ? PRICES_USD[model] : FALLBACK_PRICE_USD;
  const inT = Math.max(0, Number(usage.prompt_tokens ?? usage.input_tokens) || 0);
  const outT = Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens) || 0);
  return (inT * p[0] + outT * p[1]) / 1e6;
}

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const asDate = v => (v instanceof Date ? v : new Date(v));
const sum = o => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);

// app.js passes { get, set }; db.js's store has { kvGet, kvSet }. Either works.
function kvOf(kv) {
  if (!kv) return { get: async () => undefined, set: async () => {} };
  return {
    get: k => (typeof kv.get === 'function' ? kv.get(k) : kv.kvGet(k)),
    set: (k, v) => (typeof kv.set === 'function' ? kv.set(k, v) : kv.kvSet(k, v)),
  };
}

export function createBudget({ kv, now = () => new Date(), getCapUSD = () => DEFAULT_CAP } = {}) {
  const store = kvOf(kv);
  let days = {};   // { 'YYYY-MM-DD': { task: usd } }
  let saving = Promise.resolve();
  const dayKey = () => ymd(asDate(now()));

  async function load() {
    try {
      const v = await store.get('budget');
      days = v && v.days && typeof v.days === 'object' ? v.days : {};
    } catch (e) { days = {}; }
  }

  function persist() {
    const keys = Object.keys(days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
    const value = { days: copyDays(days) };
    // writes queue up so an older tally never lands after a newer one; a failed write is only logged
    saving = saving.then(() => store.set('budget', value)).catch(e => console.warn('budget:', (e && e.message) || e));
  }

  // 0 is a real cap (stop everything today); Infinity means no cap; an empty field, junk or a negative falls back to
  // 0.4, so clearing the box in the parent area never stops her by accident
  function capOf() {
    let v;
    try { v = getCapUSD(); } catch (e) { v = undefined; }
    const c = v === null || v === undefined || (typeof v === 'string' && !v.trim()) ? NaN : Number(v);
    return Number.isNaN(c) || c < 0 ? DEFAULT_CAP : c;
  }

  function record(usage, task = 'other', model = '') {
    const usd = costUSD(usage, model);
    if (!usd) return 0;
    const t = String(task || 'other');
    const day = days[dayKey()] || (days[dayKey()] = {});
    day[t] = (day[t] || 0) + usd;
    persist();
    return usd;
  }

  function today() {
    const date = dayKey();
    const byTask = { ...(days[date] || {}) };
    const usd = sum(byTask);
    const cap = capOf();
    return { date, usd, byTask, cap, left: Math.max(0, cap - usd) };
  }

  const canSpend = () => { const t = today(); return t.usd < t.cap; };

  function month() {
    const m = dayKey().slice(0, 7);
    const byTask = {};
    for (const [d, o] of Object.entries(days)) {
      if (!d.startsWith(m)) continue;
      for (const [k, v] of Object.entries(o || {})) byTask[k] = (byTask[k] || 0) + (Number(v) || 0);
    }
    return { month: m, usd: sum(byTask), byTask };
  }

  return {
    load, record, canSpend, today, month,
    reset: () => { days = {}; persist(); },
    saved: () => saving,
  };
}

// The tally object goes to IndexedDB by structured clone anyway; a plain copy keeps later records out of a pending write.
function copyDays(o) {
  const out = {};
  for (const [d, v] of Object.entries(o)) out[d] = { ...v };
  return out;
}
