// Mock answers for every AI task, same shapes as the real ones, so the whole app runs with settings.mock on: no
// request, no Key, no cost (家长区“模拟模式”、?mock=1、界面开发、浏览器检查).
// 负责：AI 层 agent。CONTRACTS.md 第 4 节“模拟模式”。ai.js 负责等 300 到 900 毫秒，这里只给内容。
//
// 内容来自比拼用的仿真作业（bakeoff/truth.json，程序生成的测试数据，不是学生数据）：
//   powers    −3² 当成 (−3)²（t1 第 2 题）          order     −6÷2×⅓ 先算了乘法（t1 第 5 题）
//   brackets  −2(a−3b) 去括号变号（t2 第 1 题）       equation  去分母漏乘右边的 1（t3）
//   geometry  点在直线上，漏了一种位置，半对（t5 第 7 题）
//
// 导出
//   TOPICS                                  ['powers', 'order', 'brackets', 'equation', 'geometry']
//   RECOGNIZE_CASES                         看照片能模拟的页：'' 默认（练习册 t1）| 'brackets' | 'equation' | 'half' |
//                                           'sideways' | 'ungraded' | 'unclear' | 'empty'
//   topicOf(text) -> topic                  从发给 AI 的文字里认出是哪道仿真题，认不出就是 'powers'
//   mockAnswer(task, { text, images, mockCase }) -> object   每次一份新的对象，随便改
//     task：recognize | explain | variants | solve | hint | reflect（别的任务给 {}）
//     mockCase：settings.mockCase。看照片时选页（见上），其他任务时可以直接写题目名（'order' 等）
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

export const TOPICS = ['powers', 'order', 'brackets', 'equation', 'geometry'];
export const RECOGNIZE_CASES = ['', 'brackets', 'equation', 'half', 'sideways', 'ungraded', 'unclear', 'empty'];

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
};

// Which mock problem the text is about. The real prompts carry the stem; any of its usual spellings counts.
const SIGNS = [
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
  for (const k of TOPICS) {
    const m = MORE[k];
    for (const x of [m.twin, ...m.variants]) {
      if (t && (t === x.q || t.startsWith(x.q))) return { answer: x.answer, answer_kind: x.answer_kind || 'text', form: x.form || '', unit: '', steps: ['（模拟）'], unsure: false };
    }
  }
  const m = MORE[topic];
  return { answer: m.answer, answer_kind: BANK[topic].answer_kind, form: '', unit: m.unit || '', steps: [...BANK[topic].steps], unsure: false };
}

export function mockAnswer(task, { text = '', images = [], mockCase = '' } = {}) {
  const c = String(mockCase || '');
  if (task === 'recognize') {
    const byTopic = { powers: '', order: '', geometry: 'half' };
    const key = c in PAGES ? c : c in byTopic ? byTopic[c] : '';
    return copy(PAGES[key]);
  }
  const topic = TOPICS.includes(c) ? c : topicOf(text);
  const b = BANK[topic];
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
