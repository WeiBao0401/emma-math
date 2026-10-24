// Calls to Poe's OpenAI-compatible API through Wei's relay: one model per task (config.js TASKS), retries, cut-off
// replies, tolerant JSON with the LaTeX backslash repair, one fallback model, the daily budget, mock mode.
// 负责：AI 层 agent（config.js、ai.js、budget.js、kid-errors.js、mock.js）。CONTRACTS.md 第 4 节。
// 写法照英语 App 的 ai.js，去掉百炼和路由，只走 Poe。
//
// 导出
//   createAI({ getSettings, budget, fetchImpl, sleep, now, random, timeouts, online }) -> {
//     ask(task, { system, text, images = [], signal, model, fallback }) -> Promise<{ json, text, model, usage, usd, ms, fallback, mock }>
//         task：config.js TASKS 的键（recognize | explain | variants | solve | hint | reflect）
//         images：dataURL 或 https 地址；model：这次指定模型（不传就用家长设的 taskModels[task]，再不行用 TASKS[task].model）
//         fallback：这次的备用模型，'' 表示不用备用（比如“换一家模型独立做一遍”时）；不传用 TASKS[task].fallback
//         返回：json 是解析好的对象，text 是模型原文，usage 是最后一次回答的用量，usd 是这次 ask 一共估算花了多少
//         （含重试、截断后重要、备用模型），fallback 为真表示是备用模型答的，mock 为真表示模拟模式
//     ping({ signal }) -> Promise<{ ok, ms, count, missing, code, message }>   GET {poeUrl}/models，不花积分。
//         只能说明地址通不通（Key 对不对要等第一次真请求）；missing 是任务要用、但列表里没有的模型
//     recent() -> [{ at, task, model, ms, ok, code, usd, message? }]   最近 50 次请求（每次 HTTP 一行，重试也算），只在内存，
//         不记提示词和回答。message 只在 Poe 回了错误状态（Key、积分、模型、403 等）时有，是 AIError 的原文
//   }
//   parseModelJSON(text) -> object        去 ``` 围栏；取第一个 { 到最后一个 }；修 LaTeX 反斜杠；不是对象就抛错
//   fixLatexBackslashes(text) -> string   上面那一步修复，单独导出给测试和别的模块
//   normalizePoeUrl(raw) -> string | null 去空格和看不见的字符、结尾斜杠、/chat/completions、/models，补 /v1；
//                                         '' = 没填；null = 不是 https 地址（ask 报 'badrelay'）
//   requestBody(model, { system, text, images, maxTokens }) -> object   发给 Poe 的 body
//   modelFor(task, settings) -> string    这个任务现在用哪个模型
//   relayHost(url) -> string              地址里的域名，不带暗号，可以显示在家长区
//   class AIError extends Error { code }  code：nokey | badkey | badrelay | billing | budget-day | model | forbidden |
//                                         offline | network | timeout | ratelimit | server | truncated | incomplete |
//                                         http | abort（孩子看到的话见 kid-errors.js）
//
// 规则（CONTRACTS 4）
//   重试：429、5xx、网络错间隔 1.5 秒、3 秒再试两次；超时只再试一次（一次已经等了 60 到 90 秒，孩子等不起三次）。
//   截断：finish_reason 'length' 或用满 max_tokens，max_tokens 翻倍（上限 12000）再要一次，再截断报 'truncated'。
//   不是 JSON：再要一次，还不是报 'incomplete'。
//   备用模型：主模型最后失败、原因不是地址 / Key / 积分 / 当天上限 / 断网 / 取消时，换 fallback 整个再来一次。
//   记账：每个带 usage 的回答都记 budget.record(usage, task, model)，截断的也记（Poe 照样扣积分）。
//   每次发请求前 budget.canSpend() 为假就抛 'budget-day'，不发。
//   模拟模式：settings.mock 为真时不发请求，等 300 到 900 毫秒，从 mock.js 取同形状的假回答。
//   settings.mockCase 选模拟的那一页或那道题；settings.mockFail = 某个 code 时模拟那种错误（看报错界面用）。
// err.message 是给家长区看的技术说明，可以提 Key、积分、模型名；孩子看的一律走 kid-errors.js（按 err.code）。
import { TASKS, MODEL_PARAMS, DEFAULT_MODEL_PARAMS, POE_DIRECT_URL, RETRY_DELAYS, MAX_TOKENS_CAP, MOCK_DELAY_MS,
  RECENT_CAP } from './config.js';
import { costUSD } from './budget.js';
import { mockAnswer } from './mock.js';

export class AIError extends Error {
  constructor(message, code = 'http') { super(message); this.name = 'AIError'; this.code = code; }
}
class Retryable extends Error {}   // 429, 5xx, network, timeout: worth the same request again

const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const PING_TIMEOUT_MS = 15000;
const DEFAULT_TASK = { model: '', maxTokens: 4000, timeoutMs: 60000, fallback: '' };
// fallback would not help: the address, key, points or network are wrong for every model alike
const NO_FALLBACK = new Set(['nokey', 'badkey', 'badrelay', 'billing', 'budget-day', 'offline', 'network', 'abort']);

// ---------------------------------------------------------------- JSON from a model

// Models often write LaTeX with single backslashes inside JSON strings: "\(" and "\frac" are not legal JSON, and
// "\frac", "\times", "\neq", "\beta", "\right" are worse, because \f \t \n \b \r parse as control characters and the
// LaTeX silently disappears. Before parsing, a single backslash followed by two or more letters, or by anything JSON
// cannot escape (( ) [ ] { } | , ; ! % space ...), becomes two. Pairs already doubled stay; \uXXXX stays; a lone
// \n, \t, \" etc. before a non-letter stays (a real newline in "-2\n点 C"). In the bake-off this rescued all 14
// replies that did not parse and changed none of the 52 that did (tests/ai.test.mjs).
// Cost of the rule: a real newline directly followed by two Latin letters ("\nAB") reads as text "\nAB".
export function fixLatexBackslashes(text) {
  return String(text ?? '').replace(/\\(u[0-9a-fA-F]{4}|[A-Za-z]{2,}|[\s\S]?)/g, (m, x) => {
    if (x === '\\') return m;                          // an escaped backslash, already right
    if (/^u[0-9a-fA-F]{4}$/.test(x)) return m;         // 中
    if (x.length >= 2) return '\\\\' + x;              // \frac \times \neq \text \dfrac \left ...
    if (x && '"/bfnrt'.includes(x)) return m;          // a real JSON escape before a non-letter
    return '\\\\' + x;                                 // \( \) \[ \] \{ \} \| \, \; \! \% "\ " and any other
  });
}

export function parseModelJSON(text) {
  let t = String(text ?? '').trim().replace(/^```(?:json|JSON)?\s*|\s*```$/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('回答里没有 JSON 对象');
  t = fixLatexBackslashes(t.slice(a, b + 1));
  const obj = JSON.parse(t);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('回答不是 JSON 对象');
  return obj;
}

// ---------------------------------------------------------------- address, model, body

// What Wei pastes as the relay address -> https://host/secret/v1 (same rules as the relay's normalize_base_url and
// the English app). '' = not filled in; null = not an https address we accept.
export function normalizePoeUrl(raw) {
  let u = String(raw ?? '').replace(/[\s​-‍⁠﻿]/g, '');
  if (!u) return '';
  u = u.replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '').replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~-]+)*$/.test(u)) return null;
  return u.endsWith('/v1') ? u : u + '/v1';
}
// The relay's domain without its secret, safe to show on screen
export function relayHost(url) {
  if (!url) return '';
  if (url === POE_DIRECT_URL) return 'api.poe.com（直连）';
  try { return new URL(url).host; } catch (e) { return ''; }
}

export function modelFor(task, s = {}) {
  const chosen = s && s.taskModels && typeof s.taskModels === 'object' ? String(s.taskModels[task] || '').trim() : '';
  return chosen || (TASKS[task] || DEFAULT_TASK).model;
}

export function requestBody(model, { system = '', text = '', images = [], maxTokens = DEFAULT_TASK.maxTokens } = {}) {
  const imgs = (images || []).filter(Boolean);
  const content = imgs.length
    ? [{ type: 'text', text: String(text ?? '') }, ...imgs.map(url => ({ type: 'image_url', image_url: { url } }))]
    : String(text ?? '');
  return {
    model,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: String(system ?? '') }, { role: 'user', content }],
    ...(MODEL_PARAMS[model] || DEFAULT_MODEL_PARAMS),
  };
}

// ---------------------------------------------------------------- errors

function errorDetail(data) {
  if (!data || typeof data !== 'object') return { code: '', message: '' };
  const e = data.error && typeof data.error === 'object' ? data.error : data;
  return { code: String(e.code || e.type || ''), message: String(e.message || (typeof data.error === 'string' ? data.error : '')).slice(0, 200) };
}
const isBilling = (status, blob) => status === 402 || blob.includes('insufficient') || /\bpoints?\b/.test(blob);
const modelMissing = blob => ['model_not_found', 'model not found', 'unknown model', 'does not exist', 'not_found_error',
  'not found or unavailable', 'invalid model', 'no such model'].some(s => blob.includes(s));

// One failed HTTP answer -> AIError (same order as the English app's httpError). relay: the address is not api.poe.com.
export function httpError(status, data, model = '', { relay = true } = {}) {
  const { code, message } = errorDetail(data);
  const blob = (code + ' ' + message).toLowerCase();
  if (relay && status === 404 && !message) {
    return new AIError('中转站返回空的 404：地址里的暗号不对。到家长区重新粘贴中转站地址。', 'badrelay');
  }
  if (status === 401 || blob.includes('invalid_api_key') || blob.includes('invalid api key') || blob.includes('authentication')) {
    return new AIError('Poe API Key 不对或已失效（401）：到家长区重新粘贴。', 'badkey');
  }
  if (isBilling(status, blob)) return new AIError('Poe 积分不够了：到 poe.com 看一下余额（每月初到账）。', 'billing');
  if (modelMissing(blob) || status === 404) return new AIError(`模型“${model}”用不了（${status}）：到家长区换一个。`, 'model');
  if (status === 403) return new AIError(`Poe 拒绝了请求（403）：${message || code || '没有权限'}。`, 'forbidden');
  return new AIError(`Poe 返回 ${status}：${message || code || '没有详情'}`, 'http');
}

// ---------------------------------------------------------------- the client

const pad2 = n => String(n).padStart(2, '0');
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
const defaultOnline = () => !(globalThis.navigator && globalThis.navigator.onLine === false);
const ABORT = () => new AIError('已取消', 'abort');

// Poe answers content as a string; some OpenAI-compatible servers send [{ type: 'text', text }] parts
function contentOf(choice) {
  const c = choice && choice.message && choice.message.content;
  if (Array.isArray(c)) return c.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
  return String(c || '').trim();
}

export function createAI({ getSettings, budget = null, fetchImpl, sleep = sleepMs, now = Date.now, random = Math.random,
  timeouts = {}, online = defaultOnline } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const log = [];   // newest last, memory only, no prompt or answer text
  const note = row => { log.push(row); if (log.length > RECENT_CAP) log.splice(0, log.length - RECENT_CAP); return row; };

  function connection(s, { needKey = true } = {}) {
    const url = normalizePoeUrl(s.poeUrl);
    if (url === '') throw new AIError('还没填中转站地址：到家长区填上。', 'nokey');
    if (url === null) throw new AIError('中转站地址格式不对：要以 https:// 开头。到家长区重新粘贴。', 'badrelay');
    const key = String(s.poeKey ?? '').trim();
    if (needKey && !key) throw new AIError('还没填 Poe API Key：到家长区填上。', 'nokey');
    // an invisible character in the key makes fetch throw, which would look like a network problem
    if (key && !/^[\x21-\x7e]+$/.test(key)) throw new AIError('Poe API Key 里有看不见的字符：到家长区重新粘贴。', 'badkey');
    return { url, key, relay: url !== POE_DIRECT_URL };
  }

  function budgetAllows() {
    if (!budget) return true;
    try { return budget.canSpend() !== false; } catch (e) { return true; }   // a bookkeeping slip never blocks her
  }

  // One HTTP request. Returns { content, usage, truncated, row } or throws Retryable / AIError.
  async function callOnce(c, { task, model, body, timeoutMs, signal, acc }) {
    const t0 = now();
    const row = note({ at: stamp(t0), task, model, ms: 0, ok: false, code: '', usd: 0 });
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let res, data;
    try {
      res = await doFetch(c.url + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      data = await res.json().catch(() => null);
    } catch (e) {
      row.ms = Math.round(now() - t0);
      if (signal && signal.aborted) { row.code = 'abort'; throw ABORT(); }
      row.code = timedOut ? 'timeout' : 'network';
      throw new Retryable(row.code);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    row.ms = Math.round(now() - t0);
    if (data && data.usage) {
      let usd = 0;
      try { usd = budget ? Number(budget.record(data.usage, task, model)) || 0 : costUSD(data.usage, model); } catch (e) { usd = costUSD(data.usage, model); }
      row.usd = usd;
      acc.usd += usd;
    }
    if (!res.ok) {
      const { code, message } = errorDetail(data);
      // points used up can come back as 402, 429 or even 5xx; retrying only adds requests
      if (isBilling(res.status, (code + ' ' + message).toLowerCase())) { const e = httpError(402, data, model, c); row.code = e.code; row.message = e.message; throw e; }
      if (res.status === 429) { row.code = 'ratelimit'; throw new Retryable('429'); }
      if (res.status >= 500) { row.code = 'server'; throw new Retryable('5xx:' + res.status); }
      const e = httpError(res.status, data, model, c);
      row.code = e.code;
      row.message = e.message;   // 家长区“最近的请求”显示原文（parentDetail）；只有我们自己写的说明和 Poe 的报错，没有提示词和回答
      throw e;
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const used = Number(data && data.usage && data.usage.completion_tokens) || 0;
    const truncated = (choice && choice.finish_reason === 'length') || used >= body.max_tokens;
    row.ok = !truncated;
    row.code = truncated ? 'truncated' : '';
    return { content: contentOf(choice), usage: (data && data.usage) || null, truncated, row };
  }

  // The same request again after a 429, 5xx, network failure (1.5 s, 3 s) or a timeout (once).
  async function callWithRetry(c, args) {
    let last = null, timeoutsSeen = 0;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      if (args.signal && args.signal.aborted) throw ABORT();
      if (!budgetAllows()) throw new AIError('今天的花费到了 App 里设的每天上限，明天恢复。可以在家长区调高上限。', 'budget-day');
      try { return await callOnce(c, args); } catch (e) {
        if (!(e instanceof Retryable)) throw e;
        last = e;
        if (e.message === 'network' && !online()) throw new AIError('iPad 没连网。', 'offline');
        if (e.message === 'timeout' && ++timeoutsSeen > 1) break;
        if (attempt < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt]);
      }
    }
    if (args.signal && args.signal.aborted) throw ABORT();
    const m = last.message, who = c.relay ? '中转站' : 'Poe';
    if (m === '429') throw new AIError('Poe 限流了（429，请求太频繁），稍等一会儿再试。', 'ratelimit');
    if (m.startsWith('5xx:')) throw new AIError(`Poe 或中转站出错（${m.slice(4)}），稍后再试。`, 'server');
    if (m === 'timeout') throw new AIError(`模型“${args.model}”超过 ${Math.round(args.timeoutMs / 1000)} 秒没回答，网络可能太慢。`, 'timeout');
    throw new AIError(c.relay ? '连不上中转站：网络不通，或者中转站地址不对。' : `连不上 ${who}：在国内直连 api.poe.com 要开 VPN，或者改填中转站地址。`, 'network');
  }

  // One model, start to finish: a cut-off reply is asked for again with double max_tokens, a reply that is not
  // JSON is asked for again; each at most once.
  async function askModel(c, model, { task, spec, system, text, images, signal, acc }) {
    let maxTokens = spec.maxTokens || DEFAULT_TASK.maxTokens;
    const timeoutMs = Number(timeouts[task]) || spec.timeoutMs || DEFAULT_TASK.timeoutMs;
    let cuts = 0, bad = 0, lastErr = '';
    for (;;) {
      const body = requestBody(model, { system, text, images, maxTokens });
      const r = await callWithRetry(c, { task, model, body, timeoutMs, signal, acc });
      if (r.truncated) {
        if (++cuts > 1) throw new AIError(`模型“${model}”的回答两次都被截断了（max_tokens ${maxTokens}）。`, 'truncated');
        maxTokens = Math.min(MAX_TOKENS_CAP, maxTokens * 2);
        continue;
      }
      try {
        return { json: parseModelJSON(r.content), text: r.content, model, usage: r.usage };
      } catch (e) {
        lastErr = r.content ? e.message : '回答是空的';
        r.row.ok = false;
        r.row.code = 'incomplete';
        if (++bad > 1) throw new AIError(`模型“${model}”两次都没有返回能读的 JSON：${lastErr}`, 'incomplete');
      }
    }
  }

  async function ask(task, { system = '', text = '', images = [], signal, model: forced = '', fallback: forcedFallback } = {}) {
    const t0 = now();
    const s = (getSettings && getSettings()) || {};
    const spec = TASKS[task] || DEFAULT_TASK;
    if (signal && signal.aborted) throw ABORT();
    const model = String(forced || '').trim() || modelFor(task, s);
    if (s.mock) return askMock(task, model, { text, images, signal, s, t0 });

    const c = connection(s);
    if (!model) throw new AIError(`任务“${task}”没有配模型。`, 'model');
    if (!online()) throw new AIError('iPad 没连网。', 'offline');
    if (!budgetAllows()) throw new AIError('今天的花费到了 App 里设的每天上限，明天恢复。可以在家长区调高上限。', 'budget-day');

    const acc = { usd: 0 };
    const args = { task, spec, system, text, images, signal, acc };
    const done = (r, fallback) => ({ ...r, usd: acc.usd, ms: Math.round(now() - t0), fallback, mock: false });
    try {
      return done(await askModel(c, model, args), false);
    } catch (e) {
      const fb = String((forcedFallback !== undefined ? forcedFallback : spec.fallback) || '').trim();
      if (!(e instanceof AIError) || NO_FALLBACK.has(e.code) || !fb || fb === model) throw e;
      try {
        return done(await askModel(c, fb, args), true);
      } catch (e2) {
        if (e2 instanceof AIError && e2.code !== 'abort') e2.message += `（主模型“${model}”先失败了：${e.message}）`;
        throw e2;
      }
    }
  }

  async function askMock(task, model, { text, images, signal, s, t0 }) {
    const [lo, hi] = MOCK_DELAY_MS;
    await sleep(lo + Math.floor(random() * (hi - lo + 1)));
    if (signal && signal.aborted) throw ABORT();
    const row = note({ at: stamp(t0), task, model, ms: 0, ok: true, code: '', usd: 0 });
    if (s.mockFail) {
      row.ok = false; row.code = String(s.mockFail); row.ms = Math.round(now() - t0);
      throw new AIError(`模拟模式：假装出错（${s.mockFail}）。`, String(s.mockFail));
    }
    const json = mockAnswer(task, { text, images, mockCase: s.mockCase || '' });
    row.ms = Math.round(now() - t0);
    return { json, text: JSON.stringify(json), model, usage: null, usd: 0, ms: row.ms, fallback: false, mock: true };
  }

  // 家长区“测一下连接”: GET {poeUrl}/models. Free; says whether the address answers, not whether the key is right.
  async function ping({ signal } = {}) {
    const t0 = now();
    const s = (getSettings && getSettings()) || {};
    const fail = (code, message, extra = {}) => ({ ok: false, ms: Math.round(now() - t0), count: 0, missing: [], code, message, ...extra });
    if (s.mock) {
      await sleep(300);
      return { ok: true, ms: Math.round(now() - t0), count: Object.keys(MODEL_PARAMS).length, missing: [], code: '', message: '模拟模式', mock: true };
    }
    let c;
    try { c = connection(s, { needKey: false }); } catch (e) { return fail(e.code, e.message); }
    if (!online()) return fail('offline', 'iPad 没连网。');
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, PING_TIMEOUT_MS);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    let res, data;
    try {
      res = await doFetch(c.url + '/models', { method: 'GET', headers: c.key ? { 'Authorization': 'Bearer ' + c.key } : {}, signal: ctrl.signal });
      data = await res.json().catch(() => null);
    } catch (e) {
      if (signal && signal.aborted) return fail('abort', '已取消');
      return timedOut ? fail('timeout', `超过 ${PING_TIMEOUT_MS / 1000} 秒没回`)
        : fail('network', c.relay ? '连不上中转站：网络不通，或者中转站地址不对。' : '连不上 api.poe.com：国内直连要开 VPN。');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    note({ at: stamp(t0), task: 'ping', model: '', ms: Math.round(now() - t0), ok: res.ok, code: res.ok ? '' : String(res.status), usd: 0 });
    if (!res.ok) { const e = httpError(res.status, data, '', c); return fail(e.code, e.message, { status: res.status }); }
    const list = data && Array.isArray(data.data) ? data.data.map(m => m && m.id).filter(Boolean) : [];
    const wanted = [...new Set(Object.keys(TASKS).map(t => modelFor(t, s)))];
    const missing = list.length ? wanted.filter(m => !list.includes(m)) : [];
    return { ok: true, ms: Math.round(now() - t0), count: list.length, missing, code: '', message: '' };
  }

  return { ask, ping, recent: () => log.map(x => ({ ...x })) };
}
