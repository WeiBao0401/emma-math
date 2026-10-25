// 学情档案（CONTRACTS 17，design/teacher-chat.md 第 1 节第 4、5 条）：老师“记得她”。从错题卡、作答记录、对话里的
// 【记录】算出她最需要帮的几个点（带证据）、已经跨过去的、最近的进步；每次对话把 text 写进系统提示，首页的“想和你
// 聊 3 分钟”也从这里挑点。
// 负责：接线的人（v0.3 的 profile-home agent 没交付，接线时补写）。纯函数在上面，最后一个 loadProfile 读 ctx。
//
// 导出
//   buildProfile({ cards, attempts, observations, curriculum, today }) -> {
//     weak: [{ tag, name, score, evidence: [句子], cardId?, learning, stage, wrong7 }]   按分数排，最多 5 个
//     strong: [{ tag, name }], recent: [句子], text }        text：给 teacher.js teacherSystem 的 profileText，600 字以内
//   probePoint(profile, { today, probeDay, minScore }) -> weak 里的一项 | null   今天要不要主动找她聊、聊哪个点
//   probeLine(point) -> { title, why }        首页小卡的两句：“想和你聊 3 分钟：乘方前面的负号。”“这几天这类题错了 2 道。”
//   addObservations(list, notes, { at, day, chatId }) -> 新数组   对话里的【记录】进 kv 'observations'，最多 300 条
//   evidenceOfCard(card) -> 句子             “10-22 作业 −3² 写成 9”
//   loadProfile(ctx) -> Promise<profile>      读 store 的卡和近 14 天的作答、kv 'observations'，再 buildProfile
//   OBS_CAP, WEAK_MAX, TEXT_MAX, PROBE_MIN
//
// 打分（越高越需要帮）：一张在练的卡 +3（同一个坑再多一张 +1），卡在第 1 档 +1，同一个坑后来又错（originals）每次 +1，
// 讲完还是不太懂 +4；近 14 天每次答错 +2（今天错的算满 2，14 天前的算 1，越近越重），近 14 天第一次就做对 −0.5；
// 对话【记录】gap +2（30 天以前的 +1），ok −1；攻克 −4（进 strong）。自己改对的轻卡只 +1：她自己能找出来。
// 证据写成她和老师都看得懂的话：“10-22 作业 −3² 写成 9”“10-23 复习 −2⁴ 写成 16”“10-24 聊天里：把 −3² 读成 (−3)²”。
// 问老师的卡（诊断拿不准、她点了“这题有问题”）不算：那是我们没弄清，不是她不会。
import { plain } from './mathview.js';
import { dayOf, addDays, shortName, SHORT_NAMES } from './notebook.js';

export const OBS_CAP = 300;
export const WEAK_MAX = 5;
export const TEXT_MAX = 600;
export const PROBE_MIN = 4;          // 分数到这儿才主动找她聊（一张在练的卡 + 一次答错就够）
const WINDOW = 14;                  // 近 14 天的作答
const RECENT_DAYS = 7;

const str = v => (v === undefined || v === null ? '' : String(v));
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(str(d));
const mdOf = d => (isDay(d) ? d.slice(5) : '');
const daysAgo = (day, today) => {
  if (!isDay(day) || !isDay(today)) return Infinity;
  const t = (s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  return Math.round((t(today) - t(day)) / 864e5);
};
const dayOfAt = at => {
  if (isDay(str(at).slice(0, 10)) && !str(at).includes('T')) return str(at).slice(0, 10);
  const d = new Date(at);
  return isNaN(d) ? '' : dayOf(d);
};
const cps = s => [...str(s)];
const clip = (s, n) => { const a = cps(s); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
// 题目去掉“计算：”这类开头，公式变成读得懂的字
const shortQ = stem => plain(str(stem)).replace(/^\s*(?:\(\d+\)|（\d+）|\d+\s*[.、．])?\s*(?:计算|化简|求值|解方程|解下列方程)?\s*[:：]?\s*/, '').replace(/\s*=\s*$/, '').trim();

const SOURCE_WORD = { '作业本': '作业', '练习册': '练习册', '单元测': '单元测', '试卷': '试卷' };
const KIND_WORD = { redo: '复习原题', variant: '复习', twin: '讲题时的同构题', 'self-fix': '改错', chat: '聊天时的练习', paper: '错题卷', extra: '举一反三' };

export function evidenceOfCard(card = {}) {
  const p = card.problem || {};
  const d = card.diagnosis || {};
  const when = [mdOf(card.day), SOURCE_WORD[str(card.source)] || ''].filter(Boolean).join(' ');
  const q = shortQ(p.stem);
  const her = plain(str(p.her_answer)).trim();
  let what;
  if (q && cps(q).length <= 24) what = her ? `${q} 写成 ${her}` : `${q} 做错了`;
  else if (d.wrong_step) what = `错在“${clip(plain(str(d.wrong_step)), 24)}”`;
  else what = '一道题在这儿掉了坑';
  return [when, what].filter(Boolean).join(' ');
}

function evidenceOfAttempt(a, day) {
  const q = shortQ(a.q);
  const given = plain(str(a.given)).trim();
  const kind = KIND_WORD[a.kind] || '练习';
  const what = q && cps(q).length <= 24 ? (given ? `${q} 写成 ${given}` : `${q} 没做对`) : '一道题没做对';
  return `${mdOf(day)} ${kind} ${what}`;
}

// 坑的名字：卡上的短名优先（notebook.shortName），只有标签时也走它，再没有用对话里的“知识点”
function nameFor(tag, { card = null, point = '', curriculum = null } = {}) {
  if (card) return shortName(card, curriculum);
  if (tag && (SHORT_NAMES[tag] || (curriculum && typeof curriculum.error === 'function' && curriculum.error(tag)))) {
    return shortName({ tag, diagnosis: { tag } }, curriculum);
  }
  return clip(point || '最近学的内容', 16);
}

const askReason = c => (c && c.askTeacher && typeof c.askTeacher === 'object' ? str(c.askTeacher.reason) : '');

export function buildProfile({ cards = [], attempts = [], observations = [], curriculum = null, today = dayOf() } = {}) {
  const map = new Map();
  const entry = (key, init) => {
    if (!map.has(key)) map.set(key, { key, tag: '', name: '', score: 0, ev: [], cardId: '', learning: false, stage: 0, beaten: false, wrong7: 0, okSeen: 0, last: '', cards: 0 });
    const e = map.get(key);
    if (init) for (const [k, v] of Object.entries(init)) if (v && !e[k]) e[k] = v;
    return e;
  };
  // kind：'try' 最近答错的题、'card' 错题本里的原题、'chat' 对话里老师记下的、'note' 其他说明
  const evid = (e, day, text, w = 1, kind = 'card') => { if (text) e.ev.push({ day: day || '', text, w, kind }); if (isDay(day) && day > e.last) e.last = day; };
  const recent = [];
  const keyOfCard = c => str(c.tag || (c.diagnosis && c.diagnosis.tag)) || 'name:' + shortName(c, curriculum);

  const list = (Array.isArray(cards) ? cards : []).filter(c => c && typeof c === 'object' && c.id != null);
  const byId = new Map(list.map(c => [str(c.id), c]));

  for (const c of list) {
    const reason = askReason(c);
    if (c.status === 'ask' && reason !== 'confused' && reason !== 'still-lost') continue;
    const key = keyOfCard(c);
    const e = entry(key, { tag: str(c.tag || (c.diagnosis && c.diagnosis.tag)), name: shortName(c, curriculum) });
    if (c.status === 'beaten') {
      e.score -= 4;
      e.beaten = true;
      if (daysAgo(c.updated ? dayOfAt(c.updated) : '', today) <= RECENT_DAYS) recent.push({ day: dayOfAt(c.updated), text: `攻克了“${e.name}”` });
      continue;
    }
    if (c.status === 'ask') {
      e.score += 4;
      if (!e.cardId) e.cardId = str(c.id);
      evid(e, c.day, `${mdOf(c.day)} 讲完还是不太懂`, 2, 'note');
      evid(e, c.day, evidenceOfCard(c), 1);
      continue;
    }
    if (c.light) {
      e.score += 1;
      evid(e, c.day, `${evidenceOfCard(c)}（后来自己改对了）`, 0.5);
      if (daysAgo(c.day, today) <= RECENT_DAYS) recent.push({ day: c.day, text: `自己改对了一道“${e.name}”的题` });
    } else {
      e.score += e.cards ? 1 : 3;
      e.cards++;
      e.learning = true;
      if (!e.cardId) e.cardId = str(c.id);
      const stage = Number(c.stage) || 1;
      e.stage = e.stage ? Math.min(e.stage, stage) : stage;
      if (stage === 1) e.score += 1;
      evid(e, c.day, evidenceOfCard(c), 1);
    }
    if (c.confused || c.retell) e.score += 1;
    for (const o of Array.isArray(c.originals) ? c.originals : []) {
      if (!o) continue;
      e.score += 1;
      evid(e, o.day, evidenceOfCard({ ...c, problem: o.problem || o, day: o.day, source: o.source || c.source }), 1);
    }
  }

  for (const a of Array.isArray(attempts) ? attempts : []) {
    if (!a || (a.ok !== false && a.ok !== true) || a.skipped || a.test) continue;
    const day = a.day || dayOfAt(a.at);
    const age = daysAgo(day, today);
    if (!(age >= 0 && age <= WINDOW)) continue;
    const card = byId.get(str(a.itemId));
    const tag = str(a.tag || (card && (card.tag || (card.diagnosis && card.diagnosis.tag))));
    if (!tag && !card) continue;
    if (card && card.status === 'ask' && askReason(card) !== 'confused' && askReason(card) !== 'still-lost') continue;
    const key = tag || keyOfCard(card);
    const e = entry(key, { tag, name: nameFor(tag, { card, point: a.point, curriculum }) });
    if (a.ok === false) {
      const w = 1 - age / (2 * WINDOW);           // 今天 1，14 天前 0.5
      e.score += 2 * w;
      if (age <= RECENT_DAYS) e.wrong7++;
      evid(e, day, evidenceOfAttempt(a, day), w + 0.5, 'try');
    } else if (a.firstTry !== false && !a.hints) {
      e.score -= 0.5;
      e.okSeen++;
      if (age <= RECENT_DAYS && (a.kind === 'redo' || a.kind === 'variant' || a.kind === 'chat')) recent.push({ day, text: `${KIND_WORD[a.kind] || '练习'}做对了“${e.name}”` });
    }
  }

  for (const o of Array.isArray(observations) ? observations : []) {
    if (!o || (o.kind !== 'gap' && o.kind !== 'ok')) continue;
    const day = o.day || dayOfAt(o.at);
    const tag = str(o.tag);
    const point = str(o.point);
    if (!tag && !point) continue;
    const key = tag || 'point:' + point;
    const e = entry(key, { tag, name: nameFor(tag, { point, curriculum }) });
    const age = daysAgo(day, today);
    if (o.kind === 'gap') {
      e.score += age <= 30 ? 2 : 1;
      if (o.note) evid(e, day, `${mdOf(day)} 聊天里：${clip(o.note, 30)}`, 1, 'chat');
    } else {
      e.score -= 1;
      e.okSeen++;
      if (age <= RECENT_DAYS) recent.push({ day, text: `聊天里弄懂了“${e.name}”` });
    }
  }

  const all = [...map.values()];
  const weak = all.filter(e => e.score > 0 && !e.beaten)
    .sort((a, b) => b.score - a.score || (b.last > a.last ? 1 : b.last < a.last ? -1 : 0))
    .slice(0, WEAK_MAX)
    .map(e => {
      // 证据：先各取一句最近的“答错的题”“错题本里的原题”“对话里看到的”，具体的错在前，老师和她都看得懂；
      // 不够 3 句再按新近补。同一句只留一次
      const seen = new Set();
      const byDay = e.ev.slice().sort((a, b) => (b.day > a.day ? 1 : b.day < a.day ? -1 : b.w - a.w))
        .filter(x => (seen.has(x.text) ? false : seen.add(x.text)));
      const picked = [];
      for (const kind of ['try', 'card', 'note', 'chat']) { const x = byDay.find(y => y.kind === kind); if (x) picked.push(x); }
      for (const x of byDay) if (!picked.includes(x)) picked.push(x);
      const evidence = picked.slice(0, 3).map(x => x.text);
      const out = { tag: e.tag, name: e.name, score: Math.round(e.score * 10) / 10, evidence, learning: e.learning, stage: e.stage, wrong7: e.wrong7 };
      if (e.cardId) out.cardId = e.cardId;
      return out;
    });
  const strong = all.filter(e => e.beaten || (e.score <= 0 && e.okSeen > 0)).map(e => ({ tag: e.tag, name: e.name }));
  const seenRecent = new Set();
  const recentLines = recent.filter(r => isDay(r.day)).sort((a, b) => (b.day > a.day ? 1 : b.day < a.day ? -1 : 0))
    .map(r => `${mdOf(r.day)} ${r.text}`).filter(t => (seenRecent.has(t) ? false : seenRecent.add(t))).slice(0, 5);
  return { weak, strong, recent: recentLines, text: profileText({ weak, strong, recent: recentLines }) };
}

// 给老师看的一段：最需要帮的在前，带证据；放不下先去掉证据，再去掉后面的点
function profileText({ weak, strong, recent }) {
  const tagNote = w => (w.learning ? `（在练${w.stage ? `，第 ${w.stage} 档` : ''}）` : '');
  const build = (nWeak, nEv) => {
    const lines = [];
    if (weak.length) {
      lines.push('最需要帮的（按重要排）：');
      weak.slice(0, nWeak).forEach((w, i) => {
        const ev = w.evidence.slice(0, nEv);
        lines.push(`${i + 1}. ${w.name}${tagNote(w)}${w.tag ? ` [${w.tag}]` : ''}${ev.length ? `。证据：${ev.join('；')}` : ''}`);
      });
    }
    if (strong.length) lines.push(`已经跨过去的：${strong.slice(0, 6).map(s => s.name).join('、')}`);
    if (recent.length) lines.push(`最近：${recent.slice(0, 3).join('；')}`);
    return lines.join('\n');
  };
  for (const [n, e] of [[5, 3], [5, 2], [4, 2], [4, 1], [3, 1], [3, 0], [2, 0], [1, 0]]) {
    const t = build(n, e);
    if (cps(t).length <= TEXT_MAX) return t;
  }
  return clip(build(1, 0), TEXT_MAX);
}

export function probePoint(profile, { today = dayOf(), probeDay = '', minScore = PROBE_MIN } = {}) {
  if (!profile || probeDay === today) return null;
  return (profile.weak || []).find(w => w.score >= minScore && w.evidence && w.evidence.length) || null;
}

export function probeLine(point) {
  if (!point) return { title: '', why: '' };
  const title = `想和你聊 3 分钟：${point.name}。`;
  let why;
  if (point.wrong7 > 1) why = `这几天这类题错了 ${point.wrong7} 道。`;
  else if (point.wrong7 === 1) why = '这几天又错了一道这类题。';
  else if (point.learning) why = '这个坑你还在练，我们把它弄透。';
  else why = '我想听听你是怎么想的。';
  return { title, why };
}

export function addObservations(list, notes, { at = new Date().toISOString(), day = '', chatId = '' } = {}) {
  const out = Array.isArray(list) ? list.filter(o => o && typeof o === 'object') : [];
  const d = day || dayOfAt(at);
  for (const n of Array.isArray(notes) ? notes : []) {
    if (!n || (n.kind !== 'gap' && n.kind !== 'ok')) continue;
    out.push({ at, day: d, kind: n.kind, tag: str(n.tag), point: str(n.point), note: str(n.note), chatId: str(chatId) });
  }
  return out.length > OBS_CAP ? out.slice(out.length - OBS_CAP) : out;
}

// 读她的全部卡、近 14 天的作答和对话记录。哪一样读不到都用空的，档案照样出（只是少了那部分）
export async function loadProfile(ctx) {
  const today = typeof ctx.today === 'function' ? ctx.today() : dayOf();
  let cards = [], attempts = [], observations = [];
  try { cards = ctx.store && typeof ctx.store.all === 'function' ? (await ctx.store.all('items')) || [] : []; } catch (e) { console.warn('profile items', e); }
  try {
    if (ctx.store && typeof ctx.store.byIndex === 'function') {
      const [y, m, d] = addDays(today, -WINDOW).split('-').map(Number);
      attempts = (await ctx.store.byIndex('attempts', 'at', { lo: new Date(y, m - 1, d).toISOString() })) || [];
    }
  } catch (e) { console.warn('profile attempts', e); }
  try { observations = (ctx.kv && typeof ctx.kv.peek === 'function' ? ctx.kv.peek('observations', []) : []) || []; } catch (e) { observations = []; }
  return buildProfile({ cards, attempts, observations, curriculum: ctx.curriculum || null, today });
}
