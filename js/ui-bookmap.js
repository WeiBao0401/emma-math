// 课本地图（路由 bookmap，v0.7）：这本书学到哪了、每一节现在怎么样、哪些要摸摸底。规则在 bookmap.js。
//
// 一屏
//   头：书名、“学到：2.3.1 乘方”（没设过时“从错题看大约学到…”），四个数：掌握 / 还在练 / 没一起做过 / 还没学
//   每章一组，每节一行：色点 + 编号标题 + 状态。点一行：
//     还在练、掌握了 -> 去攻克本按章看；还没一起做过题 -> 去聊天摸摸底（chat probe，point 是 bookmap.buildPoint 那样的）
//     还没学 -> 不动
//   “改进度”：进入挑选，点哪一节就“学到这里”（kv 'progress'），再点“好了”退出
//   “拍目录”：拍课本目录页，认出书名和章节（bookmap.readToc），存 kv 'textbook'.toc；认出是内置的七上就照旧用内置的编号
//
// 导出 createBookmap(ctx) -> { show(params, { from }), hide() }
// 依赖：ui-dom、bookmap、image、kid-errors。kv：读写 'progress'、'textbook'；读 items。
import { h, icon, toast as baseToast } from './ui-dom.js';
import { textbookMap, sectionWord, readToc } from './bookmap.js';
import { prepare } from './image.js';
import { kidMessage } from './kid-errors.js';

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function createBookmap(ctx) {
  const root = document.getElementById('view-bookmap');
  root.replaceChildren();
  const toast = (m, ms) => (ctx.toast ? ctx.toast(m, ms) : baseToast(m, ms));
  const lab = h('span', { className: 'back-label', text: '首页' });
  const navTitle = h('span', { className: 'nav-title', text: '课本地图' });
  const nav = h('header', { className: 'navbar' }, h('div', { className: 'inner' },
    h('button', { type: 'button', className: 'back', on: { click: () => ctx.back() } }, icon('back'), lab), navTitle, h('span', { className: 'nav-end' })));
  const page = h('div', { className: 'page tb' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', className: 'visually-hidden', tabIndex: -1, 'aria-label': '拍课本目录' });
  root.append(nav, page, fileIn);

  let cards = null;
  let picking = false;
  let reading = false;
  let token = 0;
  const peek = (k, f) => { try { return ctx.kv.peek(k, f); } catch (e) { return f; } };
  const today = () => (typeof ctx.today === 'function' ? ctx.today() : '');

  function map() {
    return textbookMap({ curriculum: ctx.curriculum, cards: cards || [], progress: peek('progress', null), toc: (peek('textbook', null) || {}).toc || null, today: today() });
  }

  async function setProgress(id) {
    try {
      await ctx.kv.set('progress', { ...(peek('progress', {}) || {}), section: id, updated: new Date().toISOString(), from: 'mine' });
      toast('好，学到这里。');
    } catch (e) { toast('没存上，再点一次。'); }
    render();
  }

  function tapSection(s, ch) {
    if (picking) { setProgress(s.id); return; }
    if (s.state === 'unseen') {
      ctx.go('chat', { mode: 'probe', point: { name: `${s.id} ${s.title}`, kind: 'build', section: s.id, evidence: [],
        opener: `这一节（${s.title}）你们学过了，我们还没一起做过这一节的题。轻松地出一两道小题，看看她掌握得怎么样，不像考试` } });
    } else if (s.state === 'weak' || s.state === 'ok') ctx.go('book', { tab: 'chapter' });
  }

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f || reading) return;
    reading = true;
    render();
    try {
      const shot = await prepare(f, { maxSide: 2000, quality: 0.85, maxBytes: 1500000 });
      const toc = await readToc(ctx, shot.dataURL);
      if (!toc.chapters.length) { toast('没认出目录。拍目录那一页，拍正、拍全。', 3500); return; }
      await ctx.kv.set('textbook', { ...(peek('textbook', {}) || {}), toc });
      const n = toc.chapters.reduce((a, c) => a + c.sections.length, 0);
      toast(`认出来了：${toc.book || '这本书'}，${toc.chapters.length} 章 ${n} 节。`, 3500);
    } catch (e) {
      console.warn('toc', e);
      toast(kidMessage(e, { where: 'photo' }) || '没认出来，再拍一次。', 3500);
    } finally { reading = false; render(); }
  });

  function render() {
    if (!cards) { page.replaceChildren(h('div', { className: 'sk-bars', 'aria-hidden': 'true' }, [80, 60, 70].map(w => h('i', { style: `width:${w}%` })))); return; }
    const m = map();
    const c = m.counts;
    const prog = m.progress;
    const out = [
      h('h1', { className: 'page-title', text: '课本地图' }),
      h('p', { className: 'small tb-book', text: m.book }),
      h('p', { className: 'lede tb-at' }, prog
        ? `${m.guessed ? '从错题看，大约学到 ' : '学到 '}${prog.id} ${prog.title}。`
        : '还不知道你们学到哪了。点“改进度”，点一下学到的那一节。'),
      h('ul', { className: 'tb-sum' },
        h('li', { className: 'ok' }, h('b', { text: String(c.ok) }), h('span', { text: '掌握了' })),
        h('li', { className: 'weak' }, h('b', { text: String(c.weak) }), h('span', { text: '还在练' })),
        h('li', { className: 'unseen' }, h('b', { text: String(c.unseen) }), h('span', { text: '没一起做过' })),
        h('li', { className: 'ahead' }, h('b', { text: String(c.ahead) }), h('span', { text: '还没学' }))),
      c.unseen ? h('p', { className: 'small tb-hint', text: '“没一起做过”的节，点一下，我出两道小题帮你摸摸底。' }) : null,
      h('div', { className: 'btn-row tb-tools' },
        h('button', { type: 'button', className: picking ? 'btn' : 'btn quiet', text: picking ? '好了' : '改进度', on: { click: () => { picking = !picking; render(); } } }),
        h('button', { type: 'button', className: 'text-btn accent', disabled: reading, on: { click: () => fileIn.click() } }, icon('camera'), h('span', { text: reading ? '在认目录…' : '拍目录' }))),
      picking ? h('p', { className: 'small tb-pick', text: '点一下你们课上学到的那一节。' }) : null,
    ];
    for (const ch of m.chapters) {
      out.push(h('section', { className: 'tb-ch' },
        h('h2', { className: 'sec-h', text: `第${CN[ch.n] || ch.n}章 ${ch.title}` }),
        h('ul', { className: 'tb-rows' }, ch.sections.map(s => h('li', {},
          h('button', { type: 'button', className: `tb-row ${s.state}${prog && prog.id === s.id ? ' at' : ''}${picking ? ' picking' : ''}`,
            disabled: !picking && s.state === 'ahead', on: { click: () => tapSection(s, ch) } },
          h('span', { className: 'tb-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'tb-name', text: `${s.id} ${s.title}` }),
          h('span', { className: 'tb-state', text: prog && prog.id === s.id && picking ? '学到这里' : sectionWord(s) }),
          s.state !== 'ahead' || picking ? icon('chev', 'tb-chev') : null))))));
    }
    page.replaceChildren(...out.filter(Boolean));
  }

  return {
    async show(params = {}, { from } = {}) {
      lab.textContent = !from || from === 'home' ? '首页' : '返回';
      const mine = ++token;
      picking = false;
      render();
      try {
        const all = ctx.store && typeof ctx.store.all === 'function' ? await ctx.store.all('items') : [];
        if (mine !== token) return;
        cards = Array.isArray(all) ? all.filter(Boolean) : [];
      } catch (e) { cards = cards || []; }
      render();
    },
    hide() { token++; picking = false; },
  };
}
