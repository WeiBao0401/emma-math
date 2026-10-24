// Calls to Poe's OpenAI-compatible API through Wei's relay: one model per task (config.js TASKS), retries, cut-off
// replies, tolerant JSON with the LaTeX backslash repair, one fallback model, the daily budget, mock mode.
// 负责：AI 层 agent（config.js、ai.js、budget.js、kid-errors.js、mock.js）。CONTRACTS.md 第 4 节。
// 写法照英语 App 的 ai.js，去掉百炼和路由，只走 Poe。
//
// 导出
//   createAI({ getSettings, budget, fetchImpl, sleep, now, random, timeouts, online, stream }) -> {
//     ask(task, { system, text, images = [], files = [], raw, signal, model, fallback }) -> Promise<{ json, text, model, usage, usd, ms, fallback, mock }>
//         task：config.js TASKS 的键（recognize | explain | variants | solve | hint | reflect | listen）
//         images：dataURL 或 https 地址；model：这次指定模型（不传就用家长设的 taskModels[task]，再不行用 TASKS[task].model）
//         files：[{ dataURL, filename }]，发成 Poe 认的 { type: 'file', file: { filename, file_data } }（录音用这个，Poe 不认 input_audio）
//         raw：true 时要的是纯文字（听写语音）：不带 response_format、不解析 JSON，json 为 null，text 是原文（可能是 ''）
//         fallback：这次的备用模型，'' 表示不用备用（比如“换一家模型独立做一遍”时）；不传用 TASKS[task].fallback
//         返回：json 是解析好的对象，text 是模型原文，usage 是最后一次回答的用量，usd 是这次 ask 一共估算花了多少
//         （含重试、截断后重要、备用模型），fallback 为真表示是备用模型答的，mock 为真表示模拟模式
//     chat({ task = 'chat', system, messages, onDelta, signal, model, fallback }) -> Promise<{ text, model, usage, usd, ms,
//         partial, truncated, fallback, mock }>                                                     CONTRACTS 15
//         messages：[{ role: 'user' | 'assistant', content: string | [{ type: 'text', text } | { type: 'image_url', image_url: { url } }] }]，
//         别的字段（display、practice、at）发之前去掉。流式（SSE）：每收到一批新字调 onDelta(到目前为止的全文)。
//         partial：网络断在中途、或太久没有新数据，已经收到的字照样返回；truncated：模型写到 max_tokens 被截断（也算 partial）。
//         一个字都没收到：429、5xx、网络错隔 1.5 秒再试一次，超时不在同一个模型上再等，然后换备用模型试一次。
//         取消（signal）抛 AIError('abort')，err.text 是已经收到的字。
//         超时按“多久没收到新数据”算（TASKS.chat.timeoutMs），不是总时长。浏览器读不了流就退回一次性拿全文。
//     ping({ signal }) -> Promise<{ ok, ms, count, missing, code, message }>   GET {poeUrl}/models，不花积分。
//         只能说明地址通不通（Key 对不对要等第一次真请求）；missing 是任务要用、但列表里没有的模型
//     recent() -> [{ at, task, model, ms, ok, code, usd, message? }]   最近 50 次请求（每次 HTTP 一行，重试也算），只在内存，
//         不记提示词和回答。message 只在 Poe 回了错误状态（Key、积分、模型、403 等）时有，是 AIError 的原文
//     noteCall({ task, model, ms, ok, code, message }) -> row    别的模块（voice.js 的豆包语音）往“最近的请求”里记一行
//   }
//   parseModelJSON(text) -> object        去 ``` 围栏；取第一个 { 到最后一个 }；修 LaTeX 反斜杠；不是对象就抛错
//   fixLatexBackslashes(text) -> string   上面那一步修复，单独导出给测试和别的模块
//   normalizePoeUrl(raw) -> string | null 去空格和看不见的字符、结尾斜杠、/chat/completions、/models，补 /v1；
//                                         '' = 没填；null = 不是 https 地址（ask 报 'badrelay'）
//   requestBody(model, { system, text, images, files, maxTokens, json = true }) -> object   发给 Poe 的 body
//   chatBody(model, { system, messages, maxTokens, stream = true }) -> object   聊天的 body（stream + stream_options.include_usage）
//   sseLines() -> { push(chunk) -> [data], end() -> [data] }   按行切 SSE：只要 data: 行的内容（含 '[DONE]'），半行留到下一块
//   readEvent(data) -> { done, delta, finish, usage, error }  一行 data 的意思（纯函数，测试用）
//   estimateUsage(body, text) -> usage   流断在中途、没拿到最后一包的用量时，往多了估（照样记账）
//   mockPieces(text) -> [string]          模拟流式时切成的小段（不切开 \frac 这类命令和【练习】）
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
//   chat 的模拟：先等 300 到 900 毫秒（像在想），再按 mock.js mockChat 的回答每 40 毫秒流出一小段；
//   mockFail = 'partial' 时流到一半就断，返回 partial: true（看“没说完”的界面用）。
// err.message 是给家长区看的技术说明，可以提 Key、积分、模型名；孩子看的一律走 kid-errors.js（按 err.code）。
import { TASKS, MODEL_PARAMS, DEFAULT_MODEL_PARAMS, POE_DIRECT_URL, RETRY_DELAYS, MAX_TOKENS_CAP, MOCK_DELAY_MS,
  RECENT_CAP, MOCK_STREAM_MS } from './config.js';
import { costUSD } from './budget.js';
import { mockAnswer, mockText, mockChat } from './mock.js';

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

// A file goes as Poe's { type: 'file' } part: Poe does not take OpenAI's input_audio, and gemini-3.1-pro read an
// iPad recording sent this way word for word (design/teacher-chat.md 3).
const filePart = f => ({ type: 'file', file: { filename: String((f && f.filename) || 'file'), file_data: String((f && f.dataURL) || '') } });

export function requestBody(model, { system = '', text = '', images = [], files = [], maxTokens = DEFAULT_TASK.maxTokens, json = true } = {}) {
  const imgs = (images || []).filter(Boolean);
  const fls = (files || []).filter(f => f && f.dataURL);
  const content = imgs.length || fls.length
    ? [{ type: 'text', text: String(text ?? '') }, ...imgs.map(url => ({ type: 'image_url', image_url: { url } })), ...fls.map(filePart)]
    : String(text ?? '');
  return {
    model,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    messages: [{ role: 'system', content: String(system ?? '') }, { role: 'user', content }],
    ...(MODEL_PARAMS[model] || DEFAULT_MODEL_PARAMS),
  };
}

// The chat UI keeps display, practice, at on each message; only role and content go to Poe. A part list keeps text,
// image_url and file parts; anything else in it is dropped. Empty turns are dropped (Poe refuses an empty message).
function chatMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : '';
  if (!role) return null;
  let content;
  if (Array.isArray(m.content)) {
    content = m.content.filter(p => p && ((p.type === 'text' && typeof p.text === 'string') || (p.type === 'image_url' && p.image_url && p.image_url.url) || (p.type === 'file' && p.file)));
    if (!content.length) return null;
  } else {
    content = String(m.content ?? '');
    if (!content.trim()) return null;
  }
  return { role, content };
}

export function chatBody(model, { system = '', messages = [], maxTokens = DEFAULT_TASK.maxTokens, stream = true } = {}) {
  return {
    model,
    max_tokens: maxTokens,
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    messages: [{ role: 'system', content: String(system ?? '') }, ...(messages || []).map(chatMessage).filter(Boolean)],
    ...(MODEL_PARAMS[model] || DEFAULT_MODEL_PARAMS),
  };
}

// ---------------------------------------------------------------- server-sent events

// SSE line by line (OpenAI-style streams send one JSON per data: line). A chunk can end in the middle of a line; the
// rest waits for the next chunk. Comments (": keep-alive"), event: and id: lines are skipped.
export function sseLines() {
  let buf = '';
  const take = line => {
    if (!line.startsWith('data:')) return null;
    return line.slice(5).replace(/^ /, '').trim();
  };
  // a \r\n cut between two chunks only adds an empty line, which is skipped
  const split = final => {
    const parts = buf.split(/\r\n|\n|\r/);
    buf = final ? '' : parts.pop();
    return parts.map(take).filter(x => x);
  };
  return {
    push(chunk) { buf += String(chunk ?? ''); return split(false); },
    end: () => split(true),
  };
}

// One data: payload -> what it says. Poe streams OpenAI chat.completion.chunk objects: choices[0].delta.content, a
// finish_reason on the last content chunk, then (stream_options.include_usage) a chunk with empty choices and usage.
// An { error } object mid-stream is a failure the server could only report after it started streaming.
export function readEvent(data) {
  const s = String(data ?? '').trim();
  if (s === '[DONE]') return { done: true, delta: '', finish: '', usage: null, error: null };
  let o;
  try { o = JSON.parse(s); } catch (e) { return { done: false, delta: '', finish: '', usage: null, error: null }; }
  if (!o || typeof o !== 'object') return { done: false, delta: '', finish: '', usage: null, error: null };
  if (o.error) return { done: false, delta: '', finish: '', usage: o.usage || null, error: o };
  const ch = Array.isArray(o.choices) ? o.choices[0] : null;
  const d = ch && (ch.delta || ch.message);
  let delta = '';
  if (d && typeof d.content === 'string') delta = d.content;
  else if (d && Array.isArray(d.content)) delta = d.content.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');
  return { done: false, delta, finish: (ch && ch.finish_reason) || '', usage: o.usage || null, error: null };
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

// Streams need a readable fetch body and TextDecoder (Safari 10.3+); without them chat asks for the whole reply at once
const defaultStream = () => typeof globalThis.ReadableStream === 'function' && typeof globalThis.TextDecoder === 'function';

// A stream that broke before its last chunk has no usage, but Poe still charged for it. Rough count, on the high side
// so the daily cap stays honest: a token per 2 characters of the request, one per character of Chinese reply, and
// what the model may have spent on hidden reasoning is not counted.
export function estimateUsage(body, text) {
  let size = 0;
  try { size = JSON.stringify((body && body.messages) || []).length; } catch (e) { size = 0; }
  return { prompt_tokens: Math.ceil(size / 2), completion_tokens: String(text || '').length };
}

// Mock streaming: about 6 characters a piece; a LaTeX command or a 【 】 tag is never split, so the screen never shows
// half of "\frac"
export function mockPieces(text, size = 6) {
  const s = String(text ?? '');
  const atoms = s.match(/\\[A-Za-z]+|\\.|【[^】\n]{0,4}】|[\s\S]/g) || [];
  const out = [];
  let cur = '';
  for (const a of atoms) {
    cur += a;
    if (cur.length >= size || a === '\n') { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

// Poe answers content as a string; some OpenAI-compatible servers send [{ type: 'text', text }] parts
function contentOf(choice) {
  const c = choice && choice.message && choice.message.content;
  if (Array.isArray(c)) return c.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
  return String(c || '').trim();
}

export function createAI({ getSettings, budget = null, fetchImpl, sleep = sleepMs, now = Date.now, random = Math.random,
  timeouts = {}, online = defaultOnline, stream } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const canStream = stream === undefined ? defaultStream() : !!stream;
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
    throw retryError(last, args, c);
  }

  // the last Retryable of a request that kept failing -> the AIError the parent area and kid-errors.js read
  function retryError(last, { model, timeoutMs }, c) {
    const m = last.message, who = c.relay ? '中转站' : 'Poe';
    if (m === '429') return new AIError('Poe 限流了（429，请求太频繁），稍等一会儿再试。', 'ratelimit');
    if (m.startsWith('5xx:')) return new AIError(`Poe 或中转站出错（${m.slice(4)}），稍后再试。`, 'server');
    if (m === 'timeout') return new AIError(`模型“${model}”超过 ${Math.round(timeoutMs / 1000)} 秒没回答，网络可能太慢。`, 'timeout');
    return new AIError(c.relay ? '连不上中转站：网络不通，或者中转站地址不对。' : `连不上 ${who}：在国内直连 api.poe.com 要开 VPN，或者改填中转站地址。`, 'network');
  }

  // One model, start to finish: a cut-off reply is asked for again with double max_tokens, a reply that is not
  // JSON is asked for again; each at most once.
  async function askModel(c, model, { task, spec, system, text, images, files, raw, signal, acc }) {
    let maxTokens = spec.maxTokens || DEFAULT_TASK.maxTokens;
    const timeoutMs = Number(timeouts[task]) || spec.timeoutMs || DEFAULT_TASK.timeoutMs;
    let cuts = 0, bad = 0, lastErr = '';
    for (;;) {
      const body = requestBody(model, { system, text, images, files, maxTokens, json: !raw });
      const r = await callWithRetry(c, { task, model, body, timeoutMs, signal, acc });
      if (r.truncated) {
        if (++cuts > 1) throw new AIError(`模型“${model}”的回答两次都被截断了（max_tokens ${maxTokens}）。`, 'truncated');
        maxTokens = Math.min(MAX_TOKENS_CAP, maxTokens * 2);
        continue;
      }
      // plain text (listen): an empty answer is a real answer (she said nothing), so it is not asked for again
      if (raw) return { json: null, text: r.content, model, usage: r.usage };
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

  async function ask(task, { system = '', text = '', images = [], files = [], raw = false, signal, model: forced = '', fallback: forcedFallback } = {}) {
    const t0 = now();
    const s = (getSettings && getSettings()) || {};
    const spec = TASKS[task] || DEFAULT_TASK;
    if (signal && signal.aborted) throw ABORT();
    const model = String(forced || '').trim() || modelFor(task, s);
    if (s.mock) return askMock(task, model, { text, images, raw, signal, s, t0 });

    const c = connection(s);
    if (!model) throw new AIError(`任务“${task}”没有配模型。`, 'model');
    if (!online()) throw new AIError('iPad 没连网。', 'offline');
    if (!budgetAllows()) throw new AIError('今天的花费到了 App 里设的每天上限，明天恢复。可以在家长区调高上限。', 'budget-day');

    const acc = { usd: 0 };
    const args = { task, spec, system, text, images, files, raw: !!raw, signal, acc };
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

  async function askMock(task, model, { text, images, raw, signal, s, t0 }) {
    const [lo, hi] = MOCK_DELAY_MS;
    await sleep(lo + Math.floor(random() * (hi - lo + 1)));
    if (signal && signal.aborted) throw ABORT();
    const row = note({ at: stamp(t0), task, model, ms: 0, ok: true, code: '', usd: 0 });
    if (s.mockFail && s.mockFail !== 'partial') {
      row.ok = false; row.code = String(s.mockFail); row.ms = Math.round(now() - t0);
      throw new AIError(`模拟模式：假装出错（${s.mockFail}）。`, String(s.mockFail));
    }
    row.ms = Math.round(now() - t0);
    if (raw) return { json: null, text: mockText(task, { text, images, mockCase: s.mockCase || '' }), model, usage: null, usd: 0, ms: row.ms, fallback: false, mock: true };
    const json = mockAnswer(task, { text, images, mockCase: s.mockCase || '' });
    return { json, text: JSON.stringify(json), model, usage: null, usd: 0, ms: row.ms, fallback: false, mock: true };
  }

  // ---------------------------------------------------------------- chat (streaming)

  // One streaming request. Returns { text, finish, usage, complete, truncated } where complete means the stream said it
  // was finished ([DONE] or a finish_reason); text arrived but no end = the connection broke or went quiet too long.
  // Throws Retryable / AIError like callOnce when it failed before any text.
  async function streamOnce(c, { task, model, body, timeoutMs, signal, acc, emit }) {
    const t0 = now();
    const row = note({ at: stamp(t0), task, model, ms: 0, ok: false, code: '', usd: 0 });
    const ctrl = new AbortController();
    let timedOut = false, reader = null, timer = null;
    const kill = () => { ctrl.abort(); if (reader) reader.cancel().catch(() => {}); };
    // the clock restarts with every piece of data: a reply that keeps coming may take as long as it needs
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs); };
    const onAbort = () => kill();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const st = { text: '', finish: '', usage: null, done: false, error: null, broken: false };
    const take = data => {
      const ev = readEvent(data);
      if (ev.done) { st.done = true; return; }
      if (ev.error) { st.error = ev.error; return; }
      if (ev.delta) st.text += ev.delta;
      if (ev.finish) st.finish = ev.finish;
      if (ev.usage) st.usage = ev.usage;
    };
    const show = before => { if (st.text !== before) emit(st.text); };
    let res;
    try {
      arm();
      try {
        res = await doFetch(c.url + '/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        row.ms = Math.round(now() - t0);
        if (signal && signal.aborted) { row.code = 'abort'; throw ABORT(); }
        row.code = timedOut ? 'timeout' : 'network';
        throw new Retryable(row.code);
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        row.ms = Math.round(now() - t0);
        if (data && data.usage) row.usd = recordUsage(data.usage, task, model, acc);
        throw failed(res.status, data, model, c, row);
      }
      arm();
      const ctype = String((res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '');
      const canRead = res.body && typeof res.body.getReader === 'function';
      if (canRead && !(/json/i.test(ctype) && !/event-stream/i.test(ctype))) {
        reader = res.body.getReader();
        const dec = new TextDecoder();
        const lines = sseLines();
        for (;;) {
          let r;
          try { r = await reader.read(); } catch (e) { st.broken = true; break; }
          if (!r || r.done) break;
          arm();
          const before = st.text;
          const chunk = typeof r.value === 'string' ? r.value : dec.decode(r.value, { stream: true });
          for (const data of lines.push(chunk)) take(data);
          show(before);
          if (st.done) break;
        }
        if (!st.done && !timedOut && !(signal && signal.aborted)) {
          const before = st.text;
          for (const data of lines.push(dec.decode())) take(data);
          for (const data of lines.end()) take(data);
          show(before);
        }
      } else {
        // no readable body (an old browser), or the server answered with plain JSON: take it all at once
        const raw = typeof res.text === 'function' ? await res.text().catch(() => '') : JSON.stringify(await res.json().catch(() => null));
        const before = st.text;
        if (/^\s*data:/m.test(raw)) {
          const lines = sseLines();
          for (const data of [...lines.push(raw), ...lines.end()]) take(data);
        } else {
          let data = null;
          try { data = JSON.parse(raw); } catch (e) { data = null; }
          const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
          st.text = contentOf(choice);
          st.finish = (choice && choice.finish_reason) || (data ? 'stop' : '');
          st.usage = (data && data.usage) || null;
          if (data && data.error) st.error = data;
        }
        show(before);
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (reader && !st.done) reader.cancel().catch(() => {});
    }
    row.ms = Math.round(now() - t0);
    if (signal && signal.aborted) {
      row.code = 'abort';
      if (st.usage || st.text) row.usd = recordUsage(st.usage || estimateUsage(body, st.text), task, model, acc);
      const e = ABORT();
      e.text = st.text;
      throw e;
    }
    // what was received costs points even when the stream broke; without the last chunk's usage, estimate it
    if (st.usage) row.usd = recordUsage(st.usage, task, model, acc);
    else if (st.text) row.usd = recordUsage(estimateUsage(body, st.text), task, model, acc);
    if (st.error && !st.text) throw streamError(st.error, model, c, row);
    const complete = st.done || !!st.finish;
    const truncated = st.finish === 'length';
    if (!st.text) {
      if (complete) { row.code = truncated ? 'truncated' : 'empty'; return { text: '', finish: st.finish, usage: st.usage, complete, truncated }; }
      row.code = timedOut ? 'timeout' : 'network';
      throw new Retryable(row.code);
    }
    row.ok = complete && !truncated;
    row.code = truncated ? 'truncated' : complete ? '' : 'partial';
    return { text: st.text, finish: st.finish, usage: st.usage, complete, truncated };
  }

  function recordUsage(usage, task, model, acc) {
    let usd = 0;
    try { usd = budget ? Number(budget.record(usage, task, model)) || 0 : costUSD(usage, model); } catch (e) { usd = costUSD(usage, model); }
    acc.usd += usd;
    return usd;
  }

  // a non-2xx answer -> what callOnce would throw for it
  function failed(status, data, model, c, row) {
    const { code, message } = errorDetail(data);
    if (isBilling(status, (code + ' ' + message).toLowerCase())) { const e = httpError(402, data, model, c); row.code = e.code; row.message = e.message; return e; }
    if (status === 429) { row.code = 'ratelimit'; return new Retryable('429'); }
    if (status >= 500) { row.code = 'server'; return new Retryable('5xx:' + status); }
    const e = httpError(status, data, model, c);
    row.code = e.code;
    row.message = e.message;
    return e;
  }

  // an { error } event before any text: a status in it is treated like the HTTP status; none = the server broke
  function streamError(data, model, c, row) {
    const e = data && data.error && typeof data.error === 'object' ? data.error : {};
    const status = Number(e.status || e.status_code || (/^\d{3}$/.test(String(e.code || '')) ? e.code : 0)) || 500;
    return failed(status, data, model, c, row);
  }

  // One model, start to finish. Nothing received: 429 / 5xx / network once more after 1.5 s; a timeout is not waited
  // out twice on the same model (she has already waited timeoutMs). A finished but empty reply (all max_tokens spent
  // on hidden reasoning) is asked again once with double max_tokens.
  async function chatModel(c, model, { task, spec, system, messages, signal, acc, emit }) {
    let maxTokens = spec.maxTokens || DEFAULT_TASK.maxTokens;
    const timeoutMs = Number(timeouts[task]) || spec.timeoutMs || DEFAULT_TASK.timeoutMs;
    let retries = 0, empties = 0;
    for (;;) {
      if (signal && signal.aborted) throw ABORT();
      if (!budgetAllows()) throw new AIError('今天的花费到了 App 里设的每天上限，明天恢复。可以在家长区调高上限。', 'budget-day');
      const body = chatBody(model, { system, messages, maxTokens, stream: canStream });
      try {
        const r = await streamOnce(c, { task, model, body, timeoutMs, signal, acc, emit });
        if (r.text) return { ...r, model };
        if (++empties > 1) {
          throw new AIError(`模型“${model}”两次都没有说话${r.truncated ? `（max_tokens ${maxTokens} 都用在了思考上）` : ''}。`, r.truncated ? 'truncated' : 'incomplete');
        }
        if (r.truncated) maxTokens = Math.min(MAX_TOKENS_CAP, maxTokens * 2);
      } catch (e) {
        if (!(e instanceof Retryable)) throw e;
        if (e.message === 'network' && !online()) throw new AIError('iPad 没连网。', 'offline');
        if (e.message === 'timeout' || ++retries > 1) throw retryError(e, { model, timeoutMs }, c);
        await sleep(RETRY_DELAYS[0]);
      }
    }
  }

  async function chat({ task = 'chat', system = '', messages = [], onDelta, signal, model: forced = '', fallback: forcedFallback } = {}) {
    const t0 = now();
    const s = (getSettings && getSettings()) || {};
    const spec = TASKS[task] || DEFAULT_TASK;
    if (signal && signal.aborted) throw ABORT();
    const model = String(forced || '').trim() || modelFor(task, s);
    // a broken screen callback never stops the teacher talking
    const emit = text => { if (typeof onDelta === 'function') { try { onDelta(text); } catch (e) { console.warn('onDelta:', e); } } };
    if (s.mock) return chatMock(task, model, { messages, signal, s, t0, emit });

    const c = connection(s);
    if (!model) throw new AIError(`任务“${task}”没有配模型。`, 'model');
    if (!online()) throw new AIError('iPad 没连网。', 'offline');
    if (!budgetAllows()) throw new AIError('今天的花费到了 App 里设的每天上限，明天恢复。可以在家长区调高上限。', 'budget-day');

    const acc = { usd: 0 };
    const args = { task, spec, system, messages, signal, acc, emit };
    const done = (r, fallback) => ({ text: r.text, model: r.model, usage: r.usage, usd: acc.usd, ms: Math.round(now() - t0),
      partial: !r.complete || r.truncated, truncated: r.truncated, fallback, mock: false });
    try {
      return done(await chatModel(c, model, args), false);
    } catch (e) {
      const fb = String((forcedFallback !== undefined ? forcedFallback : spec.fallback) || '').trim();
      if (!(e instanceof AIError) || NO_FALLBACK.has(e.code) || !fb || fb === model) throw e;
      try {
        return done(await chatModel(c, fb, args), true);
      } catch (e2) {
        if (e2 instanceof AIError && e2.code !== 'abort') e2.message += `（主模型“${model}”先失败了：${e.message}）`;
        throw e2;
      }
    }
  }

  // Mock: think 300 to 900 ms, then the scripted reply in small pieces every 40 ms, like a real stream.
  async function chatMock(task, model, { messages, signal, s, t0, emit }) {
    const [lo, hi] = MOCK_DELAY_MS;
    await sleep(lo + Math.floor(random() * (hi - lo + 1)));
    if (signal && signal.aborted) throw ABORT();
    const row = note({ at: stamp(t0), task, model, ms: 0, ok: true, code: '', usd: 0 });
    if (s.mockFail && s.mockFail !== 'partial') {
      row.ok = false; row.code = String(s.mockFail); row.ms = Math.round(now() - t0);
      throw new AIError(`模拟模式：假装出错（${s.mockFail}）。`, String(s.mockFail));
    }
    const full = mockChat({ messages, mockCase: s.mockCase || '' });
    const pieces = mockPieces(full);
    const cut = s.mockFail === 'partial' ? Math.max(1, Math.floor(pieces.length * 0.6)) : pieces.length;
    let text = '';
    for (let i = 0; i < cut; i++) {
      if (signal && signal.aborted) { row.code = 'abort'; const e = ABORT(); e.text = text; throw e; }
      text += pieces[i];
      emit(text);
      await sleep(MOCK_STREAM_MS);
    }
    const partial = cut < pieces.length;
    row.ok = !partial; row.code = partial ? 'partial' : ''; row.ms = Math.round(now() - t0);
    return { text, model, usage: null, usd: 0, ms: row.ms, partial, truncated: false, fallback: false, mock: true };
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

  // voice.js logs its Doubao calls here, so the parent area sees why a recording went to Poe instead
  function noteCall({ task = '', model = '', ms = 0, ok = false, code = '', message = '', usd = 0 } = {}) {
    const row = note({ at: stamp(now()), task: String(task), model: String(model), ms: Math.round(Number(ms) || 0), ok: !!ok, code: String(code || ''), usd: Number(usd) || 0 });
    if (message) row.message = String(message).slice(0, 300);
    return { ...row };
  }

  return { ask, chat, ping, noteCall, recent: () => log.map(x => ({ ...x })) };
}
