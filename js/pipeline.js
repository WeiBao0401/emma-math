// The path from a photo to explained, checked problems (DESIGN 3, 5, 9). Rule one: nothing reaches her unless its
// answer was checked, by the program (mathcheck.compute) or by a second model of another family solving it alone
// (research 03 §2.10, 05 E3; Bastani 2025: GPT-4 without a checked solution got half the problems right).
//
//   createPipeline({ ai, curriculum }) -> {
//     readPhoto(dataURL, { signal }) -> Page                  看照片：识别 + 规整（normalizePage）
//     diagnose(problem, imageURL, { signal }) -> Diagnosis    讲一道错题：诊断、提示阶梯、同构题，答案和同构题都核对过
//     variants(card, levels, { signal }) -> Variant[]         出变式题，只留核对过、真能考出她的坑的
//     verify(item, { signal }) -> { status, by, other }       核对一道题的答案（diagnose / variants 内部用，也给复习用）
//     retryHint({ q, given, answer, reason }, { signal }) -> string   练习做错后的一句提示（先用 localHint，不够再问模型）
//   }
//   normalizePage(raw) -> Page        normalizeDiagnosis(raw) -> Diagnosis
//   wrongProblems(page) -> Problem[]  老师打叉或半对的题
//   boxToRect(box, rotation, pad) -> { x, y, w, h }   模型的 0-1000 框 -> image.crop 用的 0-1 比例框（放宽 pad）
//   localHint(reason) -> string       mathcheck 的 reason 对应的一句话提示，不花钱
//   otherFamily(model) -> model       核对用另一家的模型
//
// Page      { graded, rotation, personal, page, problems: Problem[] }
// Problem   { idx, no, box, type, stem, options, figure, her_work, her_answer, mark, teacher_note, circled, unclear }
// Diagnosis { answer, answer_kind, form, unit, solution, wrong_line, wrong_step, error_type, tag, section, why,
//             hint1: { q, options, answer }, hint2, explain, self_explain: { q, options, answer }, remember,
//             twin: { q, answer, answer_kind, form, trap_answer } | null, doubt,
//             checked: 'program' | 'models' | 'soft' | 'unsure', model, checkModel, checkWhy }
//             'soft' = not fully confirmed (the check failed, the checker was unsure, wording not comparable, three
//             models gave three answers, or the first explanation was wrong and was taught again): still taught, with
//             a quiet line. diagnose never returns 'unsure' (Wei 10-25: always help); 'unsure' only comes from her own
//             “我觉得我是对的” on the confirm screen
// Variant   { level, q, answer, answer_kind, form, unit, trap, trap_answer, steps, checked: 'program' | 'models' }
import { TASKS } from './config.js';
import { check, compute } from './mathcheck.js';
import { SYSTEM, diagnoseSystem, variantsSystem, userRecognize, userDiagnose, userVariants, userSolve, userRetry } from './prompts.js';

const MARKS = new Set(['wrong', 'half', 'right', 'none']);
const KINDS = new Set(['number', 'expr', 'equation', 'set', 'choice', 'compare', 'text']);
const str = v => (v == null ? '' : String(v)).trim();
const strs = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);

export function normalizePage(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rot = Number(r.rotation);
  const problems = (Array.isArray(r.problems) ? r.problems : []).map((p, idx) => {
    const box = Array.isArray(p && p.box) && p.box.length === 4 && p.box.every(n => Number.isFinite(Number(n)))
      ? p.box.map(n => Math.max(0, Math.min(1000, Number(n)))) : null;
    const mark = str(p && p.mark).toLowerCase();
    return {
      idx, no: str(p && p.no), box, type: str(p && p.type), stem: str(p && p.stem), options: strs(p && p.options),
      figure: str(p && p.figure), her_work: strs(p && p.her_work), her_answer: str(p && p.her_answer),
      mark: MARKS.has(mark) ? mark : 'none', teacher_note: str(p && p.teacher_note), circled: str(p && p.circled),
      unclear: !!(p && p.unclear) || /\[\?\]/.test(JSON.stringify(p || {})),
      corrected: !!(p && p.corrected),
    };
  }).filter(p => p.stem || p.her_answer || p.her_work.length);
  const graded = r.graded === true || problems.some(p => p.mark === 'wrong' || p.mark === 'half' || p.mark === 'right');
  return { graded, rotation: [0, 90, 180, 270].includes(rot) ? rot : 0, personal: !!r.personal, page: str(r.page), problems };
}

export const wrongProblems = page => (page && page.problems || []).filter(p => p.mark === 'wrong' || p.mark === 'half');

// box is [ymin, xmin, ymax, xmax] in 0-1000 on the photo as sent. The photo is cropped after the app turned it upright,
// so the box is turned the same way first (rotation = clockwise degrees the model said the photo needs).
export function boxToRect(box, rotation = 0, pad = 0.03) {
  if (!box) return null;
  let [y0, x0, y1, x1] = box.map(n => n / 1000);
  if (y1 < y0) [y0, y1] = [y1, y0];
  if (x1 < x0) [x0, x1] = [x1, x0];
  const turn = ({ 90: 1, 180: 2, 270: 3 })[rotation] || 0;
  for (let i = 0; i < turn; i++) [x0, y0, x1, y1] = [1 - y1, x0, 1 - y0, x1];   // 90° clockwise: (x, y) -> (1 − y, x)
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(1, x1 + pad); y1 = Math.min(1, y1 + pad);
  if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const two = o => (o && Array.isArray(o.options) && o.options.length >= 2
  ? { q: str(o.q), options: o.options.slice(0, 2).map(str), answer: Number(o.answer) === 1 ? 1 : 0 } : null);
const kindOf = k => (KINDS.has(str(k)) ? str(k) : '');

export function normalizeDiagnosis(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const twin = r.twin && str(r.twin.q) && str(r.twin.answer)
    ? { q: str(r.twin.q), answer: str(r.twin.answer), answer_kind: kindOf(r.twin.answer_kind), form: str(r.twin.form), trap_answer: str(r.twin.trap_answer) } : null;
  const wl = Number.isInteger(Number(r.wrong_line)) ? Number(r.wrong_line) : -1;
  return {
    answer: str(r.answer), answer_kind: kindOf(r.answer_kind), form: str(r.form), unit: str(r.unit),
    solution: strs(r.solution), wrong_line: wl, wrong_step: str(r.wrong_step), error_type: str(r.error_type), tag: str(r.tag),
    section: (str(r.section).match(/^\d+(?:\.[\dP]+)*/) || [str(r.section)])[0], why: str(r.why), hint1: two(r.hint1), hint2: str(r.hint2), explain: strs(r.explain).slice(0, 6),
    self_explain: two(r.self_explain), remember: str(r.remember), twin, doubt: str(r.doubt),
  };
}

function normalizeVariant(v) {
  return {
    level: str(v && v.level), q: str(v && v.q), answer: str(v && v.answer), answer_kind: kindOf(v && v.answer_kind),
    form: str(v && v.form), unit: str(v && v.unit), trap: str(v && v.trap), trap_answer: str(v && v.trap_answer), steps: strs(v && v.steps),
  };
}

// the checker must not share the generator's family: Claude-made answers go to Gemini, everything else to Claude
// the third opinion when the explainer and the checker disagree: a third family
export const TIEBREAK_MODEL = 'gpt-5.4';

export function otherFamily(model) {
  const fam = m => (/^claude/i.test(m || '') ? 'claude' : /^gemini/i.test(m || '') ? 'gemini' : String(m || ''));
  return fam(model) === fam(TASKS.solve.model) ? 'claude-haiku-5.5' : TASKS.solve.model;
}

const REASON_HINT = {
  sign: '符号再看一眼：结果应该是正还是负？',
  reciprocal: '倒数和相反数分清楚：倒数是乘起来等于 1 的数。',
  missing: '还有别的可能吗？换个位置或者换个符号再想想。',
  extra: '有一个答案不对，挨个代回去检查一下。',
  form: '数是对的，写法再按题目的要求改一改。',
  unreadable: '没看懂你的答案，换个写法试试，比如 -1/3、x=2、3或7。',
};
export const localHint = reason => REASON_HINT[reason] || '';

function questionText(p) {
  return [p.stem, p.options && p.options.length ? `选项：${p.options.join('；')}` : '', p.figure ? `（图：${p.figure}）` : ''].filter(Boolean).join('\n');
}

export function createPipeline({ ai, curriculum = {} } = {}) {
  const sections = curriculum.sections || [];
  const tags = curriculum.tags || [];

  async function readPhoto(dataURL, { signal } = {}) {
    const r = await ai.ask('recognize', { system: SYSTEM.recognize, text: userRecognize(), images: [dataURL], signal });
    return { ...normalizePage(r.json), model: r.model };
  }

  // checked by the program when it can work the question out itself, else by a model of another family
  // One independent solve by a given model, retried once when the call itself fails (a timeout is not a disagreement)
  async function solveBy(model, q, signal) {
    for (let i = 0; i < 2; i++) {
      try {
        const s = await ai.ask('solve', { system: SYSTEM.solve, text: userSolve(q), signal, model, fallback: '' });
        return { ok: true, model: s.model, json: s.json || {} };
      } catch (e) {
        if (e && e.code === 'abort') throw e;
        if (e && /^(nokey|badkey|badrelay|billing|budget-day|offline)$/.test(e.code || '')) return { ok: false, error: e.code };
      }
    }
    return { ok: false, error: 'failed' };
  }

  // Wei 10-25: only a sure wrong answer stops the teaching. The program's own answer is sure; otherwise the majority of
  // three models decides. A check that fails, a checker that is unsure, or wording the program cannot compare is
  // 'soft': she still gets the explanation, with a quiet line that she can flag it.
  //   status: 'program' | 'models' (agreed) | 'conflict' (sure it is wrong; other = the right answer) | 'split' (three
  //   different answers) | 'soft' (could not confirm) | 'no-trap' (a variant her mistake would not catch)
  async function verify({ q, answer, answer_kind = '', form = '', trap_answer = '', generator = '' }, { signal } = {}) {
    if (!str(answer)) return { status: 'conflict', by: 'none' };
    const opts = { kind: answer_kind || '', form };
    if (str(trap_answer) && check(trap_answer, answer, opts).ok === true) return { status: 'no-trap', by: 'program' };
    const c = compute(q);
    if (c) {
      const r = check(answer, c.answer, { kind: c.kind, form });
      if (r.ok === true) return { status: 'program', by: 'program' };
      if (r.ok === false) return { status: 'conflict', by: 'program', other: c.answer };
    }
    const first = otherFamily(generator);
    const s1 = await solveBy(first, q, signal);
    if (!s1.ok || s1.json.unsure) return { status: 'soft', by: first, why: s1.ok ? 'unsure' : s1.error };
    const kind = answer_kind || kindOf(s1.json.answer_kind) || '';
    const a1 = str(s1.json.answer);
    const r1 = check(a1, answer, { kind });
    if (r1.ok === true) return { status: 'models', by: s1.model };
    const bare = x => str(x).replace(/[\s，。,.；;：:“”"'（）()]/g, '');
    if (r1.ok === null) return bare(a1) && bare(a1) === bare(answer) ? { status: 'models', by: s1.model } : { status: 'soft', by: s1.model, why: 'wording', other: a1 };
    // the two disagree: a third model of a third family settles it
    const s2 = await solveBy(TIEBREAK_MODEL, q, signal);
    if (!s2.ok || s2.json.unsure) return { status: 'soft', by: s1.model, why: 'tiebreak-failed', other: a1 };
    const a2 = str(s2.json.answer);
    if (check(a2, answer, { kind }).ok === true) return { status: 'models', by: `${s1.model} / ${s2.model}`, outvoted: a1 };
    if (check(a2, a1, { kind }).ok === true) return { status: 'conflict', by: `${s1.model} + ${s2.model}`, other: a1 };
    return { status: 'split', by: `${s1.model} / ${s2.model}`, other: a1, third: a2 };
  }
  const good = v => v && (v.status === 'program' || v.status === 'models');

  // the main answer and the twin problem are checked at the same time (each check can take a model call)
  async function diagnoseOnce(problem, imageURL, model, signal) {
    const r = await ai.ask('explain', {
      system: diagnoseSystem({ sections, tags }), text: userDiagnose(problem) + (problem.knownAnswer ? `\n\n这道题的正确答案已经核对过：${problem.knownAnswer}。请按这个答案讲，不要改答案。` : ''),
      images: imageURL ? [imageURL] : [], signal, model,
      ...(model ? { fallback: '' } : {}),
    });
    const d = normalizeDiagnosis(r.json);
    const [v, tv] = await Promise.all([
      verify({ q: questionText(problem) + (problem.teacher_note ? `\n老师在旁边写了：${problem.teacher_note}` : ''), answer: d.answer,
        answer_kind: d.answer_kind, form: d.form, generator: r.model }, { signal }),
      d.twin ? verify({ ...d.twin, generator: r.model }, { signal }).catch(e => { if (e && e.code === 'abort') throw e; return null; }) : null,
    ]);
    return { d, v, tv, model: r.model };
  }

  // Wei 10-25: always teach. A refusal helps her zero; a best-effort explanation with a light caveat helps a lot.
  // Sure it is wrong (the program's answer, or two models against one): teach again with that answer given. Anything
  // still unconfirmed is taught as 'soft' with the most likely right answer; nothing ends as “can't explain”.
  async function diagnose(problem, imageURL, { signal } = {}) {
    let { d, v, tv, model } = await diagnoseOnce(problem, imageURL, undefined, signal);
    if (v.status === 'conflict' && str(v.other)) {
      const right = v.other, by = v.by;
      try {
        const again = await diagnoseOnce({ ...problem, knownAnswer: right }, imageURL, TASKS.explain.fallback, signal);
        if (good(again.v)) ({ d, v, tv, model } = again);
        else { ({ d, tv, model } = again); d = { ...d, answer: right }; v = { status: 'soft', by, why: 'retaught', other: right }; }
      } catch (e) {
        if (e && e.code === 'abort') throw e;
        d = { ...d, answer: right }; v = { status: 'soft', by, why: 'retaught', other: right };
      }
    }
    const checked = good(v) ? v.status : 'soft';
    const twin = d.twin && good(tv) ? { ...d.twin, checked: tv.status } : null;
    return { ...d, twin, checked, model, checkModel: v.by, other: v.other || '', checkWhy: good(v) ? '' : (v.why || v.status) };
  }

  async function variants(card, levels = ['同构', '近变式', '近变式', '辨析'], { signal } = {}) {
    const r = await ai.ask('variants', { system: variantsSystem({ sections }), text: userVariants(card, levels), signal });
    const list = (r.json && Array.isArray(r.json.variants) ? r.json.variants : []).map(normalizeVariant).filter(v => v.q && v.answer);
    const checked = await Promise.all(list.map(v => verify({ ...v, generator: r.model }, { signal }).catch(e => {
      if (e && e.code === 'abort') throw e;
      return { status: 'unsure' };
    })));
    return list.map((v, i) => ({ ...v, checked: checked[i].status })).filter(v => v.checked === 'program' || v.checked === 'models');
  }

  async function retryHint({ q, given, answer, reason }, { signal, local = true } = {}) {
    if (local && localHint(reason)) return localHint(reason);
    const r = await ai.ask('hint', { system: SYSTEM.retry, text: userRetry({ q, given, answer, reason }), signal });
    return str(r.json && r.json.hint) || localHint(reason) || '再从第一步慢慢看一遍。';
  }

  return { readPhoto, diagnose, variants, verify, retryHint };
}
