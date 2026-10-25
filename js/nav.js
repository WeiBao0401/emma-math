// 路由表和前进后退（CONTRACTS.md 第 8 节）。纯数据和纯函数，不碰 DOM，node 能测；显示哪个界面由 app.js 的 onShow 做。
// 负责：外壳。加路由时改 ROUTES（写进 needs，由接线的人合并），同时在 app.js VIEW_FACTORIES、index.html 各加一处。
//
// 导出
//   ROUTES                 { route: { section, parent?, back?, title? } }
//                          section：index.html 里的 <section id="view-<section>">；parent：没有来路时“返回”去哪；back：返回按钮上的字
//   SECTIONS               所有 section 名（去重）
//   DEFAULT_ROUTE          'home'
//   sectionId(section)     -> 'view-<section>'
//   resolveRoute(name)     -> { name, section, ... }   不认识的名字回首页
//   createNav({ onShow })  -> { go(route, params), back(), current(), stack() }
//                          onShow(name, params, { from, back })：换界面时调一次，app.js 在里面切 section、调界面的 show()
//
// 为什么用一个栈：一个界面可以从好几处进来（错题本从首页进，也可能从讲题页进），“返回”应该回到来的地方。
// 栈里已有的界面再 go 一次，就退回到它（不会越叠越深）。iPad 主屏幕 App 没有浏览器的后退键，所以不碰 history。

// CONTRACTS.md 第 11 节。每个路由在 app.js VIEW_FACTORIES 里有一个界面，在 index.html 里有一个 section（测试检查）。
// back、title 只是说明：返回按钮和标题由各界面自己画，字和这里一致。
export const ROUTES = {
  home: { section: 'home', title: 'Emma 的数学老师' },                                // ui-home
  capture: { section: 'capture', parent: 'home', back: '首页', title: '拍错题' },       // ui-capture 屏 1-3
  page: { section: 'page', parent: 'home', back: '首页', title: '这一页的题' },         // ui-capture 屏 4 { photoId }
  confirm: { section: 'confirm', parent: 'home', back: '返回' },                      // ui-capture 屏 5 { photoId, idx }
  explain: { section: 'explain', parent: 'page', back: '返回', title: '讲题' },          // ui-explain 屏 6-10 { photoId, idx }
  practice: { section: 'practice', parent: 'home', back: '首页', title: '复习' },       // ui-practice { cardId?, light?, demo? }
  book: { section: 'book', parent: 'home', back: '首页', title: '攻克本' },             // ui-book { tab? }
  card: { section: 'card', parent: 'book', back: '攻克本' },                          // ui-book { id }
  parent: { section: 'parent', parent: 'home', back: '首页', title: '家长' },           // ui-parent
  onboard: { section: 'onboard', title: '约定' },                                     // ui-onboard { review? }
  chat: { section: 'chat', parent: 'home', back: '首页', title: '问我' },               // ui-chat { mode, point?, cardId?, chatId? }（v0.3）
  bookmap: { section: 'bookmap', parent: 'home', back: '首页', title: '课本地图' }, // ui-bookmap（v0.7 课本和进度）
  paper: { section: 'paper', parent: 'home', back: '首页', title: '错题卷' },           // ui-paper { sections? }（v0.4 考前错题卷）
};
export const DEFAULT_ROUTE = 'home';
export const SECTIONS = [...new Set(Object.values(ROUTES).map(r => r.section))];
export const sectionId = section => 'view-' + section;

export function resolveRoute(name) {
  const known = Object.prototype.hasOwnProperty.call(ROUTES, name);
  const n = known ? name : DEFAULT_ROUTE;
  return { name: n, ...ROUTES[n] };
}

export function createNav({ onShow = () => {} } = {}) {
  let stack = [];   // [{ name, params }]，最后一个是当前界面
  const top = () => stack[stack.length - 1] || null;

  function show(entry, from, back) {
    onShow(entry.name, entry.params, { from, back });
  }

  // 同一个界面、没带参数：什么都不做（连点两下不会闪）。带了参数就重新显示一次。
  function go(name, params = null) {
    const r = resolveRoute(name);
    const cur = top();
    if (cur && cur.name === r.name && !params) return false;
    const from = cur ? cur.name : null;
    const at = stack.findIndex(e => e.name === r.name);
    if (at >= 0) stack = stack.slice(0, at + 1);
    const entry = { name: r.name, params: params || (at >= 0 ? stack[at].params : {}) || {} };
    if (at >= 0) stack[at] = entry; else stack.push(entry);
    show(entry, from, false);
    return true;
  }

  // 回到来的地方；没有来路就去这个界面的 parent，再没有就回首页。已经在首页就不动。
  function back() {
    const cur = top();
    if (!cur) return go(DEFAULT_ROUTE);
    if (stack.length > 1) {
      stack.pop();
      show(top(), cur.name, true);
      return true;
    }
    const parent = resolveRoute(cur.name).parent || DEFAULT_ROUTE;
    if (parent === cur.name) return false;
    stack = [{ name: resolveRoute(parent).name, params: {} }];
    show(top(), cur.name, true);
    return true;
  }

  return {
    go,
    back,
    current: () => (top() ? top().name : null),
    stack: () => stack.map(e => e.name),
  };
}
