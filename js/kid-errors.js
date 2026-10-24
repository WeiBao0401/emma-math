// 孩子版报错文案：Emma 看到的出错提示只说发生了什么、她能做什么（“等一下再试”“告诉家长”“先练错题本”），
// 不提 Key、积分、预算、模型名、Poe、中转站。原来的技术说明留给家长区（parentDetail）。
// 负责：AI 层 agent。写法照英语 App 的 kid-errors.js，加了数学老师自己的三种情况：
// 'badrelay'（中转站地址不对，要家长改）、'unclear'（照片看不清）、'ungraded'（这页没批改，不讲）。
//
// 导出
//   KID_COPY                         { code: 中文一句 }，code 来自 ai.js 的 AIError.code，'unclear' / 'ungraded' 由看照片的流程给
//   WHERE_COPY                       按地方换说法：{ photo: {...}, explain: {...}, practice: {...}, hint: {...} }
//   kidMessage(err, { where }) -> string   给孩子看的一句。err 是 AIError、带 code 的对象或 code 字符串；
//                                    where：'photo' 看照片 | 'explain' 讲题 | 'practice' 练变式题 | 'hint' 要提示；'abort' 返回 ''
//   needsParent(err) -> bool         这个错要家长处理（地址、Key、积分、模型）：界面显示“告诉家长”，不显示“再试一次”
//   canRetry(err) -> bool            “再试一次”有意义（网络、超时、忙、没讲完）
//   parentDetail(err) -> string      原来的技术说明（err.message），只在家长区显示
//   BANNED                           孩子文案里不许出现的字（测试用）
//
// 规则：中文弯引号，不用破折号，不用感叹号，句子短。
// 依赖：无。

export const BANNED = /key|api|欠费|预算|积分|模型|poe|gemini|claude|gpt|sonnet|opus|haiku|中转|relay|token|429|404|401|—|「|」|!|！/i;

const ASK_PARENT = '老师这边出了点问题，告诉家长。';
const MONTH_OUT = '这个月的老师额度用完了，告诉家长。';
const BUSY = '老师这会儿有点忙，等一下再试。';
const AGAIN = '这次没讲完，再试一次。';

export const KID_COPY = {
  network: '老师这会儿连不上，等一下再试。',
  offline: '现在没连网，连上以后再试。',
  timeout: '网有点慢，等一下再试一次。',
  nokey: '老师还没准备好，告诉家长。',
  badkey: ASK_PARENT,
  badrelay: ASK_PARENT,
  billing: MONTH_OUT,
  'budget-day': '今天的老师额度用完了，明天再来。错题本里的题还能接着练。',
  model: ASK_PARENT,
  forbidden: ASK_PARENT,
  ratelimit: BUSY,
  server: BUSY,
  truncated: AGAIN,
  incomplete: AGAIN,
  empty: AGAIN,
  http: '出了点小问题，再试一次。',
  unclear: '照片有点看不清。找亮一点的地方，把本子放平，正对着再拍一张。',
  ungraded: '这页还没有老师的批改。等老师批改完再拍，我们只讲批改过的错题。',
  abort: '',
};

export const WHERE_COPY = {
  // 看照片：照片要重新发一次，所以说“再试一次”而不是“再拍一张”（除了真看不清）
  photo: {
    timeout: '照片传得有点慢，等一下再试一次。',
    truncated: '这张照片没看完，再试一次。',
    incomplete: '这张照片没看完，再试一次。',
    empty: '这张照片没看完，再试一次。',
    'budget-day': '今天的老师额度用完了，明天再拍。错题本里的题还能接着练。',
  },
  explain: {
    truncated: '这道题没讲完，再试一次。',
    incomplete: '这道题没讲完，再试一次。',
    empty: '这道题没讲完，再试一次。',
    'budget-day': '今天的老师额度用完了，这道题明天再讲。',
  },
  // 练变式题：出不了新题时，错题本里的原题照样能练
  practice: {
    network: '老师这会儿连不上，先练错题本里的原题。',
    offline: '现在没连网，先练错题本里的原题。',
    timeout: '网有点慢，先练错题本里的原题。',
    ratelimit: '老师这会儿有点忙，先练错题本里的原题。',
    server: '老师这会儿有点忙，先练错题本里的原题。',
    truncated: '新题没出好，先练错题本里的原题。',
    incomplete: '新题没出好，先练错题本里的原题。',
    empty: '新题没出好，先练错题本里的原题。',
    'budget-day': '今天的老师额度用完了，先练错题本里的原题。',
  },
  // 要提示：没有提示也能接着想，或者看讲解
  hint: {
    network: '提示没拿到，再想一想，或者看看讲解。',
    offline: '现在没连网，再想一想，或者看看讲解。',
    timeout: '提示没拿到，再想一想，或者看看讲解。',
    ratelimit: '提示没拿到，再想一想，或者看看讲解。',
    server: '提示没拿到，再想一想，或者看看讲解。',
    'budget-day': '今天的老师额度用完了，再想一想，或者看看讲解。',
  },
};

const PARENT_CODES = new Set(['nokey', 'badkey', 'badrelay', 'billing', 'model', 'forbidden']);
const RETRY_CODES = new Set(['network', 'offline', 'timeout', 'ratelimit', 'server', 'truncated', 'incomplete', 'empty', 'http', 'unclear']);

const codeOf = err => (err && typeof err === 'object' && err.code) || (typeof err === 'string' && err ? err : 'http');

export function kidMessage(err, { where = '' } = {}) {
  const code = codeOf(err);
  if (code === 'abort') return '';
  const local = WHERE_COPY[where] && WHERE_COPY[where][code];
  if (local) return local;
  return KID_COPY[code] ?? KID_COPY.http;
}

export const needsParent = err => PARENT_CODES.has(codeOf(err));
export const canRetry = err => RETRY_CODES.has(codeOf(err));
export const parentDetail = err => (err && err.message) || String(err || '');
