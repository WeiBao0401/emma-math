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
//             checked: 'program' | 'models' | 'unsure', model, checkModel }
//             checked 'unsure' = the answer could not be confirmed: the UI must not teach it (“问问老师”)
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
    const model = otherFamily(generator);
    let s;
    try { s = await ai.ask('solve', { system: SYSTEM.solve, text: userSolve(q), signal, model, fallback: '' }); } catch (e) {   // no fallback: it could be the generator's own family
      if (e && e.code === 'abort') throw e;
      return { status: 'unsure', by: model, error: e && e.code };
    }
    const j = s.json || {};
    if (j.unsure) return { status: 'unsure', by: s.model };
    const r = check(str(j.answer), answer, { kind: answer_kind || kindOf(j.answer_kind) || '' });
    if (r.ok === true) return { status: 'models', by: s.model };
    if (r.ok === false) return { status: 'conflict', by: s.model, other: str(j.answer) };
    // text answers the program cannot compare: same words after trimming punctuation count as agreement
    const bare = x => str(x).replace(/[\s，。,.；;：:“”"'（）()]/g, '');
    return bare(j.answer) && bare(j.answer) === bare(answer) ? { status: 'models', by: s.model } : { status: 'unsure', by: s.model, other: str(j.answer) };
  }

  const good = v => v && (v.status === 'program' || v.status === 'models');

  // the main answer and the twin problem are checked at the same time (each check can take a model call)
  async function diagnoseOnce(problem, imageURL, model, signal) {
    const r = await ai.ask('explain', {
      system: diagnoseSystem({ sections, tags }), text: userDiagnose(problem), images: imageURL ? [imageURL] : [], signal, model,
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

  async function diagnose(problem, imageURL, { signal } = {}) {
    let { d, v, tv, model } = await diagnoseOnce(problem, imageURL, undefined, signal);
    // the program or the second model disagrees: one more try with the fallback model, then give up teaching it
    if (!good(v)) {
      try {
        const again = await diagnoseOnce(problem, imageURL, TASKS.explain.fallback, signal);
        if (good(again.v)) ({ d, v, tv, model } = again);
      } catch (e) { if (e && e.code === 'abort') throw e; }
    }
    const twin = good(v) && d.twin && good(tv) ? { ...d.twin, checked: tv.status } : null;
    return { ...d, twin, checked: good(v) ? v.status : 'unsure', model, checkModel: v.by, other: v.other || '' };
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
