// 帮我出套题的卷子（路由 quiz，v0.8）。卷子在聊天里出（ui-chat 的 quiz 模式，quiz.makeQuiz），存在 kv 'quizzes'。
//   { id }   一份卷子：A4 预览（每题留了作答空间），“打印”“分享”（存成文件发到电脑打印），“看答案”（做完再点）
//   不带 id  出过的卷子列表，加“出一套新的”（去聊天，老师先问清楚要求）
// 导出 createQuiz(ctx) -> { show(params, { from }), hide() }
// 依赖：ui-dom、quiz。
import { h, icon, toast as baseToast } from './ui-dom.js';
import { quizSheetsHTML, quizHTML, quizFileName, specLine, QUIZ_CSS } from './quiz.js';
import { dayCn, SHEET_CSS } from './paper.js';

export function createQuiz(ctx) {
  const root = document.getElementById('view-quiz');
  root.replaceChildren();
  const toast = (m, ms) => (ctx.toast ? ctx.toast(m, ms) : baseToast(m, ms));
  const lab = h('span', { className: 'back-label', text: '返回' });
  const nav = h('header', { className: 'navbar pp-noprint' }, h('div', { className: 'inner' },
    h('button', { type: 'button', className: 'back', on: { click: () => ctx.back() } }, icon('back'), lab), h('span', { className: 'nav-title', text: '出套题' }), h('span', { className: 'nav-end' })));
  const page = h('div', { className: 'page pp-page qz' });
  root.append(nav, page);
  // 卷子版式和错题卷同一份（paper.SHEET_CSS），错题卷那边可能已经放过
  for (const [id, css] of [['pp-sheet-css', SHEET_CSS], ['qz-sheet-css', QUIZ_CSS]]) {
    if (document.getElementById(id)) continue;
    const st = document.createElement('style');
    st.id = id;
    st.textContent = css;
    document.head.append(st);
  }
  let quiz = null;
  let showKey = false;
  const list = () => { try { return (ctx.kv.peek('quizzes', []) || []).filter(Boolean); } catch (e) { return []; } };
  const newOne = () => ctx.go('chat', { mode: 'quiz', fresh: Date.now() });

  function paintList() {
    const all = list();
    page.replaceChildren(
      h('h1', { className: 'page-title', text: '出套题' }),
      h('p', { className: 'lede', text: '想练什么，跟我说：哪几章、哪方面、多难、综合卷还是计算题。我问清楚以后出一套，可以打印出来做。' }),
      h('div', { className: 'btn-row' }, h('button', { type: 'button', className: 'btn btn-big', on: { click: newOne } }, icon('print'), h('span', { text: '出一套新的' }))),
      all.length ? h('h2', { className: 'sec-h qz-past-h', text: '出过的卷子' }) : null,
      all.length ? h('ul', { className: 'qz-list' }, all.map(q => h('li', {}, h('button', { type: 'button', className: 'qz-row', on: { click: () => ctx.go('quiz', { id: q.id }) } },
        h('span', { className: 'qz-t', text: q.title }), h('span', { className: 'small', text: `${dayCn(q.made)} · ${specLine(q.spec || {}, ctx.curriculum)}` }), icon('chev'))))) : null);
  }

  function paintQuiz() {
    const doc = h('div', { className: 'pp-preview' + (showKey ? ' qz-showkey' : '') });
    doc.innerHTML = quizSheetsHTML(quiz);   // 字都过了 esc() 或 mathview.renderText（先转义）
    page.replaceChildren(
      h('div', { className: 'pp-noprint' },
        h('h1', { className: 'page-title', text: quiz.title }),
        h('p', { className: 'small', text: `${dayCn(quiz.made)} · ${specLine(quiz.spec || {}, ctx.curriculum)}` }),
        h('div', { className: 'btn-row pp-tools' },
          h('button', { type: 'button', className: 'btn', on: { click: doPrint } }, icon('print'), h('span', { text: '打印' })),
          h('button', { type: 'button', className: 'btn quiet', text: '分享', on: { click: doShare } })),
        h('p', { className: 'small pp-help', text: '打印不出来的话，点“分享”，存成文件，发到电脑上打印。最后一页是答案，打印时会带上。' })),
      doc,
      h('div', { className: 'btn-row pp-noprint qz-foot' },
        h('button', { type: 'button', className: 'btn quiet', text: showKey ? '收起答案' : '做完了，看答案', on: { click: () => { showKey = !showKey; paintQuiz(); } } }),
        h('button', { type: 'button', className: 'text-btn accent', text: '再出一套', on: { click: newOne } })));
  }

  function doPrint() {
    try { if (typeof window.print !== 'function') throw new Error('no print'); window.print(); }
    catch { toast('这台 iPad 现在打印不了，点“分享”试试。', 3500); }
  }
  function doShare() {
    if (!quiz) return;
    const html = quizHTML(quiz);
    const name = quizFileName(quiz);
    let file = null;
    try { file = new File([html], name, { type: 'text/html' }); } catch { file = null; }
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: quiz.title }).catch(e => { if (!e || e.name !== 'AbortError') download(html, name); });
      return;
    }
    download(html, name);
  }
  function download(html, name) {
    try {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const a = h('a', { href: url, download: name, hidden: true });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast('没分享出去，再试一次。', 3000); }
  }

  return {
    show(params = {}, { from } = {}) {
      lab.textContent = !from || from === 'home' ? '首页' : '返回';
      showKey = false;
      quiz = params.id ? list().find(q => q.id === params.id) || null : null;
      if (quiz) paintQuiz(); else paintList();
      requestAnimationFrame(() => window.scrollTo(0, 0));   // nav 恢复滚动位置之后再回到顶上
    },
    hide() { showKey = false; },
  };
}
