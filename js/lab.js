// 小实验（v0.11）：请模型现写一页能动手的网页，让她拖一拖、点一点，自己看出道理（Wei 11-02：“直接出那种 HTML 的，
// 让她能互动”）。visual.js 的六种图画不了的（比如乘方是几个相同的数相乘、去括号像分糖），都走这里。
// 页面放进沙盒 iframe（lab.html：不同源、不能联网、读不到 App 的数据），只认它发回来的高度。
//
// 导出
//   LAB_SYSTEM                                   请模型写页面的规矩
//   labUser({ problem, diagnosis, goal, idea, talk }) -> string   这次要她看懂什么（讲题时带题和诊断，聊天时带老师的打算和最近几句）
//   cleanLab(text) -> string                     模型原文 → 能放进沙盒的完整页面；不像网页给 ''
//   mountLab(html, { title }) -> HTMLElement     放进页面（只在浏览器里调）
import { plain } from './mathview.js';

const str = v => (v === null || v === undefined ? '' : String(v)).trim();

export const LAB_SYSTEM = `你是一位很会用“动手实验”讲数学的初中老师，也会写网页。学生是 12 岁的初一女生，用 2024 版人教版七年级上册。
她看到不懂的东西容易想放弃，所以这一页的唯一目标：让她通过自己动手（拖、点、滑），亲眼看出这一个道理，然后觉得“原来是这样”。

请写一个完整的单页 HTML（一个文件），要求：
内容
- 只讲一个点。开头一行标题，一两句话告诉她“动一动下面的东西，看看会发生什么”。
- 主体是一个能动手的东西：拖动的点或滑块、一步一步点的按钮、可以摆放的小块、会变化的图（用 SVG 画）。她每动一下，旁边马上用大白话说出她看到了什么、为什么。
- 用具体的数，从她题目里的数开始；能用数轴、线段图、天平、面积、分组、实物比喻的就画出来。
- 最后一个“考考你”：一道二选一或三选一的小题（就考这个点），点了马上说对不对和为什么。
- 中文，句子短，不说“粗心”“很简单”。不用超出七年级上册的方法。
数学必须对
- 所有数都在 JavaScript 里算出来再显示，不要手写结果。负号用 “−”，乘号用 “×”，平方用 “²”。不能用 LaTeX（没有公式库）；分数用上下排的 HTML（比如一个 inline-flex 竖排、中间一条横线）。
- 写完自己检查一遍：每个显示出来的数、每句结论都对。
技术
- 只用内联的 <style> 和 <script>，不引用任何外部文件、字体、图片、库，不联网。不用 alert、prompt、localStorage、cookie。
- 在 iPad 上用手指操作：用 pointer 事件，按钮和拖的东西至少 44px，拖的元素加 touch-action:none。宽度 320 到 720px 都好看，不出现横向滚动条，高度尽量在 650px 以内。
- 配色：底色 #FBF8F1，字 #1E2633，主色 #2F6B5A，重点用黄底 #F3D978，提醒用 #B4472F；字体 -apple-system, "PingFang SC", sans-serif，正文 17px 以上。
- 代码不超过 250 行，不要注释。
只输出 HTML，从 <!doctype html> 开始，到 </html> 结束，前后不要任何文字和 \`\`\` 围栏。`;

export function labUser({ problem = null, diagnosis = null, goal = '', idea = '', talk = '' } = {}) {
  const p = problem || {}, d = diagnosis || {};
  return [
    goal ? `要她看懂的点：${goal}` : '',
    idea ? `老师想的玩法（可以改得更好）：${idea}` : '',
    p.stem ? `她的题目：${plain(p.stem)}` : '',
    p.options && p.options.length ? `选项：${p.options.map(plain).join('；')}` : '',
    p.her_answer && p.useWork !== false ? `她当时的答案：${plain(p.her_answer)}` : '',
    d.answer ? `正确答案：${plain(d.answer)}` : '',
    d.wrong_step ? `她错在这一步：${plain(d.wrong_step)}` : '',
    d.why ? `她可能是这样想的：${plain(d.why)}` : '',
    d.remember ? `要记住的一句：${plain(d.remember)}` : '',
    talk ? `你们刚才聊到：\n${talk}` : '',
    !goal && d.wrong_step ? '请做一个小实验，让她亲眼看出那一步为什么不对、对的应该怎样。' : '',
  ].filter(Boolean).join('\n');
}

// 量高度：页面变高变矮时告诉外面（外面只认 lab-h）
const SIZE = `<script>(function(){function s(){parent.postMessage({kind:'lab-h',h:Math.ceil(document.documentElement.scrollHeight)},'*')}`
  + `try{new ResizeObserver(s).observe(document.documentElement)}catch(e){}addEventListener('load',s);setTimeout(s,60);setTimeout(s,600)})();</script>`;

export function cleanLab(text) {
  let s = String(text ?? '').replace(/^﻿/, '');
  s = s.replace(/^[\s\S]*?```(?:html)?\s*\n/i, m => (/<html|<!doctype/i.test(m) ? m : '')).replace(/\n```[\s\S]*$/, '');
  const a = s.search(/<!doctype html|<html[\s>]/i);
  if (a < 0) return '';
  s = s.slice(a);
  const z = s.toLowerCase().lastIndexOf('</html>');
  s = z >= 0 ? s.slice(0, z + 7) : s + '\n</html>';
  if (!/<script[\s>]|<svg[\s>]|<button[\s>]|<input[\s>]/i.test(s)) return '';   // 一点能动的都没有，不算小实验
  // 外部的东西一律去掉（沙盒里也连不上，留着只会卡住加载）
  s = s.replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/@import[^;]+;/gi, '');
  if (!/<meta[^>]+viewport/i.test(s)) s = s.replace(/<head[^>]*>/i, m => m + '<meta name="viewport" content="width=device-width,initial-scale=1">');
  s = /<\/body>/i.test(s) ? s.replace(/<\/body>/i, SIZE + '</body>') : s.replace(/<\/html>\s*$/i, SIZE + '</html>');
  return s;
}

// ---------------------------------------------------------------- 浏览器里

export function mountLab(html, { title = '小实验' } = {}) {
  const box = document.createElement('div');
  box.className = 'lab';
  const frame = document.createElement('iframe');
  frame.className = 'lab-frame';
  frame.title = title;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('loading', 'eager');
  frame.src = 'lab.html';
  const bar = document.createElement('div');
  bar.className = 'lab-bar';
  bar.textContent = '动手试试：拖一拖、点一点';
  box.append(frame, bar);
  // iframe 在页面里挪动一次就会重新加载，所以每次 lab-ready 都把页面再发一遍
  const onMsg = e => {
    if (!box.isConnected && e.source !== frame.contentWindow) { removeEventListener('message', onMsg); return; }
    if (e.source !== frame.contentWindow || !e.data) return;
    if (e.data.kind === 'lab-ready') frame.contentWindow.postMessage({ kind: 'lab', html }, '*');
    if (e.data.kind === 'lab-h' && Number(e.data.h) > 0) frame.style.height = Math.min(1400, Math.max(240, Number(e.data.h) + 4)) + 'px';
  };
  addEventListener('message', onMsg);
  return box;
}
