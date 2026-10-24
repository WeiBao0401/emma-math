// 问我：Emma 的私人老师（CONTRACTS 14-17，design/teacher-chat.md）。她打字、说话、拍题问一个数学问题，老师（gpt-5.4，
// 流式）一句句地答。老师先弄清她卡在哪，一次讲一个点，讲完用一个小问题或一道题确认；她当场作答，程序判对错；对话里看出的
// “哪里没懂 / 哪里懂了”记进学情档案，下次讲的时候连起来。
// 负责：接线的人（v0.3 的 chat-ui agent 没交付，接线时补写）。
//
// 路由 chat，params：{ mode: 'free' | 'probe' | 'problem', point?, cardId?, chatId?, problem?, diagnosis?, fresh? }
//   problem、diagnosis：讲题最后一屏传刚讲的那道（同坑合并时卡上存的是第一道）；fresh：不接着上一段，另开新的
//   free     她自己问（首页“有问题，问我”）。30 分钟内问过，接着上一段聊；导航栏“新问题”另开一段
//   probe    老师主动开场（首页小卡“想和你聊 3 分钟：…”）：probeUser(point) 隐藏发出，她只看到老师的话；记 kv 'probeDay'
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
//     systemFor({ profile, kv, curriculum, today }) -> teacherSystem(...) 的系统提示
//     resumable(chats, { mode, cardId, now }) -> 可以接着聊的那一段的 id | ''
//     chipsFor(mode, profile) -> [她可以直接点的一句话]
//
// kv：'chats'（[{ id, at, updated, title, mode, cardId }] 最近 50 个）、'chat:<id>'（整段对话）、'observations'（【记录】，
// profile.addObservations）、'probeDay'。作答写进 attempts（kind 'chat'，itemId 是卡的 id 或 'chat:<对话 id>'，带 tag）。
// 依赖：ui-dom、teacher、md、voice、profile、keypad、mathcheck、mathview、image、kid-errors、notebook。
import { h, icon, mathText, ago } from './ui-dom.js';
import { teacherSystem, probeUser, problemContext, splitReply, visibleSoFar, QUICK_REPLIES, trimHistory } from './teacher.js';
import { renderMessage, plainMessage } from './md.js';
import { createRecorder, transcribe } from './voice.js';
import { loadProfile, probePoint, addObservations } from './profile.js';
import { createAnswer } from './keypad.js';
import { check, compute } from './mathcheck.js';
import { plain } from './mathview.js';
import { prepare } from './image.js';
import { kidMessage, canRetry } from './kid-errors.js';
import { dayOf } from './notebook.js';
import { newId } from './db.js';

export const CHATS_CAP = 50;
export const HISTORY_CHARS = 12000;
export const RESUME_MS = 30 * 60 * 1000;
const KINDS = new Set(['number', 'expr', 'equation', 'set', 'choice', 'compare', 'text']);

// 她看到的字：弯引号，不用破折号和感叹号，句子短；App 自称“我”
export const COPY = {
  title: '问我',
  introFree: '想问什么都可以：哪道题不会、哪一步没想通、为什么要这样做。打字、说话、拍照都行。',
  introProblem: '这道题还有哪里不明白？直接问我，也可以说说你当时是怎么想的。',
  aboutProblem: '我们在说这道题',
  herAnswer: '你当时写的：',
  thinking: '我想一想',
  partial: '我好像没说完。',
  goOn: '接着说',
  retry: '再试一次',
  placeholder: '想问什么，写在这里',
  send: '发给老师',
  recording: '在听，说完点“说完了”。',
  stopRec: '说完了',
  cancelRec: '不要了',
  listening: '正在听你说的话',
  heard: '是这样说的吗？看一眼，没问题就发给我。',
  micDenied: '麦克风没打开。可以打字问我。',
  micNone: '这台 iPad 现在录不了音。可以打字问我。',
  tooShort: '太短了。按一下开始说，说完再按一下。',
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
  const m = ['free', 'probe', 'problem'].includes(mode) ? mode : 'free';
  const p = point && typeof point === 'object'
    ? { name: str(point.name || point.point), tag: str(point.tag), evidence: Array.isArray(point.evidence) ? point.evidence.slice(0, 3).map(str) : [] }
    : null;
  return { id, mode: m, point: p, cardId: str(cardId), context: str(context), stem: str(stem), tag: str(tag || (p && p.tag)), at, updated: at, messages: [] };
}

export function visibleMessages(chat) {
  return ((chat && chat.messages) || []).filter(m => m && !m.hidden);
}

export function chatTitle(chat = {}) {
  if (chat.mode === 'probe' && chat.point && chat.point.name) return clip(`聊聊：${chat.point.name}`, 20);
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

export function systemFor({ profile = null, kv = null, curriculum = null, today = dayOf() } = {}) {
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
  return teacherSystem({ profileText: (profile && profile.text) || '', progress, exam, tags });
}

export function chipsFor(mode, profile) {
  if (mode === 'problem') return ['我还是不明白错在哪', '换个讲法讲一遍', '出一道类似的题考考我'];
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
  const micBtn = h('button', { type: 'button', className: 'chat-icon-btn chat-mic', 'aria-label': '说话', on: { click: () => toggleRec() } }, icon('mic'));
  const sendBtn = h('button', { type: 'button', className: 'chat-send', 'aria-label': COPY.send, on: { click: () => sendTyped() } }, icon('send'));
  const photoRow = h('div', { className: 'chat-photo-row', hidden: true });
  const recLevel = h('span', { className: 'chat-level', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5, 6].map(() => h('i')));
  const recTime = h('span', { className: 'chat-rec-time num', text: '0:00' });
  const recRow = h('div', { className: 'chat-rec', hidden: true },
    h('span', { className: 'chat-rec-dot', 'aria-hidden': 'true' }), recLevel, recTime,
    h('span', { className: 'chat-rec-msg small', text: COPY.recording }),
    h('span', { className: 'chat-rec-btns' },
      h('button', { type: 'button', className: 'text-btn', text: COPY.cancelRec, on: { click: () => cancelRec() } }),
      h('button', { type: 'button', className: 'btn chat-rec-stop', on: { click: () => toggleRec() } }, icon('stop'), h('span', { text: COPY.stopRec }))));
  const hearRow = h('p', { className: 'small chat-hear', hidden: true, role: 'status' });
  const inputRow = h('div', { className: 'chat-input-row' }, camBtn, input, micBtn, sendBtn);
  const bar = h('div', { className: 'ebar chat-bar' }, h('div', { className: 'inner' }, photoRow, recRow, hearRow, inputRow));
  root.append(navbar, page, bar, fileIn);

  // ------------------------------------------------ 状态
  let chat = null;              // 当前这一段
  let profile = null;
  let photo = '';               // 要和下一句一起发的照片（dataURL）
  let answerW = null;           // 当前练习题的小键盘
  let rec = null, recRaf = 0;
  let listening = null;         // 转文字时的 AbortController
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
      return h('div', { className: 'chat-msg t' + (m.local ? ' local' : '') }, text, showPast ? pastPractice(m) : null);
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
    return h('div', { className: 'chat-msg t streaming' }, streamText);
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
      const quick = QUICK_REPLIES.filter(q => !(last.practice && !last.practiceDone && q === '出一道题考考我'));
      out.push(h('div', { className: 'chat-quick', role: 'group', 'aria-label': '快捷回答' },
        quick.map(q => h('button', { type: 'button', className: 'chat-chip', text: q, on: { click: () => send({ text: q }) } }))));
    } else if (!vis.some(m => m.role === 'user' && !m.local)) {
      const chips = chipsFor(chat.mode, profile);
      if (chips.length) {
        out.push(h('div', { className: 'chat-quick', role: 'group', 'aria-label': '可以这样问' },
          chips.map(q => h('button', { type: 'button', className: 'chat-chip', text: q, on: { click: () => send({ text: q }) } }))));
      }
      if (chat.mode === 'free') {
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
        answerW = createAnswer(host, { kind: setup.kind, options: setup.options, letters: setup.letters, variable: setup.variable,
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
    micBtn.disabled = !!listening;
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
      const system = systemFor({ profile: prof, kv: ctx.kv, curriculum: ctx.curriculum, today: today() });
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
      if (reply.partial) msg.partial = true;
      c.messages.push(msg);
      await saveNotes(c, parts.notes);
    }
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

  function recUI(on) {
    recRow.hidden = !on;
    inputRow.hidden = on;
    cancelAnimationFrame(recRaf);
    if (!on) return;
    const bars = [...recLevel.children];
    const hist = bars.map(() => 0);
    const tick = () => {
      if (!rec || rec.state() !== 'recording') return;
      hist.shift(); hist.push(rec.level());
      bars.forEach((b, i) => { b.style.transform = `scaleY(${0.15 + hist[i] * 0.85})`; });
      const s = Math.floor(rec.elapsed() / 1000);
      recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      recRaf = requestAnimationFrame(tick);
    };
    recRaf = requestAnimationFrame(tick);
  }

  async function toggleRec() {
    if (listening) return;
    if (rec && rec.state() === 'recording') {
      let blob;
      try { blob = await rec.stop(); } catch (e) { recUI(false); if (e.code === 'short') ctx.toast(COPY.tooShort); return; }
      recUI(false);
      await heard(blob);
      return;
    }
    if (rec && rec.state() !== 'idle') return;
    rec = createRecorder({ maxMs: 60000, onAutoStop: b => { recUI(false); if (b instanceof Blob) heard(b); } });
    try {
      await rec.start();
      recUI(true);
    } catch (e) {
      recUI(false);
      ctx.toast(e.code === 'denied' ? COPY.micDenied : e.code === 'abort' ? '' : COPY.micNone, 3000);
    }
  }
  function cancelRec() { if (rec) rec.cancel(); recUI(false); }

  async function heard(blob) {
    const ctl = listening = new AbortController();
    hearRow.hidden = false;
    hearRow.className = 'small chat-hear dots';
    hearRow.textContent = COPY.listening;
    syncBar();
    try {
      const text = await transcribe(ctx, blob, { signal: ctl.signal });
      if (listening !== ctl) return;
      if (text) {
        input.value = input.value.trim() ? `${input.value.trim()} ${text}` : text;
        fitInput();
        hearRow.className = 'small chat-hear';
        hearRow.textContent = COPY.heard;
      } else {
        hearRow.className = 'small chat-hear';
        hearRow.textContent = COPY.tooShort;
      }
    } catch (e) {
      if (listening !== ctl) return;
      hearRow.className = 'small chat-hear danger';
      hearRow.textContent = e.code === 'abort' ? '' : kidMessage(e, { where: 'listen' });
      hearRow.hidden = !hearRow.textContent;
    } finally {
      if (listening === ctl) listening = null;
      syncBar();
    }
  }

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
    mode = ['free', 'probe', 'problem'].includes(params.mode) ? params.mode : 'free';
    // 打开以前的对话
    let id = str(params.chatId);
    if (!id && !params.fresh) id = resumable(peek('chats', []), { mode, cardId: str(params.cardId) });
    if (id) {
      const c = (chat && chat.id === id) ? chat : loadStored(id);
      // 同一张卡上又讲了一道新题（同坑合并）：题目不一样就另开一段
      const other = c && mode === 'problem' && params.problem && params.problem.stem && c.stem !== params.problem.stem;
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
      if (!card) { await openChat(newChat({ mode: 'free' }), { intro: COPY.missingCard }); ensureProfile().then(() => token === showToken && render()); return; }
      // 讲题最后一屏传来刚讲的那道题和诊断；卡详情只有卡（卡上存的是第一次掉进这个坑的那道）
      const problem = (params.problem && typeof params.problem === 'object' ? params.problem : card.problem) || {};
      const diagnosis = (params.diagnosis && typeof params.diagnosis === 'object' ? params.diagnosis : card.diagnosis) || {};
      const c = newChat({ mode: 'problem', cardId: card.id, context: problemContext({ problem, diagnosis }), stem: problem.stem || '', tag: card.tag || diagnosis.tag || '' });
      c.herAnswer = str(problem.her_answer);
      await openChat(c, { intro: COPY.introProblem });
      return;
    }

    if (mode === 'probe') {
      const prof = await ensureProfile();
      if (token !== showToken) return;
      const point = params.point && params.point.name ? params.point : (probePoint(prof, { today: today() }) || (prof.weak || [])[0]);
      if (point) {
        try { await ctx.kv.set('probeDay', today()); } catch (e) { console.warn('probeDay', e); }
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
    if (rec && rec.state() !== 'idle') cancelRec();
    if (listening) { listening.abort(); listening = null; }
    // 正在回答的不停：答完自己存好，回来能看到
  }

  return { show, hide, onResume() { if (chat) render({ keepScroll: true }); } };
}
