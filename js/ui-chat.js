// 问我：Emma 的私人老师（CONTRACTS 14-17，design/teacher-chat.md）。她打字、说话、拍题问一个数学问题，老师（gpt-5.4，
// 流式）一句句地答。老师先弄清她卡在哪，一次讲一个点，讲完用一个小问题或一道题确认；她当场作答，程序判对错；对话里看出的
// “哪里没懂 / 哪里懂了”记进学情档案，下次讲的时候连起来。
// 负责：接线的人（v0.3 的 chat-ui agent 没交付，接线时补写）。
//
// 路由 chat，params：{ mode: 'free' | 'probe' | 'problem', point?, cardId?, chatId?, problem?, diagnosis?, fresh? }
//   problem、diagnosis：讲题最后一屏传刚讲的那道（同坑合并时卡上存的是第一道）；fresh：不接着上一段，另开新的
//   step（v0.6.0）：讲题每一屏的“有问题？问我”带来，她停在哪一步，交给 problemContext；同时带 chatId（讲题屏生成），
//     第一次就用这个 id 开新的一段，再来就接着这一段，上下文换成新的一步（refreshProblemChat）
//   free     她自己问（首页“有问题，问我”）。30 分钟内问过，接着上一段聊；导航栏“新问题”另开一段
//   probe    老师主动开场（首页小卡“想和你聊 3 分钟：…”）：probeUser(point) 隐藏发出，她只看到老师的话；记 kv 'probeDay'。
//            point 来自老师的笔记本时带 opener（笔记里计划的开场问法），probeUser 交给老师
//   problem  讲完错题接着问（讲题最后一屏、卡详情“问我”）：problemContext 作为隐藏的上下文，接在她第一句前面
//   chatId   打开以前的对话接着聊
//
// 导出
//   createChat(ctx) -> { show(params, { from }), hide(), onResume() }      画进 <section id="view-chat">
//   纯函数（tests/ui-chat.test.mjs）：
//     COPY                                  她看到的固定文案
//     newChat({ id, mode, point, cardId, context, stem, tag, at }) -> chat
//     chatTitle(chat) -> 对话列表里的一行      addChatEntry(chats, chat) -> { list, dropped }   最多 50 个，最新的在前
//     apiMessages(chat, maxChars) -> 发给 ai.chat 的 messages：去掉本地的开场白和失败的回答，留最近的，开头补上题目上下文
//     visibleMessages(chat) -> 她看得到的消息（隐藏的开场和程序加的话不显示）
//     practiceSetup(practice) -> { kind, options, letters, variable }   小键盘怎么出
//     vetPractice(practice) -> { ok, computed }    程序能算的题再算一遍；算出来和老师写的答案不一样就不让她做，换一道
//     answerTurn({ practice, given, result, self }) -> { display, content }   她交了答案以后发给老师的话（程序判的结果她看不到）
//     systemFor({ profile, kv, curriculum, today, mock, note }) -> teacherSystem(...) 的系统提示。profileText 是学情档案的
//       text，再加一行老师的笔记本（v0.5，reflect.noteForTeacher）：note 不传时读 kv 'teacherNotes' 的最新一篇
//       （模拟模式外不算模拟写的那些），没有笔记就不加
//     resumable(chats, { mode, cardId, now }) -> 可以接着聊的那一段的 id | ''
//     chipsFor(mode, profile, { noWork }) -> [她可以直接点的一句话]（noWork：订正过、直接讲的题，不问“错在哪”）
//     contextProblem(problem) -> problem   直接讲的题（useWork false）去掉 her_work、her_answer 再交给 problemContext（v0.6.0）
//     problemSource(card, params) -> { problem, diagnosis, cardId, tag } | null   problem 模式用哪道题（v0.3.1）：
//       传来的题和诊断优先，没有用卡上的；卡找不到但传来了题目（复习的样例卡），照样能问，只是不挂在卡上
//
// kv：'chats'（[{ id, at, updated, title, mode, cardId }] 最近 50 个）、'chat:<id>'（整段对话）、'observations'（【记录】，
// profile.addObservations）、'probeDay'。作答写进 attempts（kind 'chat'，itemId 是卡的 id 或 'chat:<对话 id>'，带 tag）。
// 依赖：ui-dom、teacher、md、voice-input、profile、keypad、mathcheck、mathview、image、kid-errors、notebook。
import { h, icon, mathText, ago, teacherAvatar } from './ui-dom.js';
import { teacherSystem, probeUser, settleUser, problemContext, splitReply, visibleSoFar, QUICK_REPLIES, trimHistory } from './teacher.js';
import { renderMessage, plainMessage } from './md.js';
import { createVoiceInput } from './voice-input.js';
import { loadProfile, probePoint, addObservations } from './profile.js';
import { createAnswer } from './keypad.js';
import { check, compute } from './mathcheck.js';
import { plain } from './mathview.js';
import { prepare } from './image.js';
import { kidMessage, canRetry } from './kid-errors.js';
import { dayOf } from './notebook.js';
import { newId } from './db.js';
import { noteForTeacher, focusPoint } from './reflect.js';
import { latestNote, isMock, NOTES_KEY } from './notes.js';
import { textbookMap, teacherLine } from './bookmap.js';
import { quizUser, normalizeSpec, specLine, makeQuiz, QUIZ_CAP } from './quiz.js';
import { createWaitFun } from './waitfun.js';

export const CHATS_CAP = 50;
export const QUIZ_REPLIES = ['你定吧', '标准卷就好', '结合我的薄弱点'];
export const HISTORY_CHARS = 12000;
export const RESUME_MS = 30 * 60 * 1000;
const KINDS = new Set(['number', 'expr', 'equation', 'set', 'choice', 'compare', 'text']);

// 她看到的字：弯引号，不用破折号和感叹号，句子短；App 自称“我”
export const COPY = {
  title: '问我',
  introFree: '想问什么都可以：哪道题不会、哪一步没想通、为什么要这样做。打字、说话、拍照都行。',
  introProblem: '这道题还有哪里不明白？直接问我，也可以说说你当时是怎么想的。',
  introDirect: '这道题还有哪里不明白？直接问我。',   // 订正过、选了直接讲的题（v0.6.0）：不问她当时怎么想的
  aboutProblem: '我们在说这道题',
  herAnswer: '你当时写的：',
  thinking: '我想一想',
  partial: '我好像没说完。',
  goOn: '接着说',
  retry: '再试一次',
  placeholder: '想问什么，写在这里',
  send: '发给老师',
  hold: '按住 说话',
  holdUp: '松开 发送',
  holdCancel: '松开 取消',
  holdWait: '在听写…',
  liveHint: '正在听你说…  往上滑可以取消',
  micDenied: '要先允许用麦克风，再按住说一次。',
  tooShort: '按住说话，说完再松开。',
  notHeard: '没听清，再按住说一次。',
  toType: '打字',
  toVoice: '说话',
  photo: '拍题',
  photoFail: '这张照片没放上，再选一次。',
  photoDefault: '这道题我不会，帮我看看。',
  removePhoto: '不要这张照片',
  tryIt: '试一试',
  right: '对。',
  wrong: '还不对，我们一起看看。',
  unsure: '这道我判不了，我看看你的答案。',
  paperAnswer: ans => `答案是 ${ans}。和你写的一样吗？`,
  paperSame: '一样',
  paperDiff: '不一样',
  yours: '你的答案：',
  swapping: '这道题的答案我核对不上，换一道。',
  past: '以前聊过的',
  newChat: '新问题',
  home: '首页',
  back: '返回',
  missingCard: '这道题找不到了。可以直接问我。',
};

const str = v => (v === undefined || v === null ? '' : String(v));
const cps = s => [...str(s)];
const clip = (s, n) => { const a = cps(s); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const textOf = content => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(p => p && p.type === 'text').map(p => str(p.text)).join('\n') : '');
const imageOf = content => (Array.isArray(content) ? ((content.find(p => p && p.type === 'image_url') || {}).image_url || {}).url || '' : '');

// ---------------------------------------------------------------- 纯函数

export function newChat({ id = newId('c'), mode = 'free', point = null, cardId = '', context = '', stem = '', tag = '', at = new Date().toISOString() } = {}) {
  const m = ['free', 'probe', 'problem', 'quiz'].includes(mode) ? mode : 'free';
  const p = point && typeof point === 'object'
    ? { name: str(point.name || point.point), tag: str(point.tag), evidence: Array.isArray(point.evidence) ? point.evidence.slice(0, 3).map(str) : [],
      ...(point.opener ? { opener: str(point.opener) } : {}) }
    : null;
  return { id, mode: m, point: p, cardId: str(cardId), context: str(context), stem: str(stem), tag: str(tag || (p && p.tag)), at, updated: at, messages: [] };
}

export function visibleMessages(chat) {
  return ((chat && chat.messages) || []).filter(m => m && !m.hidden);
}

export function chatTitle(chat = {}) {
  if (chat.mode === 'probe' && chat.point && chat.point.name) return clip(`聊聊：${chat.point.name}`, 20);
  if (chat.mode === 'quiz') { const q = (chat.messages || []).find(m => m && m.quizSpec); return clip(q ? `出套题：${q.quizSpec.title}` : '出套题', 20); }
  if (chat.mode === 'problem' && chat.stem) return clip(`这道题：${plain(chat.stem)}`, 20);
  const first = visibleMessages(chat).find(m => m.role === 'user' && !m.local);
  const t = first ? str(first.display ?? textOf(first.content)).trim() : '';
  return t ? clip(t.replace(/\s+/g, ' '), 20) : COPY.title;
}

export function addChatEntry(chats, chat) {
  const list = (Array.isArray(chats) ? chats : []).filter(x => x && x.id && x.id !== chat.id);
  const entry = { id: chat.id, at: chat.at, updated: chat.updated || chat.at, title: chatTitle(chat), mode: chat.mode, cardId: chat.cardId || '' };
  const all = [entry, ...list];
  return { list: all.slice(0, CHATS_CAP), dropped: all.slice(CHATS_CAP).map(x => x.id) };
}

// problem 模式用哪道题。讲题最后一屏、复习“问我这道”传来刚做的那道（同坑合并时卡上存的是第一道，复习时是变式题），
// 卡详情只有卡。卡找不到（模拟模式的样例卡不在错题本里、卡刚被删）但传来了题目：照样用传来的题和诊断，cardId 留空，
// 作答记在这段对话上，不挂到一张不存在的卡上。题和卡都没有 -> null（说“这道题找不到了”）
export function problemSource(card, params = {}) {
  const p = params && params.problem && typeof params.problem === 'object' ? params.problem : null;
  const d = params && params.diagnosis && typeof params.diagnosis === 'object' ? params.diagnosis : null;
  if (!card && !(p && str(p.stem))) return null;
  const problem = p || (card && card.problem) || {};
  const diagnosis = d || (card && card.diagnosis) || {};
  return { problem, diagnosis, cardId: card ? str(card.id) : '', tag: str((card && card.tag) || diagnosis.tag) };
}

export function resumable(chats, { mode = 'free', cardId = '', now = Date.now() } = {}) {
  const list = Array.isArray(chats) ? chats : [];
  if (mode === 'problem' && cardId) {
    const hit = list.find(x => x && x.cardId === cardId && now - new Date(x.updated || x.at).getTime() < 6 * 3600 * 1000);
    return hit ? hit.id : '';
  }
  if (mode !== 'free') return '';
  const last = list[0];
  if (!last || last.mode !== 'free') return '';
  return now - new Date(last.updated || last.at).getTime() < RESUME_MS ? last.id : '';
}

export function apiMessages(chat, maxChars = HISTORY_CHARS) {
  const turns = ((chat && chat.messages) || [])
    .filter(m => m && !m.local && !m.failed && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ role: m.role, content: m.content }))
    .filter(m => (typeof m.content === 'string' ? m.content.trim() : Array.isArray(m.content) && m.content.length));
  const out = trimHistory(turns, maxChars);
  const context = str(chat && chat.context);
  if (context && out.length && !textOf(out[0].content).includes(context)) {
    const join = t => `${context}\n\n她现在说：${t}`;
    const c = out[0].content;
    out[0] = { role: 'user', content: typeof c === 'string' ? join(c) : [{ type: 'text', text: join(textOf(c)) }, ...c.filter(p => p && p.type !== 'text')] };
  }
  return out;
}

function guessKind(answer) {
  const a = str(answer).trim();
  if (/^[<>=＜＞]$/.test(a)) return 'compare';
  if (/^[A-H]$/.test(a)) return 'choice';
  if (/或|,|，|、/.test(a)) return 'set';
  if (/=/.test(a)) return 'equation';
  if (/[a-z]/i.test(a.replace(/\\[a-z]+/gi, ''))) return 'expr';
  if (/^[-−+]?[\d.\s/()^×÷+\-−*\\{}a-z]+$/i.test(a)) return 'number';
  return 'text';
}

// 选择题的选项写在题目里：“A. 3  B. −3  C. 9”
function optionsIn(q) {
  const s = str(q);
  const out = [];
  const re = /(?:^|[\s　])([A-D])\s*[.．、:：]\s*(.+?)(?=[\s　]+[A-D]\s*[.．、:：]|$)/gs;
  for (const m of s.matchAll(re)) out.push(`${m[1]}. ${m[2].trim()}`);
  return out.length >= 2 ? out : [];
}

export function practiceSetup(practice = {}) {
  const answer = str(practice.answer);
  let kind = KINDS.has(practice.answer_kind) ? practice.answer_kind : guessKind(answer);
  let options = [];
  if (kind === 'choice') { options = optionsIn(practice.q); if (!options.length) kind = 'text'; }
  const letters = [...new Set((answer.replace(/\\[a-z]+/gi, '').match(/[a-z]/gi) || []).map(c => c.toLowerCase()))];
  const variable = kind === 'equation' ? ((/^\s*([a-z])\s*=/i.exec(answer) || [])[1] || 'x') : 'x';
  return { kind, options, letters: kind === 'expr' && letters.length ? letters.slice(0, 6) : null, variable };
}

export function vetPractice(practice = {}) {
  let computed = null;
  try { computed = compute(practice.q); } catch (e) { computed = null; }
  if (!computed) return { ok: true, computed: '' };
  const kind = KINDS.has(practice.answer_kind) ? practice.answer_kind : computed.kind;
  let r;
  try { r = check(practice.answer, computed.answer, { kind }); } catch (e) { r = { ok: null }; }
  return { ok: r.ok !== false, computed: computed.answer };
}

export function answerTurn({ practice = {}, given = '', result = null, self = null } = {}) {
  const answer = str(practice.answer);
  if (self !== null) {
    const display = self ? '我在纸上做了，和答案一样。' : '我在纸上做了，和答案不一样。';
    return { display, content: `${display}\n（这一句是程序加的，她看不到：她自己对照了答案 ${answer}。）` };
  }
  const g = str(given).trim();
  const ok = result ? result.ok : null;
  const judged = ok === true ? '程序判对了'
    : ok === false ? `程序判不对，正确答案是 ${answer}${result.reason && result.reason !== 'wrong' ? `（错因代码 ${result.reason}）` : ''}`
      : '程序判不了，请你看一下她的答案';
  return { display: `我的答案：${g}`, content: `我的答案：${g}\n（这一句是程序加的，她看不到：${judged}。）` };
}

export function systemFor({ profile = null, kv = null, curriculum = null, today = dayOf(), mock = false, note, cards = null } = {}) {
  const peek = (k, f) => { try { return kv && typeof kv.peek === 'function' ? kv.peek(k, f) : f; } catch (e) { return f; } };
  const prog = peek('progress', null);
  const progress = prog && prog.section ? (curriculum && typeof curriculum.title === 'function' ? curriculum.title(prog.section) : str(prog.section)) : '';
  const ex = peek('exam', null);
  let exam = '';
  if (ex && /^\d{4}-\d{2}-\d{2}$/.test(str(ex.date)) && str(ex.end || ex.date) >= today) {
    const days = Math.round((Date.UTC(...ex.date.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...today.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);
    const range = Array.isArray(ex.sections) && ex.sections.length
      ? `，范围 ${ex.sections.map(s => (curriculum && typeof curriculum.title === 'function' ? curriculum.title(s) : s)).join('、')}` : '';
    exam = `${ex.date}${days > 0 ? `（还有 ${days} 天）` : days === 0 ? '（今天）' : ''}${range}`;
  }
  const tags = curriculum && Array.isArray(curriculum.tags) ? curriculum.tags.map(t => ({ id: t.id, name: t.name })) : [];
  const plan = noteForTeacher(note !== undefined ? note : latestNote(peek(NOTES_KEY, []), { mock }));
  const profileText = [str(profile && profile.text).trim(), plan].filter(Boolean).join('\n');
  // v0.7 课本地图：学到哪、哪几节还在错、哪几节还没见过她做题（bookmap.teacherLine）
  let book = '';
  try { if (cards) book = teacherLine(textbookMap({ curriculum, cards, progress: prog, toc: (peek('textbook', null) || {}).toc || null, today })); } catch (e) { book = ''; }
  return teacherSystem({ profileText, progress, exam, tags, book });
}

// v0.6.0 讲题中途问我：讲题的每一屏带着 step（她停在哪一步、那一屏写着什么）和 chatId（同一道题接着同一段聊）来。
// 接着聊的时候，题目上下文换成她现在停的这一步（诊断后来才回来的也补上），再说一句前面的对话是在哪几步问的；
// 卡是讲完才建的，这段对话原来没挂卡就挂上。没带 step（从对话列表打开）不动。改的是传进来的 chat，也返回它
// 订正过、选了直接讲的题（problem.useWork === false）：卷子上的过程和答案是改过以后的，不是她当时写的，
// 不放进给老师的“她当时写的 / 她的答案”两行（teacher.problemContext 另有一句说明她订正过）
export const contextProblem = p => (p && p.useWork === false ? { ...p, her_work: [], her_answer: '' } : p);

export function refreshProblemChat(chat, params = {}) {
  const step = str(params && params.step).trim();
  const p = params && params.problem && typeof params.problem === 'object' ? params.problem : null;
  if (!chat || chat.mode !== 'problem' || !step || !p) return chat;
  const d = params.diagnosis && typeof params.diagnosis === 'object' ? params.diagnosis : {};
  const before = (Array.isArray(chat.steps) ? chat.steps : []).filter(s => s && s !== step);
  const said = before.length ? `${step}（前面的对话是她停在“${before.slice(-2).join('”“')}”时问的）` : step;
  chat.context = problemContext({ problem: contextProblem(p), diagnosis: d, step: said });
  chat.steps = [...before, step].slice(-4);
  if (!chat.cardId && params.cardId) chat.cardId = str(params.cardId);
  return chat;
}

export function chipsFor(mode, profile, { noWork = false } = {}) {
  // 订正过、选了直接讲的题（v0.6.0）：讲的是正确思路，没有“错在哪”可问
  if (mode === 'problem') return [noWork ? '这一步为什么要这样做' : '我还是不明白错在哪', '换个讲法讲一遍', '出一道类似的题考考我'];
  if (mode !== 'free') return [];
  const weak = (profile && profile.weak) || [];
  return weak.slice(0, 2).map(w => `我想弄懂“${w.name}”`);
}

// ---------------------------------------------------------------- 界面

export function createChat(ctx) {
  const root = document.getElementById('view-chat');
  root.replaceChildren();
  root.classList.add('with-bar');

  const backLabel = h('span', { className: 'back-label', text: COPY.home });
  const navTitle = h('span', { className: 'nav-title', text: COPY.title });
  const newBtn = h('button', { type: 'button', className: 'text-btn accent chat-new', text: COPY.newChat, hidden: true, on: { click: () => startFresh() } });
  const navbar = h('header', { className: 'navbar' }, h('div', { className: 'inner' },
    h('button', { type: 'button', className: 'back', on: { click: () => ctx.back() } }, icon('back'), backLabel),
    navTitle, h('span', { className: 'nav-end' }, newBtn)));

  const top = h('div', { className: 'chat-top' });
  const list = h('div', { className: 'chat-list', role: 'log', 'aria-live': 'polite' });
  const after = h('div', { className: 'chat-after' });
  const page = h('div', { className: 'page chat-page' }, h('h1', { className: 'page-title chat-title', text: COPY.title }), top, list, after);

  // 底部输入条：拍题、输入框、说话、发送；录音时换成音量条和“说完了”
  const fileIn = h('input', { type: 'file', accept: 'image/*', className: 'visually-hidden', tabIndex: -1, 'aria-label': COPY.photo });
  const input = h('textarea', { className: 'chat-input', rows: 1, placeholder: COPY.placeholder, 'aria-label': COPY.placeholder, enterkeyhint: 'send' });
  const camBtn = h('button', { type: 'button', className: 'chat-icon-btn', 'aria-label': COPY.photo, on: { click: () => fileIn.click() } }, icon('camera'));
  // 语音（v0.7，和英语 App 一样）：输入框换成一整条“按住 说话”，说的话边说边出在上面，松开就发，往上滑取消；
  // 左边的小按钮在说话和打字之间切换，记在 localStorage
  const MODE_KEY = 'emmamath.chat.mode';
  const voice = createVoiceInput(ctx);
  let voiceMode = (() => { try { return localStorage.getItem(MODE_KEY) !== 'text'; } catch (e) { return true; } })();
  const holdLabel = h('span', { text: COPY.hold });
  const holdBtn = h('button', { type: 'button', className: 'chat-hold', 'aria-label': '按住说话，松开发送' }, holdLabel);
  const live = h('div', { className: 'chat-live', hidden: true, 'aria-live': 'polite' });
  const modeBtn = h('button', { type: 'button', className: 'chat-icon-btn chat-mode', on: { click: () => setVoiceMode(!voiceMode, true) } });
  const sendBtn = h('button', { type: 'button', className: 'chat-send', 'aria-label': COPY.send, on: { click: () => sendTyped() } }, icon('send'));
  const photoRow = h('div', { className: 'chat-photo-row', hidden: true });
  const hearRow = h('p', { className: 'small chat-hear', hidden: true, role: 'status' });
  const inputRow = h('div', { className: 'chat-input-row' }, modeBtn, camBtn, input, holdBtn, sendBtn);
  const bar = h('div', { className: 'ebar chat-bar' }, h('div', { className: 'inner' }, photoRow, live, hearRow, inputRow));
  root.append(navbar, page, bar, fileIn);

  // ------------------------------------------------ 状态
  let chat = null;              // 当前这一段
  let profile = null;
  let photo = '';               // 要和下一句一起发的照片（dataURL）
  let answerW = null;           // 当前练习题的小键盘
  let rec = null;               // 正在按住说话的这一次
  let showToken = 0;
  let mode = 'free';
  const running = new Map();    // chatId -> { text, ctl }：正在流式回答的
  const vetted = new Map();     // 消息 at -> vetPractice 的结果
  const today = () => (typeof ctx.today === 'function' ? ctx.today() : dayOf());
  const peek = (k, f) => { try { return ctx.kv.peek(k, f); } catch (e) { return f; } };

  // ------------------------------------------------ 存
  async function saveChat(c) {
    try {
      c.updated = new Date().toISOString();
      await ctx.kv.set('chat:' + c.id, c);
      const { list: chats, dropped } = addChatEntry(peek('chats', []), c);
      await ctx.kv.set('chats', chats);
      for (const id of dropped) { try { await ctx.kv.delete('chat:' + id); } catch (e) { /* 删不掉也没关系 */ } }
    } catch (e) { console.warn('chat save', e); }
  }
  async function saveNotes(c, notes) {
    if (!notes || !notes.length) return;
    try {
      await ctx.kv.set('observations', addObservations(peek('observations', []), notes, { at: new Date().toISOString(), day: today(), chatId: c.id }));
      const t = notes.find(n => n.tag);
      if (t && !c.tag) c.tag = t.tag;
      profile = null;   // 下一轮重新算
    } catch (e) { console.warn('observations', e); }
  }
  async function ensureProfile() {
    if (profile) return profile;
    try { profile = await loadProfile(ctx); } catch (e) { profile = { weak: [], strong: [], recent: [], text: '' }; }
    return profile;
  }

  // ------------------------------------------------ 画
  const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
  const toBottom = () => { try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e) { /* 没关系 */ } };

  // 老师出过的题留在对话里：做过的写上她的答案和对错，没做的只留题目（正在做的那道在 afterEls 里，带小键盘）
  function pastPractice(m) {
    const d = m.practiceDone;
    return h('div', { className: 'chat-practice past' + (d ? ' done' : '') },
      h('p', { className: 'label', text: COPY.tryIt }),
      mathText(m.practice.q, { tag: 'div', className: 'chat-pq' }),
      d ? h('p', { className: 'chat-pres ' + (d.ok === true ? 'ok' : d.ok === false ? 'no' : '') },
        d.self !== undefined && d.self !== null ? h('span', { text: d.self ? '和答案一样。' : '和答案不一样。' })
          : [h('span', { text: COPY.yours }), mathText(d.given || ''), h('span', { className: 'chat-mark', text: d.ok === true ? '　对' : d.ok === false ? '　不对' : '' })]) : null);
  }

  function msgEl(m, isLast = false) {
    if (m.role === 'assistant') {
      const text = h('div', { className: 'chat-text' });
      text.innerHTML = renderMessage(str(m.display ?? splitReply(textOf(m.content)).display));   // renderText 先转义
      const showPast = m.practice && (m.practiceDone || !isLast) && !m.swapAsked;
      return h('div', { className: 'chat-msg t' + (m.local ? ' local' : '') }, teacherAvatar('chat-av'), h('div', { className: 'chat-tbody' }, text, showPast ? pastPractice(m) : null, m.quizSpec ? quizCard(m) : null));
    }
    const img = m.image || imageOf(m.content);
    const words = str(m.display ?? textOf(m.content));
    return h('div', { className: 'chat-msg me' },
      img ? h('img', { className: 'chat-img', src: img, alt: '我拍的题' }) : null,
      words ? h('div', { className: 'chat-text', text: words }) : null);
  }

  function renderTop() {
    if (!chat || chat.mode !== 'problem' || !chat.stem) { top.replaceChildren(); return; }
    top.replaceChildren(h('div', { className: 'chat-about' },
      h('p', { className: 'label', text: COPY.aboutProblem }),
      mathText(chat.stem, { tag: 'div', className: 'chat-about-q' }),
      chat.herAnswer ? h('p', { className: 'small' }, COPY.herAnswer, mathText(chat.herAnswer)) : null));
  }

  function destroyAnswer() { if (answerW) { try { answerW.destroy(); } catch (e) { /* 已经拆了 */ } answerW = null; } }

  function render({ keepScroll = false } = {}) {
    destroyAnswer();
    if (!chat) { list.replaceChildren(); after.replaceChildren(); return; }
    const stick = keepScroll ? nearBottom() : true;
    const vis = visibleMessages(chat);
    newBtn.hidden = !vis.some(m => m.role === 'user' && !m.local);
    navTitle.textContent = chatTitle(chat);
    renderTop();
    list.replaceChildren(...vis.map((m, i) => msgEl(m, i === vis.length - 1)));
    const live = running.get(chat.id);
    if (live) list.append(streamEl(live.text));
    after.replaceChildren(...afterEls(vis, !!live));
    syncBar();
    if (stick) requestAnimationFrame(toBottom);
  }

  let streamText = null;
  function streamEl(text) {
    const shown = visibleSoFar(text || '');
    streamText = h('div', { className: 'chat-text' });
    if (shown) streamText.innerHTML = renderMessage(shown);
    else streamText.append(h('span', { className: 'small dots chat-thinking', text: COPY.thinking }));
    return h('div', { className: 'chat-msg t streaming' }, teacherAvatar('chat-av'), h('div', { className: 'chat-tbody' }, streamText));
  }
  let paintQueued = false;
  function paintStream() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      const live = chat && running.get(chat.id);
      if (!live || !streamText || !streamText.isConnected) return;
      const stick = nearBottom();
      const shown = visibleSoFar(live.text || '');
      if (shown) streamText.innerHTML = renderMessage(shown);
      if (stick) toBottom();
    });
  }

  // 消息下面：练习题、没说完、出错、快捷回答、可以直接点的话、以前聊过的
  function afterEls(vis, busy) {
    const out = [];
    if (busy) return out;
    const last = vis[vis.length - 1];
    if (last && last.role === 'assistant' && !last.local) {
      if (last.error) {
        out.push(h('div', { className: 'chat-error', role: 'alert' },
          h('p', { className: 'status-line danger' }, icon('alert'), h('span', { text: last.error })),
          last.canRetry ? h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn quiet', text: COPY.retry, on: { click: () => retryLast() } })) : null));
        return out;
      }
      if (last.partial) {
        out.push(h('div', { className: 'chat-partial' }, h('span', { className: 'small', text: COPY.partial }),
          h('button', { type: 'button', className: 'text-btn accent', text: COPY.goOn, on: { click: () => send({ text: COPY.goOn }) } })));
      }
      if (last.practice && !last.practiceDone) out.push(practiceEl(last));
      if (chat.mode === 'quiz') {
        if (!chat.messages.some(m => m.quizSpec)) out.push(h('div', { className: 'chat-quick', role: 'group', 'aria-label': '快捷回答' },
          QUIZ_REPLIES.map(q => h('button', { type: 'button', className: 'chat-chip', text: q, on: { click: () => send({ text: q }) } }))));
        return out;
      }
      const quick = QUICK_REPLIES.filter(q => !(last.practice && !last.practiceDone && q === '出一道题考考我'));
      out.push(h('div', { className: 'chat-quick', role: 'group', 'aria-label': '快捷回答' },
        quick.map(q => h('button', { type: 'button', className: 'chat-chip', text: q, on: { click: () => send({ text: q }) } }))));
    } else if (!vis.some(m => m.role === 'user' && !m.local)) {
      const chips = chipsFor(chat.mode, profile, { noWork: !!chat.noWork });
      if (chips.length) {
        out.push(h('div', { className: 'chat-quick', role: 'group', 'aria-label': '可以这样问' },
          chips.map(q => h('button', { type: 'button', className: 'chat-chip', text: q, on: { click: () => send({ text: q }) } }))));
      }
      if (chat.mode === 'free') {
        out.push(h('div', { className: 'btn-row chat-quizgo' }, h('button', { type: 'button', className: 'text-btn accent', on: { click: () => ctx.go('chat', { mode: 'quiz', fresh: Date.now() }) } }, icon('print'), h('span', { text: '帮我出套题' }))));
        const past = (peek('chats', []) || []).filter(x => x && x.id !== chat.id).slice(0, 5);
        if (past.length) {
          out.push(h('section', { className: 'chat-past' }, h('h2', { className: 'sec-h', text: COPY.past }),
            h('ul', {}, past.map(x => h('li', {}, h('button', { type: 'button', className: 'chat-past-row', on: { click: () => ctx.go('chat', { chatId: x.id }) } },
              h('span', { className: 'chat-past-t', text: x.title || COPY.title }), h('span', { className: 'small', text: ago(x.updated || x.at) }), icon('chev')))))));
        }
      }
    }
    return out;
  }

  // ------------------------------------------------ 练习
  function practiceEl(m) {
    const p = m.practice;
    const box = h('div', { className: 'chat-practice' },
      h('p', { className: 'label', text: COPY.tryIt }),
      mathText(p.q, { tag: 'div', className: 'chat-pq' }));
    const v = vetted.get(m.at) || vetPractice(p);
    vetted.set(m.at, v);
    if (!v.ok) {
      // 老师写的答案和程序算的不一样：不让她做一道答案可能是错的题，请老师换一道
      box.append(h('p', { className: 'small', text: COPY.swapping }));
      if (!m.swapAsked) {
        m.swapAsked = true;
        setTimeout(() => send({ hidden: `（这一句是程序发的，她看不到。）你刚才出的练习题，程序算出来的答案是 ${v.computed}，和你写的 ${p.answer} 不一样。请换一道考同一个点的题，数字简单，答案自己算两遍。` }), 0);
      }
      return box;
    }
    const setup = practiceSetup(p);
    const host = h('div', { className: 'chat-kp' });
    box.append(host);
    if (setup.kind === 'text') {
      // 纸上作答：写好了对照答案，她自己说一样不一样
      let shown = false;
      const area = h('div', { className: 'chat-paper' });
      const btn = h('button', { type: 'button', className: 'btn quiet', text: '在纸上写好了，对照看', on: { click: () => {
        if (shown) return;
        shown = true;
        btn.hidden = true;
        area.append(h('p', {}, mathText(COPY.paperAnswer(p.answer))),
          h('div', { className: 'btn-row' },
            h('button', { type: 'button', className: 'btn', text: COPY.paperSame, on: { click: () => submitPractice(m, '', true) } }),
            h('button', { type: 'button', className: 'btn quiet', text: COPY.paperDiff, on: { click: () => submitPractice(m, '', false) } })));
      } } });
      host.append(btn, area);
      return box;
    }
    requestAnimationFrame(() => {
      if (!host.isConnected) return;
      try {
        answerW = createAnswer(host, { kind: setup.kind, options: setup.options, letters: setup.letters, variable: setup.variable, context: `${p.q || ''} ${p.answer || ''}`,
          onSubmit: given => submitPractice(m, typeof given === 'string' ? given : '', null) });
        // 小键盘比题目高得多：画好以后让题目和小键盘都露出来
        requestAnimationFrame(() => { try { box.scrollIntoView({ block: 'end', behavior: 'smooth' }); } catch (e) { toBottom(); } });
      } catch (e) { console.warn('keypad', e); }
    });
    return box;
  }

  async function submitPractice(m, given, self) {
    if (!chat || m.practiceDone) return;
    const p = m.practice;
    const setup = practiceSetup(p);
    let result = null;
    if (self === null) {
      try { result = check(given, p.answer, { kind: setup.kind, form: p.form || '' }); } catch (e) { result = { ok: null, reason: 'unreadable' }; }
    }
    const ok = self !== null ? !!self : result.ok;
    m.practiceDone = { given, ok, self: self === null ? null : !!self, reason: (result && result.reason) || '' };
    if (ok === true) ctx.toast(COPY.right);
    // 作答进 attempts：学情档案看近 14 天哪里还在错
    try {
      if (ctx.store && typeof ctx.store.addAttempt === 'function' && ok !== null) {
        const at = new Date().toISOString();
        await ctx.store.addAttempt({ itemId: chat.cardId || 'chat:' + chat.id, at, day: today(), kind: 'chat', q: p.q, given: given || (self ? p.answer : ''),
          ok, reason: m.practiceDone.reason, firstTry: true, hints: 0, tag: chat.tag || '', point: (chat.point && chat.point.name) || '' });
      }
    } catch (e) { console.warn('attempt', e); }
    const turn = answerTurn({ practice: p, given, result, self });
    send({ text: turn.content, display: turn.display });
  }

  // ------------------------------------------------ 发和收
  function syncBar() {
    const busy = !!(chat && running.get(chat.id));
    sendBtn.disabled = busy || (!input.value.trim() && !photo);
    holdBtn.disabled = busy;
    sendBtn.hidden = voiceMode && !photo && !input.value.trim();
    photoRow.hidden = !photo;
    if (photo) {
      photoRow.replaceChildren(h('img', { className: 'chat-photo-prev', src: photo, alt: '要发的照片' }),
        h('button', { type: 'button', className: 'text-btn', 'aria-label': COPY.removePhoto, on: { click: () => { photo = ''; syncBar(); } } }, icon('close')));
    }
  }

  function sendTyped() {
    const text = input.value.trim();
    if (!text && !photo) return;
    if (chat && running.get(chat.id)) return;
    input.value = '';
    fitInput();
    hearRow.hidden = true;
    const img = photo;
    photo = '';
    send({ text: text || COPY.photoDefault, image: img });
  }

  // 发一句：text 是发给老师的话；display 是她看到的（不传就和 text 一样）；hidden 是程序替她说的、她看不到的话
  async function send({ text = '', display, image = '', hidden = '' } = {}) {
    const c = chat;
    if (!c || running.get(c.id)) return;
    const at = new Date().toISOString();
    if (hidden) c.messages.push({ role: 'user', content: hidden, hidden: true, at });
    else {
      const content = image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] : text;
      const msg = { role: 'user', content, at };
      if (display !== undefined && display !== text) msg.display = display;
      c.messages.push(msg);
    }
    await ask(c);
  }

  async function ask(c) {
    const ctl = new AbortController();
    const live = { text: '', ctl };
    running.set(c.id, live);
    if (chat === c) render();
    saveChat(c);
    let reply = null, error = null;
    try {
      const prof = await ensureProfile();
      let cards = null;
      try { cards = ctx.store && typeof ctx.store.all === 'function' ? await ctx.store.all('items') : null; } catch (e) { cards = null; }
      const system = systemFor({ profile: prof, kv: ctx.kv, curriculum: ctx.curriculum, today: today(), mock: isMock(ctx), cards });
      reply = await ctx.ai.chat({ system, messages: apiMessages(c), signal: ctl.signal,
        onDelta: t => { live.text = t; if (chat === c) paintStream(); } });
    } catch (e) { error = e; }
    running.delete(c.id);
    const at = new Date().toISOString();
    if (error) {
      if (error.code === 'abort') {
        if (error.text) c.messages.push({ role: 'assistant', content: error.text, display: splitReply(error.text).display, partial: true, at });
      } else {
        c.messages.push({ role: 'assistant', content: '', failed: true, error: kidMessage(error, { where: 'chat' }) || kidMessage('http'), canRetry: canRetry(error), at });
        console.warn('chat', error.code, error.message);
      }
    } else {
      const raw = str(reply.text);
      const parts = splitReply(raw);
      const msg = { role: 'assistant', content: raw, display: parts.display, at };
      if (parts.practice) msg.practice = parts.practice;
      if (parts.quiz) msg.quizSpec = normalizeSpec(parts.quiz, ctx.curriculum);   // v0.8 要求问清楚了：接着出卷
      if (reply.partial) msg.partial = true;
      c.messages.push(msg);
      await saveNotes(c, parts.notes);
      // v0.7：她说了课上学到哪，老师写了【进度】，记成进度锚点
      if (parts.progress) {
        try { await ctx.kv.set('progress', { ...(peek('progress', {}) || {}), section: parts.progress, updated: at, from: 'chat' }); } catch (e) { console.warn('progress', e); }
      }
    }
    await saveChat(c);
    if (chat === c) render({ keepScroll: true });
    const last = c.messages[c.messages.length - 1];
    if (last && last.quizSpec && !last.quizState) startQuiz(c, last);
  }

  // ------------------------------------------------ v0.8 帮我出套题
  const quizJobs = new Map();   // msg.at -> { step, done, total }
  function quizCard(m) {
    const job = quizJobs.get(m.at);
    let status;
    if (m.quizState === 'done' && m.quizId) {
      status = h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn', on: { click: () => ctx.go('quiz', { id: m.quizId }) } }, icon('print'), h('span', { text: '打开试卷' })));
    } else if (m.quizState === 'failed') {
      status = [h('p', { className: 'small danger', text: m.quizError || '没出成，再试一次。' }),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn quiet', text: '再出一次', on: { click: () => { const c = chat; if (c) startQuiz(c, m); } } }))];
    } else if (job || m.quizState === 'making') {
      const t = !job || job.step === 'make' ? '我在出题，大约一分钟……' : `在核对答案 ${job.done || 0} / ${job.total || 0}……`;
      status = [h('p', { className: 'small dots', text: t }), job ? (job.fun || (job.fun = createWaitFun(ctx))) : null];
    } else {
      status = h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn quiet', text: '接着出', on: { click: () => { const c = chat; if (c) startQuiz(c, m); } } }));
    }
    return h('div', { className: 'chat-quiz' }, h('p', { className: 'label', text: m.quizSpec.title }), h('p', { className: 'small', text: specLine(m.quizSpec, ctx.curriculum) }), status);
  }
  async function startQuiz(c, m) {
    if (quizJobs.has(m.at)) return;
    const job = { step: 'make', done: 0, total: 0 };
    quizJobs.set(m.at, job);
    m.quizState = 'making';
    m.quizError = '';
    if (chat === c) render({ keepScroll: true });
    try {
      const prof = m.quizSpec.weak ? await ensureProfile() : null;
      const quiz = await makeQuiz(ctx, m.quizSpec, { weakText: prof ? str(prof.text) : '',
        onStep: (step, done, total) => { Object.assign(job, { step, done, total }); if (chat === c) render({ keepScroll: true }); } });
      const list = (peek('quizzes', []) || []).filter(x => x && x.id !== quiz.id);
      await ctx.kv.set('quizzes', [quiz, ...list].slice(0, QUIZ_CAP));
      m.quizId = quiz.id;
      m.quizState = 'done';
    } catch (e) {
      console.warn('quiz', e);
      m.quizState = 'failed';
      m.quizError = kidMessage(e, { where: 'chat' }) || '没出成，再试一次。';
    }
    quizJobs.delete(m.at);
    await saveChat(c);
    if (chat === c) render({ keepScroll: true });
  }

  function retryLast() {
    const c = chat;
    if (!c) return;
    while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant' && c.messages[c.messages.length - 1].failed) c.messages.pop();
    if (!c.messages.length || c.messages[c.messages.length - 1].role !== 'user') { render(); return; }
    ask(c);
  }

  // ------------------------------------------------ 输入框、照片、说话
  function fitInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(160, Math.max(44, input.scrollHeight)) + 'px';
  }
  input.addEventListener('input', () => { fitInput(); syncBar(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); sendTyped(); }
  });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const shot = await prepare(f, { maxSide: 1280, quality: 0.8, maxBytes: 600000 });
      photo = shot.dataURL;
      syncBar();
    } catch (e) { console.warn('photo', e); ctx.toast(COPY.photoFail); }
  });

  function setVoiceMode(on, remember) {
    voiceMode = !!on;
    if (remember) { try { localStorage.setItem(MODE_KEY, voiceMode ? 'voice' : 'text'); } catch (e) { /* fine */ } }
    input.hidden = voiceMode;
    holdBtn.hidden = !voiceMode;
    modeBtn.replaceChildren(icon(voiceMode ? 'keyboard' : 'mic'), h('span', { text: voiceMode ? COPY.toType : COPY.toVoice }));
    modeBtn.setAttribute('aria-label', voiceMode ? '改成打字' : '改成说话');
    syncBar();
    if (!voiceMode && remember) { try { input.focus(); } catch (e) { /* fine */ } }
  }
  function setMic(state) {
    holdBtn.classList.toggle('on', state === true || state === 'cancel');
    holdBtn.classList.toggle('cancel', state === 'cancel');
    holdBtn.classList.toggle('wait', state === 'wait');
    holdLabel.textContent = state === true ? COPY.holdUp : state === 'cancel' ? COPY.holdCancel : state === 'wait' ? COPY.holdWait : COPY.hold;
    live.hidden = !(state === true || state === 'cancel' || state === 'wait');
    live.classList.toggle('cancel', state === 'cancel');
    if (state === true && !live.textContent) live.textContent = COPY.liveHint;
    if (!state) live.textContent = '';
  }
  const joinText = (base, add) => (base && add ? base.replace(/\s+$/, '') + add : base || add || '');
  function voiceError(err) {
    if (err && err.name === 'NotAllowedError') return COPY.micDenied;
    if (err && typeof err.kid === 'string' && err.kid) return err.kid;
    return COPY.notHeard;
  }
  holdBtn.addEventListener('contextmenu', e => e.preventDefault());
  holdBtn.addEventListener('pointerdown', async e => {
    if ((chat && running.get(chat.id)) || rec) return;
    e.preventDefault();
    try { holdBtn.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    const r = { base: input.value, t0: Date.now(), y0: e.clientY, started: null, armed: false };
    rec = r;
    hearRow.hidden = true;
    setMic(true);
    try {
      // 前面不能有 await：豆包流式的 AudioContext 要在这次点按里建
      r.started = Promise.resolve(voice.start({ onPartial: t => { if (rec === r) { input.value = joinText(r.base, String(t || '')); live.textContent = input.value || COPY.liveHint; } } }));
      await r.started;
    } catch (err) {
      if (rec === r) { rec = null; setMic(false); input.value = r.base; ctx.toast(voiceError(err), 2500); }
    }
  });
  async function endHold(cancel) {
    const r = rec;
    if (!r) return;
    rec = null;
    const quick = Date.now() - r.t0 < 350;
    if (cancel || quick) {
      setMic(false);
      try { voice.cancel(); } catch (err) { /* dropped anyway */ }
      input.value = r.base;
      if (quick && !cancel) ctx.toast(COPY.tooShort, 2000);
      return;
    }
    setMic('wait');
    try {
      await r.started;
      const text = String((await voice.stop()) || '').trim();
      if (text) input.value = joinText(r.base, text);
      else if (input.value === r.base) ctx.toast(COPY.notHeard, 2000);
      // 说话模式：松开就发，像发语音消息；打字模式不会到这里
      if (input.value.trim() && input.value !== r.base) { setMic(false); sendTyped(); }
    } catch (err) {
      ctx.toast(voiceError(err), 2500);
    } finally {
      setMic(false);
      fitInput();
      syncBar();
    }
  }
  holdBtn.addEventListener('pointermove', e => {
    const r = rec;
    if (!r) return;
    const up = r.y0 - e.clientY > 60;
    if (up !== r.armed) { r.armed = up; setMic(up ? 'cancel' : true); }
  });
  holdBtn.addEventListener('pointerup', () => endHold(!!(rec && rec.armed)));
  holdBtn.addEventListener('pointercancel', () => endHold(true));
  setVoiceMode(voiceMode && voice.available(), false);

  // ------------------------------------------------ 开一段
  async function openChat(c, { intro = '' } = {}) {
    chat = c;
    if (intro && !c.messages.length) c.messages.push({ role: 'assistant', content: intro, display: intro, local: true, at: c.at });
    render();
  }

  function loadStored(id) {
    const c = peek('chat:' + id, null);
    return c && Array.isArray(c.messages) ? c : null;
  }

  function startFresh() {
    ctx.go('chat', { mode: 'free', fresh: Date.now() });
  }

  async function show(params = {}, { from } = {}) {
    const token = ++showToken;
    backLabel.textContent = !from || from === 'home' ? COPY.home : COPY.back;
    hearRow.hidden = true;
    mode = ['free', 'probe', 'problem', 'quiz'].includes(params.mode) ? params.mode : 'free';
    // 打开以前的对话
    let id = str(params.chatId);
    if (!id && !params.fresh) id = resumable(peek('chats', []), { mode, cardId: str(params.cardId) });
    if (id) {
      const c = (chat && chat.id === id) ? chat : loadStored(id);
      // 同一张卡上又讲了一道新题（同坑合并）：题目不一样就另开一段
      const other = c && mode === 'problem' && params.problem && params.problem.stem && c.stem !== params.problem.stem;
      if (c && !other && mode === 'problem') refreshProblemChat(c, params);   // v0.6.0：讲题中途又来问，上下文换成她现在停的这一步
      if (c && !other) { chat = c; render(); ensureProfile().then(() => { if (chat === c && token === showToken) render({ keepScroll: true }); }); return; }
    }
    chat = null;
    list.replaceChildren(h('div', { className: 'sk-bars', 'aria-hidden': 'true' }, [70, 52].map(w => h('i', { style: `width:${w}%` }))));
    after.replaceChildren();
    top.replaceChildren();

    if (mode === 'problem') {
      let card = null;
      try { card = params.cardId && ctx.store ? await ctx.store.get('items', params.cardId) : null; } catch (e) { card = null; }
      if (token !== showToken) return;
      // 讲题最后一屏、复习“问我这道”传来刚做的那道题和诊断；卡详情只有卡（卡上存的是第一次掉进这个坑的那道）
      const src = problemSource(card, params);
      if (!src) { await openChat(newChat({ mode: 'free' }), { intro: COPY.missingCard }); ensureProfile().then(() => token === showToken && render()); return; }
      const { problem, diagnosis } = src;
      // v0.6.0：讲题中途来问带着 step（她停在哪一步）和 chatId（这道题第一次问时讲题屏生成的；已经有这一段就不拿它另开）
      const given = str(params.chatId);
      const ownId = given && !loadStored(given) ? given : undefined;
      const c = newChat({ id: ownId, mode: 'problem', cardId: src.cardId, context: problemContext({ problem: contextProblem(problem), diagnosis, step: str(params.step) }), stem: problem.stem || '', tag: src.tag });
      if (str(params.step)) c.steps = [str(params.step)];
      c.herAnswer = str(problem.her_answer);
      if (problem.useWork === false) { c.herAnswer = ''; c.noWork = true; }   // 订正过、选了直接讲：卷子上的已经是改过的答案，不当她当时写的
      // v0.7 我的问题“和我弄清楚”：老师先开口
      if (str(params.settle)) { await openChat(c); send({ hidden: settleUser(str(params.settle)) }); return; }
      await openChat(c, { intro: c.noWork ? COPY.introDirect : COPY.introProblem });
      return;
    }

    // v0.8 帮我出套题：老师先开口问清楚要求
    if (mode === 'quiz') {
      const c = newChat({ mode: 'quiz' });
      await openChat(c);
      send({ hidden: quizUser() });
      return;
    }

    if (mode === 'probe') {
      const prof = await ensureProfile();
      if (token !== showToken) return;
      // 没带点：先看老师的笔记本里想聊的，再看学情档案
      const note = latestNote(peek(NOTES_KEY, []), { mock: isMock(ctx) });
      const point = params.point && params.point.name ? params.point : (focusPoint(note, { today: today() }) || probePoint(prof, { today: today() }) || (prof.weak || [])[0]);
      if (point) {
        const dayKey = point.kind === 'build' || point.kind === 'progress' ? 'checkinDay' : 'probeDay';   // v0.7 课本的小卡另算一天
        try { await ctx.kv.set(dayKey, today()); } catch (e) { console.warn(dayKey, e); }
        const c = newChat({ mode: 'probe', point });
        await openChat(c);
        send({ hidden: probeUser(point) });
        return;
      }
      mode = 'free';
    }

    await openChat(newChat({ mode: 'free' }), { intro: COPY.introFree });
    ensureProfile().then(() => { if (token === showToken) render({ keepScroll: true }); });
  }

  function hide() {
    showToken++;
    destroyAnswer();
    if (rec) { rec = null; setMic(false); try { voice.cancel(); } catch (e) { /* dropped */ } }
    // 正在回答的不停：答完自己存好，回来能看到
  }

  return { show, hide, onResume() { if (chat) render({ keepScroll: true }); } };
}
