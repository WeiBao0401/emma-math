// 语音提问（CONTRACTS 16，design/teacher-chat.md 第 2、3 节）：她按一下麦克风说，再按一下停，文字出现在输入框里，她看一眼
// 再发。录音用 MediaRecorder（iPad 录出来是 audio/mp4）；转文字默认走 Poe 的 listen 任务（gemini-3.1-pro，file 写法，
// 实测 7-9 秒逐字转对，Poe 不认 input_audio），家长区选了豆包且填了 App ID 和 Access Key 时先走豆包，失败自动退回 Poe，
// 在家长区“最近的 AI 调用”里记一行原因。
// 负责：接线的人（v0.3 的 ai-voice agent 写完 ai.js 的 files / raw / noteCall 后没写这个文件，接线时补写）。
//
// 导出
//   createRecorder({ maxMs = 60000, onAutoStop, env }) -> { start(), stop() -> Promise<Blob>, cancel(), state(), level(), elapsed() }
//     start() -> Promise   要麦克风权限；拒绝或没有麦克风抛 VoiceError（code 'denied' | 'nomic' | 'unsupported' | 'busy'）
//     stop() -> Promise<Blob>   停下拿到录音；太短（不到 0.6 秒或没有声音数据）抛 VoiceError('short')
//     cancel()             不要这段了（离开页面时调用），麦克风马上释放
//     state()              'idle' | 'starting' | 'recording' | 'stopping'
//     level()              0..1 的音量，界面画小波形用；拿不到时是 0
//     elapsed()            已经录了多少毫秒
//     到 maxMs 自动停，调 onAutoStop(blob | error)
//   transcribe(ctx, blob, { signal }) -> Promise<string>   settings.asr：'poe'（默认）| 'doubao'
//   LISTEN_SYSTEM                       发给 listen 任务的系统提示（数学式照她说的写成算式）
//   cleanTranscript(text) -> string     去掉模型偶尔加的“转写：”、引号、首尾空白
//   fileNameFor(type) -> 'q.m4a' | 'q.webm' | 'q.ogg' | 'q.wav' | 'q.mp3'
//   pickMime(isTypeSupported) -> MediaRecorder 用哪种格式（'' = 让浏览器自己选）
//   doubaoRequest({ appId, accessKey, resourceId }, base64, requestId) -> { url, init }   纯函数（测试看形状）
//   doubaoText(status, headers, body) -> string   读豆包的回答；出错抛 VoiceError（code 'doubao'）
//   encodeWav(samples, sampleRate) -> Uint8Array  16 位单声道 PCM 的 WAV（豆包极速版收 wav / mp3 / ogg，不收 m4a）
//   class VoiceError extends Error { code }
//
// 豆包：火山引擎“大模型录音文件识别极速版”，一次发整段录音（base64），同步拿文字。接口地址和资源 ID 在 config.js
// DOUBAO_ASR，没有实测过（等 Wei 给 Key）。浏览器直接调它可能被跨域拦下，那也会自动退回 Poe，她感觉不到。
import { DOUBAO_ASR } from './config.js';
import { blobToDataURL } from './db.js';

export class VoiceError extends Error {
  constructor(message, code = 'error') { super(message); this.name = 'VoiceError'; this.code = code; }
}

export const LISTEN_SYSTEM = '把这段录音逐字转成中文文字。数学式照她说的写成算式，比如“负三的平方”写成 -3²。只输出文字。';
export const MIN_MS = 600;

const MIMES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
export function pickMime(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return '';
  for (const m of MIMES) { try { if (isTypeSupported(m)) return m; } catch (e) { /* 不认识就下一个 */ } }
  return '';
}

export function fileNameFor(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('webm')) return 'q.webm';
  if (t.includes('ogg')) return 'q.ogg';
  if (t.includes('wav')) return 'q.wav';
  if (t.includes('mpeg') || t.includes('mp3')) return 'q.mp3';
  return 'q.m4a';                                     // audio/mp4（iPad）和不知道的
}

export function cleanTranscript(text) {
  let t = String(text ?? '').trim();
  t = t.replace(/^```\w*\s*|\s*```$/g, '').trim();
  t = t.replace(/^(?:转写|转录|文字|识别结果|录音内容)\s*[:：]\s*/, '');
  if (/^[“"\u300c].*[”"\u300d]$/s.test(t)) t = t.slice(1, -1).trim();   // 直角引号写成转义：源码里不出现直角引号
  return t.replace(/\s*\n\s*/g, ' ').trim();
}

// ---------------------------------------------------------------- 录音

export function createRecorder({ maxMs = 60000, onAutoStop = null, env = globalThis } = {}) {
  let st = 'idle';
  let stream = null, rec = null, chunks = [], audio = null, analyser = null, buf = null;
  let t0 = 0, timer = 0, waiting = null;   // waiting: { resolve, reject } of stop()

  function release() {
    clearTimeout(timer);
    if (stream) { for (const t of stream.getTracks()) { try { t.stop(); } catch (e) { /* 已经停了 */ } } }
    if (audio && typeof audio.close === 'function') audio.close().catch(() => {});
    stream = null; analyser = null; audio = null; buf = null;
  }

  async function start() {
    if (st !== 'idle') throw new VoiceError('正在录。', 'busy');
    const md = env.navigator && env.navigator.mediaDevices;
    const MR = env.MediaRecorder;
    if (!md || typeof md.getUserMedia !== 'function' || typeof MR !== 'function') throw new VoiceError('这个浏览器不能录音。', 'unsupported');
    st = 'starting';
    try {
      stream = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) {
      st = 'idle';
      const name = (e && e.name) || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new VoiceError('没有麦克风权限。', 'denied');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new VoiceError('找不到麦克风。', 'nomic');
      throw new VoiceError('打不开麦克风：' + ((e && e.message) || name), 'nomic');
    }
    if (st !== 'starting') { release(); throw new VoiceError('已取消。', 'abort'); }   // 等权限时她点了取消
    const mime = pickMime(MR.isTypeSupported && MR.isTypeSupported.bind(MR));
    try { rec = mime ? new MR(stream, { mimeType: mime }) : new MR(stream); } catch (e) { rec = new MR(stream); }
    chunks = [];
    rec.ondataavailable = ev => { if (ev && ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = () => {
      const type = (rec && rec.mimeType) || mime || (chunks[0] && chunks[0].type) || 'audio/mp4';
      const blob = new env.Blob(chunks, { type: String(type).split(';')[0] });
      const ms = Date.now() - t0;
      const w = waiting;
      waiting = null;
      st = 'idle';
      release();
      if (!w) return;
      if (ms < MIN_MS || !blob.size) w.reject(new VoiceError('太短了，没录上。', 'short'));
      else w.resolve(blob);
    };
    // 音量：给界面画一条小波形，让她知道真的在录
    try {
      const AC = env.AudioContext || env.webkitAudioContext;
      if (AC) {
        audio = new AC();
        const src = audio.createMediaStreamSource(stream);
        analyser = audio.createAnalyser();
        analyser.fftSize = 512;
        buf = new Uint8Array(analyser.fftSize);
        src.connect(analyser);
      }
    } catch (e) { analyser = null; }
    t0 = Date.now();
    rec.start(1000);
    st = 'recording';
    timer = setTimeout(() => {
      if (st !== 'recording') return;
      stop().then(b => onAutoStop && onAutoStop(b), e => onAutoStop && onAutoStop(e));
    }, maxMs);
  }

  function stop() {
    if (st !== 'recording' || !rec) return Promise.reject(new VoiceError('没有在录。', 'idle'));
    st = 'stopping';
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject };
      try { rec.stop(); } catch (e) { waiting = null; st = 'idle'; release(); reject(new VoiceError('没录上。', 'short')); }
    });
  }

  function cancel() {
    const w = waiting;
    waiting = null;
    if (rec && (st === 'recording' || st === 'stopping')) { try { rec.onstop = null; rec.stop(); } catch (e) { /* 已经停了 */ } }
    st = 'idle';
    release();
    if (w) w.reject(new VoiceError('已取消。', 'abort'));
  }

  function level() {
    if (!analyser || !buf || st !== 'recording') return 0;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }

  return { start, stop, cancel, state: () => st, level, elapsed: () => (st === 'recording' ? Date.now() - t0 : 0) };
}

// ---------------------------------------------------------------- 豆包（未验证）

const uuid = () => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
};

export function doubaoRequest({ appId = '', accessKey = '', resourceId = '' } = {}, base64 = '', requestId = uuid()) {
  return {
    url: DOUBAO_ASR.url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-App-Key': String(appId).trim(),
        'X-Api-Access-Key': String(accessKey).trim(),
        'X-Api-Resource-Id': String(resourceId || DOUBAO_ASR.resourceId).trim(),
        'X-Api-Request-Id': requestId,
        'X-Api-Sequence': '-1',
      },
      body: JSON.stringify({
        user: { uid: 'emma-math' },
        audio: { data: base64 },
        request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true },
      }),
    },
  };
}

// 极速版：成功时响应头 X-Api-Status-Code 是 20000000，文字在 result.text；20000003 是静音（她没说话，当成空字）
export function doubaoText(status, headers, body) {
  const get = k => (headers && typeof headers.get === 'function' ? headers.get(k) : headers && headers[k]) || '';
  const code = String(get('X-Api-Status-Code') || get('x-api-status-code') || '');
  const msg = String(get('X-Api-Message') || get('x-api-message') || '');
  if (code === '20000003') return '';
  if (!(status >= 200 && status < 300) || (code && code !== '20000000')) {
    throw new VoiceError(`豆包语音没转成（HTTP ${status}${code ? `，${code}` : ''}${msg ? `，${msg.slice(0, 120)}` : ''}）`, 'doubao');
  }
  const text = body && body.result && typeof body.result.text === 'string' ? body.result.text : null;
  if (text === null) throw new VoiceError('豆包语音的回答里没有文字。', 'doubao');
  return text;
}

// 16 位单声道 PCM WAV
export function encodeWav(samples, sampleRate = 16000) {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const ascii = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

const toBase64 = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

// iPad 录的是 m4a，豆包极速版不收：用浏览器自己解码，重采样成 16k 单声道 WAV
async function toWav16k(blob, env = globalThis) {
  const AC = env.AudioContext || env.webkitAudioContext;
  const OAC = env.OfflineAudioContext || env.webkitOfflineAudioContext;
  if (!AC || !OAC) throw new VoiceError('这个浏览器不能转格式。', 'unsupported');
  const ac = new AC();
  let decoded;
  try {
    const ab = await blob.arrayBuffer();
    decoded = await new Promise((resolve, reject) => {
      const p = ac.decodeAudioData(ab, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  } finally { if (typeof ac.close === 'function') ac.close().catch(() => {}); }
  const rate = 16000;
  const len = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OAC(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  return encodeWav(rendered.getChannelData(0), rate);
}

async function viaDoubao(ctx, blob, cfg, { signal, fetchImpl } = {}) {
  let bytes;
  if (/wav|mpeg|mp3|ogg/i.test(blob.type || '')) bytes = new Uint8Array(await blob.arrayBuffer());
  else bytes = await toWav16k(blob);
  const { url, init } = doubaoRequest(cfg, toBase64(bytes));
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), DOUBAO_ASR.timeoutMs);
  try {
    const res = await (fetchImpl || fetch)(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    return doubaoText(res.status, res.headers, body);
  } catch (e) {
    if (signal && signal.aborted) throw new VoiceError('已取消。', 'abort');
    if (e instanceof VoiceError) throw e;
    throw new VoiceError('连不上豆包语音（可能是网络，或者浏览器不让直接调用）：' + ((e && e.message) || e), 'doubao');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------- 转文字

export async function transcribe(ctx, blob, { signal, fetchImpl } = {}) {
  if (!blob || !blob.size) throw new VoiceError('没有录到声音。', 'short');
  const s = typeof ctx.settings === 'function' ? ctx.settings() || {} : {};
  const mock = !!s.mock || (typeof ctx.mockForced === 'function' && ctx.mockForced());
  const d = s.doubao || {};
  if (!mock && s.asr === 'doubao' && String(d.appId || '').trim() && String(d.accessKey || '').trim()) {
    const t0 = Date.now();
    try {
      const text = cleanTranscript(await viaDoubao(ctx, blob, d, { signal, fetchImpl }));
      note(ctx, { ms: Date.now() - t0, ok: true });
      return text;
    } catch (e) {
      if (e && e.code === 'abort') throw e;
      note(ctx, { ms: Date.now() - t0, ok: false, code: (e && e.code) || 'doubao', message: (e && e.message) || String(e) });
      // 退回 Poe，她感觉不到
    }
  }
  const dataURL = await blobToDataURL(blob);
  const r = await ctx.ai.ask('listen', { system: LISTEN_SYSTEM, text: '请转写。', files: [{ dataURL, filename: fileNameFor(blob.type) }], raw: true, signal });
  return cleanTranscript(r && r.text);
}

function note(ctx, { ms, ok, code = '', message = '' }) {
  try { if (ctx.ai && typeof ctx.ai.noteCall === 'function') ctx.ai.noteCall({ task: 'listen', model: '豆包语音', ms, ok, code, message: ok ? '' : message + '（已改用 Poe 转写）' }); }
  catch (e) { /* 记不上也不影响她 */ }
}
