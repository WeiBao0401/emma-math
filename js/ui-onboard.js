// 第一次打开：老师和你的约定（C 7.4 的草稿，和英语老师 App 同样的结构和口吻，C 8.5）。
// 六条约定，一个“好，开始吧”：写 kv 'onboarded' = true 和 'promisesSeen' = PROMISES_VERSION，回首页。
// 以后从错题本底部“老师和你的约定”还能再看（params.review），这时按钮是“知道了”，点了回去。
// 约定改了（PROMISES_VERSION 加一），needsOnboard 为真，首页会再请她看一次（C 8.5“改了条款要重新给她看”）。
// 孩子这边不出现“第几步 / 共几步”，没有勾选框，读完点一下就行。
// 负责：首页 / 错题本 / 约定页 agent。
//
// 导出
//   createOnboard(ctx) -> { show({ review }), hide() }    画在 #view-onboard，全屏，没有顶栏
//   PROMISES [{ head, more }]、PROMISES_VERSION、needsOnboard(kv) -> bool（首页用）
// 用到的 ctx：kv（peek / set）、go、back、toast。样式在 css/onboard.css，类名以 onboard- 开头。
import { h } from './ui-dom.js';

export const PROMISES_VERSION = 1;
export const PROMISES = [
  { head: '我只讲学校老师批改过的错题。', more: '还没交的作业，等学校老师批完再拿来。' },
  { head: '我不会一上来就给答案。', more: '先请你自己找，找不到我一步步帮你，最多四步一定讲清楚。' },
  { head: '我也会看错、算错。', more: '拿不准的题我会直说“这道问问学校老师”。你觉得我不对，就点“这题有问题”。' },
  { head: '家长每周看一页小结。', more: '就是你看到的那一页，还有“要问学校老师的题”。不会把每道题的对错发给家长。' },
  { head: '我只当数学老师。', more: '别的作业和心事，去找家人。' },
];

export function needsOnboard(kv) {
  if (!kv || typeof kv.peek !== 'function') return false;
  if (kv.peek('onboarded', false) !== true) return true;
  const seen = Number(kv.peek('promisesSeen', 1)) || 1;   // 没记版本的（老备份）当看过第 1 版
  return seen < PROMISES_VERSION;
}

export function createOnboard(ctx) {
  const root = document.getElementById('view-onboard');
  root.replaceChildren();
  let review = false;
  let busy = false;

  async function agree() {
    if (busy) return;
    if (review) { ctx.back(); return; }
    busy = true;
    try {
      await ctx.kv.set('onboarded', true);
      await ctx.kv.set('promisesSeen', PROMISES_VERSION);
    } catch (e) {
      console.warn('onboard:', (e && e.message) || e);
      busy = false;
      ctx.toast('没存上，再点一次。');
      return;
    }
    busy = false;
    ctx.go('home');
  }

  function render() {
    root.replaceChildren(h('div', { className: 'onboard' },
      h('p', { className: 'onboard-kicker', text: 'Emma 的数学老师' }),
      h('h1', { className: 'page-title onboard-title', text: '老师和你的约定' }),
      h('ol', { className: 'onboard-list' }, PROMISES.map((p, i) => h('li', {},
        h('span', { className: 'onboard-num', text: String(i + 1) }),
        h('div', {}, h('p', { className: 'onboard-head', text: p.head }), h('p', { className: 'onboard-more', text: p.more }))))),
      h('div', { className: 'onboard-go' }, h('button', { type: 'button', className: 'btn btn-big onboard-btn', text: review ? '知道了' : '好，开始吧', on: { click: agree } }))));
  }

  return {
    show(params = {}) {
      review = !!params.review && !needsOnboard(ctx.kv);
      busy = false;
      render();
      window.scrollTo(0, 0);
    },
    hide() { busy = false; },
  };
}
