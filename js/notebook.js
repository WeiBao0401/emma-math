// 错因卡：one card per wrong problem she worked through, scheduled for spaced, mixed re-practice until it is beaten
// (research 03 §2.3-2.5, 02 §2.6). Pure functions over plain objects; db.js stores them in "items", the UI shows them.
//
// Schedule (research 03 §2.3): the same day she does one twin problem in the explain flow (stage 0). Then
//   stage 1  day 1-2   redo the original problem (explanation hidden) + one 近变式
//   stage 2  ~day 7    one 近变式 + one 辨析, mixed into other cards
//   stage 3  ~day 21   one 远变式, mixed
// A review counts as passed only when every problem of it was right on the first try without a hint. Pass: next stage.
// Any miss: back to stage 1, due tomorrow, and the streak starts over.
// 攻克 (research 03 §2.4): 3 passed spaced reviews in a row, at least 14 days from the first to the last, one of them
// a 远变式 or mixed review. After that the card rests until an exam season wakes it (wake()).
//
//   newCard({ id, problem, diagnosis, photoId, crop, today }) -> card
//   reviewPlan(card) -> [{ kind: 'redo' | 'variant', level }]       what this card's next review asks for
//   recordReview(card, { results: [{ ok, firstTry, hints, kind, level }], today }) -> card   (returns a new object)
//   due(cards, today) -> cards due today or overdue, oldest first
//   todayQueue(cards, today, { max, light }) -> [{ cardId, kind, level }]   mixed: neighbours differ in tag, ≤ 2 per card
//   wake(cards, today) -> cards       exam season: every beaten card gets one more mixed review
//   stats(cards) -> { total, byStatus, byType, bySection, beatenThisWeek }
//   addDays(day, n), dayOf(date)      'YYYY-MM-DD' in local time
//
// card = { id, at, day, photoId, crop, problem, diagnosis, tag, type, section, status, stage, due, streak,
//          streakFrom, reviews: [{ day, passed, results }], pool: [variant], used: [q], askTeacher }
// status: 'learning' | 'beaten' | 'ask' (the answer could not be checked: 问老师, not scheduled)
//
// 界面阶段加的（C 4.2、4.4，CONTRACTS 12；ui-home、ui-book 写，ui-explain、ui-practice、ui-capture 也用）
//   mergeInto(card, { problem, crop, thumb, photoId, source, found, today, at, extra }) -> card
//       同坑合并：新题挂到 originals，卡回第 1 档、明天到期、streak 清零（攻克了的重新在练）。新题要讲解才弄懂的
//       （found 不是 'self'），轻卡变正常卡。
//   lightCard(args) -> card      自己改对的轻卡（newCard 的参数，另加 found，默认 'self'）：第 2 天 1 道同构题（没有就近变式），
//       做对就休息（due ''，restOn），考前 wake() 叫回来；没做对就变正常卡，回第 1 档。
//   selfFixes(cards, tag, today) -> n            这个坑最近 7 天（含今天）自己改对了几次（卡本身 + originals）
//   promoteLight(cards, tag, today) -> cards     满 3 次：这个坑的轻卡升成正常卡（checkpoint: true，第 1 档，明天）。
//       变了的卡是新对象，没变的原样返回，所以 out.filter((c, i) => c !== cards[i]) 就是要存的。
//   sameTrap(cards, tag) -> card | null          新题该合并进哪张卡：同一个坑、不是问老师；在练的正常卡优先
//   fileProblem(cards, args) -> { card, merged, changed }   “收进本子”一步：合并、轻卡或新卡，再看要不要升轻卡；
//       changed 是别的被升级的卡。args 同 newCard，另加 thumb、source、found、extra（新卡上的其他字段，如 mySentence）
//   quotaFor(day, { exam, light }) -> { newMax, reviewMax, weekend, examSeason, light }
//       新讲名额：上学日 2、周末 5、期中季上学日 3；复习上限：上学日 6、周末 10、轻松版 3
//   inExamSeason(day, exam), isWeekend(day), isLate(date)    期中季 = 考试前 14 天到考完；21:00 以后算晚
//   shortName(card, curriculum) -> 12 字以内的坑名（SHORT_NAMES 先，没有再从课程数据和诊断里截）
//   SHORT_NAMES                  七上 76 个错因 id 的短名，家长过目
//
// v1 期中季（DESIGN 2.4、4.9，C 9.3，调研 03 2.11）。只追一件够得着的事：范围内每个犯过的坑，考前独立做对一次。
//   examPlan(cards, exam, today, { paperDone }) -> { daysLeft, phase, wake: [cardId], note }
//       phase  'none'    没填日期、离考试多于 21 天、考完超过 3 天
//              'season'  离考试 6 到 21 天。wake 是范围内跨过去的卡和休息中的轻卡（各叫醒一次，调用方用 wake() 叫，
//                        首页第一次进期中季时做，kv 'examWoke' 记着）
//              'paper'   考前 3 到 5 天，推荐错题卷（拆两半，一半 15 分钟）。日历 A 来不及：调用方明说卷子还没做
//                        （paperDone === false）时，考前第 2 天也算 paper（DESIGN 2.4）
//              'rest'    考前 2 天到考完：只推轻松版复习，不推新讲
//              'after'   考完后 3 天内：提醒把发回来的卷子拍进来
//       note 是首页那一行（孩子看的字），phase 'none' 时 ''。daysLeft 没填日期时是 null
//   compressDue(card, exam, today) -> card      考前压缩，recordReview（或 newCard、fileProblem）之后由调用方套用；
//       没变就原样返回（c === card），变了是新对象，带 examMoved: { exam, from }。两条规矩：
//       过了第 1 档的卡（stage ≥ 2），下一次排在原来那天和“考前第 3 天”里较早的那天，和上一次复习至少隔 2 天，
//         排不下就不动（错题卷里会放它一题）；
//       考前 2 天内新建（或刚并进新题）的卡只做当天的同构题，下一次排到考完的第二天。
//   inExamRange(card, exam) -> bool              卡在不在考试范围：按节（'2.3.1' 算在 '2.3' 里）；没选范围、卡没有节都算
//   examEnd(exam) -> 'YYYY-MM-DD'                考试最后一天（没有 end 就是 date）
// 期中季这个词有两个窗口：quotaFor 的新讲名额 3 道还是 inExamSeason 的 14 天（CONTRACTS 12），examPlan 的 season 是 21 天
// （DESIGN 4.9 “离考试不到 21 天”）。
// 轻卡让 reviewPlan、recordReview、wake 多了一个分支（card.light 为真时），正常卡的行为一点没变。
// 卡上另加的字段：light、found、restOn、promotedOn、checkpoint、mergedOn、originals[]（见 CONTRACTS 12）。

export const STAGES = [
  { stage: 1, gap: 1, plan: [{ kind: 'redo', level: '原题' }, { kind: 'variant', level: '近变式' }] },
  { stage: 2, gap: 6, plan: [{ kind: 'variant', level: '近变式' }, { kind: 'variant', level: '辨析' }] },
  { stage: 3, gap: 14, plan: [{ kind: 'variant', level: '远变式' }] },
];
export const BEAT_STREAK = 3, BEAT_SPAN_DAYS = 14;

const pad = n => String(n).padStart(2, '0');
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return dayOf(new Date(y, m - 1, d + n));
}
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);

export function newCard({ id, problem, diagnosis = {}, photoId = '', crop = '', today = dayOf(), at = new Date().toISOString() }) {
  const unsure = diagnosis.checked === 'unsure';
  return {
    id, at, day: today, photoId, crop, problem, diagnosis,
    tag: diagnosis.tag || '', type: diagnosis.error_type || '', section: diagnosis.section || '',
    status: unsure ? 'ask' : 'learning', askTeacher: unsure,
    stage: 1, due: unsure ? '' : addDays(today, STAGES[0].gap), streak: 0, streakFrom: '',
    reviews: [], pool: [], used: [],
  };
}

// 轻卡（自己改对的）第 2 天只要 1 道：先用讲题时核对过、当天没做的同构题（ui-explain 放进了卡的池子，C 4.4，不再花钱出题），
// 没有就退回近变式（v0.3.1）。levels 交给 ui-practice.pickVariant 按顺序找
export const LIGHT_PLAN = [{ kind: 'variant', level: '同构', levels: ['同构', '近变式'] }];

export function reviewPlan(card) {
  if (card && card.light) return LIGHT_PLAN.map(p => ({ ...p }));
  const s = STAGES.find(x => x.stage === card.stage) || STAGES[STAGES.length - 1];
  return s.plan.map(p => ({ ...p }));
}

export function recordReview(card, { results = [], today = dayOf() } = {}) {
  const c = structuredClone(card);
  // Redoing the original only counts when it goes wrong: a right redo may be a remembered answer (DESIGN 冲突表),
  // so passing needs at least one new problem right on the first try without a hint.
  const fresh = results.filter(r => r.kind !== 'redo');
  const redoOk = results.filter(r => r.kind === 'redo').every(r => r.ok);
  const firstTryOk = r => r.ok && r.firstTry !== false && !r.hints;
  if (!fresh.length && results.length && redoOk) {
    // only the original was done (no new problem was ready): keep the stage, look again tomorrow
    c.reviews.push({ day: today, passed: false, held: true, results });
    for (const r of results) if (r.q) c.used.push(r.q);
    c.due = addDays(today, 1);
    return c;
  }
  const passed = fresh.length > 0 && fresh.every(firstTryOk) && redoOk;
  c.reviews.push({ day: today, passed, results });
  for (const r of results) if (r.q) c.used.push(r.q);
  // 轻卡：做对了就休息到考前；没做对说明不只是一时手滑，变成正常卡从第 1 档练（C 4.4）
  if (c.light) {
    if (passed) { c.due = ''; c.restOn = today; return c; }
    c.light = false; c.promotedOn = today;
  }
  if (!passed) {
    c.stage = 1; c.streak = 0; c.streakFrom = ''; c.status = 'learning';
    c.due = addDays(today, 1);
    return c;
  }
  if (!c.streak) c.streakFrom = today;
  c.streak += 1;
  const far = c.reviews.slice(-c.streak).some(r => r.results.some(x => x.level === '远变式' || x.mixed));
  if (c.streak >= BEAT_STREAK && daysBetween(c.streakFrom, today) >= BEAT_SPAN_DAYS && far) {
    c.status = 'beaten'; c.due = ''; c.beatenOn = today;
    return c;
  }
  const next = STAGES.find(x => x.stage === c.stage + 1);
  if (next) { c.stage = next.stage; c.due = addDays(today, next.gap); } else { c.due = addDays(today, STAGES[STAGES.length - 1].gap); }
  return c;
}

export const due = (cards, today = dayOf()) => cards
  .filter(c => c.status === 'learning' && c.due && c.due <= today)
  .sort((a, b) => a.due.localeCompare(b.due) || a.at.localeCompare(b.at));

// Mixed order: never two problems of the same tag (or, without a tag, the same error type) next to each other when
// another choice exists; at most 2 problems from one card a day (research 03 §2.3, Rohrer 2020).
export function todayQueue(cards, today = dayOf(), { max = 6, light = false } = {}) {
  const cap = light ? Math.min(max, 4) : max;
  const lanes = due(cards, today).map(c => ({ c, items: reviewPlan(c).slice(0, 2) }));
  const out = [];
  let last = null;
  while (out.length < cap && lanes.some(l => l.items.length)) {
    const open = lanes.filter(l => l.items.length);
    const key = l => l.c.tag || l.c.type || l.c.id;
    const pick = open.find(l => key(l) !== last) || open[0];
    const item = pick.items.shift();
    out.push({ cardId: pick.c.id, ...item });
    last = key(pick);
  }
  return out;
}

export function wake(cards, today = dayOf()) {
  return cards.map(c => {
    if (c.status === 'beaten') return { ...structuredClone(c), status: 'learning', stage: 3, due: today, woken: today };
    // 休息中的轻卡考前也回来一次
    if (c.light && c.status === 'learning' && !c.due) return { ...structuredClone(c), due: today, woken: today };
    return c;
  });
}

export function stats(cards, today = dayOf()) {
  const count = (f) => cards.reduce((m, c) => { const k = f(c) || '其他'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const weekAgo = addDays(today, -7);
  return {
    total: cards.length,
    byStatus: count(c => c.status),
    byType: count(c => c.type),
    bySection: count(c => c.section),
    beatenThisWeek: cards.filter(c => c.status === 'beaten' && c.beatenOn && c.beatenOn > weekAgo).length,
  };
}

// ---------------------------------------------------------------- 界面阶段：同坑合并、轻卡、名额、坑名

// 同一个坑后来又错的原题挂到这张卡上，一晚 4 道去括号的错题只出一张卡（C 4.4）
export function mergeInto(card, { problem = null, crop = '', thumb = '', photoId = '', source = '', found = '', today = dayOf(), at = new Date().toISOString(), extra = {} } = {}) {
  const c = structuredClone(card);
  c.originals = [...(Array.isArray(c.originals) ? c.originals : []), { ...extra, problem, crop, thumb, photoId, source, found, day: today, at }];
  c.light = !!c.light && found === 'self';
  c.mergedOn = today;
  delete c.restOn;
  c.stage = 1; c.streak = 0; c.streakFrom = '';
  if (c.status === 'ask') { c.due = ''; return c; }   // 问老师的卡不排练习（sameTrap 也不会选它）
  c.status = 'learning';
  c.due = addDays(today, STAGES[0].gap);
  return c;
}

export function lightCard(args = {}) {
  const c = newCard(args);
  if (c.status === 'ask') return c;   // 答案核对不了的，自己改对了也先问老师
  return { ...c, light: true, found: args.found || 'self' };
}

export const LIGHT_PROMOTE_AT = 3, LIGHT_WINDOW_DAYS = 7;

export function selfFixes(cards, tag, today = dayOf()) {
  if (!tag) return 0;
  const from = addDays(today, -(LIGHT_WINDOW_DAYS - 1));
  const inWindow = d => typeof d === 'string' && d >= from && d <= today;
  let n = 0;
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || c.tag !== tag) continue;
    if (c.found === 'self' && inWindow(c.day)) n++;
    for (const o of Array.isArray(c.originals) ? c.originals : []) if (o && o.found === 'self' && inWindow(o.day)) n++;
  }
  return n;
}

// 同一个坑一周内自己改对 3 次：不是手滑了，升成正常卡，复习题旁边出“检查点”（C 4.4，调研 02 2.2）
export function promoteLight(cards, tag, today = dayOf()) {
  const list = Array.isArray(cards) ? cards : [];
  if (!tag || selfFixes(list, tag, today) < LIGHT_PROMOTE_AT) return list;
  return list.map(c => (c && c.tag === tag && c.light && c.status === 'learning'
    ? { ...structuredClone(c), light: false, checkpoint: true, promotedOn: today, stage: 1, streak: 0, streakFrom: '', due: addDays(today, STAGES[0].gap) }
    : c));
}

export function sameTrap(cards, tag) {
  if (!tag) return null;
  const rank = c => (c.status === 'learning' && !c.light ? 0 : c.status === 'learning' ? 1 : 2);
  const mine = (Array.isArray(cards) ? cards : []).filter(c => c && c.tag === tag && (c.status === 'learning' || c.status === 'beaten'));
  return mine.sort((a, b) => rank(a) - rank(b) || String(a.at || '').localeCompare(String(b.at || '')))[0] || null;
}

export function fileProblem(cards, { id, problem, diagnosis = {}, photoId = '', crop = '', thumb = '', source = '', found = '', today = dayOf(), at = new Date().toISOString(), extra = {} } = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const unsure = diagnosis.checked === 'unsure';
  const home = unsure ? null : sameTrap(list, diagnosis.tag);
  let card;
  if (home) {
    card = mergeInto(home, { problem, crop, thumb, photoId, source, found, today, at, extra });
  } else {
    const args = { id, problem, diagnosis, photoId, crop, today, at };
    const base = found === 'self' ? lightCard({ ...args, found }) : newCard(args);
    card = { ...base, light: !!base.light, thumb, source, found, originals: [], flagged: [], ...extra };
  }
  if (found !== 'self' || !card.tag) return { card, merged: !!home, changed: [] };
  const others = list.filter(c => c && c.id !== card.id);
  const before = [...others, card];
  const after = promoteLight(before, card.tag, today);
  return { card: after[after.length - 1], merged: !!home, changed: after.slice(0, -1).filter((c, i) => c !== before[i]) };
}

export const QUOTA = { school: { newMax: 2, reviewMax: 6 }, weekend: { newMax: 5, reviewMax: 10 }, examSchoolNewMax: 3, lightReviewMax: 3 };
export const EXAM_SEASON_DAYS = 14, LATE_HOUR = 21;

const weekdayOf = day => { const [y, m, d] = String(day).split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
export const isWeekend = day => { const w = weekdayOf(day); return w === 0 || w === 6; };
export const isLate = (date = new Date()) => new Date(date).getHours() >= LATE_HOUR;
const ymdOf = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');

// exam = kv 'exam' { date, end?, sections }：考试第一天、最后一天（没有就当一天考完）
export function inExamSeason(day, exam) {
  const start = ymdOf(exam && exam.date);
  if (!start) return false;
  const end = ymdOf(exam.end) || start;
  return day >= addDays(start, -EXAM_SEASON_DAYS) && day <= (end > start ? end : start);
}

// 名额只算要讲解的新题（她自己改对的不占），复习按题数算（C 4.4）
export function quotaFor(day = dayOf(), { exam = null, light = false } = {}) {
  const weekend = isWeekend(day);
  const examSeason = inExamSeason(day, exam);
  const base = weekend ? QUOTA.weekend : QUOTA.school;
  return {
    newMax: !weekend && examSeason ? QUOTA.examSchoolNewMax : base.newMax,
    reviewMax: light ? Math.min(base.reviewMax, QUOTA.lightReviewMax) : base.reviewMax,
    weekend, examSeason, light: !!light,
  };
}

// ---------------------------------------------------------------- v1 期中季（DESIGN 2.4、4.9）

export const EXAM_WINDOW_DAYS = 21, EXAM_PAPER_FROM = 5, EXAM_PAPER_TO = 3, EXAM_REST_DAYS = 2, EXAM_AFTER_DAYS = 3, EXAM_MIN_GAP = 2;
const isYmd = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

export function examEnd(exam) {
  const start = ymdOf(exam && exam.date);
  const end = ymdOf(exam && exam.end);
  return end > start ? end : start;
}

// 范围是家长选的节（ui-parent examRecord：'1.1'、'2.3'……）；卡上的节可能细到 '2.3.1'。没选范围时都算：期中前学过的
// 多半就是要考的。卡上没有节的也算，宁可多叫醒一张，也别让一个坑考前没碰过
export function inExamRange(card, exam) {
  const list = (exam && Array.isArray(exam.sections) ? exam.sections : []).map(s => String(s || '').trim()).filter(Boolean);
  if (!list.length) return true;
  const raw = card && (card.section || (card.diagnosis && card.diagnosis.section));
  const sec = String(raw || '').trim().split(/\s+/)[0];
  if (!sec) return true;
  return list.some(s => sec === s || sec.startsWith(s + '.') || s.startsWith(sec + '.'));
}

// 这张卡最近一次被考过（复习、休息、跨过去）是哪天
const lastSeen = c => {
  const r = Array.isArray(c.reviews) && c.reviews.length ? c.reviews[c.reviews.length - 1] : null;
  return [r && r.day, c.restOn, c.beatenOn].filter(isYmd).sort().pop() || '';
};

export const EXAM_NOTES = {
  season: n => `离期中还有 ${n} 天。这周把范围里的坑各做对一次就好。`,
  paper: '考前做一份错题卷吧，拆成两半，一半 15 分钟。',
  paperDone: '错题卷做完了。卷上错的题，再过一遍就好。',
  rest: '考前两天，轻松复习，早点睡。',
  examDay: '今天考试。轻松复习一下，早点睡。',
  examDays: '考试这几天，轻松复习，早点睡。',
  after: '考完了。卷子发回来，拍进来我们一起看。',
};

export function examPlan(cards = [], exam = null, today = dayOf(), { paperDone } = {}) {
  const date = ymdOf(exam && exam.date);
  if (!date || !isYmd(today)) return { daysLeft: null, phase: 'none', wake: [], note: '' };
  const end = examEnd(exam);
  const daysLeft = daysBetween(today, date);
  const out = { daysLeft, phase: 'none', wake: [], note: '' };
  if (today > end) {
    if (daysBetween(end, today) <= EXAM_AFTER_DAYS) { out.phase = 'after'; out.note = EXAM_NOTES.after; }
    return out;
  }
  if (daysLeft > EXAM_WINDOW_DAYS) return out;
  if (daysLeft > EXAM_PAPER_FROM) {
    out.phase = 'season';
    out.note = EXAM_NOTES.season(daysLeft);
    // 跨过去的卡、休息中的轻卡各回来一题（DESIGN 4.4、4.5）。这 3 周里已经叫醒过、或者已经考过一次的不再叫
    const from = addDays(date, -EXAM_WINDOW_DAYS);
    out.wake = (Array.isArray(cards) ? cards : [])
      .filter(c => c && c.id != null && inExamRange(c, exam)
        && (c.status === 'beaten' || (c.light && c.status === 'learning' && !c.due))
        && !(isYmd(c.woken) && c.woken >= from) && !(lastSeen(c) >= from))
      .map(c => c.id);
    return out;
  }
  if (daysLeft >= EXAM_PAPER_TO || (daysLeft === EXAM_REST_DAYS && paperDone === false)) {
    out.phase = 'paper';
    out.note = paperDone === true ? EXAM_NOTES.paperDone : EXAM_NOTES.paper;
    return out;
  }
  out.phase = 'rest';
  out.note = daysLeft > 0 ? EXAM_NOTES.rest : date === end ? EXAM_NOTES.examDay : EXAM_NOTES.examDays;
  return out;
}

export function compressDue(card, exam, today = dayOf()) {
  const date = ymdOf(exam && exam.date);
  if (!card || !date || !isYmd(today) || card.status !== 'learning' || !isYmd(card.due) || !inExamRange(card, exam)) return card;
  const end = examEnd(exam);
  const left = daysBetween(today, date);
  if (today > end || left > EXAM_WINDOW_DAYS) return card;
  const moved = due => ({ ...structuredClone(card), due, examMoved: { exam: date, from: card.due } });
  const reviews = Array.isArray(card.reviews) ? card.reviews : [];
  // 考前 2 天内新建、或刚并进新题的卡：当天做完同构题就停，下一次排到考后（考前不处理大批新错题，调研 03 2.11）
  if (left <= EXAM_REST_DAYS) {
    const restFrom = addDays(date, -EXAM_REST_DAYS);
    const born = isYmd(card.mergedOn) && card.mergedOn >= restFrom ? card.mergedOn : card.day;
    const fresh = card.stage === 1 && isYmd(born) && born >= restFrom && !reviews.some(r => r && r.day >= born);
    return fresh && card.due <= end ? moved(addDays(end, 1)) : card;
  }
  // 过了第 1 档的卡：下一次不晚于考前第 3 天，和上一次至少隔 2 天；排不下就照原样（错题卷里有它一题）
  if (card.light || !(card.stage >= 2)) return card;
  const target = addDays(date, -EXAM_PAPER_TO);
  if (card.due <= target) return card;
  const last = lastSeen(card) || today;
  const soonest = [addDays(last, EXAM_MIN_GAP), today].sort().pop();
  return target >= soonest ? moved(target) : card;
}

// 她看到的坑名（C 4.2）：12 字以内，说的是那个坑，不说她。七上全部 76 个错因 id，期中范围是第 1 到 3 章。
export const SHORT_NAMES = {
  'E-neg-has-minus': '带负号不一定是负数', 'E-zero-sign': '0 既不正也不负', 'E-rational-class': '哪些数是有理数',
  'E-opposite-meaning': '正负表示相反意义', 'E-numline-3elems': '数轴的三要素', 'E-numline-move': '数轴上左右移动',
  'E-dist-two-sides': '距离一样的点有两个', 'E-self-equal': '等于本身的数', 'E-abs-neg-a': '负数的绝对值',
  'E-abs-two-values': '绝对值有两个数', 'E-neg-compare': '负数比大小', 'E-abs-rule-overuse': '比数还是比绝对值',
  'E-multi-sign': '多重负号化简',
  'E-add-sign': '异号相加的符号', 'E-sub-neg': '减去负数', 'E-carry-sign': '换位置带上符号',
  'E-mul-sign-count': '数负号定积的符号', 'E-mul-neg-neg': '负负得正只管乘除', 'E-div-distrib': '除法不能拆开分配',
  'E-div-order': '乘除从左往右', 'E-recip': '倒数怎么写', 'E-mixed-num-sign': '负带分数的符号', 'E-zero-div': '0 不能做除数',
  'E-pow-neg-paren': '乘方前面的负号', 'E-pow-as-mul': '乘方不是乘指数', 'E-pow-frac-scope': '分数乘方要加括号',
  'E-pow-sign-odd': '−1 的奇数次和偶数次', 'E-order-ops': '先乘方再乘除', 'E-sci-notation': '科学记数法',
  'E-approx-place': '近似数精确到哪一位', 'E-approx-trailing-zero': '近似数末尾的 0', 'E-round-chain': '四舍五入只看一位',
  'E-closure': '代数式就是结果', 'E-word-order': '谁是谁的几倍', 'E-sq-sum-vs-sum-sq': '平方和与和的平方',
  'E-alg-notation': '代数式的写法', 'E-percent-base': '百分数的基准', 'E-two-digit': '两位数怎么表示',
  'E-subst-neg-paren': '代入负数忘加括号', 'E-subst-whole': '整体代入', 'E-pattern-index': '找规律数清第几个',
  'E-mono-degree-pi': 'π 是数不算次数', 'E-coef-one': '系数里的负号', 'E-poly-degree': '多项式的次数',
  'E-like-terms-def': '什么是同类项', 'E-conjoin': '不是同类项不能合并', 'E-paren-minus': '去括号要变号',
  'E-paren-distribute': '去括号漏乘', 'E-sub-poly-paren': '减多项式要加括号', 'E-simplify-then-sub': '先化简再求值',
  'E-indep-of-x': '值与 x 无关', 'E-like-coef-sign': '合并时带上符号',
  'E-eq-sign-do': '等号两边要相等', 'E-eq-property-div0': '两边不能除以 0', 'E-move-term-sign': '移项要变号',
  'E-coef-to-one': '系数化为 1', 'E-denom-miss': '去分母漏乘', 'E-denom-numerator-paren': '去分母加括号',
  'E-decimal-denom': '小数分母化整数', 'E-paren-in-eq': '方程里去括号', 'E-linear-def': '一次项系数不为 0',
  'E-word-head-start': '先出发的那段路', 'E-profit-base': '打折和利润率', 'E-work-rate': '工作效率相加',
  'E-answer-asked': '答题目问的那个量',
  'E-solid-net': '正方体展开图', 'E-line-ray-seg': '直线射线线段', 'E-count-segments': '数线段不重不漏',
  'E-distance-def': '两点间的距离', 'E-midpoint-cases': '点在直线上两种位置', 'E-angle-arms': '角的大小和边长无关',
  'E-angle-naming': '角的名字怎么写', 'E-dms-base60': '度分秒是六十进制', 'E-comp-supp': '余角和补角',
  'E-angle-cases': '射线在角内还是角外', 'E-bearing': '方位角从南北量起',
};

export const SHORT_MAX = 12;
const cps = s => [...String(s || '')];
// 去掉公式和引号，取第一小句；还长就截到 12 个字
function clip(text) {
  const s = String(text || '').replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, '').replace(/[“”"「」]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const first = s.split(/[，。；：;:,！？!?]/).map(x => x.trim()).find(x => cps(x).length >= 2) || '';
  return cps(first).slice(0, SHORT_MAX).join('').trim();
}

export function shortName(card, curriculum = null) {
  const c = card || {};
  const d = c.diagnosis || {};
  const tag = c.tag || d.tag || '';
  const fits = s => s && cps(s).length <= SHORT_MAX;
  for (const s of [c.shortName, SHORT_NAMES[tag]]) if (fits(String(s || '').trim())) return String(s).trim();
  const err = curriculum && typeof curriculum.error === 'function' ? curriculum.error(tag) : null;
  if (err && fits(err.short)) return err.short;
  const tagged = curriculum && Array.isArray(curriculum.tags) ? curriculum.tags.find(t => t.id === tag) : null;
  for (const s of [d.remember, tagged && tagged.name, err && err.wrong]) { const x = clip(s); if (cps(x).length >= 3) return x; }
  const sec = curriculum && typeof curriculum.section === 'function' ? curriculum.section(c.section || d.section) : null;
  if (sec && sec.title) return cps(`${sec.title}里的坑`).slice(0, SHORT_MAX).join('');
  return '这道题的坑';
}
