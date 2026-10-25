// 分拣（DESIGN 4.9、6.1）：期中前错题袋里积了一堆旧错题，先不一道道讲，每道只走“我看到的题对吗”和“先自己找”两屏。
// 自己改对的，收成轻卡（约 30 秒一道，不占今天的新讲名额，讲题请求照样发，费用不变）；改不出来的放进待讲，以后再仔细讲。
// 她不会在这里被讲解、被提示：分拣只问一件事，这道你自己能不能改对。
//
//   TRIAGE                       她看到的文案（弯引号，不用破折号和感叹号，句子短）
//   canTriage(picks) -> bool     这一页勾了至少 2 道才给“先分拣”
//   startPlan(picks) -> { first, rest, state } | null
//       first 先去确认屏的那道，rest 是剩下的（flow.queue，也先写进待讲，中途走掉不丢），
//       state 写进 flow.triage：{ total, parked }。名额不挡分拣：自己改对的本来就不占名额
//   beyondSelfFix(st) -> bool    讲题状态走到了要提示或讲解的地方（hint1 / hint2 / explain）：分拣到此为止，这道放进待讲
//   parkedState(tri) -> tri      放进待讲一道以后的分拣状态（parked + 1）
//   progressLine(tri, restLeft) -> '分拣：第 3 道，共 8 道。'   restLeft 是这一道之后还排着几道
//   finishLine(tri) -> '分拣完了：5 道自己改对，收进本子了；3 道放进待讲。'
//
// flow.triage 只在这一轮分拣里有；flow.clear()、ui-capture 开始普通讲题（triage: false）都会把它去掉。

export const TRIAGE = {
  offer: '先分拣一遍',
  offerNote: '分拣：每道先自己改一改。改对的约 30 秒收进本子，不占今天的名额；改不出来的放进待讲，以后再仔细讲。',
  skip: '这道我先不改，放进待讲',
  parkedOne: '这道放进待讲了，先看下一道。',
};

export const TRIAGE_MIN = 2;

export const canTriage = picks => Array.isArray(picks) && picks.length >= TRIAGE_MIN;

export function startPlan(picks) {
  if (!canTriage(picks)) return null;
  return { first: picks[0], rest: picks.slice(1), state: { total: picks.length, parked: 0 } };
}

// 走到提示或讲解：她自己改不出来。noWork（订正过的卷子，不看她的步骤）一进来就是 explain，也在这里放进待讲
const BEYOND = new Set(['hint1', 'hint2', 'explain']);
export const beyondSelfFix = st => !!st && BEYOND.has(st.step);

export const parkedState = tri => ({ ...(tri || {}), parked: ((tri && tri.parked) || 0) + 1 });

const n = x => Math.max(0, Number(x) || 0);

export function progressLine(tri, restLeft = 0) {
  const total = n(tri && tri.total);
  if (!total) return '';
  const k = Math.min(total, Math.max(1, total - n(restLeft)));
  return `分拣：第 ${k} 道，共 ${total} 道。`;
}

export function finishLine(tri) {
  const total = n(tri && tri.total), parked = Math.min(total, n(tri && tri.parked)), fixed = total - parked;
  if (!total) return '';
  const a = fixed ? `${fixed} 道自己改对，收进本子了` : '';
  const b = parked ? `${parked} 道放进待讲` : '';
  return `分拣完了：${[a, b].filter(Boolean).join('；')}。`;
}
