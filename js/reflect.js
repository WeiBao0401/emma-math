// 老师的笔记本：每周一次，最强的模型像资深老师那样回顾她这一周，写下哪些稳了、哪些还没懂（以及她可能是怎么想的）、
// 下周打算怎么教。这份判断带进以后每次对话（teacher.js 的 profileText），首页主动找她聊时优先用它挑话题。
// 程序记账，模型每周想一次；她的一举一动都来自 store，不靠模型记忆。
//
//   reflectDue(notes, { today, events }) -> bool      距上一篇满 7 天（或从没写过），且之后至少有 5 件事（作答、聊天记录）
//   weekDigest({ cards, attempts, observations, profile, progress, exam, lastNote, today, curriculum }) -> string
//                                                      给模型看的这一周（4000 字以内），她的名字不进去
//   REFLECT_SYSTEM                                     系统提示
//   normalizeNote(raw, { today }) -> note              { day, solid: [{point, evidence}], gaps: [{tag, point, why, evidence, plan}],
//                                                        focus: [{tag, point, opener}], changed, parent }
//   noteForTeacher(note) -> string                     给 teacherSystem 的一段（400 字以内）：上周的判断和这周的打算
//   focusPoint(note, { today, probeDay }) -> { tag, name, evidence, opener } | null   首页小卡用
//   NOTE_KEEP                                          kv 'teacherNotes' 最多留几篇
import { plain } from './mathview.js';
import { dayOf, addDays } from './notebook.js';

export const REFLECT_EVERY_DAYS = 7, REFLECT_MIN_EVENTS = 5, NOTE_KEEP = 26, DIGEST_MAX = 4000, TEACHER_MAX = 400;

const str = v => (v === undefined || v === null ? '' : String(v)).trim();
const md = d => str(d).slice(5, 10);
const short = (s, n) => { const t = plain(str(s)).replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const dayOfAt = at => (str(at).length >= 10 ? str(at).slice(0, 10) : '');

export function reflectDue(notes = [], { today = dayOf(), events = 0 } = {}) {
  const last = notes.length ? notes[notes.length - 1] : null;
  if (last && last.day && addDays(last.day, REFLECT_EVERY_DAYS) > today) return false;
  return events >= REFLECT_MIN_EVENTS;
}

const KIND = { redo: '复习原题', variant: '复习', twin: '同构题', 'self-fix': '自己改', chat: '聊天练习', paper: '错题卷' };

export function weekDigest({ cards = [], attempts = [], observations = [], profile = null, progress = '', exam = '', lastNote = null, today = dayOf(), curriculum = null } = {}) {
  const since = addDays(today, -7);
  const name = c => (curriculum && c.tag && curriculum.error && curriculum.error(c.tag) ? short(curriculum.error(c.tag).wrong, 24) : '') || short(c.mySentence || (c.diagnosis && c.diagnosis.remember) || c.type || '', 24);
  const lines = [];
  lines.push(`今天：${today}。现在学到：${progress || '不确定'}。${exam ? `考试：${exam}。` : ''}`);
  const live = cards.filter(c => c.status !== 'ask');
  if (live.length) {
    lines.push('\n错题本里的坑：');
    for (const c of live.slice(0, 20)) {
      const last = (c.reviews || []).slice(-3).map(r => `${md(r.day)}${r.passed ? '对' : r.held ? '只做了原题' : '错'}`).join('，');
      const st = c.status === 'beaten' ? '已攻克' : c.light ? '自己改对的轻卡' : `第 ${c.stage} 档`;
      lines.push(`- ${name(c) || c.tag || '未命名'}（${c.tag || '无标签'}，${st}，${md(c.day)} 进本，原题“${short(c.problem && c.problem.stem, 30)}”她写 ${short(c.problem && c.problem.her_answer, 12) || '—'}${c.mySentence ? `，她说自己错在：${short(c.mySentence, 30)}` : ''}${last ? `；最近复习：${last}` : ''}${(c.originals || []).length ? `；同一个坑后来又错了 ${(c.originals || []).length} 次` : ''}${c.confused ? '；讲完说还是不太懂' : ''}）`);
    }
  }
  const week = attempts.filter(a => dayOfAt(a.at) >= since);
  if (week.length) {
    lines.push('\n这一周的作答（时间顺序）：');
    for (const a of week.slice(-40)) {
      lines.push(`- ${md(dayOfAt(a.at))} ${KIND[a.kind] || '练习'}：${short(a.q, 30)} 她答 ${short(a.given, 14) || '—'}，${a.ok ? '对' : '错'}${a.hints ? `，用了 ${a.hints} 级提示` : ''}${a.firstTry === false ? '，不是第一次就对' : ''}${a.trap ? '，正好掉进那个坑' : ''}`);
    }
  }
  const obs = observations.filter(o => (o.day || dayOfAt(o.at)) >= since);
  if (obs.length) {
    lines.push('\n聊天里老师看到的：');
    for (const o of obs.slice(-20)) lines.push(`- ${md(o.day || dayOfAt(o.at))} ${o.kind === 'gap' ? '没懂' : '懂了'}：${short(o.point, 24)}，${short(o.note, 50)}`);
  }
  if (profile && profile.text) lines.push(`\n程序算的学情摘要：\n${short(profile.text, 600)}`);
  if (lastNote) {
    lines.push(`\n上一篇笔记（${lastNote.day}）的判断和计划：`);
    for (const g of (lastNote.gaps || []).slice(0, 3)) lines.push(`- 没懂：${short(g.point, 24)}；当时猜：${short(g.why, 40)}；计划：${short(g.plan, 50)}`);
    for (const s of (lastNote.solid || []).slice(0, 3)) lines.push(`- 稳了：${short(s.point, 24)}`);
  }
  let text = lines.join('\n');
  if (text.length > DIGEST_MAX) text = text.slice(0, DIGEST_MAX - 1) + '…';
  return text;
}

export const REFLECT_SYSTEM = `你是一位很资深、很会带学生的初中数学老师，是一位初一女生的私人老师（2024 版人教版七年级上册）。每周你回顾一次她这一周，像写给自己看的教学笔记。

要做的：
1. 哪些已经稳了：有证据（隔了几天还一次做对、自己找出了错）才算。
2. 哪些还没懂：每个点写清证据，再写你的判断：她“可能是怎么想的”（具体的错误想法，不是“粗心”“不认真”）。证据不够就说“还看不准”，别硬下结论。
3. 下周怎么教：每个没懂的点，写一个具体打算（换哪种讲法：具体的数、数轴、画图、代回去检验、对比两种写法；先问她什么问题）。
4. 下周主动找她聊的 1 到 2 个点：每个写一句开场要问她的话（像聊天，只问不讲，让她说出她的想法）。
5. 和上一篇比，变化是什么（进步、反复、新问题），一两句。
6. 给家长的三句话：这周的进步（具体）、需要留意的、家里可以怎么聊（不比分数、不检查作业）。

规矩：只根据给你的记录说话，不编；不评价她这个人，只说她的做法；不出现“粗心”“聪明”“笨”。错因标签 tag 用记录里的 id，没有就写空。
写法：中文引号用弯引号“ ”，不用「」；句子短。evidence、why 各 60 字以内，plan 80 字以内，opener 40 字以内，parent 120 字以内。

只输出一个 JSON 对象：
{"solid":[{"point":"","evidence":""}],"gaps":[{"tag":"","point":"","why":"","evidence":"","plan":""}],"focus":[{"tag":"","point":"","opener":""}],"changed":"","parent":""}`;

const arr = (v, f, n) => (Array.isArray(v) ? v.map(f).filter(Boolean).slice(0, n) : []);

export function normalizeNote(raw, { today = dayOf(), model = '' } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    day: today, model,
    solid: arr(r.solid, x => (str(x && x.point) ? { point: str(x.point), evidence: str(x.evidence) } : null), 5),
    gaps: arr(r.gaps, x => (str(x && x.point) ? { tag: str(x.tag), point: str(x.point), why: str(x.why), evidence: str(x.evidence), plan: str(x.plan) } : null), 5),
    focus: arr(r.focus, x => (str(x && x.point) ? { tag: str(x.tag), point: str(x.point), opener: str(x.opener) } : null), 2),
    changed: str(r.changed), parent: str(r.parent),
  };
}

export function noteForTeacher(note) {
  if (!note) return '';
  const parts = [];
  const gaps = (note.gaps || []).slice(0, 3).map(g => `${g.point}（我的猜测：${g.why || '还看不准'}；打算：${g.plan || '先问她怎么想'}）`);
  if (gaps.length) parts.push(`我上次（${note.day}）的判断：${gaps.join('；')}`);
  const solid = (note.solid || []).slice(0, 3).map(s => s.point);
  if (solid.length) parts.push(`已经稳了：${solid.join('、')}`);
  let t = parts.join('。');
  if (t.length > TEACHER_MAX) t = t.slice(0, TEACHER_MAX - 1) + '…';
  return t;
}

export function focusPoint(note, { today = dayOf(), probeDay = '' } = {}) {
  if (!note || probeDay === today) return null;
  if (note.day && addDays(note.day, 10) < today) return null;          // 太旧的计划不用了
  const f = (note.focus || [])[0];
  if (!f) return null;
  const gap = (note.gaps || []).find(g => (f.tag && g.tag === f.tag) || g.point === f.point);
  return { tag: f.tag, name: f.point, opener: f.opener, evidence: gap && gap.evidence ? [gap.evidence] : [] };
}
