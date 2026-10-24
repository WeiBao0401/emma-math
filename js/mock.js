// Mock answers for every AI task, same shapes as the real ones, so the whole app runs with settings.mock on: no
// request, no Key, no cost (家长区“模拟模式”、?mock=1、界面开发、浏览器检查).
// 负责：AI 层 agent。CONTRACTS.md 第 4 节“模拟模式”。ai.js 负责等 300 到 900 毫秒，这里只给内容。
//
// 内容来自比拼用的仿真作业（bakeoff/truth.json，程序生成的测试数据，不是学生数据）：
//   powers    −3² 当成 (−3)²（t1 第 2 题）          order     −6÷2×⅓ 先算了乘法（t1 第 5 题）
//   brackets  −2(a−3b) 去括号变号（t2 第 1 题）       equation  去分母漏乘右边的 1（t3）
//   geometry  点在直线上，漏了一种位置，半对（t5 第 7 题）
//   wordproblem  横着拍的应用题：每组 7 人余 3 人、每组 8 人少 5 人，她列成 7x−3=8x+5（“余下”“少”的加减反了），
//                解出 x=−8 又写成“共分 8 组”。答案 8，错因审题（v0.3.1：以前这页的诊断会套成乘方题）
//
// 另有一页“拿不准”（mockCase 'unsure'，v0.3.1）：一道计算题，模拟的讲题答案写错了（最后一步把 −9 减成了加），
//   程序算出来对不上，pipeline 再换备用模型也一样，判成 unsure，界面进“问学校老师”，不讲。它不在 TOPICS 里：
//   TOPICS 的每道题答案都要核对得上（tests/ai.test.mjs）。
//
// 导出
//   TOPICS                                  ['powers', 'order', 'brackets', 'equation', 'geometry', 'wordproblem']
//   RECOGNIZE_CASES                         看照片能模拟的页：'' 默认（练习册 t1）| 'brackets' | 'equation' | 'half' |
//                                           'sideways' | 'ungraded' | 'unclear' | 'empty' | 'unsure'（家长区下拉框列的就是这些）
//   UNLISTED_CASES                          []：能用但下拉框里没有名字的页（'unsure' 0.3.1 起进了下拉框）
//   UNSURE_STEM                             'unsure' 那页打叉的那道题（测试用）
//   topicOf(text) -> topic                  从发给 AI 的文字里认出是哪道仿真题，认不出就是 'powers'
//                                           （“每组”“余下”是 wordproblem）
//   mockAnswer(task, { text, images, mockCase }) -> object   每次一份新的对象，随便改
//     task：recognize | explain | variants | solve | hint | reflect（别的任务给 {}）
//     mockCase：settings.mockCase。看照片时选页（见上），其他任务时可以直接写题目名（'order' 等）；
//     'unsure' 时讲题（explain）一律给写错答案的那份诊断，题目是 UNSURE_STEM 时也是
//   mockText(task, { text, images, mockCase }) -> string     要纯文字的任务（ask 的 raw）：listen 给 MOCK_TRANSCRIPT
//   MOCK_TRANSCRIPT                         模拟的录音转写：“老师，负三的平方为什么是负九？”
//   CHAT_CASES                              mockChat 认的场景名（settings.mockCase 写其中一个就固定用那一段）
//   mockChat({ messages, mockCase }) -> string   v0.3 私人老师的假回答（ai.chat 每 40 毫秒流出一小段）。按对话认场景：
//     probe     第一条是 teacher.js probeUser 发的（“主动开启”）：打招呼、说为什么想聊、只问一个小问题，不讲、不出题
//     problem   对话里有 problemContext（“讲完一道错题”）、老师还没说过话：先问她卡在哪一步
//     free      问到 −3²（平方、乘方、负三……）：讲一个点，带【练习】计算 \(-4^2\) 和【记录】gap
//     retry     “还是不懂”：换一种讲法（相反数按钮），带【记录】
//     example   “举个例子”：几组对比           quiz   “出一道题考考我”：只出【练习】
//     gotit     “懂了”：用一个小问题确认         right / wrong   她报了练习的结果（“我的答案……”，带“不对”“错”算 wrong）
//     photo     只发了照片：先问她第一步打算怎么做    other   别的问题：先弄清她卡在哪
//     对话里的题是别的仿真题（去括号、去分母、乘除顺序、几何、分组应用题）时，free、retry、quiz 用那道题的讲法和同构题
//
// 形状（和 bakeoff/prompts/*.md 一致，另加比拼报告“要改进的地方”第 2 条的 answer_kind）
//   recognize  { graded, rotation, page, problems: [{ no, type, stem, options, figure, her_work, her_answer, mark,
//                teacher_note, circled, unclear }] }
//   explain    prompts.js diagnoseSystem 的形状：{ answer, answer_kind, form, unit, solution, wrong_line, wrong_step,
//                error_type, tag, section, why, hint1, hint2, explain, self_explain, remember, twin, doubt }
//   variants   { variants: [{ level: 同构 | 近变式 | 辨析 | 远变式, q, answer, answer_kind, form, unit, trap, trap_answer, steps }] }
//   solve      { answer, answer_kind, form, unit, steps, unsure }：答的是发来的那道题（twin、变式题都认得）
//   hint       { hint }
//   reflect    { summary, strengths, focus, next }
// answer 只写结果；answer_kind 是 mathcheck.js 的 kind（number | expr | equation | set | choice | compare | text），
// 所以模拟模式下程序核对也能走通（测试检查每道题 mathcheck 算出来和 answer 一致）。
// 依赖：无。

const L = String.raw;   // LaTeX with single backslashes, exactly what a parsed reply holds
const copy = o => JSON.parse(JSON.stringify(o));

export const TOPICS = ['powers', 'order', 'brackets', 'equation', 'geometry', 'wordproblem'];
export const RECOGNIZE_CASES = ['', 'brackets', 'equation', 'half', 'sideways', 'ungraded', 'unclear', 'empty', 'unsure'];
// 能用的模拟页，但家长区下拉框还没有它的中文名（ui-parent MOCK_CASE_LABELS 加上以后挪进 RECOGNIZE_CASES，parent.test 查每页都有名字）
export const UNLISTED_CASES = [];
export const UNSURE_STEM = L`\((-2)^3\times\frac{1}{4}-(-3)^2=\)`;

const P = (no, type, stem, her_answer, mark, extra = {}) => ({
  no, type, stem, options: [], figure: '', her_work: [], her_answer, mark, teacher_note: '', circled: '', unclear: false, ...extra,
});

// ---------------------------------------------------------------- recognize: the pages
const PAGE_T1 = {
  graded: true, rotation: 0, page: '练习册',
  problems: [
    P('(1)', '计算', L`\((-8)+5=\)`, '-3', 'right'),
    P('(2)', '计算', L`\(-3^2=\)`, '9', 'wrong'),
    P('(3)', '计算', L`\((-2)^3=\)`, '-8', 'right'),
    P('(4)', '计算', L`\(|-5|-|3|=\)`, '2', 'right'),
    P('(5)', '计算', L`\(-6\div 2\times\frac{1}{3}=\)`, '-9', 'wrong'),
    P('(6)', '计算', L`\(\frac{-1}{2}\times(-4)=\)`, '2', 'right'),
  ],
};
const PAGES = {
  '': PAGE_T1,
  brackets: {
    graded: true, rotation: 0, page: '作业本',
    problems: [
      P('1', '化简', L`化简：\(3(2a-b)-2(a-3b)\)`, L`\(4a-9b\)`, 'wrong', {
        her_work: [L`解：原式 \(=6a-3b-2a-6b\)`, L`\(=4a-9b\)`], teacher_note: L`\(-2\times(-3b)\) 是多少？`, circled: '-6b' }),
      P('2', '化简', L`化简：\(5x-(2x-1)\)`, L`\(3x+1\)`, 'right', { her_work: [L`解：原式 \(=5x-2x+1\)`, L`\(=3x+1\)`] }),
    ],
  },
  equation: {
    graded: true, rotation: 0, page: '作业本',
    problems: [
      P('1', '解方程', L`解方程：\(\frac{x-1}{2}-\frac{2x+1}{3}=1\)`, L`\(x=-6\)`, 'wrong', {
        her_work: [L`解：去分母，得 \(3(x-1)-2(2x+1)=1\)`, L`去括号，得 \(3x-3-4x-2=1\)`, L`移项合并，得 \(-x=6\)`, L`\(x=-6\)`],
        teacher_note: '?', circled: '=1' }),
    ],
  },
  half: {
    graded: true, rotation: 0, page: '作业本',
    problems: [
      P('7', '几何', L`已知线段 \(AB=10\) cm，点 \(C\) 在直线 \(AB\) 上，\(BC=4\) cm，点 \(M\) 是线段 \(AC\) 的中点，求线段 \(AM\) 的长。`,
        '3 cm', 'half', {
          figure: '一条直线上从左到右依次是 A、M、C、B 四个点。',
          her_work: [L`解：因为 \(AB=10\)，\(BC=4\)，`, L`所以 \(AC=AB-BC=6\)，`, L`因为 \(M\) 是 \(AC\) 的中点，所以 \(AM=3\) cm。`],
          teacher_note: '-2\n点 C 一定在 A、B 之间吗？' }),
    ],
  },
  sideways: {
    graded: true, rotation: 90, page: '作业本',
    problems: [
      P('', '应用题', '某班学生分组活动，每组 7 人，则余下 3 人；每组 8 人，则少 5 人。这个班共分几组？', '共分 8 组。', 'wrong', {
        her_work: ['解：设共分 x 组。', L`\(7x-3=8x+5\)`, L`\(7x-8x=5+3\)`, L`\(-x=8\)，\(x=-8\)`, '答：共分 8 组。'],
        teacher_note: '组数能是负数吗？“余”和“少”再读一读' }),
    ],
  },
  ungraded: {
    graded: false, rotation: 0, page: '作业本',
    problems: [
      P('1', '计算', L`计算：\((-12)\times(\frac{1}{4}-\frac{1}{3}+\frac{1}{2})\)`, '-5', 'none', { her_work: ['= -3+4-6', '= -5'] }),
      P('2', '计算', L`计算：\((-1)^{2026}-|-2|=\)`, '', 'none'),
    ],
  },
  empty: { graded: false, rotation: 0, page: '其他', problems: [] },
  // 拿不准：第 2 题她把 (−3)² 算成 6（底数乘指数），得 −8；程序算是 −11；模拟的讲题答案写成了 7（见 SHAKY）。三个都不一样
  unsure: {
    graded: true, rotation: 0, page: '练习册',
    problems: [
      P('1', '计算', L`\((-1)^{3}+|-2|=\)`, '1', 'right'),
      P('2', '计算', UNSURE_STEM, '-8', 'wrong', {
        her_work: [L`\(=-8\times\frac{1}{4}-6\)`, L`\(=-2-6\)`, L`\(=-8\)`], circled: '6' }),
      P('3', '计算', L`\(-2^2\div 4=\)`, '-1', 'right'),
    ],
  },
};
// the t1 page with her last answer smudged: the model marks what it could not read
PAGES.unclear = copy(PAGE_T1);
Object.assign(PAGES.unclear.problems[4], { her_answer: '[?]', unclear: true });
Object.assign(PAGES.unclear.problems[5], { stem: L`\(\frac{-1}{[?]}\times(-4)=\)`, unclear: true });

// ---------------------------------------------------------------- explain / variants / solve / hint per topic
const BANK = {
  powers: {
    answer_kind: 'number',
    steps: [
      L`\(-3^2\) 里，指数 2 只管紧挨着它的 3，底数是 3，不是 \(-3\)。`,
      L`先算乘方：\(3^2=3\times 3=9\)。`,
      L`再带上前面的负号：\(-3^2=-(3^2)=-9\)。`,
    ],
    wrong_step: '9',
    why: '她看到 3 前面有个负号，觉得负号和 3 是一家人，就一起平方了，负负得正，得到 9。',
    explain: [
      '这个坑很多初一同学都掉过：负号和平方挨在一起时，先要看清谁在被平方。',
      '问题在于：谁在被平方？没有括号时，2 只管紧挨着的那个 3，负号不在里面。',
      L`所以 \(-3^2\) 读成“3 的平方，再取相反数”，也就是 \(-(3\times 3)=-9\)。`,
      L`对比一下：\((-3)^2\) 有括号，整个 \(-3\) 都被平方，才是 \((-3)\times(-3)=9\)。`,
    ],
    remember: L`没有括号，指数只管紧挨着的那个数：\(-3^2=-9\)，\((-3)^2=9\)。`,
    hints: ['先看看：负号在不在括号里面？', '没有括号时，指数只管紧挨着它的那个数。', L`先算 \(3^2\)，最后再带上负号。`],
  },
  order: {
    answer_kind: 'number',
    steps: [
      '除和乘是同一级运算，要从左往右一步一步算。',
      L`先算 \(-6\div 2=-3\)。`,
      L`再算 \(-3\times\frac{1}{3}=-1\)。`,
    ],
    wrong_step: '-9',
    why: L`她觉得 \(2\times\frac{1}{3}\) 挨在一起，好像应该先算，就先把它们乘了，再用 \(-6\) 去除。`,
    explain: [
      '你知道负数除以正数得负数，这一点是对的。',
      L`问题出在顺序上：乘和除是“同一级”，谁也不比谁优先，要从左往右算。`,
      L`从左往右：第一步 \(-6\div 2=-3\)，第二步 \(-3\times\frac{1}{3}=-1\)。`,
      L`可以这样检查：把 \(\div 2\) 看成 \(\times\frac{1}{2}\)，算式就是 \(-6\times\frac{1}{2}\times\frac{1}{3}=-1\)，和刚才一样。`,
    ],
    remember: '乘除同级，从左往右，一步一步来。',
    hints: ['乘和除，哪个先算？', '乘除是同一级，从左往右算。', L`先算 \(-6\div 2\)，再乘 \(\frac{1}{3}\)。`],
  },
  brackets: {
    answer_kind: 'expr',
    steps: [
      L`\(3(2a-b)=6a-3b\)。`,
      L`\(-2(a-3b)=-2a+6b\)，因为 \((-2)\times(-3b)=+6b\)。`,
      L`原式 \(=6a-3b-2a+6b=4a+3b\)。`,
    ],
    wrong_step: L`原式 \(=6a-3b-2a-6b\)`,
    why: L`她知道要把 \(-2\) 分给括号里每一项，乘 \(-3b\) 时只记住了前面的负号，没把括号里的负号也算进去。`,
    explain: [
      L`第一个括号 \(3(2a-b)=6a-3b\) 你做对了，把 3 分给每一项的思路也对。`,
      L`问题在第二个括号：\(-2\) 乘 \(-3b\)，两个负号碰在一起，负负得正，是 \(+6b\)。`,
      L`所以原式 \(=6a-3b-2a+6b=4a+3b\)。`,
      L`代个数检验：取 \(a=1,b=1\)，原式 \(=3-2\times(-2)=7\)，\(4a+3b=7\)，对上了。`,
    ],
    remember: '括号前的数要乘括号里每一项，连各项自己的正负号一起带上。',
    hints: [L`\(-2\) 要乘括号里的哪几项？`, L`\(-2\) 乘 \(-3b\)，两个负号碰在一起会怎样？`, L`\((-2)\times(-3b)=+6b\)，再合并同类项。`],
  },
  equation: {
    answer_kind: 'equation',
    steps: [
      L`两边同乘 6：\(3(x-1)-2(2x+1)=6\)。`,
      L`去括号：\(3x-3-4x-2=6\)。`,
      L`合并：\(-x-5=6\)，所以 \(-x=11\)，\(x=-11\)。`,
    ],
    wrong_step: L`去分母，得 \(3(x-1)-2(2x+1)=1\)`,
    why: '她觉得只有带分母的两项要乘 6，右边的 1 没有分母，就没想到它也要跟着乘。',
    explain: [
      L`公分母 6 你找对了，\(3(x-1)\) 和 \(2(2x+1)\) 也写对了。`,
      L`卡住的是最右边：去分母是给方程两边每一项都乘 6，右边的 1 也要乘，变成 6。`,
      '可以把等式想成天平：左边整个放大 6 倍，右边不跟着放大，天平就歪了。',
      L`正确过程：\(3x-3-4x-2=6\)，\(-x=11\)，\(x=-11\)。代回去：\(-6-(-7)=1\)，对上了。`,
    ],
    remember: '去分母，每一项都要乘公分母，没有分母的数也不能漏。',
    hints: ['去分母时，两边要乘同一个数。', '右边的 1 也要乘吗？', '每一项都乘 6，右边变成 6。'],
  },
  geometry: {
    answer_kind: 'set',
    steps: [
      '点 C 在直线 AB 上，BC=4，所以 C 有两种位置。',
      L`C 在 A、B 之间：\(AC=10-4=6\)，\(AM=3\) cm。`,
      L`C 在 B 的另一边：\(AC=10+4=14\)，\(AM=7\) cm。`,
    ],
    wrong_step: L`所以 \(AC=AB-BC=6\)`,
    why: '她看着图，觉得 C 就在 A 和 B 中间，没想到“在直线上”的 C 还可以跑到 B 的另一边。',
    explain: [
      L`你不是算错，是少算了一种情况。\(AM=AC\div 2\) 这个想法完全对。`,
      '题目说的是“C 在直线 AB 上”，不是“在线段 AB 上”。直线两头无限长，C 可以在 B 的左边，也可以在右边。',
      L`第一种：\(AC=10-4=6\)，\(AM=3\) cm。第二种：\(AC=10+4=14\)，\(AM=7\) cm。`,
      '所以答案要写两个：3 cm 或 7 cm。你的 3 cm 是对的，老师给了半对。',
    ],
    remember: '只说“点在直线上”，位置就不固定：画两张图，左边一张，右边一张。',
    hints: ['题目说 C 在“直线”上，还是在“线段”上？', 'C 可以在 B 的哪一边？画两张图看看。', L`C 在 B 外面时，\(AC=10+4\)。`],
  },
  // 7x+3=8x−5，x=8（总人数 59）。她的 7x−3=8x+5 得 x=−8：两处都反了，所以只差一个负号，她去掉负号写了 8 组
  wordproblem: {
    answer_kind: 'number',
    steps: [
      L`设共分 \(x\) 组。每组 7 人，余下 3 人，总人数是 \(7x+3\)。`,
      L`每组 8 人，少 5 人，总人数是 \(8x-5\)。`,
      L`总人数不变：\(7x+3=8x-5\)，解得 \(x=8\)，共分 8 组。`,
    ],
    wrong_step: L`\(7x-3=8x+5\)`,
    why: L`她把“余下 3 人”当成要减去，把“少 5 人”当成要加上，两处正好反了。解出 \(x=-8\) 以后，她觉得组数不该是负的，就去掉负号写了 8 组，没有回头查方程。`,
    explain: [
      '设组数为 x，用两种分法各写一次总人数，再让它们相等，这个思路是对的。',
      L`问题出在“余下”和“少”上。每组 7 人，坐满 \(7x\) 个位子还余下 3 人，人比位子多，总人数是 \(7x+3\)。`,
      L`每组 8 人，少 5 人，是 \(8x\) 个位子还空着 5 个，人比位子少，总人数是 \(8x-5\)。`,
      L`所以 \(7x+3=8x-5\)，\(x=8\)。检验：\(7\times 8+3=59\)，\(8\times 8-5=59\)，对上了。`,
      L`解出 \(x=-8\) 时就该停下来：组数不能是负数，说明方程列反了，要回头查，不能只把负号去掉。`,
    ],
    remember: '余下是人多出来，要加上；少几人是位子没坐满，要减去。解出来先问一句：组数能是负的吗？',
    hints: [L`“余下 3 人”时，总人数比 \(7x\) 多还是少？`, '余下的人要加上，少的人要减去。', L`总人数写成 \(7x+3\) 和 \(8x-5\)，让它们相等。`],
  },
};

// Which mock problem the text is about. The real prompts carry the stem; any of its usual spellings counts.
const SIGNS = [
  ['wordproblem', /每组|余下/],   // 放最前：她的方程 7x−3=8x+5 里没有别的题的记号，但应用题的字最准
  ['brackets', /3\(2a-b\)|2a-b|a-3b/],
  ['equation', /frac\{x-1\}\{2\}|\(x-1\)\/2|2x\+1\}\{3\}|x=-6/],
  ['geometry', /AM|中点|直线 ?\\?\(?AB/],
  ['order', /div|÷/],
  ['powers', /3\^2|3\^\{2\}|3²/],
];
export function topicOf(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  for (const [topic, re] of SIGNS) if (re.test(t)) return topic;
  return 'powers';
}
// the 'unsure' page's wrong problem, however the prompt spells it (LaTeX as read, or plain after she edited it)
const isShaky = text => {
  const t = String(text ?? '').replace(/\s+/g, '').replace(/[−–]/g, '-');
  return t.includes(UNSURE_STEM.replace(/\s+/g, '').replace(/=\\\)$/, '')) || /\(-2\)(?:\^3|³)×(?:1\/4|¼)-\(-3\)(?:\^2|²)/.test(t);
};

// The diagnose shape of prompts.js (hint ladder, self-explanation, twin) and variants at the four levels, each with
// the answer her wrong idea would give (trap_answer), all worked out by hand and checked by tests/ai.test.mjs.
const MORE = {
  powers: {
    answer: '-9', tag: 'E-pow-neg-paren', section: '2.3.1', error_type: '符号', wrong_line: -1,
    hint1: { q: L`\(-3^2\) 里，平方管的是谁？`, options: ['只管 3，负号在外面', L`管整个 \(-3\)`], answer: 0 },
    hint2: L`没有括号时，指数只管紧挨着它的数。先算 \(3^2=9\)，再把前面的负号带上，你接着算算看。`,
    self_explain: { q: '我错在：', options: [L`把 \(-3^2\) 当成了 \((-3)^2\)`, L`\(3\times 3\) 算错了`], answer: 0 },
    twin: { q: L`计算 \(-2^2\)`, answer: '-4', answer_kind: 'number', form: '', trap_answer: '4' },
    variants: [
      { level: '同构', q: L`计算 \(-5^2\)`, answer: '-25', answer_kind: 'number', trap: '负号在括号外，平方只管 5', trap_answer: '25' },
      { level: '近变式', q: L`计算 \(-2^4\)`, answer: '-16', answer_kind: 'number', trap: '偶次方，负号不在底数里', trap_answer: '16' },
      { level: '辨析', q: L`计算 \(-3^2+(-3)^2\)`, answer: '0', answer_kind: 'number', trap: '两种写法放在一起比', trap_answer: '18' },
      { level: '远变式', q: L`计算 \(-2^2\times 3-(-1)\)`, answer: '-11', answer_kind: 'number', trap: '第一步乘方就是这个坑', trap_answer: '13' },
    ],
  },
  order: {
    answer: '-1', tag: 'E-div-order', section: '2.2.2', error_type: '运算规则', wrong_line: -1,
    hint1: { q: L`\(-6\div 2\times\frac{1}{3}\) 里，乘和除谁先算？`, options: ['同一级，从左往右', '先算乘法'], answer: 0 },
    hint2: L`乘除是同一级，从左往右。先算 \(-6\div 2\)，等于几？再接着乘 \(\frac{1}{3}\)。`,
    self_explain: { q: '我错在：', options: ['乘除同级时，先算了后面的乘法', '负数除以正数的符号弄错了'], answer: 0 },
    twin: { q: L`计算 \(-8\div 4\times\frac{1}{2}\)`, answer: '-1', answer_kind: 'number', form: '', trap_answer: '-4' },
    variants: [
      { level: '同构', q: L`计算 \(12\div 3\times 2\)`, answer: '8', answer_kind: 'number', trap: '先乘后除就错', trap_answer: '2' },
      { level: '近变式', q: L`计算 \(-9\div 3\times\frac{1}{3}\)`, answer: '-1', answer_kind: 'number', trap: '分数在后面，更像要先乘', trap_answer: '-9' },
      { level: '辨析', q: L`计算 \(24\div(4\times 2)-24\div 4\times 2\)`, answer: '-9', answer_kind: 'number', trap: '有括号和没括号的对比', trap_answer: '0' },
      { level: '远变式', q: L`计算 \(-6\div\frac{1}{2}\times 3+1\)`, answer: '-35', answer_kind: 'number', trap: '混合运算里藏着乘除顺序', trap_answer: '-3' },
    ],
  },
  brackets: {
    answer: '4a+3b', tag: 'E-paren-minus', section: '4.2', error_type: '符号', wrong_line: 0,
    hint1: { q: L`\(-2\) 乘括号里的 \(-3b\)，结果是多少？`, options: [L`\(+6b\)，负负得正`, L`\(-6b\)`], answer: 0 },
    hint2: L`代个数试试：\(b=1\) 时，\((-2)\times(-3)=6\)，是正的。从第一行改起。`,
    self_explain: { q: '我错在：', options: [L`\(-2\) 乘 \(-3b\) 时，没算负负得正`, '合并同类项时算错了'], answer: 0 },
    twin: { q: L`化简 \(2(3x-y)-4(x-2y)\)`, answer: '2x+6y', answer_kind: 'expr', form: 'simplified', trap_answer: '2x-10y' },
    variants: [
      { level: '同构', q: L`化简 \(4(2x-y)-3(x-2y)\)`, answer: '5x+2y', answer_kind: 'expr', form: 'simplified', trap: '负数乘负数在第二个括号的第二项', trap_answer: '5x-10y' },
      { level: '近变式', q: L`化简 \(-3(a-2)+a\)`, answer: '-2a+6', answer_kind: 'expr', form: 'simplified', trap: '括号前是负数', trap_answer: '-2a-6' },
      { level: '辨析', q: L`化简 \(-(x-5)-(5-x)\)`, answer: '0', answer_kind: 'expr', form: 'simplified', trap: '两个负号括号，每一项都要变号', trap_answer: '-2x-10' },
      { level: '远变式', q: L`解方程 \(3-2(x-4)=1\)`, answer: 'x=5', answer_kind: 'equation', form: '', trap: '解方程时去括号', trap_answer: 'x=-3' },
    ],
  },
  equation: {
    answer: 'x=-11', tag: 'E-denom-miss', section: '5.2', error_type: '书写与步骤', wrong_line: 0,
    hint1: { q: '去分母时，右边的 1 要不要乘 6？', options: ['要，每一项都乘 6', '不用，它没有分母'], answer: 0 },
    hint2: '方程两边同乘 6，右边的 1 也变成 6，像天平两边一起放大。从第一行改起。',
    self_explain: { q: '我错在：', options: ['去分母时，没有分母的那一项漏乘了', '去括号时符号错了'], answer: 0 },
    twin: { q: L`解方程 \(\frac{x+1}{2}-\frac{x}{3}=1\)`, answer: 'x=3', answer_kind: 'equation', form: '', trap_answer: 'x=-2' },
    variants: [
      { level: '同构', q: L`解方程 \(\frac{x+2}{3}-\frac{x-1}{2}=1\)`, answer: 'x=1', answer_kind: 'equation', trap: '右边的 1 要乘 6', trap_answer: 'x=6' },
      { level: '近变式', q: L`解方程 \(\frac{x}{2}-1=\frac{x}{3}\)`, answer: 'x=6', answer_kind: 'equation', trap: '没有分母的项换到了左边', trap_answer: 'x=1' },
      { level: '辨析', q: L`解方程 \(\frac{2x}{3}+1=x\)`, answer: 'x=3', answer_kind: 'equation', trap: '两边都有不带分母的项', trap_answer: 'x=1' },
      { level: '远变式', q: L`解方程 \(\frac{2x-1}{3}-\frac{x+2}{4}=5\)`, answer: 'x=14', answer_kind: 'equation', trap: '公分母是 12，右边的 5 也要乘', trap_answer: 'x=3' },
    ],
  },
  geometry: {
    answer: '3或7', unit: 'cm', tag: 'E-midpoint-cases', section: '6.2.2', error_type: '分类讨论遗漏', wrong_line: 1,
    hint1: { q: '题目说“点 C 在直线 AB 上”，C 可能在哪里？', options: ['可以在 A、B 之间，也可以在 B 的外面', '只能在 A、B 之间，图上就是这样'], answer: 0 },
    hint2: 'B 的右边 4 cm 也有一个点。C 在那里时，AC 是多少？接着算 AM。',
    self_explain: { q: '我错在：', options: ['只按图上的一种位置算，漏了另一种', '中点取一半时算错了'], answer: 0 },
    twin: { q: L`已知线段 \(AB=8\)，点 \(C\) 在直线 \(AB\) 上，\(BC=2\)，点 \(M\) 是 \(AC\) 的中点，求 \(AM\) 的长。`, answer: '3或5', answer_kind: 'set', form: '', trap_answer: '3' },
    variants: [
      { level: '同构', q: L`已知线段 \(AB=6\)，点 \(C\) 在直线 \(AB\) 上，\(BC=2\)，求 \(AC\) 的长。`, answer: '4或8', answer_kind: 'set', trap: '点在直线上，有两个位置', trap_answer: '4' },
      { level: '近变式', q: L`已知线段 \(AB=12\)，点 \(C\) 在直线 \(AB\) 上，\(BC=4\)，点 \(M\)、\(N\) 分别是 \(AB\)、\(BC\) 的中点，求 \(MN\) 的长。`, answer: '4或8', answer_kind: 'set', trap: '换成两个中点，还是两种位置', trap_answer: '4' },
      { level: '辨析', q: '数轴上点 A 表示 2，点 B 到点 A 的距离是 3，点 B 表示的数是多少？', answer: '5或-1', answer_kind: 'set', trap: '只说距离，没说方向', trap_answer: '5' },
      { level: '远变式', q: L`已知 \(\angle AOB=70^\circ\)，\(\angle BOC=30^\circ\)，求 \(\angle AOC\) 的度数。`, answer: '100°或40°', answer_kind: 'set', trap: 'OC 可以在 ∠AOB 外面，也可以在里面', trap_answer: '100°' },
    ],
  },
  // 每组 a 个余下 r 个、每组 b 个少 s 个：组数 = (r+s)/(b−a)。她的坑（加减反了）解出来正好是负的组数，远变式问的是总数，
  // 坑答案是只答了 x。每道都在 tests/ai.test.mjs 里按这个式子再算一遍
  wordproblem: {
    answer: '8', tag: 'E-answer-asked', section: '5.3', error_type: '审题', wrong_line: 1,
    hint1: { q: L`每组 7 人，余下 3 人。总人数比 \(7x\) 多还是少？`, options: [L`多 3 人，是 \(7x+3\)`, L`少 3 人，是 \(7x-3\)`], answer: 0 },
    hint2: '余下的人是多出来的，要加上；少的人是位子没坐满，要减去。从第二行改起，先写出两种分法的总人数，再让它们相等。',
    self_explain: { q: '我错在：', options: ['把“余下”和“少”的加减弄反了，解出负数也没回头查', '解方程时移项算错了'], answer: 0 },
    twin: { q: '某班学生分组活动，每组 6 人，则余下 4 人；每组 7 人，则少 3 人。这个班共分几组？', answer: '7', answer_kind: 'number', form: '', trap_answer: '-7' },
    variants: [
      { level: '同构', q: '同学们分组植树，每组 5 人，则余下 2 人；每组 6 人，则少 4 人。一共分了几组？', answer: '6', answer_kind: 'number',
        trap: '“余下”要加上，“少”要减去，反过来就解出负的组数', trap_answer: '-6' },
      { level: '近变式', q: '把一些练习本分给几个小组，每组 3 本，则余下 8 本；每组 5 本，则还差 2 本。一共有几个小组？', answer: '5', answer_kind: 'number',
        trap: '“还差”和“少”一样，要从总数里减去', trap_answer: '-5' },
      { level: '辨析', q: L`设共分 \(x\) 组。每组 8 人，则少 5 人。用含 \(x\) 的式子表示总人数。`, answer: '8x-5', answer_kind: 'expr',
        trap: '少 5 人是位子没坐满，总人数比 8x 少', trap_answer: '8x+5' },
      { level: '远变式', q: '把一些苹果分给几个小朋友，每人分 4 个，则余下 9 个；每人分 6 个，则少 3 个。一共有多少个苹果？', answer: '33', answer_kind: 'number',
        trap: '设的是人数，问的是苹果数，解出 x 还要再算一步', trap_answer: '6' },
    ],
  },
};

// 'unsure' 那页的第 2 题：模拟的讲题最后一步把 −(−3)² 当成了 +9，答案写成 7（程序算是 −11）。同构题本身是对的，
// 但主答案核对不上，pipeline 不会给她
const SHAKY = {
  answer: '7', answer_kind: 'number', form: '', unit: '',
  solution: [L`先算乘方：\((-2)^3=-8\)，\((-3)^2=9\)。`, L`再算乘法：\(-8\times\frac{1}{4}=-2\)。`, L`最后算减法：\(-2-(-9)=7\)。`],
  wrong_line: 0, wrong_step: L`\(=-8\times\frac{1}{4}-6\)`, error_type: '概念误解', tag: 'E-pow-as-mul', section: '2.3.1',
  why: L`她把 \((-3)^2\) 算成了 \(3\times 2=6\)，把指数当成了乘数。`,
  hint1: { q: L`\((-3)^2\) 是什么意思？`, options: [L`两个 \(-3\) 相乘`, L`\(-3\) 乘 2`], answer: 0 },
  hint2: L`\((-3)^2=(-3)\times(-3)\)，先把它算出来，再往下算。`,
  explain: [
    L`第一步 \((-2)^3=-8\) 你算对了，乘 \(\frac{1}{4}\) 得 \(-2\) 也对。`,
    L`问题在 \((-3)^2\)：它是两个 \(-3\) 相乘，等于 9，不是 6。`,
    L`所以原式 \(=-2-(-9)=7\)。`,
  ],
  self_explain: { q: '我错在：', options: [L`把 \((-3)^2\) 算成了 \(3\times 2\)`, '乘法算错了'], answer: 0 },
  remember: '乘方是几个相同的数相乘，不是底数乘指数。',
  twin: { q: L`计算 \((-2)^2\times\frac{1}{2}-(-1)^3\)`, answer: '3', answer_kind: 'number', form: '', trap_answer: '1' },
  doubt: '',
};

function explainOf(topic) {
  const b = BANK[topic], m = MORE[topic];
  return {
    answer: m.answer, answer_kind: b.answer_kind, form: m.form || '', unit: m.unit || '', solution: [...b.steps],
    wrong_line: m.wrong_line, wrong_step: b.wrong_step, error_type: m.error_type, tag: m.tag, section: m.section, why: b.why,
    hint1: copy(m.hint1), hint2: m.hint2, explain: [...b.explain], self_explain: copy(m.self_explain), remember: b.remember,
    twin: copy(m.twin), doubt: '',
  };
}

// solve answers the question it was given (userSolve sends "题目：" + q), so mock checks agree like real ones
function solveOf(text, topic) {
  const t = String(text || '').replace(/^题目：/, '').trim();
  for (const x of [...TOPICS.flatMap(k => [MORE[k].twin, ...MORE[k].variants]), SHAKY.twin]) {
    if (t && (t === x.q || t.startsWith(x.q))) return { answer: x.answer, answer_kind: x.answer_kind || 'text', form: x.form || '', unit: '', steps: ['（模拟）'], unsure: false };
  }
  // the 'unsure' problem: the checking model works it out right, so it disagrees with the slipped explanation
  if (isShaky(t)) return { answer: '-11', answer_kind: 'number', form: '', unit: '', steps: ['（模拟）'], unsure: false };
  const m = MORE[topic];
  return { answer: m.answer, answer_kind: BANK[topic].answer_kind, form: '', unit: m.unit || '', steps: [...BANK[topic].steps], unsure: false };
}

export function mockAnswer(task, { text = '', images = [], mockCase = '' } = {}) {
  const c = String(mockCase || '');
  if (task === 'recognize') {
    const byTopic = { powers: '', order: '', geometry: 'half', wordproblem: 'sideways' };
    const key = c in PAGES ? c : c in byTopic ? byTopic[c] : '';
    return copy(PAGES[key]);
  }
  const topic = TOPICS.includes(c) ? c : topicOf(text);
  const b = BANK[topic];
  if (task === 'explain' && (c === 'unsure' || isShaky(text))) return copy(SHAKY);
  if (task === 'explain') return copy(explainOf(topic));
  if (task === 'variants') return copy({ variants: MORE[topic].variants.map(v => ({ form: '', unit: '', steps: ['（模拟）'], ...v })) });
  if (task === 'solve') return copy(solveOf(text, topic));
  if (task === 'hint') return copy({ hint: b.hints[0] });
  if (task === 'reflect') {
    return {
      summary: '这周讲了 3 道错题，2 道已经会了。',
      strengths: ['去括号时会先写出每一项再合并。'],
      focus: [L`乘方的底数：\(-3^2\) 和 \((-3)^2\)。`],
      next: ['下周先练 3 道乘方的变式题。'],
    };
  }
  return {};
}

// ---------------------------------------------------------------- v0.3 private teacher: voice and chat

export const MOCK_TRANSCRIPT = '老师，负三的平方为什么是负九？';

export function mockText(task, opts = {}) {
  if (task === 'listen') return MOCK_TRANSCRIPT;
  if (task === 'chat') return mockChat(opts);
  return JSON.stringify(mockAnswer(task, opts));
}

export const CHAT_CASES = ['probe', 'problem', 'free', 'retry', 'example', 'quiz', 'gotit', 'right', 'wrong', 'photo', 'other'];

// the point each mock problem is about, in her words (what a 【记录】 line names)
const POINTS = {
  powers: '乘方前面的负号', order: '乘除同级的顺序', brackets: '去括号时的符号', equation: '去分母要乘每一项', geometry: '点在直线上要分两种情况',
  wordproblem: '“余下”和“少”怎么列式',
};
// the hidden lines are written as a model writes them: the marker, then one JSON object on the same line
const hidden = (kind, obj) => `【${kind}】${JSON.stringify(obj)}`;
const practiceOf = x => ({ q: x.q, answer: x.answer, answer_kind: x.answer_kind || 'text', form: x.form || '' });
const note = (kind, topic, note) => hidden('记录', { kind, tag: MORE[topic].tag, point: POINTS[topic], note });

// written like gpt-5.4 answers with teacher.js: short sentences, one point, inline \( \), at most 4 list items,
// then a small question or a practice line. Single backslashes in the 【练习】 JSON, the way models write it.
const POWERS = {
  free: L`你问到点子上了。关键是看清：平方管的是谁。
\(-3^2\) 没有括号，平方只管紧挨着它的 3，负号在外面等着。所以先算 \(3^2=9\)，再带上负号，得 \(-9\)。
要是写成 \((-3)^2\)，括号把负号也包进去了，才是 \((-3)\times(-3)=9\)。
- 没括号：先平方，再带负号
- 有括号：连负号一起平方
你来试一道，看看是不是想通了。
【练习】{"q":"计算 \(-4^2\)","answer":"-16","answer_kind":"number"}
【记录】{"kind":"gap","tag":"E-pow-neg-paren","point":"乘方前面的负号","note":"她问 −3² 为什么是 −9，说明她把它读成了 (−3)²"}`,
  retry: L`没关系，我换个说法。
把前面的负号想成一个按钮，按一下，数就变成它的相反数。
\(-3^2\)：先算 \(3^2=9\)，最后按一下按钮，变成 \(-9\)。
\((-3)^2\)：括号里先按按钮，得到 \(-3\)，再拿 \(-3\) 去平方，\((-3)\times(-3)=9\)。
同样是一个负号、一个平方，先做哪一步不一样，结果就不一样。
你用按钮的说法讲给我听：\(-2^2\) 先做哪一步？结果是多少？
【记录】{"kind":"gap","tag":"E-pow-neg-paren","point":"乘方前面的负号","note":"第一种讲法以后她还是不懂，换成了“相反数按钮”的讲法"}`,
  example: L`好，我们看几组，一对一对比着看。
- \(-2^2=-(2\times 2)=-4\)，\((-2)^2=(-2)\times(-2)=4\)
- \(-5^2=-25\)，\((-5)^2=25\)
- \(-1^2=-1\)，\((-1)^2=1\)
每一对里，有括号的都是正的，没括号的都是负的。
你说说看，为什么有括号的就变成正的了？`,
  quiz: L`好，来一道。只考刚才说的那一点：做之前先问自己，平方管的是谁。
【练习】{"q":"计算 \(-5^2+(-2)^2\)","answer":"-21","answer_kind":"number"}`,
  gotit: L`好。那我用一个小问题确认一下：\(-1^2\) 和 \((-1)^2\)，哪一个等于 \(-1\)？说说你是怎么看出来的。`,
  right: L`对了。你没有让负号跟着平方，先算乘方、最后带上负号，顺序完全对。
以后看到负号和乘方挨在一起，先停一下，问自己：平方管的是谁？
这个点我记下了，过几天复习时再出一道，看看你还记不记得。
【记录】{"kind":"ok","tag":"E-pow-neg-paren","point":"乘方前面的负号","note":"讲完以后当场练习做对了"}`,
  wrong: L`你记得先算乘方，这一点是对的。问题在负号：你让它也跟着一起平方了。
我们放慢一点，先只看这一个：\(-4^2\) 里，平方管的是 4，还是 \(-4\)？
你先回答这一个，我们再往下走。
【记录】{"kind":"gap","tag":"E-pow-neg-paren","point":"乘方前面的负号","note":"讲完以后当场练习，负号还是跟着一起平方了"}`,
};
const OTHER = '我先弄清楚你卡在哪。你说说看，这道题你算到哪一步开始觉得不对劲？\n可以一步一步说给我听，也可以把你写的过程拍给我。';
const PHOTO = '这道题我看到了。先别急着要答案，我想先听听你的想法。\n你打算第一步做什么？为什么这样做？';

const textOf = m => {
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  return Array.isArray(m.content) ? m.content.map(p => (p && p.type === 'text' ? String(p.text || '') : '')).join('\n') : '';
};
const hasImage = m => !!m && Array.isArray(m.content) && m.content.some(p => p && p.type === 'image_url');
const isProbe = t => /主动开启/.test(t);
const isContext = t => /讲完一道错题/.test(t);

// which mock problem a conversation is about; null when none of them is named
function topicIn(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  for (const [topic, re] of SIGNS) if (re.test(t)) return topic;
  if (/平方|乘方|负三|[-−]3²/.test(t)) return 'powers';
  return null;
}

function probeReply(text) {
  const name = (String(text).match(/弄清这个点：(.+?)。/) || [])[1] || '最近学的内容';
  const evidence = (String(text).match(/你看到的证据：(.+?)。/) || [])[1] || '';
  const seen = evidence ? `我翻了一下你最近的本子：${evidence}。` : '最近这类题有几道没做对。';
  const ask = /乘方|平方|负号/.test(name)
    ? L`先不急着算。你说说看：\(-3^2\) 里，被平方的是谁？是 3，还是 \(-3\)？`
    : '先不急着算。你挑一道这样的题，说说你第一步会做什么，为什么这样做？';
  return `Emma，你好。想和你聊 3 分钟：${name}。\n${seen}我想先听听你是怎么想的，不是考试，说错了也没关系。\n${ask}`;
}

function problemReply(topic) {
  return `好，我们接着刚才那道题说。我先弄清楚你卡在哪一步。\n${MORE[topic].hint1.q}\n你说说你的想法，说错了也没关系。`;
}

// “还是不懂” on the other mock problems: a different picture, not the same words again (teacher.js rule 4)
const RETRY = {
  order: L`没关系，我换个说法。
把 \(\div 2\) 换成 \(\times\frac{1}{2}\)，整道题就只剩乘法了：\(-6\times\frac{1}{2}\times\frac{1}{3}\)。
只有乘法时，从左往右一个一个乘：\(-6\times\frac{1}{2}=-3\)，\(-3\times\frac{1}{3}=-1\)。
你用这个办法试试 \(12\div 3\times 2\)，先说说你会把它改成什么样？`,
  brackets: L`没关系，我换个说法。
把 \(-2(a-3b)\) 想成：\(-2\) 要和括号里的每一个人握手，\(a\) 一个，\(-3b\) 一个。
和 \(a\) 握手得 \(-2a\)；和 \(-3b\) 握手，两个负号碰在一起，负负得正，得 \(+6b\)。
你来试一下：\(-3(x-2)\) 要和括号里的谁握手？各得多少？`,
  equation: L`没关系，我换个说法。
把方程想成一架天平，左边和右边一样重。
去分母就是把两边都放大 6 倍。左边每一项放大了，右边的 1 也得放大，变成 6，天平才不会歪。
你来说说：\(\frac{x}{2}-1=\frac{x}{3}\) 两边乘 6 以后，\(-1\) 变成多少？`,
  geometry: L`没关系，我换个说法。
拿一把尺子，A 放在 0，B 放在 10。C 离 B 有 4 cm，尺子上哪些位置离 10 正好 4 格？
一个是 6，一个是 14。所以 AC 可能是 6，也可能是 14。
你接着算：这两种情况下，AM 各是多少？`,
  wordproblem: L`没关系，我换个说法。
把每组想成一排椅子。每组 7 人，就是每排 7 把椅子，\(x\) 排一共 \(7x\) 把。
余下 3 人：椅子都坐满了，还有 3 个人站着，人数是 \(7x+3\)。
少 5 人：每排换成 8 把椅子，坐完还空着 5 把，人数是 \(8x-5\)。
你来说说：每组 6 人、少 2 人的时候，总人数怎么写？`,
};

// free / retry / example / quiz for the other mock problems, from the explanation bank
function topicReply(kind, topic) {
  const b = BANK[topic], m = MORE[topic];
  if (kind === 'free') return `${b.explain[1]}\n${b.explain[2]}\n你来试一道，看看是不是想通了。\n${hidden('练习', practiceOf(m.twin))}\n${note('gap', topic, b.why)}`;
  if (kind === 'retry') return `${RETRY[topic]}\n${note('gap', topic, '第一种讲法以后她还是不懂，换了讲法')}`;
  if (kind === 'example') return `好，看这一道，我一步一步写：\n${b.steps.map(s => '- ' + s).slice(0, 4).join('\n')}\n你说说看，哪一步和你原来想的不一样？`;
  if (kind === 'quiz') return `好，来一道。只考刚才说的那一点：${b.remember}\n${hidden('练习', practiceOf(m.variants[0]))}`;
  return POWERS[kind];
}

export function mockChat({ messages = [], mockCase = '' } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const users = list.filter(m => m && m.role === 'user');
  const last = users[users.length - 1];
  const lastText = textOf(last);
  const all = list.map(textOf).join('\n');
  const context = users.map(textOf).find(isContext) || '';
  const topic = topicIn(context) || topicIn(all) || 'powers';
  const pick = kind => (topic === 'powers' ? POWERS[kind] : topicReply(kind, topic));
  const c = String(mockCase || '');
  if (CHAT_CASES.includes(c)) {
    if (c === 'probe') return probeReply('弄清这个点：乘方前面的负号。你看到的证据：10-22 作业 −3² 写成 9；10-23 复习 −2⁴ 写成 16。');
    if (c === 'problem') return problemReply(topic);
    if (c === 'photo') return PHOTO;
    if (c === 'other') return OTHER;
    return pick(c);
  }
  if (isProbe(lastText) && users.length === 1) return probeReply(lastText);
  const assistants = list.filter(m => m && m.role === 'assistant').length;
  if (context && assistants === 0 && (users.length > 1 || lastText.replace(context, '').trim() === '')) return problemReply(topic);
  // her own words in the last turn (the hidden context may share a turn with her question)
  const said = lastText.replace(context, '').trim();
  if (/还是不懂|没懂|不明白|听不懂|不太懂/.test(said)) return pick('retry');
  if (/例子/.test(said)) return pick('example');
  if (/出一道题|考考我|再来一道/.test(said)) return pick('quiz');
  if (/答案|我做|我写|我算|算出/.test(said)) return /不对|错/.test(said) ? POWERS.wrong : POWERS.right;
  if (/^(懂了|明白了|会了|知道了)/.test(said)) return POWERS.gotit;
  if (context && assistants === 0) return problemReply(topic);
  const asked = topicIn(said);
  if (asked) return asked === 'powers' ? POWERS.free : topicReply('free', asked);
  if (hasImage(last)) return PHOTO;
  return OTHER;
}
