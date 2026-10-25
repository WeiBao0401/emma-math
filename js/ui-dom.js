// 界面共用的 DOM 小工具（照英语老师 App 的 ui-dom.js 改）。
// 负责：外壳。界面 agent 要加图标或工具函数，写进 needs。
//
// 导出
//   $(sel, root), $$(sel, root)
//   h(tag, props, ...children)          建元素；数据一律当文字放（textContent），不拼 HTML
//   icon(name, className) -> <svg>      24 格、1.75 线宽的图标，名字见 ICONS
//   mathText(text, { tag, className })  -> 元素：题目、讲解里的公式用 mathview.js 画（它负责转义，模型的字不会变成标签）
//   toast(msg, ms = 2000)               底部一句提示（#toast）
//   skBars(widths)                      安静的骨架条，等 AI 时用
//   ago(iso), dateCn(iso, now), ymd(iso), md(iso), localYmd(d), fmtBytes(n), fmtSecs(ms)
//   prefersReducedMotion()
//
// 模块顶层不碰 document，node 里能 import（测试要用）。
import { renderText } from './mathview.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('button', { className: 'x', on: { click }, dataset: {...}, 'aria-label': '...' }, 'text', child, [more])
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'className') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') el.style.cssText = v;   // CSSOM，不受 CSP 的内联样式限制
      else if (k in el && typeof v !== 'string') el[k] = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'open') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === '') continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// 带公式的一段字。mathview.renderText 先转义再画，所以这里是全 App 唯一可以用 innerHTML 放模型文字的地方。
export function mathText(text, { tag = 'span', className = '' } = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.innerHTML = renderText(String(text ?? ''));
  return el;
}

// 图标：24 格，一种 1.75 的圆头线，粗细和大小由 .icon 的 CSS 管。和英语老师 App 同一套画法。
const svg = paths => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
export const ICONS = {
  camera: svg('<path d="M4 8.6A1.6 1.6 0 0 1 5.6 7h2.2l1.6-2.2h5.2L16.2 7h2.2A1.6 1.6 0 0 1 20 8.6v8.8a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 17.4z"/><circle cx="12" cy="12.6" r="3.4"/>'),
  photo: svg('<rect x="4" y="5" width="16" height="14" rx="1.75"/><circle cx="9" cy="10" r="1.5"/><path d="m4.6 17.2 4.6-4.6 3.3 3.3 2.4-2.4 4.5 4.5"/>'),
  crop: svg('<path d="M7 3.5V17h13.5"/><path d="M3.5 7H17v13.5"/>'),
  rotate: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5V9H9"/>'),
  book: svg('<path d="M6 5.5A1.5 1.5 0 0 1 7.5 4H18v13H7.5A1.5 1.5 0 0 0 6 18.5z"/><path d="M6 18.5A1.5 1.5 0 0 0 7.5 20H18"/><path d="M10 4v6l1.75-1.3L13.5 10V4"/>'),
  note: svg('<path d="M7.25 3.75h9.5a1.75 1.75 0 0 1 1.75 1.75v13a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 5.5 18.5v-13a1.75 1.75 0 0 1 1.75-1.75z"/><path d="M9 8.75h6M9 12.25h6M9 15.75h3.5"/>'),
  pen: svg('<path d="M13.6 5.4l5 5L11 18H7v-4z"/><path d="M11 8l5 5"/><path d="M4 21h9"/>'),
  bulb: svg('<path d="M9.5 17.5h5"/><path d="M10.5 20.5h3"/><path d="M12 3.5a5.5 5.5 0 0 0-3.3 9.9c.8.6 1.3 1.5 1.3 2.5v.1h4v-.1c0-1 .5-1.9 1.3-2.5A5.5 5.5 0 0 0 12 3.5z"/>'),
  ask: svg('<circle cx="12" cy="12" r="8.25"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.5v.3"/><path d="M12 16.4h.01"/>'),
  print: svg('<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 13.5h10V20H7z"/>'),
  check: svg('<path d="M5.5 12.5 10 17l8.5-9.5"/>'),
  close: svg('<path d="M7 7 17 17"/><path d="M17 7 7 17"/>'),
  back: svg('<path d="M14.5 5 7.5 12l7 7"/>'),
  chev: svg('<path d="m9.5 6 6 6-6 6"/>'),
  plus: svg('<path d="M12 5.5v13"/><path d="M5.5 12h13"/>'),
  minus: svg('<path d="M5.5 12h13"/>'),
  arrow: svg('<path d="M4.5 12h14.5"/><path d="M13.5 6.5 19 12l-5.5 5.5"/>'),
  refresh: svg('<path d="M19.5 11a7.5 7.5 0 1 0-2.2 5.4"/><path d="M19.5 4.5V11H13"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 2"/>'),
  alert: svg('<path d="M12 4.2 20.5 19H3.5z"/><path d="M12 10v4"/><path d="M12 16.6h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="8.25"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
  offline: svg('<path d="M3.5 9.4a12 12 0 0 1 17 0"/><path d="M6.7 12.6a7.6 7.6 0 0 1 10.6 0"/><path d="M9.8 15.8a3.1 3.1 0 0 1 4.4 0"/><path d="M12 19.2h.01"/><path d="M4.2 4.2 19.8 19.8"/>'),
  lock: svg('<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  eye: svg('<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.9"/>'),
  eyeOff: svg('<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.9"/><path d="M4.5 4.5 19.5 19.5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/>'),
  // v0.3 问我：说话、发送、停、对话
  mic: svg('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v2.5"/>'),
  keyboard: svg('<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10h.01M10.3 10h.01M13.7 10h.01M17 10h.01M8 14h8"/>'),
  send: svg('<path d="M12 19.5V5"/><path d="M6 10.5 12 4.5l6 6"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/>'),
  chat: svg('<path d="M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3.5V16.5h0a2 2 0 0 1-2-2z"/><path d="M8.5 9h7M8.5 12h4.5"/>'),
};

// v0.7 老师的头像（Wei 10-25：“聊一聊加一个老师的图标，像人和人在聊”）：圆脸、短发、眼镜，固定图形，颜色跟主题走
const AVATAR = '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">'
  + '<circle cx="20" cy="20" r="20" class="av-bg"/>'
  + '<path d="M7 37.5c1.8-6.8 7-10 13-10s11.2 3.2 13 10A20 20 0 0 1 7 37.5z" class="av-shirt"/>'
  + '<circle cx="20" cy="17.5" r="8.2" class="av-face"/>'
  + '<path d="M11.6 17.2c-.4-6.2 3.4-9.7 8.4-9.7s8.9 3.3 8.4 9.7c-1.3-2.9-3.7-4.6-6.4-4.9-1.4 1.6-4.6 2.6-8 2.4-.9.6-1.8 1.4-2.4 2.5z" class="av-hair"/>'
  + '<circle cx="16.8" cy="18.4" r="2.5" class="av-glass"/><circle cx="23.2" cy="18.4" r="2.5" class="av-glass"/><path d="M19.3 18.2h1.4" class="av-glass"/>'
  + '<path d="M17.6 22.3q2.4 1.7 4.8 0" class="av-smile"/></svg>';
export function teacherAvatar(className = '') {
  const el = document.createElement('span');
  el.className = 't-avatar' + (className ? ' ' + className : '');
  el.innerHTML = AVATAR;   // 固定图形
  return el;
}

// -> <svg class="icon extra">；className 加在 "icon" 后面
export function icon(name, className = '') {
  const tmp = document.createElement('span');
  tmp.innerHTML = ICONS[name] || svg('');   // 只放上面的固定图形
  const el = tmp.firstElementChild;
  if (className) el.setAttribute('class', 'icon ' + className);
  return el;
}

// ---------------------------------------------------------------- 日期和数字

export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const m = (now - new Date(iso)) / 6e4;
  if (!(m >= 0)) return dateCn(iso);
  if (m < 1) return '刚刚';
  if (m < 60) return Math.floor(m) + ' 分钟前';
  if (m < 1440) return Math.floor(m / 60) + ' 小时前';
  if (m < 2880) return '昨天';
  if (m < 7 * 1440) return Math.floor(m / 1440) + ' 天前';
  return dateCn(iso);
}
export const ymd = iso => String(iso || '').slice(0, 10);
export const md = iso => String(iso || '').slice(5, 10);
// “10 月 14 日”；不是今年的前面加年份
export function dateCn(iso, now = new Date()) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const day = `${+m[2]} 月 ${+m[3]} 日`;
  return +m[1] === new Date(now).getFullYear() ? day : `${m[1]} 年 ${day}`;
}
// 本地时区的 YYYY-MM-DD（“今天”按 iPad 上的日期算，不按 UTC）
export function localYmd(d) {
  const x = new Date(d);
  if (isNaN(x)) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function fmtBytes(n) {
  if (!(n >= 0)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}
// 等待和耗时：“0.8 秒”“13 秒”
export function fmtSecs(ms) {
  if (!(ms >= 0)) return '';
  const s = ms / 1000;
  return (s < 10 ? (Math.round(s * 10) / 10) : Math.round(s)) + ' 秒';
}

// ---------------------------------------------------------------- toast

let toastTimer = 0;
export function toast(msg, ms = 2000) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// 安静的骨架条，宽度是百分比
export const skBars = (widths = [92, 74, 84]) => h('div', { className: 'sk-bars', 'aria-hidden': 'true' }, widths.map(w => h('i', { style: `width:${w}%` })));

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
