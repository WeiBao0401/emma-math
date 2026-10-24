// The private teacher's voice in free conversation (design/teacher-chat.md): how a seasoned teacher talks with Emma,
// what she knows about her, and the two hidden lines a reply may end with. Pure functions, no DOM, no network.
//
//   teacherSystem({ profileText, progress, exam, tags }) -> string    system prompt for every chat turn
//   probeUser(point) -> string            the hidden first user turn when the teacher starts a talk on a weak point
//   problemContext({ problem, diagnosis }) -> string   hidden context when she asks about a problem just explained
//   splitReply(text) -> { display, practice, notes }   strips 【练习】 and 【记录】 lines; display is what she reads
//     practice: { q, answer, answer_kind, form } | null      notes: [{ kind: 'gap' | 'ok', tag, point, note }]
//   visibleSoFar(text) -> string          while streaming: the text without a started hidden line
//   QUICK_REPLIES                         the buttons under a teacher message
//   trimHistory(messages, maxChars) -> messages   keeps the latest turns within a size, always starts with a user turn
//
// The hidden lines are plain text the model writes at the very end ("【练习】{json}", "【记录】{json}"), so they also
// work when streaming; JSON inside may have single LaTeX backslashes, repaired like every other reply.
import { parseModelJSON } from './ai.js';

export const QUICK_REPLIES = ['懂了', '还是不懂', '举个例子', '出一道题考考我'];

export function teacherSystem({ profileText = '', progress = '', exam = '', tags = [] } = {}) {
  const tagList = tags.length ? tags.map(t => `${t.id}：${t.name}`).join('\n') : '（没有）';
  return `你是 Emma 的私人数学老师。她是北京一所初中的初一女生，用 2024 版人教版七年级上册。你已经教了她一段时间，了解她（见最后“你知道的她”）。

你的目标：让她真正弄懂，以后自己会做。不是把题做出来给她看。

怎么教（像一位很有经验、很耐心的老师，面对面坐在她旁边）：
1. 先弄清她卡在哪。她问的问题背后，常常有一个没想通的地方。先问一个小问题，或者请她说说她是怎么想的，再对准那一点讲。她已经说清楚了，就直接讲。
2. 一次只讲一个点，3 到 6 句话。讲完停下来：用一个小问题确认她懂没懂，或者请她自己做关键的那一步。不要一口气讲完整套。
3. 多用具体的数、数轴、画图（用文字描述图）、代回去检验，少用术语。用课本里的叫法（有理数、乘方、去括号、合并同类项、等式的性质、移项）。
4. 她说不懂，就换一种讲法，别把原话再说一遍。
5. 联系“你知道的她”：她以前错过的坑、已经跨过去的、最近在学的，自然地提一句，比如“这和你上周那道 \\(-2(a-3b)\\) 是同一个坑”。
6. 她答对了，具体地说她哪里做对了；答错了，先说她做对的部分，再指出是哪一步，问她这一步是怎么想的。不说“粗心”“聪明”“超级棒”“很简单”“又错了”。
7. 她拍了作业题来问：先陪她做，关键一步让她自己来；她试过还是不会，再完整讲清楚。
8. 只聊数学和怎么学数学。别的话题，温和地拉回来。
9. 不编造。拿不准就直说，请她问学校老师。

格式：中文，句子短。数学式写在行内的 \\( \\) 里，不用 \\[ \\]。要点可以用“- ”开头列，最多 4 条。不用标题、不用表格、不用加粗。

两个隐藏行（她看不到，程序处理，写在回复最后，每种最多一行）：
- 她说“出一道题考考我”，或者你觉得该让她当场练一下时，最后一行写
【练习】{"q":"题目，数学式用 \\\\( \\\\)","answer":"只写最后结果，比如 -16、4a+3b、x=2、3或7","answer_kind":"number|expr|equation|set|choice|compare|text","form":""}
题目只考你们刚聊的那个点，数字简单，答案自己算两遍。出了题，正文里就不要再写答案。
- 这一轮你看出她哪里没懂、或者哪里其实懂了，最后一行写
【记录】{"kind":"gap 或 ok","tag":"从下面的错因标签里选一个 id，没有合适的写空","point":"知识点，一句话","note":"你看到的证据，一句话"}

你知道的她：
${profileText || '还不太了解她。多问一句她是怎么想的。'}

现在学到：${progress || '不确定，大约在第三章“代数式”'}
${exam ? `考试：${exam}` : ''}
错因标签：
${tagList}`;
}

export function probeUser(point = {}) {
  const name = point.name || point.point || '最近学的内容';
  const evidence = (point.evidence || []).slice(0, 3).join('；');
  return `（这一句是程序发的，她看不到。）请你主动开启一段 3 分钟左右的小对话，帮她弄清这个点：${name}。
${evidence ? `你看到的证据：${evidence}。` : ''}
第一句打个招呼，用一两句话说为什么想和她聊这个（可以提证据，语气轻松，不像在检查）。然后问她一个能看出她怎么想的小问题，等她回答。这一条不要讲解，也不要出【练习】。`;
}

export function problemContext({ problem = {}, diagnosis = {} } = {}) {
  const lines = [
    '（这一段是程序发的，她看不到。）她刚在 App 里讲完一道错题，现在想接着问。这道题的情况：',
    `题目：${problem.stem || ''}`,
    problem.options && problem.options.length ? `选项：${problem.options.join('；')}` : '',
    problem.her_work && problem.her_work.length ? `她当时写的：${problem.her_work.join(' / ')}` : '',
    problem.her_answer ? `她的答案：${problem.her_answer}` : '',
    diagnosis.answer ? `正确答案：${diagnosis.answer}` : '',
    diagnosis.wrong_step ? `她错在：${diagnosis.wrong_step}` : '',
    diagnosis.why ? `她可能是这样想的：${diagnosis.why}` : '',
    diagnosis.remember ? `讲题时给她的要点：${diagnosis.remember}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

const HIDDEN = /^[ \t]*【(练习|记录)】\s*(\{[\s\S]*?\})\s*$/gm;

function parseLoose(json) {
  try { return parseModelJSON(json); } catch { return null; }
}

export function splitReply(text) {
  const raw = String(text ?? '');
  let practice = null;
  const notes = [];
  const display = raw.replace(HIDDEN, (_, kind, json) => {
    const o = parseLoose(json);
    if (o && kind === '练习' && String(o.q || '').trim() && String(o.answer || '').trim() && !practice) {
      practice = { q: String(o.q).trim(), answer: String(o.answer).trim(), answer_kind: String(o.answer_kind || '').trim(), form: String(o.form || '').trim() };
    } else if (o && kind === '记录' && (o.kind === 'gap' || o.kind === 'ok')) {
      notes.push({ kind: o.kind, tag: String(o.tag || '').trim(), point: String(o.point || '').trim(), note: String(o.note || '').trim() });
    }
    return '';
  }).replace(/【(练习|记录)】[\s\S]*$/, '').replace(/\n{3,}/g, '\n\n').trim();
  return { display, practice, notes };
}

// While the reply streams in, a hidden line may be half written: show everything before it
export function visibleSoFar(text) {
  const s = String(text ?? '');
  const i = s.search(/【(练|记)|【$/);
  return (i >= 0 ? s.slice(0, i) : s).trimEnd();
}

export function trimHistory(messages = [], maxChars = 12000) {
  const out = [];
  let size = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const len = typeof m.content === 'string' ? m.content.length : 2000;   // a turn with a photo counts as 2000
    if (out.length && size + len > maxChars) break;
    out.unshift(m);
    size += len;
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
