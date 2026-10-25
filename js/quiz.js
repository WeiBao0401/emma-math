// 帮我出套题（v0.8，Wei 10-25）：她在聊天里说想要什么样的题（哪几章、哪方面、多难、综合卷还是计算题），老师先问清楚，
// 确认以后写一行隐藏的【出卷】{要求}；这里按要求出题、核对答案，排成能打印、留了作答空间的卷子。
// 只有她要“练薄弱的地方”时，才把学情档案里的弱点交给出题的模型；标准卷不加。
//
//   quizUser() -> 隐藏的第一句：请老师开口问清楚要求（teacher 的 probeUser 一样的写法）
//   normalizeSpec(raw, curriculum) -> spec { title, sections, focus, difficulty, style, count, minutes, weak, parts, note }
//   specLine(spec, curriculum) -> “第 1、2 章 · 计算题 · 中等 · 20 道 · 约 40 分钟 · 结合薄弱点”
//   quizSystem({ sections }) / quizUserText(spec, { weakText, curriculum }) -> 出题的提示词
//   normalizeQuiz(json, spec) -> { title, parts: [{ name, items: [item] }] }   item 同错题卷：{ no, q, options, answer, answer_kind, form, unit, minutes, solution, section }
//   makeQuiz(ctx, spec, { onStep, signal }) -> Promise<quiz>   出题（TASKS.quiz）+ 逐题核对（pipeline.verify，四道一起）；
//     程序或多数模型确定答案写错了，换成对的；模拟模式出一份固定的小卷子，不核对
//   quizSheetsHTML(quiz) / quizHTML(quiz)   卷子版式（复用错题卷的 SHEET_CSS 和题目排法），分大题，最后一页答案和简要过程
//   QUIZ_CAP = 20：kv 'quizzes' 最多留 20 份（最新的在前）
import { itemHTML, SHEET_CSS, MATH_CSS, dayCn } from './paper.js';
import { renderText } from './mathview.js';
import { dayOf } from './notebook.js';

export const QUIZ_CAP = 20;
export const MAX_ITEMS = 30;
const str = v => (v === undefined || v === null ? '' : String(v)).trim();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KINDS = new Set(['number', 'expr', 'equation', 'set', 'choice', 'compare', 'text']);
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function quizUser() {
  return `（这一句是程序发的，她看不到。）她点了“帮我出套题”，想让你给她出一套题，打印出来做。请你先开口，用两三句话问清楚要求，一次最多问三件事，每件给一个默认建议让她好选：
- 范围：哪几章、哪几节（不知道就按她现在学到的地方建议）
- 侧重和题型：一套综合卷（选择、填空、解答都有），还是专练某一类（比如有理数计算、去括号、解方程、应用题）
- 难度：基础 / 中等 / 提高；多少道、大概做多久
- 要不要结合她的薄弱点（你知道她哪里还不太会，可以提一两个让她选）；她要标准卷就不结合
她说清楚了，或者说“你定吧”，你就用一句话复述要求，最后一行写
【出卷】{"title":"卷子标题","sections":["2.1.1","2.3.1"],"focus":"侧重，一句话","difficulty":"基础|中等|提高","style":"综合卷|专项练习","count":20,"minutes":40,"weak":true或false,"parts":[{"name":"选择题","kind":"choice","count":6},{"name":"计算题","kind":"number","count":8}],"note":"她特别提的要求"}
parts 的 kind 只能是 choice、fill、calc、solve（解答题）。写了【出卷】，正文就说“好，我这就出，大约一分钟”，不要在聊天里出题。`;
}

const PART_KIND = { choice: '选择题', fill: '填空题', calc: '计算题', solve: '解答题' };
export function normalizeSpec(raw, curriculum = null) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const known = id => !curriculum || typeof curriculum.section !== 'function' || !!curriculum.section(id);
  const sections = (Array.isArray(r.sections) ? r.sections : []).map(str).filter(s => /^\d+(\.[\dP]+)*$/.test(s) && known(s)).slice(0, 20);
  let parts = (Array.isArray(r.parts) ? r.parts : []).map(p => ({ kind: PART_KIND[str(p && p.kind)] ? str(p.kind) : 'calc', name: str(p && p.name), count: Math.max(1, Math.min(15, Math.round(+p.count || 0))) }))
    .map(p => ({ ...p, name: p.name || PART_KIND[p.kind] }));
  let count = Math.max(1, Math.min(MAX_ITEMS, Math.round(+r.count || 0) || parts.reduce((a, p) => a + p.count, 0) || 12));
  if (!parts.length) parts = [{ kind: 'calc', name: '计算题', count }];
  const total = parts.reduce((a, p) => a + p.count, 0);
  if (total > MAX_ITEMS) { const k = MAX_ITEMS / total; parts = parts.map(p => ({ ...p, count: Math.max(1, Math.floor(p.count * k)) })); }
  count = parts.reduce((a, p) => a + p.count, 0);
  const difficulty = ['基础', '中等', '提高'].includes(str(r.difficulty)) ? str(r.difficulty) : '中等';
  return {
    title: str(r.title).slice(0, 30) || 'Emma 的练习卷',
    sections, focus: str(r.focus).slice(0, 80), difficulty, style: str(r.style) || (parts.length > 1 ? '综合卷' : '专项练习'),
    count, minutes: Math.max(5, Math.min(120, Math.round(+r.minutes || count * 2))), weak: r.weak === true, parts, note: str(r.note).slice(0, 120),
  };
}

function rangeText(sections, curriculum) {
  if (!sections.length) return '学过的内容';
  const chs = [...new Set(sections.map(s => parseInt(s, 10)).filter(n => n > 0))];
  if (sections.length > 4 && chs.length) return `第 ${chs.join('、')} 章`;
  return sections.map(s => (curriculum && typeof curriculum.title === 'function' ? curriculum.title(s) : s)).join('、');
}
export function specLine(spec, curriculum = null) {
  return [rangeText(spec.sections, curriculum), spec.style, spec.difficulty, `${spec.count} 道`, `约 ${spec.minutes} 分钟`, spec.weak ? '结合薄弱点' : ''].filter(Boolean).join(' · ');
}

export function quizSystem({ sections = [] } = {}) {
  return `你是北京一所初中的资深数学老师，给初一学生出一套练习卷，打印出来在纸上做。教材：2024 版人教版七年级上册。
出题要求：
1. 只考给定范围内、学生已经学过的内容；用课本里的说法。题目准确、条件充分、没有歧义，答案唯一（多解题明确写“求所有可能的值”）。
2. 难度：基础 = 课本例题和练习的难度；中等 = 课后习题和单元测验的难度，有少量两三步的题；提高 = 期中考试压轴前的难度，但不超纲。整套由易到难。
3. 每一题自己完整算两遍，答案一定要对。数字尽量简单，不出要用计算器的题。
4. 题型：choice 选择题给 4 个选项（A. B. C. D.），只有一个对；fill 填空题题干里用“____”表示空，一题一个空；calc 计算 / 化简 / 解方程；solve 解答题（应用题、说理、几何计算）。
5. 结合薄弱点时：大约一半的题对准给出的薄弱点（换数、换形式，考同一个坑），另一半照常覆盖范围；不要在题目里写“易错”之类的字。
6. 不出需要看图才能做的题，几何题用文字把图说清楚。

答案字段的规矩：
- answer 只写最后结果。例：-9、4a+3b、x=-11、3或7、C、<。多个答案用“或”。带单位的只写数（单位写在 unit）。
- answer_kind：number、expr、equation（写成 x=…）、set、choice（字母）、compare、text（说理题）。
- solution：简要过程，2 到 4 步，给她对答案时看。

只输出一个 JSON 对象，不要别的文字：
{"title":"卷子标题","parts":[{"name":"一、选择题","items":[{"q":"题目，数学式用 \\\\( \\\\)","options":["A. …","B. …","C. …","D. …"],"answer":"B","answer_kind":"choice","form":"","unit":"","section":"2.3.1","solution":"…"}]}]}
JSON 字符串里的反斜杠要写两个，例如 "\\\\(-3^2\\\\)"、"\\\\frac{1}{2}"。不写学生的名字。
${sections.length ? '知识点编号：\n' + sections.map(s => `${s.id} ${s.title}`).join('\n') : ''}`;
}

export function quizUserText(spec, { weakText = '', curriculum = null } = {}) {
  const lines = [
    `卷子标题：${spec.title}`,
    `范围：${rangeText(spec.sections, curriculum)}`,
    spec.focus ? `侧重：${spec.focus}` : '',
    `难度：${spec.difficulty}；${spec.style}；一共 ${spec.count} 道，大约 ${spec.minutes} 分钟做完。`,
    '大题和题数：' + spec.parts.map((p, i) => `${CN[i + 1]}、${p.name}（${p.kind}）${p.count} 道`).join('；'),
    spec.note ? `她特别提的：${spec.note}` : '',
    spec.weak && weakText ? `她的薄弱点（老师平时看出来的）：\n${weakText}` : '',
    spec.weak ? '' : '这是一套标准卷，不用针对她个人的弱点。',
  ];
  return lines.filter(Boolean).join('\n');
}

export function normalizeQuiz(json, spec) {
  const j = json && typeof json === 'object' ? json : {};
  let no = 0;
  const parts = (Array.isArray(j.parts) ? j.parts : []).map((p, i) => ({
    name: str(p && p.name) || `${CN[i + 1]}、${(spec.parts[i] && spec.parts[i].name) || '练习'}`,
    items: (Array.isArray(p && p.items) ? p.items : []).map(it => {
      const kind = KINDS.has(str(it && it.answer_kind)) ? str(it.answer_kind) : 'number';
      return { q: str(it && it.q), options: Array.isArray(it && it.options) ? it.options.map(str).filter(Boolean).slice(0, 5) : [],
        answer: str(it && it.answer), answer_kind: kind, form: str(it && it.form), unit: str(it && it.unit), section: str(it && it.section), solution: str(it && it.solution) };
    }).filter(it => it.q),
  })).filter(p => p.items.length);
  for (const p of parts) for (const it of p.items) it.no = ++no;
  // 大题名字没带“一、”就补上
  parts.forEach((p, i) => { if (!/^[一二三四五六七八九十]、/.test(p.name)) p.name = `${CN[i + 1]}、${p.name}`; });
  return { title: str(j.title) || spec.title, parts };
}

// 并行跑，最多 n 个同时
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } }));
}

export async function makeQuiz(ctx, spec, { onStep = () => {}, signal, weakText = '' } = {}) {
  const mock = (() => { try { return !!((ctx.mockForced && ctx.mockForced()) || (ctx.settings && ctx.settings().mock)); } catch (e) { return false; } })();
  const sections = ((ctx.curriculum && ctx.curriculum.sections) || []).filter(s => s.chapter >= 0 && s.chapter <= 6);
  onStep('make');
  let quiz;
  if (mock) {
    await new Promise(r => setTimeout(r, 600));
    quiz = normalizeQuiz(MOCK_QUIZ, spec);
  } else {
    const r = await ctx.ai.ask('quiz', { system: quizSystem({ sections }), text: quizUserText(spec, { weakText, curriculum: ctx.curriculum }), signal });
    quiz = normalizeQuiz(r && r.json, spec);
  }
  if (!quiz.parts.length) { const e = new Error('没出成'); e.code = 'quiz-empty'; throw e; }
  const items = quiz.parts.flatMap(p => p.items);
  // 核对：程序能算就程序算，不能就另一家模型独立做，对不上请第三家；确定写错了换成对的（同讲题）
  if (!mock && ctx.pipeline && typeof ctx.pipeline.verify === 'function') {
    let done = 0;
    onStep('check', 0, items.length);
    await pool(items.filter(it => it.answer_kind !== 'text'), 4, async it => {
      try {
        const v = await ctx.pipeline.verify({ q: it.q + (it.options.length ? '\n' + it.options.join('  ') : ''), answer: it.answer, answer_kind: it.answer_kind, form: it.form, generator: 'claude-sonnet-5.5' }, { signal });
        it.checked = v.status;
        if (v.status === 'conflict' && str(v.other)) { it.fixedFrom = it.answer; it.answer = str(v.other); it.solution = ''; }
      } catch (e) { it.checked = 'soft'; }
      onStep('check', ++done, items.length);
    });
  }
  return { id: 'q' + Date.now().toString(36), made: dayOf(), at: new Date().toISOString(), spec, title: quiz.title, parts: quiz.parts, mock };
}

// ---------------------------------------------------------------- 卷子

export function quizSheetsHTML(quiz) {
  const title = esc(quiz.title || 'Emma 的练习卷');
  const date = esc(dayCn(quiz.made));
  const spec = quiz.spec || {};
  const n = quiz.parts.reduce((a, p) => a + p.items.length, 0);
  const note = `共 ${n} 道，建议 ${spec.minutes || n * 2} 分钟。写清过程，做完再看最后一页的答案。`;
  const body = quiz.parts.map(p => `<h3 class="pp-part">${esc(p.name)}</h3><ol class="pp-items">${p.items.map(itemHTML).join('')}</ol>`).join('');
  const sheet = `<section class="pp-sheet"><header class="pp-head"><span class="pp-head-t">${title}</span><span class="pp-head-m">${date}</span></header>`
    + `<p class="pp-note">${esc(note)}</p><p class="pp-name">姓名：<span class="pp-blank"></span>　用时：<span class="pp-blank pp-blank-s"></span>　得分：<span class="pp-blank pp-blank-s"></span></p>${body}</section>`;
  const keys = quiz.parts.flatMap(p => p.items).map(it => `<li class="pp-k"><span class="pp-no">${it.no}.</span>`
    + `<span class="pp-a">${renderText(it.answer + (it.unit ? ' ' + it.unit : ''))}</span><span class="pp-trap">${renderText(it.solution || '')}</span></li>`).join('');
  const key = `<section class="pp-sheet pp-key"><header class="pp-head"><span class="pp-head-t">答案</span><span class="pp-head-m">${title} · ${date}</span></header>`
    + `<p class="pp-note">做完再看。每题后面是简要过程。</p><ol class="pp-keys">${keys}</ol></section>`;
  return `<div class="pp-doc">${sheet}${key}</div>`;
}

export const QUIZ_CSS = `.pp-part{font:600 13pt/1.5 "PingFang SC","Microsoft YaHei",sans-serif;margin:5mm 0 3mm}
.pp-name{margin:0 0 4mm;font-size:11pt;color:#333}
.pp-blank-s{width:22mm}`;

export function quizHTML(quiz) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${quiz.title} · ${dayCn(quiz.made)}`)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#ECEAE4;padding:24px 12px}
@media print{body{background:#fff;padding:0}}
${MATH_CSS}
${SHEET_CSS}
${QUIZ_CSS}
.pp-key{display:block}
</style>
</head>
<body>
${quizSheetsHTML(quiz)}
</body>
</html>
`;
}
export const quizFileName = quiz => `emma-math-quiz-${str(quiz && quiz.made) || dayOf()}.html`;

// 模拟模式的小卷子（答案都核过）
export const MOCK_QUIZ = {
  title: '有理数的运算 · 练习卷',
  parts: [
    { name: '一、选择题', items: [
      { q: '下列各式中，结果是负数的是（　）', options: ['A. \\(-(-3)\\)', 'B. \\(|-3|\\)', 'C. \\(-3^2\\)', 'D. \\((-3)^2\\)'], answer: 'C', answer_kind: 'choice', section: '2.3.1', solution: '\\(-3^2=-9\\)，其余都是正数。' },
      { q: '\\(-\\frac{1}{2}\\) 的倒数是（　）', options: ['A. 2', 'B. \\(-2\\)', 'C. \\(\\frac{1}{2}\\)', 'D. \\(-\\frac{1}{2}\\)'], answer: 'B', answer_kind: 'choice', section: '2.2.2', solution: '乘积是 1 的两个数互为倒数。' },
    ] },
    { name: '二、填空题', items: [
      { q: '计算：\\(-2-5=\\) ____', answer: '-7', answer_kind: 'number', section: '2.1.2', solution: '减 5 等于加 −5。' },
      { q: '\\((-2)^3=\\) ____', answer: '-8', answer_kind: 'number', section: '2.3.1', solution: '三个 −2 相乘。' },
    ] },
    { name: '三、计算题', items: [
      { q: '计算：\\(-3^2+(-2)^2\\)', answer: '-5', answer_kind: 'number', section: '2.3.1', solution: '\\(-9+4=-5\\)' },
      { q: '计算：\\(12\\div(-3)\\times2\\)', answer: '-8', answer_kind: 'number', section: '2.2.2', solution: '从左往右：\\(-4\\times2=-8\\)' },
      { q: '计算：\\(\\left(\\frac{1}{2}-\\frac{2}{3}\\right)\\times(-6)\\)', answer: '1', answer_kind: 'number', section: '2.2.1', solution: '\\(\\frac{1}{2}\\times(-6)-\\frac{2}{3}\\times(-6)=-3+4=1\\)' },
    ] },
  ],
};
