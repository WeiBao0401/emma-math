// 课本地图（v0.7，Wei 10-25：“结合课本和进度：课本掌握了多少，有什么需要构建的；比如拍课本上的目录”）。
// 一节一行，按她的进度和错题本看这一节现在怎么样；拍目录让我认出是哪本书、有哪些章节（七上内置，换成七下就靠拍目录）。
// 纯函数加一次识图，不碰界面。
//
//   textbookMap({ curriculum, cards, progress, toc, today }) -> {
//     book, chapters: [{ n, title, sections: [Sec] }], progress: Sec | null, guessed, counts: { learned, ok, weak, unseen, ahead } }
//     Sec = { id, title, state: 'ok' | 'weak' | 'unseen' | 'ahead', open, beaten, total }
//       weak    这一节有还在练、还没弄清的错题（open 道）
//       ok      这一节的错题都攻克了、或者都是自己改对的
//       unseen  学过了（在进度之前），可我还没见过她做这一节的题：要摸摸底
//       ahead   还没学到
//     进度：kv 'progress'.section（家长区、课本地图里点“学到这里”、聊天里她说的）；没有就用错题里最靠后的一节（guessed）
//   sectionWord(sec) -> 这一节一句话状态（“还在练 2 道”“掌握了”“还没一起做过题”“还没学”）
//   teacherLine(map, { max }) -> 给老师的几行（teacher.js 的“现在学到”后面接上），没有进度时 ''
//   buildPoint(map, { skip }) -> 摸底的点 { name, kind: 'build', section, opener, evidence: [] } | null   离进度最近的 unseen
//   progressPoint() -> 问她“课上学到哪了”的点（kind: 'progress'）
//   readToc(ctx, dataURL, { signal }) -> Promise<toc>   拍目录：识图（recognize 任务的模型），模拟模式直接回七上
//   tocFromJSON(json, curriculum) -> toc  { book, at, chapters: [{ n, title, sections: [{ id, title }]}], matched }
//     matched：和内置七上对得上的节数；对得上一半以上就当是内置那本（用内置的 id，错题本的 section 才接得上）
//   TOC_SYSTEM
import { dayOf } from './notebook.js';

const str = v => (v === undefined || v === null ? '' : String(v));
const BUILTIN_BOOK = '人教版七年级上册（2024）';

// '2.3.1' < '2.10' 按数字比；'2.P' 排在这一章最后
const parts = id => str(id).split('.').map(x => (x === 'P' ? 99 : parseInt(x, 10) || 0));
export function cmpId(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? -1) - (y[i] ?? -1); if (d) return d; }
  return 0;
}

function chaptersFrom(curriculum, toc) {
  if (toc && Array.isArray(toc.chapters) && toc.chapters.length && !toc.builtin) {
    return toc.chapters.map(c => ({ n: c.n, title: str(c.title), sections: (c.sections || []).map(s => ({ id: str(s.id), title: str(s.title) })) }));
  }
  const out = new Map();
  for (const s of (curriculum && curriculum.sections) || []) {
    if (!(s.chapter >= 1 && s.chapter <= 6)) continue;   // 内置七上，小学衔接不上地图
    if (!out.has(s.chapter)) out.set(s.chapter, { n: s.chapter, title: s.chapterTitle || '', sections: [] });
    out.get(s.chapter).sections.push({ id: s.id, title: s.title });
  }
  return [...out.values()].sort((a, b) => a.n - b.n);
}

// 错题落在哪一节：卡上的 section 可能写到小节（2.3.1）也可能只写到节（2.3）
function owner(secIds, raw) {
  const id = str(raw).trim();
  if (!id) return '';
  if (secIds.has(id)) return id;
  const pre = [...secIds].filter(s => s.startsWith(id + '.') || id.startsWith(s + '.'));
  return pre.sort(cmpId)[0] || '';
}

export function textbookMap({ curriculum = null, cards = [], progress = null, toc = null, today = dayOf() } = {}) {
  const chapters = chaptersFrom(curriculum, toc);
  const all = chapters.flatMap(c => c.sections);
  const ids = new Set(all.map(s => s.id));
  const by = new Map(all.map(s => [s.id, { open: 0, beaten: 0, total: 0 }]));
  let latest = '';
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c) continue;
    const id = owner(ids, c.section || (c.diagnosis && c.diagnosis.section));
    if (!id) continue;
    const b = by.get(id);
    b.total++;
    if (c.status === 'beaten' || (c.light && c.status !== 'ask')) b.beaten++;   // 攻克的、自己改对的
    else b.open++;
    if (!latest || cmpId(id, latest) > 0) latest = id;
  }
  const set = owner(ids, progress && progress.section);
  const guessed = !set && !!latest;
  const at = set || latest;
  const counts = { learned: 0, ok: 0, weak: 0, unseen: 0, ahead: 0 };
  let prog = null;
  for (const ch of chapters) {
    ch.sections = ch.sections.map(s => {
      const b = by.get(s.id);
      const learned = at ? cmpId(s.id, at) <= 0 : b.total > 0;
      const state = b.open ? 'weak' : b.total ? 'ok' : learned ? 'unseen' : 'ahead';
      const sec = { ...s, state, open: b.open, beaten: b.beaten, total: b.total };
      if (state !== 'ahead') counts.learned++;
      counts[state]++;
      if (s.id === at) prog = sec;
      return sec;
    });
  }
  const book = toc && toc.book ? toc.book : BUILTIN_BOOK;
  return { book, chapters, progress: prog, guessed, counts, today };
}

export function sectionWord(sec) {
  if (!sec) return '';
  if (sec.state === 'weak') return `还在练 ${sec.open} 道`;
  if (sec.state === 'ok') return '掌握了';
  if (sec.state === 'unseen') return '还没一起做过题';
  return '还没学';
}

const name = s => `${s.id} ${s.title}`;
export function teacherLine(map, { max = 6 } = {}) {
  if (!map || !map.progress) return '';
  const list = map.chapters.flatMap(c => c.sections);
  const pick = st => list.filter(s => s.state === st).map(name);
  const cut = arr => (arr.length > max ? arr.slice(0, max).join('、') + ` 等 ${arr.length} 节` : arr.join('、'));
  const weak = pick('weak'), ok = pick('ok'), unseen = pick('unseen');
  return [
    `课本：${map.book}，${map.guessed ? '从错题看大约' : ''}学到 ${name(map.progress)}。`,
    weak.length ? `还在错的节：${cut(weak)}。` : '',
    ok.length ? `错过但已经弄懂的节：${cut(ok)}。` : '',
    unseen.length ? `学过但还没见过她做这几节的题（可以出一两道小题摸摸底）：${cut(unseen.slice(-max))}。` : '',
  ].filter(Boolean).join('\n');
}

// 摸底：学过但还没见过题的节，离进度最近的先来（刚学的最该巩固）；skip 是今天已经摸过的节
export function buildPoint(map, { skip = [] } = {}) {
  if (!map) return null;
  const list = map.chapters.flatMap(c => c.sections).filter(s => s.state === 'unseen' && !skip.includes(s.id));
  const s = list.sort((a, b) => cmpId(b.id, a.id))[0];
  if (!s) return null;
  return { name: `${s.id} ${s.title}`, kind: 'build', section: s.id, evidence: [],
    opener: `这一节（${s.title}）你们学过了，我们还没一起做过这一节的题。轻松地出一两道小题，看看她掌握得怎么样，不像考试` };
}
export function progressPoint() {
  return { name: '课上学到哪了', kind: 'progress', evidence: [],
    opener: '问问她这几天数学课学到哪一节了、有没有哪里听得不太懂。她说了学到哪，就按约定写【进度】' };
}

// ---------------------------------------------------------------- 拍目录

export const TOC_SYSTEM = `你看一张初中数学课本目录页的照片，把目录抄成 JSON。
只输出 JSON：{"book":"书名和册次，比如 人教版数学七年级上册","chapters":[{"n":1,"title":"有理数","sections":[{"id":"1.1","title":"正数和负数"}]}]}
- 章的 n 是数字；节的 id 照目录上的编号写（1.1、2.3.1）。目录上没有编号的“数学活动”“小结”“复习题”“阅读与思考”这类不要。
- “综合与实践”写成 id "章号.P"。
- 看不清的字用 [?] 代替，不要猜。照片不是课本目录，就输出 {"book":"","chapters":[]}。`;

const normTitle = t => str(t).replace(/[\s·.…\d]/g, '').replace(/[（(].*?[)）]/g, '');

export function tocFromJSON(json, curriculum = null) {
  const j = json && typeof json === 'object' ? json : {};
  const chapters = (Array.isArray(j.chapters) ? j.chapters : []).map((c, i) => ({
    n: Number.isFinite(+c.n) && +c.n > 0 ? +c.n : i + 1, title: str(c.title).trim(),
    sections: (Array.isArray(c.sections) ? c.sections : []).map(s => ({ id: str(s.id).trim(), title: str(s.title).trim() })).filter(s => s.id && s.title),
  })).filter(c => c.title || c.sections.length);
  const builtin = new Map(((curriculum && curriculum.sections) || []).map(s => [normTitle(s.title), s.id]));
  let matched = 0, total = 0;
  for (const c of chapters) for (const s of c.sections) { total++; if (builtin.has(normTitle(s.title))) matched++; }
  const isBuiltin = total > 0 && matched >= total / 2;
  return { book: str(j.book).trim() || (isBuiltin ? BUILTIN_BOOK : ''), at: new Date().toISOString(), chapters, matched, total, builtin: isBuiltin };
}

export async function readToc(ctx, dataURL, { signal } = {}) {
  const mock = (() => { try { return !!((ctx.mockForced && ctx.mockForced()) || (ctx.settings && ctx.settings().mock)); } catch (e) { return false; } })();
  if (mock) {
    const ch = chaptersFrom(ctx.curriculum, null);
    return { ...tocFromJSON({ book: BUILTIN_BOOK, chapters: ch.map(c => ({ n: c.n, title: c.title, sections: c.sections })) }, ctx.curriculum), mock: true };
  }
  const r = await ctx.ai.ask('recognize', { system: TOC_SYSTEM, text: '这是课本的目录页，请抄成 JSON。', images: [dataURL], signal });
  return tocFromJSON(r && r.json, ctx.curriculum);
}
