// 考前错题卷（路由 paper，DESIGN 2.4、4.9、6.1，C 9.3）。负责：错题卷 agent（ui-paper.js、paper.js、css/paper.css）。
// 规则和排版都在 paper.js（纯函数，tests/paper.test.mjs），这里只管几屏怎么走、存什么。
//
// 几屏
//   接着做  kv 'paper' 里有一份还没对完答案的卷子：“接着对答案”“再看一眼卷子”“出一份新的”。
//   选范围  按章勾（默认 params.sections，再没有就 kv 'exam' 的范围，再没有就第 1-3 章），每章后面是几个坑，
//           下面一行“这份卷子 N 道，约 M 分钟，拆成两半做”。
//   补题    范围里排得进卷子、池子里却没有能用的题的卡（paper.fillTargets），先调 ctx.pipeline.variants 给它们出题，
//           三张一起出，“我在给几个坑出新题”，最多等 60 秒（也可以点“不等了”）；补不上就少出几道。
//           出好的题不管等没等到都存进卡的池子（钱花了，题留着以后复习用）。
//   卷子    A4 打印版式（paper.sheetsHTML，样式 paper.SHEET_CSS 放进 <style>）：每半一张，最后一页答案和“这题的坑”。
//           “打印”= window.print()（css/paper.css 打印时只留卷子）；“分享”= Web Share API 分享一个 HTML 文件，
//           不支持就下载这个文件（emma-math-paper-日期.html，paper.paperHTML：内联样式、公式画好、没有脚本）。
//   对答案  每题一行：题、答案、✓ ✗。点了马上存进 kv 'paper'，切走再回来接着点。✗ 的题出“这题的坑”和“问我这道”
//           （go('chat', paper.askParams(item))，回来时这一屏原样接着）。一半的题都点完了，“第一半对完了”交这一半：
//           每张卡 notebook.recordReview（paper.applyPaperResult：mixed、kind 'variant'、firstTry 按她勾的），
//           题记进卡的 used；有考试设置时再套 notebook.compressDue（考前压缩，期中季 agent 写的，没有就跳过）；
//           每题 store.addAttempt（kind 'paper'）。两半可以分两天交（日历 B：11-04、11-05 各做半张）。
//   收尾    “推进了 N 个坑”，没做对的明天换道题再来；另一半还没交就说一声。
// 模拟模式（设置里 mock 或 ?mock=1）：没有坑的时候出“用样例卡出一份”，样例卡（paper.demoPaperCards）只在内存里，
//   补题走 ai.js 的模拟回答，交了也不存、不记。
//
// 导出
//   createPaper(ctx) -> { show(params, { from, back }), hide() }      params：{ sections? }（节或章的编号，预先勾上）
//                       back 为真（从“问我这道”回来）：不重开，原样接着
// kv：'paper'（paper.newPaper 的样子：最近一份卷子的日期、题、她点的 ✓ ✗、哪一半交了）；读 'exam'。
// 依赖：paper.js、notebook.js、ui-dom.js。模块顶层不碰 document。
import { h, icon, mathText, toast, skBars, prefersReducedMotion } from './ui-dom.js';
import * as NB from './notebook.js';
import {
  COPY, HALF_NAMES, PAPER_MAX, FILL_WAIT_MS, FILL_LEVELS, CHAPTER_TITLES, SHEET_CSS,
  buildPaper, fillTargets, fillSource, addToPool, splitInHalves, previewPaper, chapterCounts, sectionsFor, chaptersOf,
  newPaper, paperState, halvesOf, halfReady, applyPaperResult, paperAttempt, askParams, answerShown, trapLine,
  sheetsHTML, paperHTML, paperFileName, dayCn, demoPaperCards,
} from './paper.js';

const FILL_AT_ONCE = 3;
const str = v => (v == null ? '' : String(v)).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// replaceChildren 会把 null 印成字 “null”：先去掉空的，和 ui-dom.h 一样
const fill = (el, ...nodes) => el.replaceChildren(...nodes.flat().filter(Boolean));

export function createPaper(ctx) {
  let root = null, bar = null, page = null, navTitle = null, backLab = null;
  let backText = COPY.back;   // 返回按钮的字：从首页来写“首页”，从错题本等别处来写“返回”（接线时加，和 ui-book 一样）
  let token = 0;
  let S = null;          // { cards, chapters: Set, picked（考试设置里的节）, demo, paper, open（对答案摊开的那一半）, busy, skipFill }
  let paused = false;    // 去“问我这道”时留着这一屏

  const todayOf = () => (typeof ctx.today === 'function' ? ctx.today() : NB.dayOf());
  const isMock = () => { try { return !!((ctx.settings && ctx.settings().mock) || (ctx.mockForced && ctx.mockForced())); } catch { return false; } };
  const peek = (key, fallback = null) => { try { return ctx.kv && typeof ctx.kv.peek === 'function' ? ctx.kv.peek(key, fallback) : fallback; } catch { return fallback; } };

  // ---------------------------------------------------------------- 画在哪
  function mount() {
    if (!root) {
      root = document.getElementById('view-paper');
      if (!root) {   // 接线前也能打开：自己补一个 section
        root = h('section', { id: 'view-paper', className: 'view' });
        (document.getElementById('main') || document.body).append(root);
      }
    }
    if (!page || !page.isConnected) {
      navTitle = h('span', { className: 'nav-title', text: COPY.title });
      bar = h('header', { className: 'navbar pp-noprint' }, h('div', { className: 'inner' },
        h('button', { type: 'button', className: 'back', on: { click: leave } }, icon('back'), backLab = h('span', { text: backText })),
        navTitle, h('span', { className: 'nav-end' })));
      page = h('div', { className: 'page pp-page' });
      root.replaceChildren(bar, page);
    }
    // 卷子的版式只有一份（paper.SHEET_CSS），分享出去的文件里也是它；App 里放进一个 <style>（CSP 允许内联样式）
    if (!document.getElementById('pp-sheet-css')) {
      const st = document.createElement('style');
      st.id = 'pp-sheet-css';
      st.textContent = SHEET_CSS;
      document.head.append(st);
    }
  }
  function paint(...nodes) {
    fill(page, ...nodes);
    window.scrollTo(0, 0);
  }
  function leave() { S = null; paused = false; ctx.back ? ctx.back() : ctx.go('home'); }
  const homeBtn = (big = false) => h('button', { type: 'button', className: 'btn' + (big ? ' btn-big' : ''), text: COPY.home, on: { click: () => { S = null; ctx.go('home'); } } });
  const title = (text, sub = '') => [h('h1', { className: 'page-title', text }), sub ? h('p', { className: 'lead', text: sub }) : null];

  function paintMsg(main, sub) {
    paint(...title(COPY.title), h('div', { className: 'pp-msg' }, h('p', { className: 'lede', text: main }), sub ? h('p', { className: 'lead', text: sub }) : null,
      h('div', { className: 'btn-row' }, homeBtn())));
  }

  // ---------------------------------------------------------------- 存
  async function savePaper() {
    if (!S || !S.paper || S.paper.demo) return true;
    try { await ctx.kv.set('paper', S.paper); return true; } catch (e) { console.warn('paper: save', e); return false; }
  }

  // ---------------------------------------------------------------- 打开
  async function show(params = {}) {
    const my = ++token;
    paused = false;
    mount();
    paint(...title(COPY.title), h('div', { className: 'pp-loading' }, skBars([84, 66, 76])));
    let cards = [];
    try {
      const all = ctx.store ? await ctx.store.all('items') : [];
      cards = (all || []).filter(c => c && c.id && typeof c.status === 'string');
    } catch (e) {
      if (my !== token) return;
      console.warn('paper: items', e);
      return paintMsg(COPY.loadFail, COPY.loadFailSub);
    }
    if (my !== token) return;
    const exam = peek('exam', null) || {};
    const want = Array.isArray(params.sections) && params.sections.length ? params.sections.map(str) : Array.isArray(exam.sections) ? exam.sections.map(str) : [];
    S = { cards, chapters: new Set(chaptersOf(want)), picked: want, demo: false, paper: null, busy: false, skipFill: null };
    const last = peek('paper', null);
    if (last && paperState(last).pending && !last.demo) { S.paper = last; return paintResume(); }
    paintRange();
  }

  // ---------------------------------------------------------------- 接着做
  function paintResume() {
    const p = S.paper;
    navTitle.textContent = COPY.title;
    paint(...title(COPY.title),
      h('div', { className: 'pp-resume' },
        h('p', { className: 'lede', text: COPY.resume(p.made === todayOf() ? '今天' : p.made === NB.addDays(todayOf(), -1) ? '昨天' : dayCn(p.made)) }),
        h('p', { className: 'lead', text: p.title }),
        h('div', { className: 'btn-row' },
          h('button', { type: 'button', className: 'btn', text: COPY.resumeCheck, on: { click: paintCheck } }),
          h('button', { type: 'button', className: 'btn quiet', text: COPY.resumeSheet, on: { click: paintSheet } })),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn accent', text: COPY.fresh, on: { click: () => { S.paper = null; paintRange(); } } }))));
  }

  // ---------------------------------------------------------------- 选范围
  function chapterList() {
    const out = [];
    const secs = ctx.curriculum && Array.isArray(ctx.curriculum.sections) ? ctx.curriculum.sections : [];
    for (let ch = 1; ch <= 6; ch++) {
      const s = secs.find(x => Number(x.chapter) === ch);
      out.push({ ch, name: `第 ${ch} 章 ${str(s && s.chapterTitle) || CHAPTER_TITLES[ch]}` });
    }
    return out;
  }
  const sectionsNow = () => sectionsFor([...S.chapters], S.picked);

  function paintRange() {
    navTitle.textContent = COPY.title;
    S.paper = null;
    const counts = chapterCounts(S.cards);
    const info = h('div', { className: 'pp-sum', 'aria-live': 'polite' });
    const make = h('button', { type: 'button', className: 'btn btn-big', text: COPY.make, on: { click: () => makePaper() } });
    const rows = chapterList().map(({ ch, name }) => {
      const btn = h('button', { type: 'button', className: 'pp-ch', 'aria-pressed': String(S.chapters.has(ch)), on: { click: () => {
        if (S.chapters.has(ch)) S.chapters.delete(ch); else S.chapters.add(ch);
        btn.setAttribute('aria-pressed', String(S.chapters.has(ch)));
        update();
      } } },
      h('span', { className: 'pp-box', 'aria-hidden': 'true' }, icon('check')),
      h('span', { className: 'pp-ch-name', text: name }),
      h('span', { className: 'pp-ch-n', text: COPY.pits(counts[ch] || 0) }));
      return h('li', {}, btn);
    });
    function update() {
      if (!S.chapters.size) {
        info.replaceChildren(h('p', { className: 'pp-sum-main', text: COPY.noChapter }));
        make.disabled = true;
        return;
      }
      const pv = previewPaper(S.cards, { sections: sectionsNow(), curriculum: ctx.curriculum || null });
      make.disabled = pv.count === 0;
      fill(info, pv.count
        ? h('p', { className: 'pp-sum-main', text: COPY.summary(pv.count, pv.minutes, pv.two) })
        : h('p', { className: 'pp-sum-main', text: COPY.none }),
      pv.count && pv.two ? h('p', { className: 'small', text: COPY.summarySub }) : null);
    }
    update();
    const demo = isMock() ? h('button', { type: 'button', className: 'text-btn accent pp-demo', text: COPY.demo, on: { click: startDemo } }) : null;
    paint(...title(COPY.rangeTitle, COPY.rangeLead),
      h('section', { className: 'pp-range' }, h('h2', { className: 'sec-h', text: COPY.rangeHead }), h('ul', { className: 'pp-chs' }, rows)),
      info, h('div', { className: 'btn-row pp-make' }, make), demo);
  }

  // 模拟模式：样例卡只在内存里，范围默认勾上样例卡在的那几章
  function startDemo() {
    S.cards = demoPaperCards(todayOf());
    S.demo = true;
    S.picked = [];
    S.chapters = new Set(Object.keys(chapterCounts(S.cards)).map(Number));
    paintRange();
  }

  // ---------------------------------------------------------------- 出卷子（先补题）
  async function makePaper() {
    if (S.busy) return;
    S.busy = true;
    const my = token;
    const sections = sectionsNow();
    const curriculum = ctx.curriculum || null;
    let cards = S.cards;
    let built = buildPaper(cards, { sections, curriculum });
    const targets = fillTargets(cards, built, { sections });
    if (targets.length && ctx.pipeline && typeof ctx.pipeline.variants === 'function') {
      paintFilling(targets.length);
      cards = await fillCards(cards, targets, S.demo);
      if (my !== token || !S) return;
      built = buildPaper(cards, { sections, curriculum });
    }
    S.cards = cards;
    S.busy = false;
    const short = fillTargets(cards, built, { sections, limit: PAPER_MAX }).length;
    const { halves } = splitInHalves(built.items);
    if (!halves.flat().length) return paintMsg(COPY.none, '');
    S.paper = newPaper({ made: todayOf(), chapters: [...S.chapters].sort((a, b) => a - b), sections, halves, short, demo: S.demo });
    await savePaper();
    if (my !== token) return;
    paintSheet();
  }

  function paintFilling(n) {
    navTitle.textContent = COPY.title;
    paint(...title(COPY.title),
      h('div', { className: 'pp-wait' },
        h('p', { className: 'pp-wait-t' }, h('span', { className: 'dots', text: COPY.filling(n) })),
        h('p', { className: 'small', text: COPY.fillingSub }),
        skBars([88, 64, 76]),
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'text-btn', text: COPY.skip, on: { click: () => { if (S && S.skipFill) S.skipFill(); } } }))));
  }

  // 三张卡一起出题；60 秒或她点“不等了”就先往下走。还在路上的照样存进卡的池子，只是赶不上这份卷子
  async function fillCards(cards, ids, demo) {
    const byId = new Map(cards.map(c => [c.id, c]));
    const queue = ids.slice();
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const cd = byId.get(id);
          const got = await ctx.pipeline.variants(fillSource(cd), FILL_LEVELS,
            { local: true, avoid: [...(cd.used || []), ...(cd.pool || []).map(x => x && x.q)] });
          if (!got || !got.length) continue;
          byId.set(id, addToPool(byId.get(id), got));
          if (!demo) saveFilled(id, got);
        } catch (e) { console.warn('paper: variants', e && (e.code || e.message)); }
      }
    };
    const skip = new Promise(r => { S.skipFill = r; });
    await Promise.race([Promise.all(Array.from({ length: Math.min(FILL_AT_ONCE, ids.length) }, worker)), sleep(FILL_WAIT_MS), skip]);
    if (S) S.skipFill = null;
    return [...byId.values()];
  }
  async function saveFilled(id, got) {
    try {
      const fresh = await ctx.store.get('items', id);
      if (fresh) await ctx.store.put('items', { ...addToPool(fresh, got), updated: new Date().toISOString() });
    } catch (e) { console.warn('paper: save pool', e); }
  }

  // ---------------------------------------------------------------- 卷子
  function paintSheet() {
    const p = S.paper;
    navTitle.textContent = COPY.title;
    const halves = halvesOf(p).filter(x => x.length);
    const two = halves.length > 1;
    const doc = h('div', { className: 'pp-preview' });
    doc.innerHTML = sheetsHTML(p);   // 所有字都过了 esc() 或 mathview.renderText（先转义），和 ui-dom.mathText 一样安全
    paint(
      h('div', { className: 'pp-noprint' },
        ...title(COPY.title, `${p.range} · ${dayCn(p.made)}`),
        h('p', { className: 'pp-sheet-lead', text: COPY.sheetLead(p.items.length, two) }),
        p.short ? h('p', { className: 'small', text: COPY.short(p.short) }) : null,
        h('div', { className: 'btn-row pp-tools' },
          h('button', { type: 'button', className: 'btn', on: { click: doPrint } }, icon('print'), h('span', { text: COPY.print })),
          h('button', { type: 'button', className: 'btn quiet', text: COPY.share, on: { click: doShare } })),
        h('p', { className: 'small pp-help', text: COPY.printHelp })),
      doc,
      // 屏幕上不放答案页（css/paper.css 只在打印时显示它）：还没做的题，答案先不给她看
      h('p', { className: 'small pp-noprint pp-keyhidden', text: COPY.keyHidden }),
      h('div', { className: 'btn-row pp-noprint pp-tocheck' }, h('button', { type: 'button', className: 'btn btn-big', text: COPY.toCheck, on: { click: paintCheck } })));
  }

  function doPrint() {
    try {
      if (typeof window.print !== 'function') throw new Error('no print');
      window.print();
    } catch { toast(COPY.printFail, 3500); }
  }

  // 分享一个 HTML 文件（iPad 上可以存到“文件”、隔空投送到电脑）；不能分享文件的浏览器直接下载
  function doShare() {
    const p = S && S.paper;
    if (!p) return;
    const html = paperHTML(p);
    const name = paperFileName(p.made);
    let file = null;
    try { file = new File([html], name, { type: 'text/html' }); } catch { file = null; }
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: p.title }).catch(e => {
        if (e && e.name === 'AbortError') return;   // 她自己关了分享面板
        download(html, name);
      });
      return;
    }
    download(html, name);
  }
  function download(html, name) {
    try {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const a = h('a', { href: url, download: name, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { console.warn('paper: download', e); toast(COPY.shareFail, 3000); }
  }

  // ---------------------------------------------------------------- 对答案
  // 两半可以分两天做：一次只摊开一半的答案（还没做的那一半，答案先不给她看）。默认摊开第一个还没交的那一半
  function paintCheck() {
    const p = S.paper;
    navTitle.textContent = COPY.checkTitle;
    const halves = halvesOf(p);
    const two = halves.filter(x => x.length).length > 1;
    if (!S.open) {
      const first = halves.findIndex((list, i) => list.length && !(p.done && p.done[i]));
      S.open = new Set(first >= 0 ? [first] : []);
    }
    const blocks = halves.map((list, i) => (list.length ? halfBlock(list, i, two) : null));
    paint(...title(COPY.checkTitle, COPY.checkLead), blocks,
      h('div', { className: 'btn-row pp-back-sheet' }, h('button', { type: 'button', className: 'text-btn accent', text: COPY.resumeSheet, on: { click: paintSheet } })));
  }

  function halfBlock(list, i, two) {
    const p = S.paper;
    const done = !!(p.done && p.done[i]);
    const open = S.open.has(i);
    const head = two || done ? h('h2', { className: 'sec-h' }, h('span', { text: two ? HALF_NAMES[i] : COPY.title }), done ? h('span', { className: 'st', text: COPY.halfDone }) : null) : null;
    if (!open) {
      const label = done ? COPY.lookAgain : COPY.openHalf(i);
      return h('section', { className: 'pp-half closed' + (done ? ' done' : '') }, head,
        h('div', { className: 'btn-row' }, h('button', { type: 'button', className: done ? 'text-btn accent' : 'btn quiet', text: label, on: { click: () => { S.open.add(i); paintCheck(); } } })));
    }
    const foot = h('div', { className: 'pp-half-foot' });
    const rows = h('ol', { className: 'pp-rows' });
    const refreshFoot = () => {
      if (done) { foot.replaceChildren(); return; }
      const r = halfReady(p, i);
      const btn = h('button', { type: 'button', className: 'btn', text: COPY.submitHalf(two ? i : -1), disabled: !r.ready, on: { click: () => submitHalf(i) } });
      fill(foot, h('div', { className: 'btn-row' }, btn), r.left ? h('p', { className: 'small', text: COPY.left(r.left) }) : null);
    };
    for (const it of list) rows.append(rowEl(it, done, () => refreshFoot()));
    refreshFoot();
    return h('section', { className: 'pp-half' + (done ? ' done' : '') }, head, rows, foot);
  }

  function rowEl(it, done, onMark) {
    const li = h('li', { className: 'pp-row' });
    const draw = () => {
      const mark = (S.paper.marks || {})[it.no] || '';
      const btn = (v, sym, label) => h('button', {
        type: 'button', className: 'pp-mark ' + v, 'aria-pressed': String(mark === v), 'aria-label': `第 ${it.no} 题${label}`, disabled: done, text: sym,
        on: { click: () => setMark(it, mark === v ? '' : v) },
      });
      const miss = mark === 'wrong';
      li.className = 'pp-row' + (mark ? ' ' + mark : '');
      fill(li,
        h('span', { className: 'pp-rno', text: `${it.no}.` }),
        h('div', { className: 'pp-rbody' },
          mathText(it.q, { tag: 'div', className: 'pp-rq' }),
          h('div', { className: 'pp-ra' }, h('span', { className: 'label', text: COPY.answer }), mathText(answerShown(it), { className: 'pp-ra-v' })),
          miss && trapLine(it) ? mathText(trapLine(it), { tag: 'p', className: 'pp-rtrap' }) : null,
          miss ? h('button', { type: 'button', className: 'text-btn accent pp-ask', on: { click: () => askMe(it) } }, icon('chat'), h('span', { text: COPY.askMe })) : null),
        h('div', { className: 'pp-marks', role: 'group', 'aria-label': `第 ${it.no} 题` }, btn('ok', '✓', COPY.right), btn('wrong', '✗', COPY.wrong)));
    };
    function setMark(item, v) {
      if (!S || !S.paper || done) return;
      const marks = { ...(S.paper.marks || {}) };
      if (v) marks[item.no] = v; else delete marks[item.no];
      S.paper.marks = marks;
      draw();
      onMark();
      savePaper().then(ok => { if (!ok) toast(COPY.saveFail, 2500); });
    }
    draw();
    return li;
  }

  function askMe(it) {
    paused = true;
    ctx.go('chat', askParams(it));
  }

  async function submitHalf(i) {
    const p = S && S.paper;
    if (!p || S.busy || (p.done && p.done[i]) || !halfReady(p, i).ready) return;
    S.busy = true;
    const today = todayOf();
    const at = new Date().toISOString();
    const exam = peek('exam', null);
    const list = halvesOf(p)[i];
    let passed = 0, missed = 0;
    for (const it of list) {
      const ok = p.marks[it.no] === 'ok';
      if (ok) passed++; else missed++;
      if (p.demo) continue;
      try {
        const card = await ctx.store.get('items', it.cardId);
        if (card && (card.status === 'learning' || card.status === 'beaten')) {
          let next = applyPaperResult(card, it, ok, today);
          // 考前压缩（期中季）：notebook.compressDue 由期中季那边写，recordReview 之后套一次；没有这个函数就照原样
          if (exam && exam.date && typeof NB.compressDue === 'function') next = NB.compressDue(next, exam, today) || next;
          await ctx.store.put('items', { ...next, updated: at });
        }
      } catch (e) { console.warn('paper: card', it.cardId, e); }
      try { await ctx.store.addAttempt(paperAttempt(it, ok, { paperId: p.id, today, at })); } catch (e) { console.warn('paper: attempt', e); }
    }
    // 她可能在存的时候点了返回（S 清掉了）：这一半照样记成交了，只是不再画收尾
    p.done = (p.done || []).map((d, k) => (k === i ? today : d));
    if (!p.demo) { try { await ctx.kv.set('paper', p); } catch (e) { console.warn('paper: save', e); } }
    if (!S || S.paper !== p) return;
    S.busy = false;
    S.open = null;
    paintWrap({ half: i, passed, missed });
  }

  // ---------------------------------------------------------------- 收尾
  function paintWrap({ half, passed, missed }) {
    const p = S.paper;
    const st = paperState(p);
    const other = st.done.findIndex((d, k) => !d && k !== half);
    const lines = [
      h('p', { className: 'lede', text: passed ? COPY.wrapPassed(passed) : COPY.wrapNone }),
      missed ? h('p', { className: 'lead', text: COPY.wrapMiss }) : h('p', { className: 'lead', text: COPY.wrapAllRight }),
      other >= 0 ? h('p', { className: 'small', text: COPY.wrapOther(other) }) : st.all && st.halves > 1 ? h('p', { className: 'small', text: COPY.wrapAll }) : null,
      p.demo ? h('p', { className: 'small pp-demo-note', text: COPY.demoNote }) : null,
    ];
    navTitle.textContent = COPY.title;
    paint(...title(COPY.title), h('div', { className: 'pp-wrap' + (prefersReducedMotion() ? '' : ' reveal') }, lines,
      h('div', { className: 'btn-row' }, homeBtn(true))));
  }

  // 从 chat 回来：屏上还是那一屏，她点过的都在
  return {
    show(params, opts) {
      if (opts && opts.back && paused && S && S.paper) { paused = false; return; }
      if (!(opts && opts.back)) backText = !opts || !opts.from || opts.from === 'home' ? COPY.back : '返回';
      if (backLab) backLab.textContent = backText;
      show(params || {});
    },
    hide() {
      if (paused) return;   // 去“问我这道”：这一屏留着
      token++;
      if (S && S.skipFill) S.skipFill();
      S = null;
    },
  };
}
