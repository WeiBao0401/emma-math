// Settings that every module reads: version, names, which model answers which AI task, Poe parameters and prices.
// 负责：AI 层 agent（config.js、ai.js、budget.js、kid-errors.js、mock.js）。CONTRACTS.md 第 2、3 节。
//
// 导出
//   VERSION, APP_NAME                     VERSION 和 sw.js 的 VERSION 一致（测试检查），每次发版两处一起改
//   DB_NAME, DB_VERSION                    IndexedDB 'emmamath'（和英语 App 的 'emma' 分开，同一个源）
//   LS_PREFIX                              localStorage 键前缀 'emmamath.'
//   POE_DIRECT_URL                         直连 Poe 的地址（国内要 VPN）；平时用家长粘贴的中转站地址
//   TASKS                                  { task: { model, maxTokens, timeoutMs, fallback } }，比拼结果（bakeoff/REPORT.md）
//   TASK_LABELS                            家长区显示用的任务名
//   MODEL_PARAMS                           每个模型额外带的 Poe 参数（一律关联网搜索）
//   DEFAULT_MODEL_PARAMS                   不在表里的模型带什么（只关联网搜索）
//   PRICES_USD, FALLBACK_PRICE_USD         美元 / 百万 token [输入, 输出]
//   RETRY_DELAYS, MAX_TOKENS_CAP, MOCK_DELAY_MS, RECENT_CAP
//   MOCK_STREAM_MS, MOCK_LISTEN_MS         模拟模式：聊天每一小段间隔 40 毫秒；语音转写等 800 毫秒
//   ASR_OPTIONS, DOUBAO_ASR               语音转写走哪家（v0.3，CONTRACTS 16）；豆包接口的地址和资源 ID（未验证）
//   DEFAULT_SETTINGS                       { poeUrl, poeKey, taskModels, dailyCapUSD, mock, asr, doubao }
//
// 依赖：无。只放常量，不放 Key、本机路径、学生数据（web/ 是公开仓库）。

export const VERSION = '0.9.0';
export const APP_NAME = 'Emma 的数学老师';
export const DB_NAME = 'emmamath', DB_VERSION = 1;
export const LS_PREFIX = 'emmamath.';

// Poe's OpenAI-compatible API. In China it needs a VPN, so the app normally talks to Wei's relay
// (https://<domain>/<secret>/v1, pasted in the parent area); this direct address works wherever Poe is reachable.
export const POE_DIRECT_URL = 'https://api.poe.com/v1';

// Which model does which AI task, from the bake-off (bakeoff/REPORT.md, 2026-10-24). 10-24 evening, after an end-to-end
// run: gemini-3.8-flash took 40-90 s per variants call (cut off, timed out), so variants moved to Sonnet and the
// independent check to gemini-3.1-pro (about 8 s). The parent area can change a
// task's model (settings.taskModels); the request then uses MODEL_PARAMS[that model].
// maxTokens: Claude and Gemini on Poe spend part of it on hidden thinking, so a reply that uses all of it counts as
// cut off and is asked for again with double (ai.js, up to MAX_TOKENS_CAP).
// fallback: used once when the main model keeps failing for a reason that is not the key, the points or the network.
export const TASKS = {
  recognize: { model: 'gemini-3.1-pro',    maxTokens: 6000, timeoutMs: 60000, fallback: 'claude-sonnet-5.5' },
  explain:   { model: 'claude-sonnet-5.5', maxTokens: 6000, timeoutMs: 90000, fallback: 'gemini-3.1-pro' },
  variants:  { model: 'claude-sonnet-5.5', maxTokens: 6000, timeoutMs: 90000, fallback: 'gemini-3.1-pro' },
  solve:     { model: 'gemini-3.1-pro',    maxTokens: 4000, timeoutMs: 60000, fallback: '' },  // 独立再做一遍，用来核对（另一家）
  hint:      { model: 'claude-sonnet-5.5', maxTokens: 3000, timeoutMs: 60000, fallback: 'gemini-3.8-flash' },
  reflect:   { model: 'claude-opus-4.8',   maxTokens: 8000, timeoutMs: 180000, fallback: 'claude-sonnet-5.5' },
  // v0.3 私人老师（design/teacher-chat.md）。chat 是流式的自由对话：timeoutMs 按“多久没收到新数据”算，不是总时长。
  // gpt-5.4 的 max_tokens 含看不见的推理，2500 够讲 3 到 6 句再出一道题。
  chat:      { model: 'gpt-5.4',           maxTokens: 2500, timeoutMs: 90000, fallback: 'claude-sonnet-5.5' },
  // listen：把她说的话转成文字（Poe 的 file 写法，实测 gemini-3.1-pro 7-9 秒逐字转对）。别家模型收不了录音，所以没有备用
  listen:    { model: 'gemini-3.1-pro',    maxTokens: 1000, timeoutMs: 60000, fallback: '' },
  // v0.8 帮我出套题（quiz.js）：一次出一整套（最多 30 道，带答案和简要过程），再逐题核对
  quiz:      { model: 'claude-sonnet-5.5', maxTokens: 12000, timeoutMs: 180000, fallback: 'gemini-3.1-pro' },
};
export const TASK_LABELS = {
  recognize: '看照片', explain: '讲错题', variants: '出变式题', solve: '独立核对', hint: '提示', reflect: '老师的笔记本',
  chat: '自由问答', listen: '听写语音', quiz: '出套题',
};

// Poe parameters per model. Web search is always off: Gemini has it on by default, about 1900 points a search.
export const MODEL_PARAMS = {
  'gemini-3.1-pro': { web_search: false, thinking_level: 'low' },
  'gemini-3.8-flash': { web_search: false, thinking_level: 'medium' },
  'claude-sonnet-5.5': { web_search: false, effort: 'medium' },
  'claude-haiku-5.5': { web_search: false, effort: 'medium' },
  'claude-opus-4.8': { web_search: false, output_effort: 'medium' },
  // 10-24 晚实测流式：medium 第一个字 3.6 秒、讲完约 7 秒，low 反而 6 秒才出第一个字；verbosity low 让它少说废话
  'gpt-5.4': { web_search: false, reasoning_effort: 'medium', verbosity: 'low' },
};
// A model typed in by the parent that is not in the table: still no web search (all six bake-off models took it).
export const DEFAULT_MODEL_PARAMS = { web_search: false };

// USD per million tokens [input, output], Poe /v1/models prices of 2026-10-24.
export const PRICES_USD = { 'gemini-3.1-pro': [2.02, 12.12], 'gemini-3.8-flash': [0.76, 3.79], 'claude-sonnet-5.5': [2.02, 10.10],
  'claude-haiku-5.5': [0.10, 0.51], 'claude-opus-4.8': [4.29, 21.46], 'gpt-5.4': [2.27, 13.64] };
export const FALLBACK_PRICE_USD = [5, 25];   // 不认识的模型往贵了算，宁可早停

// ai.js: waits between retries of a 429 / 5xx / network failure; the most max_tokens a cut-off reply can grow to;
// how long a mock answer takes; how many requests the parent area's “最近的请求” keeps (memory only).
export const RETRY_DELAYS = [1500, 3000];
export const MAX_TOKENS_CAP = 12000;
export const MOCK_DELAY_MS = [300, 900];
export const RECENT_CAP = 50;
export const MOCK_STREAM_MS = 40;
export const MOCK_LISTEN_MS = 800;

// 语音转写：'poe'（默认，走上面的 listen 任务）| 'doubao'（火山引擎豆包，Wei 给 Key 以后在家长区切过去；失败自动退回 poe）
export const ASR_OPTIONS = ['poe', 'doubao'];
// 豆包“大模型录音文件识别极速版”。未验证：等 Wei 给 App ID 和 Access Key 实测（voice.js）。resourceId 可以在
// settings.doubao.resourceId 里改，不用改代码
export const DOUBAO_ASR = {
  url: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',
  resourceId: 'volc.bigasr.auc_turbo',
  timeoutMs: 30000,
};

// taskModels: { task: model } the parent changed; a task not in it uses TASKS[task].model.
// dailyCapUSD: budget.js stops paid calls once today's estimate reaches it (0 stops them all).
// asr: who turns her voice into text ('poe' | 'doubao'); doubao: { appId, accessKey } from the Volcengine console
// (resourceId optional). Both only matter for voice.js.
// v0.7 语音照搬英语 App（voice-input.js）：asrProvider 'auto'（填了 doubaoToken 就用豆包流式）| 'poe'；doubaoAppId、doubaoToken、
// doubaoCluster 和英语 App 同名，数学 App 没填时开机从英语 App 拿（asrFrom 'english'）。asr、doubao 是 v0.3 的旧字段，不再用。
export const DEFAULT_SETTINGS = { poeUrl: '', poeKey: '', taskModels: {}, dailyCapUSD: 0.4, mock: false,
  asr: 'poe', doubao: { appId: '', accessKey: '' },
  asrProvider: 'auto', doubaoAppId: '', doubaoToken: '', doubaoCluster: '', asrFrom: '' };
