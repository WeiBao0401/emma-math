// 语音提问（v0.7，Wei 10-25：“跟英语 App 一模一样”）：按住说话，边说边出字，松开就发给老师，往上滑取消。
// 豆包流式语音识别 2.0（voice-stream.js，从英语 App 原样拷来）走 wss://openspeech.bytedance.com，凭据和英语 App 同一套：
//   settings.doubaoAppId（APP ID）+ doubaoToken（Access Token）；新版控制台只有 API Key 时放进 doubaoToken、App ID 空着。
//   doubaoCluster 是资源 ID，空着用 2.0 的 volc.seedasr.sauc.duration。
//   数学 App 自己没填时，开机从英语 App 存的设置里拿一份（同一个网址域名，读它的 IndexedDB 'emma' 的 kv 'settings'）。
// 豆包流式失败（鉴权、网络、超时）：把已经录到的整段 16 kHz 音频交给 Poe 的 listen 任务（voice.js transcribe），不用她再说一遍。
// 没填豆包：按住录整段，松开交给 Poe 转写（没有边说边出字）。
//
// 导出
//   createVoiceInput(ctx, deps?) -> { available(), start({ onPartial }), stop() -> Promise<string>, cancel(), state(), info() }
//     start 要在 pointerdown 里直接调（前面不能有 await：流式的 AudioContext 要在点按里建）。onPartial(整句) 边说边给。
//     stop 返回最终整句，没听到返回 ''。出错时 err.kid 是给她看的一句；麦克风被拒时 err.name 'NotAllowedError'。
//   asrRoute(settings) -> { provider: 'doubao' | 'poe', ready, stream, appId, token, mode, resource }
//   contextText() 给豆包的对话上下文（初一数学的说法），MOCK_LINES、mockPieces、VOICE_COPY
//   importFromEnglish(ctx, { indexedDB }) -> Promise<boolean>   数学没填豆包时从英语 App 拿凭据，拿到了返回 true
//   ASR_DEFAULTS
// 依赖：voice-stream.js（createDoubaoStream）、voice.js（createRecorder、transcribe、encodeWav）。
import { createDoubaoStream, STREAM_URL, STREAM_RESOURCE } from './voice-stream.js';
import { createRecorder, transcribe } from './voice.js';

export const ASR_DEFAULTS = { asrProvider: 'auto', doubaoAppId: '', doubaoToken: '', doubaoCluster: '' };
export const MAX_MS = 60000;
export const MIN_MS = 400;
const MOCK_STEP_MS = 150;
const WORKLET_URL = (() => { try { return new URL('./pcm-tap-worklet.js', import.meta.url).href; } catch (e) { return ''; } })();

export const VOICE_COPY = {
  notready: '语音这会儿用不了，先打字问我吧。',
  nodevice: '这台 iPad 现在录不了音，先打字问我吧。',
  network: '语音这会儿连不上，先打字问我吧。',
  offline: '现在没连网，先打字问我吧。',
  timeout: '网有点慢，没听完，再说一次或者打字问我吧。',
  short: '按住说话，说完再松开。',
  http: '没听清，再按住说一次。',
  fallback: '换个方式听写。',
};
export const MOCK_LINES = ['负三的平方为什么是正九？', '去括号的时候符号怎么变？', '这道方程我移项移错了吗？'];

const clean = v => String(v == null ? '' : v).replace(/[\s​-‍⁠﻿]/g, '');
const isFileResource = r => /(^|\.)auc(\.|_|$)/i.test(r || '');
const call = (fn, ...a) => { try { if (typeof fn === 'function') fn(...a); } catch (e) { /* the page's callback never stops recognition */ } };

export function asrRoute(s = {}) {
  s = s || {};
  const token = clean(s.doubaoToken);
  const appId = clean(s.doubaoAppId);
  const want = s.asrProvider === 'poe' ? 'poe' : 'auto';
  if (want !== 'poe' && token) {
    const cluster = clean(s.doubaoCluster);
    return { provider: 'doubao', stream: true, ready: true, url: STREAM_URL, appId, token, mode: appId ? 'app' : 'apikey',
      resource: cluster && !isFileResource(cluster) ? cluster : STREAM_RESOURCE };
  }
  return { provider: 'poe', stream: false, ready: true };
}

// 豆包把它当对话上下文，数学说法认得更准（“x 的平方”“负三分之一”）
export function contextText() {
  return '初一学生在问数学老师问题，会说到有理数、负数、分数、绝对值、乘方、整式、去括号、合并同类项、一元一次方程、移项、'
    + '线段、角、x、y、a、b，比如“负三的平方”“三分之二x”“x 等于负十一”。';
}

export function mockPieces(line) {
  return String(line || '').match(/\s*[A-Za-z0-9']+|\s*[^\sA-Za-z0-9']/g) || [];
}

function kidErr(code, cause = null) {
  const e = new Error((cause && cause.message) || code);
  e.code = code;
  e.kid = VOICE_COPY[code] || VOICE_COPY.http;
  if (cause && cause.reason) e.reason = cause.reason;
  return e;
}
function micDenied() { const x = new Error('mic'); x.name = 'NotAllowedError'; return x; }

// 英语 App 的设置在同一域名的 IndexedDB 'emma'（kv 仓，keyPath 'key'）。库不存在时绝不新建：新建出来的空库会让英语 App 打不开。
export async function importFromEnglish(ctx, { indexedDB = globalThis.indexedDB } = {}) {
  try {
    const s = (ctx.settings && ctx.settings()) || {};
    if (clean(s.doubaoToken) || s.asrFrom === 'cleared' || !indexedDB) return false;   // 家长清掉过就不再拿
    if (typeof indexedDB.databases === 'function') {
      const list = await indexedDB.databases();
      if (!list.some(d => d && d.name === 'emma')) return false;
    }
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('emma');
      req.onupgradeneeded = () => { try { req.transaction.abort(); } catch (e) { /* aborted below anyway */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    let value = null;
    try {
      if (!db.objectStoreNames.contains('kv')) return false;
      value = await new Promise((resolve, reject) => {
        const r = db.transaction('kv', 'readonly').objectStore('kv').get('settings');
        r.onsuccess = () => resolve(r.result ? r.result.value : null);
        r.onerror = () => reject(r.error);
      });
    } finally { try { db.close(); } catch (e) { /* fine */ } }
    const token = clean(value && value.doubaoToken);
    if (!token) return false;
    await ctx.saveSettings({ doubaoAppId: clean(value.doubaoAppId), doubaoToken: token, doubaoCluster: clean(value.doubaoCluster), asrFrom: 'english' });
    return true;
  } catch (e) {
    console.warn('voice: 英语 App 的豆包凭据没拿到', (e && e.message) || e);
    return false;
  }
}

export function createVoiceInput(ctx = {}, deps = {}) {
  const nav = globalThis.navigator || {};
  const hasMic = () => !!(deps.streamMedia || deps.recorder || (nav.mediaDevices && nav.mediaDevices.getUserMedia));
  const makeStream = deps.createStream || createDoubaoStream;
  const makeRecorder = deps.createRecorder || (o => createRecorder(o));
  const toText = deps.transcribe || ((blob, opt) => transcribe(ctx, blob, opt));
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const every = deps.every || ((fn, ms) => { const id = setInterval(fn, ms); return () => clearInterval(id); });
  const settings = () => { try { return (ctx.settings && ctx.settings()) || {}; } catch (e) { return {}; } };
  const mock = () => { const s = settings(); try { return !!s.mock || !!(ctx.mockForced && ctx.mockForced()); } catch (e) { return !!s.mock; } };
  const notice = msg => { try { if (ctx.toast) ctx.toast(msg, 2200); } catch (e) { /* only a hint */ } };
  let rec = null;
  let state = 'idle';
  let last = null;
  let mockN = 0;

  const available = () => mock() || hasMic();

  function start(opts = {}) {
    if (rec) cancel();
    const onPartial = typeof (opts && opts.onPartial) === 'function' ? opts.onPartial : null;
    if (mock()) return startMock(onPartial);
    if (!hasMic()) return Promise.reject(kidErr('nodevice'));
    const route = asrRoute(settings());
    const canStream = !!deps.createStream || typeof (deps.WebSocketImpl || globalThis.WebSocket) === 'function';
    if (route.provider === 'doubao' && canStream) return startStream(route, onPartial);
    return startRecorder();
  }

  // ------------------------------------------------ 豆包流式
  function streamOptions(route) {
    const o = { url: route.url, resourceId: route.resource, contextText: contextText(), maxMs: MAX_MS, uid: 'emma', workletUrl: WORKLET_URL };
    if (route.mode === 'app') { o.appId = route.appId; o.accessToken = route.token; } else o.apiKey = route.token;
    if (deps.streamMedia) o.getMedia = deps.streamMedia;
    if (deps.WebSocketImpl) o.WebSocketImpl = deps.WebSocketImpl;
    if (deps.AudioContextImpl) o.AudioContextImpl = deps.AudioContextImpl;
    if (deps.streamOptions) Object.assign(o, deps.streamOptions);
    return o;
  }
  async function startStream(route, onPartial) {
    const st = makeStream(streamOptions(route));
    const r = { kind: 'stream', t0: now(), st };
    rec = r;
    state = 'recording';
    try {
      await st.start({ onPartial: t => { if (rec === r) call(onPartial, String(t || '')); } });
    } catch (e) {
      if (rec !== r) return;
      rec = null;
      state = 'idle';
      if (e && e.name === 'NotAllowedError') throw micDenied();
      // 流式连开头都没起来（没有 WebSocket、音频图建不起来）：改成录整段给 Poe
      if (e && e.fallback) { notice(VOICE_COPY.fallback); return startRecorder({ reason: e.reason || '' }); }
      throw kidErr(e && VOICE_COPY[e.code] ? e.code : 'nodevice', e);
    }
  }
  async function stopStream(r) {
    const ms = now() - r.t0;
    if (ms < MIN_MS) { try { r.st.cancel(); } catch (e) { /* gone */ } state = 'idle'; return ''; }
    state = 'recognizing';
    try {
      const text = String((await r.st.stop()) || '').trim();
      last = { provider: 'doubao', stream: true, fellBack: '', reason: '', ms };
      return text;
    } catch (e) {
      if (e && e.name === 'NotAllowedError') throw micDenied();
      // 流式断了：同一段录音交给 Poe 转写
      let buf = null;
      try { buf = r.st.wav(); } catch (x) { buf = null; }
      const bytes = buf ? Math.max(0, buf.byteLength - 44) : 0;
      if (!bytes) throw kidErr(e && VOICE_COPY[e.code] ? e.code : 'network', e);
      if (bytes / 32 < MIN_MS) return '';
      console.warn('voice: 豆包流式没成，换 Poe', (e && (e.reason || e.message)) || e);
      last = { provider: 'doubao', stream: true, fellBack: 'poe', reason: (e && e.reason) || '', ms };
      notice(VOICE_COPY.fallback);
      return String((await toText(new Blob([buf], { type: 'audio/wav' }))) || '').trim();
    } finally { state = 'idle'; }
  }

  // ------------------------------------------------ 录整段给 Poe（没填豆包，或流式起不来）
  async function startRecorder(via = null) {
    const r = { kind: 'rec', t0: now(), via, rc: makeRecorder({ maxMs: MAX_MS }) };
    rec = r;
    state = 'recording';
    try { await r.rc.start(); } catch (e) {
      if (rec === r) rec = null;
      state = 'idle';
      if (e && (e.code === 'denied' || e.name === 'NotAllowedError')) throw micDenied();
      throw kidErr('nodevice', e);
    }
    if (rec !== r) { try { r.rc.cancel(); } catch (e) { /* gone */ } }
  }
  async function stopRecorder(r) {
    const ms = now() - r.t0;
    let blob;
    try { blob = await r.rc.stop(); } catch (e) { state = 'idle'; if (e && e.code === 'short') return ''; throw kidErr('http', e); }
    state = 'recognizing';
    try {
      last = r.via ? { provider: 'doubao', stream: true, fellBack: 'poe', reason: r.via.reason, ms } : { provider: 'poe', stream: false, fellBack: '', reason: '', ms };
      return String((await toText(blob)) || '').trim();
    } catch (e) {
      throw kidErr(nav.onLine === false ? 'offline' : 'network', e);
    } finally { state = 'idle'; }
  }

  // ------------------------------------------------ 模拟（不录音、不联网）：一个字一个字地出
  function startMock(onPartial) {
    const r = { kind: 'mock', t0: now(), line: MOCK_LINES[mockN % MOCK_LINES.length], tick: null };
    rec = r;
    state = 'recording';
    const pieces = mockPieces(r.line);
    let n = 0;
    if (onPartial) {
      r.tick = every(() => {
        if (rec !== r) return;
        if (n < pieces.length) { n++; call(onPartial, pieces.slice(0, n).join('')); }
        if (n >= pieces.length && r.tick) { r.tick(); r.tick = null; }
      }, MOCK_STEP_MS);
    }
    return Promise.resolve();
  }
  async function stopMock(r) {
    if (r.tick) { r.tick(); r.tick = null; }
    state = 'recognizing';
    await sleep(150);
    state = 'idle';
    if (now() - r.t0 < MIN_MS) return '';
    mockN++;
    last = { provider: 'doubao', stream: true, fellBack: '', reason: '', ms: now() - r.t0, mock: true };
    return r.line;
  }

  async function stop() {
    const r = rec;
    rec = null;
    if (!r) { state = 'idle'; return ''; }
    if (r.kind === 'mock') return stopMock(r);
    if (r.kind === 'stream') return stopStream(r);
    return stopRecorder(r);
  }
  function cancel() {
    const r = rec;
    rec = null;
    state = 'idle';
    if (!r) return;
    if (r.kind === 'mock') { if (r.tick) r.tick(); return; }
    try { if (r.kind === 'stream') r.st.cancel(); else r.rc.cancel(); } catch (e) { /* gone */ }
  }

  return { available, start, stop, cancel, state: () => state, info: () => (last ? { ...last } : null) };
}
