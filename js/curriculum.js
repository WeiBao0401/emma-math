// The textbook map and the error catalog (curriculum/sections.json, errors.json; research 01 and 02). Public data:
// section names, knowledge point names, and self-written error descriptions only, never textbook text.
//
//   loadCurriculum(fetchImpl?) -> Promise<Curriculum>
//   makeCurriculum(sectionsJSON, errorsJSON) -> Curriculum      (pure, for tests)
//   Curriculum = {
//     sections: [{ id, title, chapter, chapterTitle, points }]   七上 1-6 章 and 小学衔接 0, in book order
//     tags: [{ id, name, section, category }]                     name: the wrong idea in a few words, for prompts
//     section(id) -> section | null      title(id) -> '2.3.1 乘方' | id
//     error(id) -> catalog entry | null  (wrong, right, why, hint, variantRecipe, examples)
//     chapterOf(sectionId) -> chapter number | null
//   }

const short = s => String(s || '').split(/[；;。]/)[0].replace(/[“”"]/g, '').slice(0, 36);

export function makeCurriculum(sectionsJSON = {}, errorsJSON = {}) {
  const chapters = Array.isArray(sectionsJSON.chapters) ? sectionsJSON.chapters : [];
  const sections = [];
  for (const ch of chapters) {
    if (!(ch.chapter >= 0 && ch.chapter <= 6)) continue;       // 七上 and 小学衔接; 七下 later
    for (const s of ch.sections || []) sections.push({ id: s.id, title: s.title, chapter: ch.chapter, chapterTitle: ch.chapterTitle, points: s.points || [] });
  }
  sections.sort((a, b) => (a.chapter || 99) - (b.chapter || 99) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  const errors = Array.isArray(errorsJSON.errors) ? errorsJSON.errors : [];
  // prompts get 七上 tags only (七下 entries name their section in words, not "2.3.1")
  const tags = errors.map(e => ({ id: e.id, name: short(e.wrong), section: String(e.section || '').split(' ')[0], category: e.category }))
    .filter(t => /^[0-6](\.|$)/.test(t.section));
  const byId = new Map(sections.map(s => [s.id, s]));
  const errById = new Map(errors.map(e => [e.id, e]));
  const section = id => byId.get(String(id || '')) || byId.get(String(id || '').split('.').slice(0, 2).join('.')) || null;
  return {
    sections, tags,
    section,
    title: id => { const s = section(id); return s ? `${s.id} ${s.title}` : String(id || ''); },
    error: id => errById.get(id) || null,
    chapterOf: id => { const n = parseInt(String(id || ''), 10); return Number.isFinite(n) ? n : null; },
  };
}

export async function loadCurriculum(fetchImpl = (...a) => fetch(...a)) {
  const get = async f => { try { const r = await fetchImpl(new URL(`../curriculum/${f}`, import.meta.url)); return r.ok ? r.json() : {}; } catch { return {}; } };
  const [s, e] = await Promise.all([get('sections.json'), get('errors.json')]);
  return makeCurriculum(s, e);
}
