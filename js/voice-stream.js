// 豆包流式语音识别 2.0（火山引擎 v3 sauc）的浏览器适配器：按住说话，边说边出字。
// 不依赖别的文件。voice-input.js 在 asrProvider='doubao'（或自动选到豆包）时调用，失败时它把 wav() 交给百炼整段识别。
// 负责：语音输入（和 voice-input.js 同一个人）。worklet 用同源的 pcm-tap-worklet.js（voice-input 传 workletUrl），内容和 WORKLET_SOURCE 一样。
//
// 接口地址用 bigmodel_async（双向流式优化版）：结果有变化才回包，首字和尾字都更快，官方推荐；
// 豆包流式 2.0 的资源 volc.seedasr.sauc.duration 在 /sauc/bigmodel 上会报 “not allowed”。
// 浏览器的 WebSocket 带不了请求头，凭据走网址参数（服务端认，10-25 实测）：
//   旧版控制台 ?api_app_key=<APP ID>&api_access_key=<Access Token>&api_resource_id=…
//   新版控制台 ?api_key=<API Key>&api_resource_id=…
//
// 二进制帧（整数都是大端）：4 字节头 [版本 1 | 头长 1] [消息类型 | 标志] [序列化 | 压缩] [保留 0]
//   客户端：full client request（类型 1，JSON + gzip）→ 若干 audio only（类型 2，16 kHz 单声道 16 位 PCM + gzip）
//          → 最后一包（标志 0b0011 + 负序号；不带序号时标志 0b0010）
//   服务端：full server response（类型 9，头后可能有 4 字节序号，再 4 字节长度 + JSON），最后一包标志带 0b0010 / 序号为负
//          错误帧（类型 15）：4 字节错误码 + 4 字节长度 + 错误信息
//
// 导出
//   createDoubaoStream({ appId, accessToken, apiKey, resourceId, getMedia, WebSocketImpl, onPartial, onFinal, onError, ...选项 })
//     -> { start({ onPartial?, onFinal?, onError? }?), stop() -> Promise<最终文字>, cancel(), state(), pcm(), wav(), info() }
//     start() 要在点按（pointerdown）里同步调用：里面先建 AudioContext 再等麦克风。录到的音频边录边发，连上之前先排队。
//     stop() 发最后一包，等最终结果；3 秒（finalTimeoutMs）没等到就用最后一次中间结果，一句都没有就报 timeout。
//     出错时 err.code 是英文键（和 voice-input.js 的 VOICE_COPY 一致），err.reason 是中文原因码（REASONS），
//     err.fallback = true 表示上层可以退回百炼整段识别：pcm() / wav() 里有这次按住录到的全部音频（16 kHz），不用重录。
//   纯函数（测试用）：credentials、streamUrl、buildRequest、encodeFrame、parseFrame、decodePayload、fullRequestFrame、
//     audioFrame、textOf、tidy、serverError、classifyHttp、streamError、Resampler、floatTo16LE、pcmToWav、pcmSource、gzip、gunzip
//   常量：STREAM_URL、STREAM_ENDPOINTS、STREAM_RESOURCE、RATE、MSG、FLAG、CODE、REASONS、DEFAULTS、WORKLET_SOURCE

export const STREAM_ENDPOINTS = {
  bigmodel_async: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',   // 双向流式优化版（默认）
  bigmodel: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',               // 双向流式（每包回一包）
  bigmodel_nostream: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream', // 流式输入（15 秒或最后一包才出字）
};
export const STREAM_URL = STREAM_ENDPOINTS.bigmodel_async;
export const STREAM_RESOURCE = 'volc.seedasr.sauc.duration';   // 豆包流式语音识别模型 2.0，按时长计费
export const RATE = 16000;

export const MSG = { FULL_CLIENT: 0b0001, AUDIO_ONLY: 0b0010, FULL_SERVER: 0b1001, ERROR: 0b1111 };
export const FLAG = { NONE: 0b0000, POS_SEQ: 0b0001, LAST: 0b0010, NEG_SEQ: 0b0011, EVENT: 0b0100 };
const SERIAL_JSON = 1, GZIP = 1;
export const CODE = { OK: 20000000, BAD_PARAM: 45000001, EMPTY_AUDIO: 45000002, WAIT_TIMEOUT: 45000081, BAD_FORMAT: 45000151, BUSY: 55000031 };

// 中文原因码：给上层判断退不退百炼、给家长区显示；孩子看到的话由 voice-input.js 的 VOICE_COPY 按 err.code 给
export const REASONS = {
  notready: '没填凭据',
  nodevice: '不能录音',
  mic: '麦克风被拒',
  badkey: '鉴权失败',
  forbidden: '没开通资源',
  network: '连不上',
  offline: '没联网',
  timeout: '超时',
  ratelimit: '请求太多',
  server: '服务繁忙',
  format: '音频格式不对',
  http: '请求无效',
};

export const DEFAULTS = {
  url: STREAM_URL,
  resourceId: STREAM_RESOURCE,
  chunkMs: 200,            // 官方：双向流式 200 ms 一包性能最好
  finalTimeoutMs: 3000,    // 松手后等最终结果的上限
  connectTimeoutMs: 6000,
  maxMs: 60000,            // 最长录多久，到了自动发最后一包
  secondPass: true,        // enable_nonstream：边说边出字 + 每句判停后用非流式模型重认一遍，最终结果更准
  sequence: true,          // 帧里带序号（标志 0b0001 / 最后一包 0b0011 + 负序号）；false 用文档示例里不带序号的写法
  compress: 'auto',        // 'auto' = 有 CompressionStream 就 gzip，否则不压缩；也可 'gzip' / 'none'
  uid: 'emma',
  language: '',            // 只有 bigmodel_nostream 认；空着 = 中英文（加几种方言）
  hotwords: [],            // 热词直传（双向流式约 100 tokens 以内）
  contextText: '',         // 没有热词时当对话上下文传
  request: null,           // 追加或覆盖 request 字段
  workletUrl: '',          // 同源的 worklet 文件；空着就用 Blob 网址（CSP 拦了会退回 ScriptProcessor）
};

const MIC_CONSTRAINTS = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
const MIN_LAST_BYTES = 320;   // 最后一包至少带 10 ms（空包不保险）
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------- 凭据和网址

const clean = v => String(v == null ? '' : v).replace(/[\s​-‍⁠﻿]/g, '');

// 新版 API Key 优先；只填了 Access Token 没填 APP ID 时，当新版 API Key 用（和 voice-input.js 的约定一样）
export function credentials({ appId, accessToken, apiKey } = {}) {
  const id = clean(appId), tok = clean(accessToken), key = clean(apiKey);
  if (key) return { mode: 'apikey', apiKey: key };
  if (id && tok) return { mode: 'app', appId: id, accessToken: tok };
  if (tok) return { mode: 'apikey', apiKey: tok };
  return null;
}

export function streamUrl({ url = STREAM_URL, mode, appId, accessToken, apiKey, resourceId = STREAM_RESOURCE } = {}) {
  const q = mode === 'apikey' ? [['api_key', apiKey]] : [['api_app_key', appId], ['api_access_key', accessToken]];
  q.push(['api_resource_id', clean(resourceId) || STREAM_RESOURCE]);
  const qs = q.map(([k, v]) => `${k}=${encodeURIComponent(v || '')}`).join('&');
  return url + (url.includes('?') ? '&' : '?') + qs;
}
const bareUrl = u => String(u || '').split('?')[0];

// ---------------------------------------------------------------- 请求参数

function corpusContext(hotwords = [], text = '') {
  const seen = new Set(), words = [];
  let chars = 0;
  for (const w of hotwords || []) {
    const t = String(w || '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    if (words.length >= 40 || chars + t.length > 300) break;
    seen.add(t.toLowerCase());
    words.push(t);
    chars += t.length;
  }
  if (words.length) return JSON.stringify({ hotwords: words.map(word => ({ word })) });
  const ctx = String(text || '').trim();
  if (ctx) return JSON.stringify({ context_type: 'dialog_ctx', context_data: [{ text: ctx.slice(0, 800) }] });
  return '';
}

export function buildRequest({ uid = 'emma', secondPass = true, language = '', hotwords = [], contextText = '', request = null } = {}) {
  const audio = { format: 'pcm', codec: 'raw', rate: RATE, bits: 16, channel: 1 };
  if (language) audio.language = language;
  const req = { model_name: 'bigmodel', enable_punc: true, enable_itn: true, enable_ddc: false, show_utterances: true, result_type: 'full' };
  if (secondPass) req.enable_nonstream = true;
  const ctx = corpusContext(hotwords, contextText);
  if (ctx) req.corpus = { context: ctx };
  if (request && typeof request === 'object') Object.assign(req, request);
  return { user: { uid: String(uid || 'emma'), platform: 'web' }, audio, request: req };
}

// ---------------------------------------------------------------- 帧

const canGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
const useGzip = mode => (mode === 'gzip' ? true : mode === 'none' ? false : canGzip());

async function through(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}
export const gzip = bytes => through(bytes, new CompressionStream('gzip'));
export const gunzip = bytes => through(bytes, new DecompressionStream('gzip'));

// 头 + [序号] + 长度 + 负载。flags 的第 0 位表示头后跟 4 字节序号
export function encodeFrame({ type, flags = 0, serial = 0, compress = 0, seq = 0, payload = new Uint8Array(0) }) {
  const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const hasSeq = (flags & FLAG.POS_SEQ) !== 0;
  const out = new Uint8Array(4 + (hasSeq ? 4 : 0) + 4 + body.length);
  const v = new DataView(out.buffer);
  out[0] = 0x11;                         // 协议版本 1，头长 1×4 字节
  out[1] = ((type & 15) << 4) | (flags & 15);
  out[2] = ((serial & 15) << 4) | (compress & 15);
  out[3] = 0;
  let p = 4;
  if (hasSeq) { v.setInt32(p, seq); p += 4; }
  v.setUint32(p, body.length);
  out.set(body, p + 4);
  return out;
}

export function parseFrame(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < 4) throw new Error('帧太短');
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const f = {
    version: u8[0] >> 4, headerSize: (u8[0] & 15) * 4, type: u8[1] >> 4, flags: u8[1] & 15,
    serial: u8[2] >> 4, compress: u8[2] & 15, seq: null, event: null, code: null, size: 0, payload: new Uint8Array(0), last: false,
  };
  let p = f.headerSize || 4;
  const need = n => p + n <= u8.length;
  if ((f.flags & FLAG.POS_SEQ) && need(4)) { f.seq = v.getInt32(p); p += 4; }
  if ((f.flags & FLAG.EVENT) && need(4)) { f.event = v.getInt32(p); p += 4; }
  if (f.type === MSG.ERROR && need(4)) { f.code = v.getUint32(p); p += 4; }
  if (need(4)) { f.size = v.getUint32(p); p += 4; }
  f.payload = u8.subarray(p, Math.min(u8.length, p + f.size));
  f.last = (f.flags & FLAG.LAST) !== 0 || (f.seq !== null && f.seq < 0);
  return f;
}

// 解压 + JSON；错误帧的信息可能是纯文字
export async function decodePayload(f) {
  let bytes = f.payload;
  if (f.compress === GZIP && bytes.length) bytes = await gunzip(bytes);
  const text = bytes.length ? dec.decode(bytes) : '';
  let json = null;
  if (text && (f.serial === SERIAL_JSON || /^\s*[{[]/.test(text))) { try { json = JSON.parse(text); } catch (e) { json = null; } }
  return { text, json };
}

export async function fullRequestFrame(params, { sequence = true, gzip: zip = true } = {}) {
  let payload = enc.encode(JSON.stringify(params));
  if (zip) payload = await gzip(payload);
  return encodeFrame({ type: MSG.FULL_CLIENT, flags: sequence ? FLAG.POS_SEQ : FLAG.NONE, serial: SERIAL_JSON, compress: zip ? GZIP : 0, seq: 1, payload });
}

export async function audioFrame(pcm, { seq = 2, last = false, sequence = true, gzip: zip = true } = {}) {
  let payload = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm.buffer || pcm, pcm.byteOffset || 0, pcm.byteLength);
  if (zip) payload = await gzip(payload);
  const flags = last ? (sequence ? FLAG.NEG_SEQ : FLAG.LAST) : (sequence ? FLAG.POS_SEQ : FLAG.NONE);
  return encodeFrame({ type: MSG.AUDIO_ONLY, flags, serial: 0, compress: zip ? GZIP : 0, seq: last ? -Math.abs(seq) : seq, payload });
}

// result 可能是对象（文档示例）也可能是列表（表格写的 list）
export function textOf(j) {
  if (!j || typeof j !== 'object') return '';
  let r = j.result;
  if (Array.isArray(r)) r = { text: r.map(x => (x && typeof x.text === 'string' ? x.text : '')).join(''), utterances: [] };
  if (!r || typeof r !== 'object') return '';
  if (typeof r.text === 'string' && r.text.trim()) return r.text.trim();
  if (Array.isArray(r.utterances)) return r.utterances.map(u => (u && u.text) || '').join('').trim();
  return '';
}

// 二遍识别的结果会在中文标点后面留个空格（“老师， There be”），去掉
export function tidy(text) {
  return String(text || '').replace(/([，。？！、；：）】」”])[ \t\u00a0\u3000]+/g, '$1').trim();
}

// ---------------------------------------------------------------- 错误

export function streamError(code, { detail = '', fallback, name = '', cause = null, serverCode = 0 } = {}) {
  const reason = REASONS[code] || REASONS.http;
  const err = new Error(`豆包流式识别：${reason}${detail ? `（${detail}）` : ''}`);
  err.code = REASONS[code] ? code : 'http';
  err.reason = reason;
  err.detail = String(detail || '');
  err.fallback = fallback === undefined ? !(code === 'mic') : !!fallback;
  err.source = 'doubao-stream';
  if (serverCode) err.serverCode = serverCode;
  if (name) err.name = name;
  if (cause) err.cause = cause;
  return err;
}

export function serverError(code, message = '') {
  const c = Number(code) || 0, m = String(message || '');
  if (c === CODE.BAD_FORMAT) return 'format';
  if (c === CODE.WAIT_TIMEOUT) return 'timeout';
  if (c === CODE.BUSY) return 'server';
  if (/grant|x-api-key|api.?key|token|auth|unauthori|access.?key|app.?key/i.test(m)) return 'badkey';
  if (/resource|not allowed|permission|quota|forbidden|欠费|余额/i.test(m)) return 'forbidden';
  if (/limit|too many|concurren/i.test(m)) return 'ratelimit';
  if (c >= 55000000 && c < 56000000) return 'server';
  return 'http';
}

// 握手被拒时浏览器只看到 1006，原因读不到；同一个网址用 https GET 再问一次（CORS 是 *），服务端回 JSON 的 error
export function classifyHttp(status, body = '') {
  let msg = String(body || '');
  try { const j = JSON.parse(msg); msg = String(j.error || j.message || (j.header && j.header.message) || msg); } catch (e) { /* 纯文字 */ }
  msg = msg.slice(0, 200);
  const s = Number(status) || 0;
  let code = 'network';
  if (s === 401) code = 'badkey';
  else if (s === 403) code = /grant|key|token|auth/i.test(msg) ? 'badkey' : 'forbidden';
  else if (s === 400 && /resource/i.test(msg)) code = 'forbidden';
  else if (s === 400 && /grant|key|token|auth/i.test(msg)) code = 'badkey';
  else if (s === 429) code = 'ratelimit';
  else if (s >= 500) code = 'server';
  return streamError(code, { detail: `握手被拒 ${s}${msg ? ' ' + msg : ''}` });
}

// ---------------------------------------------------------------- 音频

// 面积平均重采样（顺带低通），按块喂、状态连续；48k / 44.1k → 16k
export class Resampler {
  constructor(from = RATE, to = RATE) {
    this.from = from; this.to = to; this.ratio = from / to; this.acc = 0; this.left = this.ratio;
  }
  push(input) {
    if (!input || !input.length) return new Float32Array(0);
    if (this.from === this.to) return Float32Array.from(input);
    const r = this.ratio;
    const out = new Float32Array(Math.ceil(input.length / r) + 2);
    let n = 0, acc = this.acc, left = this.left;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      let rem = 1;
      while (rem > 1e-12) {
        const take = rem < left ? rem : left;
        acc += x * take; left -= take; rem -= take;
        if (left <= 1e-9) { out[n++] = acc / r; acc = 0; left = r; }
      }
    }
    this.acc = acc; this.left = left;
    return out.slice(0, n);
  }
}

// [-1, 1] 浮点 → 16 位小端 PCM 字节
export function floatTo16LE(f32) {
  const out = new Uint8Array(f32.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < f32.length; i++) {
    const x = Math.max(-1, Math.min(1, f32[i] || 0));
    v.setInt16(i * 2, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true);
  }
  return out;
}

export function pcmToWav(pcm, rate = RATE) {
  const bytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const buf = new ArrayBuffer(44 + bytes.length);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes.length, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes.length, true);
  new Uint8Array(buf, 44).set(bytes);
  return buf;
}

// 不走麦克风的音源（测试和 try-stream 用）：getMedia 返回它就行。realtime = 按真实时间一帧帧喂
export function pcmSource(samples, { sampleRate = RATE, realtime = false, frameMs = 20 } = {}) {
  const f32 = samples instanceof Float32Array ? samples : Float32Array.from(samples, x => x / 32768);
  const frame = Math.max(1, Math.round(sampleRate * frameMs / 1000));
  let timer = 0, stopped = false, endIt;
  const done = new Promise(r => { endIt = r; });
  return {
    sampleRate, kind: realtime ? 'pcm-realtime' : 'pcm', done,
    start(push) {
      let i = 0;
      if (!realtime) { for (; i < f32.length; i += frame) push(f32.subarray(i, i + frame)); endIt(); return; }
      const t0 = Date.now();
      const tick = () => {
        if (stopped) return;
        const due = Math.min(f32.length, Math.floor((Date.now() - t0) * sampleRate / 1000));
        while (i < due) { const j = Math.min(i + frame, due); push(f32.subarray(i, j)); i = j; }
        if (i >= f32.length) { endIt(); return; }
        timer = setTimeout(tick, frameMs);
      };
      tick();
    },
    stop() { stopped = true; clearTimeout(timer); endIt(); },
  };
}

// AudioWorklet：混成单声道，攒 2048 个采样发一次；收到 'flush' 把手上的先发出来
export const WORKLET_SOURCE = `class EmmaPcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0;
    this.port.onmessage = e => { if (e.data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); } }; }
  flush() { if (this.n) { this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0; } }
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) {
      const len = ch[0].length, k = ch.length;
      for (let i = 0; i < len; i++) {
        let s = 0; for (let c = 0; c < k; c++) s += ch[c][i];
        this.buf[this.n++] = s / k;
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('emma-pcm-tap', EmmaPcmTap);
`;

function makeAudioContext(AC) {
  if (typeof AC !== 'function') return null;
  let ac = null;
  try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ac = new AC(); } catch (e2) { return null; } }
  try { const p = ac.resume && ac.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 等麦克风以后再试 */ }
  return ac;
}

function stopTracks(stream) {
  try { for (const t of (stream && stream.getTracks ? stream.getTracks() : [])) t.stop(); } catch (e) { /* 已经停了 */ }
}

// 麦克风 → AudioWorklet（不行就 ScriptProcessor）→ 静音增益 → 扬声器（要接到 destination 才会跑）
async function micSource(stream, ac, { workletUrl = '' } = {}) {
  const src = ac.createMediaStreamSource(stream);
  const sink = ac.createGain();
  sink.gain.value = 0;
  sink.connect(ac.destination);
  let node = null, port = null, flushed = null, push = () => {};
  if (ac.audioWorklet && typeof globalThis.AudioWorkletNode === 'function') {
    let blobUrl = '';
    try {
      let url = workletUrl;
      if (!url) { blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' })); url = blobUrl; }
      await Promise.race([ac.audioWorklet.addModule(url), wait(1500).then(() => { throw new Error('worklet 加载超时'); })]);   // CSP 拦了也别卡住
      node = new globalThis.AudioWorkletNode(ac, 'emma-pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      port = node.port;
      port.onmessage = e => {
        const d = e.data;
        if (d instanceof Float32Array) push(d);
        else if (d && d.flushed && flushed) { flushed(); flushed = null; }
      };
    } catch (e) { node = null; port = null; }
    finally { if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) { /* 无所谓 */ } } }
  }
  if (!node) {
    node = ac.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = e => push(new Float32Array(e.inputBuffer.getChannelData(0)));
  }
  return {
    sampleRate: ac.sampleRate,
    kind: port ? 'worklet' : 'script',
    async start(fn) {
      push = fn;
      src.connect(node);
      node.connect(sink);
      try { if (ac.state !== 'running' && ac.resume) await ac.resume(); } catch (e) { /* iPad 录音中一般能恢复 */ }
    },
    flush() {
      if (!port) return Promise.resolve();
      return new Promise(r => { flushed = r; try { port.postMessage('flush'); } catch (e) { r(); } setTimeout(r, 120); });
    },
    stop() {
      push = () => {};
      for (const n of [src, node, sink]) { try { n.disconnect(); } catch (e) { /* 已断开 */ } }
      if (port) { try { port.onmessage = null; } catch (e) { /* 无所谓 */ } }
      stopTracks(stream);
      try { const p = ac.close && ac.close(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 已关 */ }
    },
  };
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  if (typeof data === 'string') return enc.encode(data);
  return new Uint8Array(0);
}

const call = (fn, ...a) => { try { if (typeof fn === 'function') fn(...a); } catch (e) { /* 上层的回调出错不影响识别 */ } };
const wait = ms => new Promise(r => setTimeout(r, ms));

function concat(list, total) {
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of list) { out.set(b, p); p += b.length; }
  return out;
}

// ---------------------------------------------------------------- 主体

export function createDoubaoStream(opts = {}) {
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(opts || {})) if (v !== undefined) o[k] = v;
  const zip = useGzip(o.compress);
  let cur = null;    // 正在按住的这一次
  let last = null;   // 最近一次（停了以后 pcm() / wav() / info() 还能读）

  const now = () => Date.now();
  const since = s => now() - s.t0;

  function open(callOpts) {
    const c = callOpts || {};
    const cb = { onPartial: c.onPartial || o.onPartial, onFinal: c.onFinal || o.onFinal, onError: c.onError || o.onError };
    const cred = credentials(o);
    if (!cred) throw streamError('notready');
    const WS = o.WebSocketImpl || globalThis.WebSocket;
    if (typeof WS !== 'function') throw streamError('nodevice', { detail: '没有 WebSocket', fallback: true });
    const nav = globalThis.navigator || {};
    const getMedia = o.getMedia || (nav.mediaDevices && nav.mediaDevices.getUserMedia ? x => nav.mediaDevices.getUserMedia(x) : null);
    if (!getMedia) throw streamError('nodevice', { detail: '没有 getUserMedia', fallback: false });
    const s = {
      t0: now(), cb, state: 'starting', partial: '', finalText: '', error: null, done: false, dead: false, stopping: false,
      capturing: false, chain: Promise.resolve(), recv: Promise.resolve(), opened: null, ws: null, seq: 0,
      pend: [], pendBytes: 0, chunks: [], bytes: 0, chunkBytes: Math.max(2, Math.round(RATE * o.chunkMs / 1000) * 2),
      source: null, resampler: null, waiter: null, finishing: null, timers: new Set(),
      info: { url: bareUrl(o.url), mode: cred.mode, resourceId: o.resourceId, secondPass: !!o.secondPass, sequence: !!o.sequence,
        gzip: zip, capture: '', openMs: null, firstPartialMs: null, stopMs: null, finalMs: null, packets: 0, sentBytes: 0,
        audioMs: 0, timedOut: false, closedEarly: false },
    };
    // iPad Safari：AudioContext 要在点按里建（这里还没有任何 await）；注入了 getMedia 又没给 AudioContextImpl 时不建
    s.ac = !o.getMedia || o.AudioContextImpl ? makeAudioContext(o.AudioContextImpl || globalThis.AudioContext || globalThis.webkitAudioContext) : null;
    connect(s, WS, cred);
    s.ready = capture(s, getMedia);
    return s;
  }

  function later(s, fn, ms) {
    const t = setTimeout(() => { s.timers.delete(t); fn(); }, ms);
    s.timers.add(t);
    return t;
  }

  function connect(s, WS, cred) {
    const url = streamUrl({ ...cred, url: o.url, resourceId: o.resourceId });
    let isOpen = false, ok, no;
    s.opened = new Promise((a, b) => { ok = a; no = b; });
    s.opened.catch(() => {});
    let ws;
    try { ws = new WS(url); } catch (e) { no(streamError('network', { detail: '建不了连接', cause: e })); return; }
    s.ws = ws;
    try { ws.binaryType = 'arraybuffer'; } catch (e) { /* 收到 Blob 也能读 */ }
    const timer = later(s, () => {
      if (isOpen || s.dead) return;
      const err = streamError('timeout', { detail: `连接超过 ${Math.round(o.connectTimeoutMs / 1000)} 秒` });
      no(err); fail(s, err);
      try { ws.close(); } catch (e) { /* 已关 */ }
    }, o.connectTimeoutMs);
    ws.onopen = () => { isOpen = true; clearTimeout(timer); s.timers.delete(timer); s.info.openMs = since(s); ok(); };
    ws.onmessage = ev => {
      s.recv = s.recv.then(() => onFrame(s, ev && ev.data))
        .catch(e => fail(s, streamError('http', { detail: '回包解析失败', cause: e })));
    };
    ws.onerror = () => { /* 原因在 onclose 里判断 */ };
    ws.onclose = ev => {
      clearTimeout(timer); s.timers.delete(timer);
      if (s.dead || s.error || s.done) return;
      if (!isOpen) {
        diagnose(url).then(err => { no(err); fail(s, err); });
        return;
      }
      s.recv.then(() => {
        if (s.dead || s.error || s.done) return;
        if (s.stopping && s.partial) settle(s, s.partial, { closedEarly: true });
        else fail(s, streamError('network', { detail: `连接断了（${(ev && ev.code) || ''}${ev && ev.reason ? ' ' + ev.reason : ''}）` }));
      });
    };
    s.seq = 1;
    const params = buildRequest(o);
    queue(s, () => fullRequestFrame(params, { sequence: o.sequence, gzip: zip }));
  }

  async function diagnose(url) {
    const nav = globalThis.navigator || {};
    if (nav.onLine === false) return streamError('offline');
    const f = o.fetchImpl || (typeof globalThis.fetch === 'function' ? (...a) => globalThis.fetch(...a) : null);
    if (!f) return streamError('network', { detail: '握手失败' });
    try {
      const res = await Promise.race([
        f(url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), { method: 'GET', cache: 'no-store' }),
        wait(4000).then(() => { throw new Error('诊断超时'); }),
      ]);
      let body = '';
      try { body = await res.text(); } catch (e) { body = ''; }
      return classifyHttp(res.status, body);
    } catch (e) {
      return streamError('network', { detail: `握手失败，${(e && e.message) || '网络不通'}`, cause: e });
    }
  }

  // 发送排队：gzip 是异步的，用一条 promise 链保证顺序；连上之前先排着
  function queue(s, make) {
    s.chain = s.chain.then(async () => {
      await s.opened;
      if (s.dead || s.error) return;
      const frame = await make();
      const ws = s.ws;
      if (s.dead || !ws || ws.readyState !== 1) return;
      ws.send(frame);
      s.info.packets++;
      s.info.sentBytes += frame.length;
    }).catch(e => fail(s, e && e.source === 'doubao-stream' ? e : streamError('network', { detail: '发送失败', cause: e })));
  }

  function take(s, n) {
    const all = concat(s.pend, s.pendBytes);
    const head = all.slice(0, n);
    const rest = all.slice(n);
    s.pend = rest.length ? [rest] : [];
    s.pendBytes = rest.length;
    return head;
  }

  function onAudio(s, f32) {
    if (s.dead || !s.capturing || !f32 || !f32.length) return;
    const out = s.resampler.push(f32);
    if (!out.length) return;
    const b = floatTo16LE(out);
    s.chunks.push(b); s.bytes += b.length;
    s.pend.push(b); s.pendBytes += b.length;
    while (s.pendBytes >= s.chunkBytes) {
      const pcm = take(s, s.chunkBytes);
      const n = ++s.seq;
      queue(s, () => audioFrame(pcm, { seq: n, last: false, sequence: o.sequence, gzip: zip }));
    }
  }

  async function capture(s, getMedia) {
    let media;
    try {
      media = await getMedia(MIC_CONSTRAINTS);
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const err = denied ? streamError('mic', { name: 'NotAllowedError', fallback: false, cause: e })
        : streamError('nodevice', { detail: (e && (e.name || e.message)) || '麦克风打不开', fallback: false, cause: e });
      kill(s);
      if (cur === s) cur = null;
      throw err;
    }
    if (s.dead) { if (media && typeof media.stop === 'function' && typeof media.start === 'function') media.stop(); else stopTracks(media); return; }
    let source;
    try {
      if (media && typeof media.start === 'function') {
        source = media;
        closeAc(s);
      } else {
        if (!s.ac) s.ac = makeAudioContext(o.AudioContextImpl || globalThis.AudioContext || globalThis.webkitAudioContext);
        if (!s.ac) throw new Error('没有 AudioContext');
        source = await micSource(media, s.ac, o);
        s.ac = null;   // 交给 micSource，stop 时它来关
      }
    } catch (e) {
      stopTracks(media);
      kill(s);
      if (cur === s) cur = null;
      throw streamError('nodevice', { detail: (e && e.message) || '录音处理建不起来', fallback: true, cause: e });
    }
    if (s.dead) { try { source.stop(); } catch (e) { /* 已停 */ } return; }
    s.source = source;
    s.info.capture = source.kind || 'custom';
    s.resampler = new Resampler(source.sampleRate || RATE, RATE);
    s.capturing = true;
    s.state = 'recording';
    await source.start(f32 => onAudio(s, f32));
    if (o.maxMs > 0 && !s.dead) later(s, () => { if (!s.finishing && !s.dead) { s.finishing = finish(s); s.finishing.catch(() => {}); } }, o.maxMs);
  }

  async function onFrame(s, data) {
    if (s.dead) return;
    const f = parseFrame(await toBytes(data));
    const body = await decodePayload(f);
    const j = body.json;
    if (f.type === MSG.ERROR || (j && typeof j.code === 'number' && j.code !== CODE.OK && j.code !== 0 && !j.result)) {
      const code = f.type === MSG.ERROR ? f.code : j.code;
      const msg = String((j && (j.error || j.message || (j.header && j.header.message))) || body.text || '').slice(0, 200);
      if (code === CODE.EMPTY_AUDIO) { if (s.stopping) settle(s, s.partial || ''); return; }   // 空音频 = 没听到
      fail(s, streamError(serverError(code, msg), { detail: `${code || ''} ${msg}`.trim(), serverCode: code }));
      return;
    }
    if (f.type !== MSG.FULL_SERVER) return;
    if (j && j.audio_info && j.audio_info.duration) s.info.audioMs = Number(j.audio_info.duration) || 0;
    const text = tidy(textOf(j));
    if (f.last) { settle(s, text || s.partial); return; }
    if (text && text !== s.partial) {
      s.partial = text;
      if (s.info.firstPartialMs == null) s.info.firstPartialMs = since(s);
      call(s.cb.onPartial, text);
    }
  }

  function closeWs(s, code = 1000) {
    const ws = s.ws;
    if (!ws) return;
    try { if (ws.readyState === 0 || ws.readyState === 1) ws.close(code); } catch (e) { /* 已关 */ }
  }
  function closeAc(s) {
    const ac = s.ac;
    s.ac = null;
    try { const p = ac && ac.close && ac.close(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 已关 */ }
  }

  function settle(s, text, extra = {}) {
    if (s.done || s.dead) return;
    s.done = true;
    s.finalText = String(text || '');
    s.info.finalMs = since(s);
    Object.assign(s.info, extra);
    call(s.cb.onFinal, s.finalText);
    if (s.waiter) s.waiter.resolve(s.finalText);
    closeWs(s);
  }

  // 出错后照样录音，松手时 stop() 报错，上层拿 pcm() / wav() 去百炼
  function fail(s, err) {
    if (s.error || s.done || s.dead) return;
    s.error = err;
    call(s.cb.onError, err);
    if (s.waiter) s.waiter.reject(err);
    closeWs(s);
  }

  async function stopCapture(s) {
    const src = s.source;
    if (src && typeof src.flush === 'function') { try { await Promise.race([src.flush(), wait(150)]); } catch (e) { /* 照停 */ } }
    s.capturing = false;
    s.source = null;
    if (src) { try { src.stop(); } catch (e) { /* 已停 */ } }
    closeAc(s);
  }

  async function finish(s) {
    s.stopping = true;
    s.state = 'finishing';
    s.info.stopMs = since(s);
    await stopCapture(s);
    if (s.dead) return '';
    if (s.error) throw s.error;
    if (s.done) return s.finalText;
    let rest = take(s, s.pendBytes);
    if (rest.length < MIN_LAST_BYTES) { const pad = new Uint8Array(MIN_LAST_BYTES); pad.set(rest); rest = pad; }
    const n = ++s.seq;
    queue(s, () => audioFrame(rest, { seq: n, last: true, sequence: o.sequence, gzip: zip }));
    return new Promise((resolve, reject) => {
      s.waiter = { resolve, reject };
      if (s.done) { resolve(s.finalText); return; }
      if (s.error) { reject(s.error); return; }
      s.chain.then(() => {
        if (s.done || s.error || s.dead) return;
        later(s, () => {
          if (s.done || s.error || s.dead) return;
          if (s.partial) settle(s, s.partial, { timedOut: true });
          else fail(s, streamError('timeout', { detail: `松手后 ${o.finalTimeoutMs / 1000} 秒没等到最终结果` }));
        }, o.finalTimeoutMs);
      });
    });
  }

  function kill(s) {
    if (s.dead) return;
    s.dead = true;
    s.capturing = false;
    s.state = 'idle';
    for (const t of s.timers) clearTimeout(t);
    s.timers.clear();
    const src = s.source;
    s.source = null;
    if (src) { try { src.stop(); } catch (e) { /* 已停 */ } }
    closeAc(s);
    closeWs(s);
  }

  function start(callOpts = {}) {
    if (cur) cancel();
    let s;
    try { s = open(callOpts); } catch (e) { return Promise.reject(e); }
    cur = last = s;
    return s.ready;
  }

  async function stop() {
    const s = cur;
    if (!s) return '';
    try { await s.ready; } catch (e) { if (cur === s) cur = null; throw e; }
    if (s.dead) { if (cur === s) cur = null; return ''; }
    if (!s.finishing) { s.finishing = finish(s); s.finishing.catch(() => {}); }
    try { return await s.finishing; }
    finally { kill(s); if (cur === s) cur = null; }
  }

  function cancel() {
    const s = cur;
    cur = null;
    if (!s) return;
    kill(s);
    if (s.waiter) s.waiter.resolve('');
  }

  return {
    start,
    stop,
    cancel,
    state: () => (cur ? cur.state : 'idle'),
    pcm: () => { if (!last) return new Int16Array(0); const b = concat(last.chunks, last.bytes); return new Int16Array(b.buffer, 0, b.length >> 1); },
    wav: () => pcmToWav(last ? concat(last.chunks, last.bytes) : new Uint8Array(0), RATE),
    info: () => (last ? { ...last.info, partial: last.partial, final: last.finalText, error: last.error ? last.error.code : '' } : null),
  };
}
