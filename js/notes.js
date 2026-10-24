// 老师的笔记本接线（CONTRACTS 20）：什么时候写一篇、写好了存在哪、首页和对话读哪一篇。写什么、怎么写在 reflect.js
// （提示词和形状不在这里改）。纯函数在上面，最后的 runReflect(ctx) 读 ctx、找模型写一篇、存进 kv。
//
// 什么时候写：首页每次显示时在后台调 runReflect(ctx)，不挡界面、不告诉她。距上一篇满 7 天（或从没写过）、之后至少有
//   5 件事（作答 + 对话里的【记录】），而且今天还没试过（kv 'reflectTry' 记日期）就写；失败就算了，第二天再试。
//   家长区“现在写一篇”是 runReflect(ctx, { force: true })：不看日子和件数，错了把错误抛给家长区。
// 存哪：kv 'teacherNotes'，按时间排的数组，最新的在最后，最多 NOTE_KEEP 篇。每篇是 reflect.normalizeNote 的形状，另加
//   at（写好的时间）、mock（模拟模式写的）。
// 模拟模式：照样写、照样存，带 mock: true；模拟模式外这些笔记一律不算（不进对话、不出首页小卡、不挡下一篇），免得假的
//   判断混进真的教学。模拟模式也不看、不记 reflectTry（不花钱，写坏了下次再来）。
//
// 导出
//   NOTES_KEY = 'teacherNotes', TRY_KEY = 'reflectTry'
//   notesOf(list, { mock }) -> 能用的笔记（模拟模式外去掉 mock 的）      latestNote(list, { mock }) -> 最新一篇 | null
//   appendNote(list, note, keep = NOTE_KEEP) -> 新数组                  noteSince(note) -> ISO 时间（这篇以后的事才算新的）
//   countEvents(note, { attempts, observations }) -> 这篇以后的作答数 + 对话记录数（没有笔记就是全部）
//   progressName(progress, curriculum) -> '3.1 从算式到方程' | ''         examSentence(exam, curriculum, today) -> 一句话 | ''
//   isMock(ctx) -> bool
//   runReflect(ctx, { force }) -> Promise<{ status: 'written' | 'tried' | 'not-due' | 'offline' | 'budget', note?, events? }>
//     同一时间只跑一篇：正在写时再调，拿到的是同一个 Promise。写出来是空的（一条判断都没有）算失败，不存
// 依赖：reflect.js、profile.js（loadProfile）、notebook.js（dayOf、addDays）。
import { reflectDue, weekDigest, REFLECT_SYSTEM, normalizeNote, NOTE_KEEP } from './reflect.js';
import { loadProfile } from './profile.js';
import { dayOf, addDays } from './notebook.js';

export const NOTES_KEY = 'teacherNotes';
export const TRY_KEY = 'reflectTry';

const str = v => (v === undefined || v === null ? '' : String(v)).trim();
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(str(d));
const isNote = n => n && typeof n === 'object' && isDay(n.day);
// 本地零点换成 ISO（attempts 的 at 是 ISO）
const isoOfDay = day => {
  if (!isDay(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
};

export function notesOf(list, { mock = false } = {}) {
  return (Array.isArray(list) ? list : []).filter(n => isNote(n) && (mock || !n.mock));
}
export function latestNote(list, opts = {}) {
  const all = notesOf(list, opts);
  return all.length ? all[all.length - 1] : null;
}
export function appendNote(list, note, keep = NOTE_KEEP) {
  const all = (Array.isArray(list) ? list : []).filter(isNote);
  if (isNote(note)) all.push(note);
  return all.length > keep ? all.slice(all.length - keep) : all;
}

// 这篇以后发生的事才算新的。老笔记没有 at 就从那天零点算
export function noteSince(note) {
  if (!isNote(note)) return '';
  return str(note.at) || isoOfDay(note.day);
}
const stamp = r => str(r && (r.at || r.day));
export function countEvents(note, { attempts = [], observations = [] } = {}) {
  const since = noteSince(note);
  const fresh = r => r && typeof r === 'object' && (!since || stamp(r) > since);
  return (Array.isArray(attempts) ? attempts : []).filter(fresh).length
    + (Array.isArray(observations) ? observations : []).filter(fresh).length;
}

export function progressName(progress, curriculum = null) {
  const s = str(progress && progress.section);
  if (!s) return '';
  return curriculum && typeof curriculum.title === 'function' ? str(curriculum.title(s)) || s : s;
}

// 考试的一句话：“2026-11-04，还有 10 天，范围：2.3 有理数的乘方、3.1 代数式”（weekDigest 前面加“考试：”）。考完了、没填日期给 ''
export function examSentence(exam, curriculum = null, today = dayOf()) {
  const date = str(exam && exam.date).slice(0, 10);
  if (!isDay(date)) return '';
  const end = isDay(str(exam.end).slice(0, 10)) && str(exam.end).slice(0, 10) > date ? str(exam.end).slice(0, 10) : date;
  if (end < today) return '';
  const utc = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const days = Math.round((utc(date) - utc(today)) / 864e5);
  const when = days > 0 ? `还有 ${days} 天` : days === 0 ? '就是今天' : '正在考';
  const ids = Array.isArray(exam.sections) ? exam.sections.map(str).filter(Boolean) : [];
  const names = ids.slice(0, 5).map(id => (curriculum && typeof curriculum.title === 'function' ? str(curriculum.title(id)) || id : id));
  const range = names.length ? `，范围：${names.join('、')}${ids.length > 5 ? '等' : ''}` : '';
  return `${date}，${when}${range}`;
}

export function isMock(ctx) {
  try { return !!((ctx && typeof ctx.mockForced === 'function' && ctx.mockForced()) || (ctx && typeof ctx.settings === 'function' && ctx.settings().mock)); }
  catch (e) { return false; }
}

// ---------------------------------------------------------------- 写一篇

const peek = (ctx, k, f) => { try { const v = ctx.kv && typeof ctx.kv.peek === 'function' ? ctx.kv.peek(k, f) : f; return v === undefined || v === null ? f : v; } catch (e) { return f; } };
const todayOf = ctx => (typeof ctx.today === 'function' ? ctx.today() : dayOf());
const offline = () => typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
const budgetOut = ctx => { try { return !!(ctx.budget && typeof ctx.budget.canSpend === 'function' && !ctx.budget.canSpend()); } catch (e) { return false; } };

async function readAttempts(ctx, lo) {
  try {
    if (!ctx.store || typeof ctx.store.byIndex !== 'function') return [];
    return (await ctx.store.byIndex('attempts', 'at', lo ? { lo } : undefined)) || [];
  } catch (e) { console.warn('reflect attempts', (e && e.message) || e); return []; }
}
async function readCards(ctx) {
  try { return ctx.store && typeof ctx.store.all === 'function' ? (await ctx.store.all('items')) || [] : []; }
  catch (e) { console.warn('reflect items', (e && e.message) || e); return []; }
}

async function reflectOnce(ctx, { force = false } = {}) {
  const today = todayOf(ctx);
  const mock = isMock(ctx);
  const notes = notesOf(peek(ctx, NOTES_KEY, []), { mock });
  const last = notes.length ? notes[notes.length - 1] : null;
  if (!force) {
    if (!mock && peek(ctx, TRY_KEY, '') === today) return { status: 'tried' };
    if (!reflectDue(notes, { today, events: Infinity })) return { status: 'not-due' };   // 不到 7 天：不用读作答
    if (!mock && offline()) return { status: 'offline' };
    if (!mock && budgetOut(ctx)) return { status: 'budget' };
  }
  // 数件数要上一篇以后的全部作答，写这一周要近 7 天的：取两者早的那个读一次（从没写过就读全部）
  const since = noteSince(last);
  const weekLo = isoOfDay(addDays(today, -7));
  const attempts = await readAttempts(ctx, !last ? '' : since < weekLo ? since : weekLo);
  const observations = peek(ctx, 'observations', []);
  const events = countEvents(last, { attempts, observations });
  if (!force && !reflectDue(notes, { today, events })) return { status: 'not-due', events };
  // 今天试过了：成不成都等明天（家长手动写的不算）
  if (!force && !mock) {
    try { await ctx.kv.set(TRY_KEY, today); } catch (e) { console.warn('reflectTry', e); }
  }

  const [cards, profile] = await Promise.all([readCards(ctx), loadProfile(ctx).catch(() => null)]);
  const curriculum = ctx.curriculum || null;
  const digest = weekDigest({
    cards, attempts, observations, profile,
    progress: progressName(peek(ctx, 'progress', null), curriculum),
    exam: examSentence(peek(ctx, 'exam', null), curriculum, today),
    lastNote: last, today, curriculum,
  });
  const r = await ctx.ai.ask('reflect', { system: REFLECT_SYSTEM, text: digest });
  const note = { ...normalizeNote(r && r.json, { today, model: str(r && r.model) }), at: new Date().toISOString() };
  if (r && r.mock) note.mock = true;
  if (!note.solid.length && !note.gaps.length && !note.focus.length && !note.changed && !note.parent) {
    const e = new Error('老师的笔记是空的：模型没有按格式写出任何判断。');
    e.code = 'incomplete';
    throw e;
  }
  // 存之前重新读一次：写的这半分钟里别处可能动过
  await ctx.kv.set(NOTES_KEY, appendNote(peek(ctx, NOTES_KEY, []), note));
  return { status: 'written', note, events };
}

let running = null;
export function runReflect(ctx, opts = {}) {
  if (running) return running;
  running = reflectOnce(ctx, opts).finally(() => { running = null; });
  return running;
}
