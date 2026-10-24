// 离线外壳：先读缓存，按版本整套换。作用范围 /emma-math/（GitHub Pages 仓库 "emma-math"）。
// VERSION 和 js/config.js 的 VERSION 必须一样（测试检查），每次发版两处一起改，不然 iPad 一直用旧文件。
// 和英语老师（/emma/）、Wei 的词典（/wordcoach/）同一个源，Cache Storage 是共用的：
//   这里的缓存一律叫 "emmamath-…"，也只删 "emmamath-" 开头的旧缓存。
//   绝不能叫 "emma-…"：英语老师的 sw.js 会删掉所有 "emma-" 开头、不是它自己版本的缓存。
// Poe、中转站的请求是别的源，直接走网络，这里不碰。照片和错题在 IndexedDB 里，也不经过这里。
const VERSION = '0.3.0';
const CACHE = 'emmamath-' + VERSION;
// 要离线能用的全部文件。web/js、web/css、web/curriculum 下新加文件要加进来（测试检查两个方向：列了的都存在，存在的都列了）。
// curriculum/ 是公开的课本目录和错因表（几十 KB），跟着版本走，不单独分缓存。
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'css/base.css', 'css/math.css', 'css/keypad.css',
  'css/home.css', 'css/capture.css', 'css/explain.css', 'css/practice.css', 'css/book.css', 'css/onboard.css', 'css/parent.css', 'css/chat.css',
  'js/app.js', 'js/nav.js', 'js/ui-dom.js', 'js/flow.js',
  'js/config.js', 'js/ai.js', 'js/budget.js', 'js/kid-errors.js', 'js/mock.js',
  'js/db.js', 'js/image.js', 'js/mathcheck.js', 'js/mathview.js',
  'js/prompts.js', 'js/pipeline.js', 'js/notebook.js', 'js/curriculum.js',
  'js/keypad.js',
  'js/teacher.js', 'js/md.js', 'js/voice.js', 'js/profile.js',
  'js/ui-home.js', 'js/ui-capture.js', 'js/ui-explain.js', 'js/ui-practice.js', 'js/ui-book.js', 'js/ui-onboard.js', 'js/ui-parent.js', 'js/ui-chat.js',
  'curriculum/sections.json', 'curriculum/errors.json',
];
const BASE = new URL('./', self.location).href;   // https://weibao0401.github.io/emma-math/
const OURS = k => k.startsWith('emmamath-');

// 装的时候绕过 HTTP 缓存，拿到的一定是这一版的文件
const fresh = u => new Request(new URL(u, BASE), { cache: 'reload' });

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(fresh))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => OURS(k) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 只管同源、/emma-math/ 下面的文件。英语老师、词典、Poe、中转站都不管。
  if (url.origin !== self.location.origin || !url.href.startsWith(BASE)) return;

  if (req.mode === 'navigate') {
    // 外壳按相对路径加载 js/，只能在 App 根目录打开。打错的地址回到 /emma-math/，带着 ?mock=1 这类参数。
    const root = new URL(BASE).pathname;
    if (url.pathname !== root && url.pathname !== root + 'index.html') {
      e.respondWith(Response.redirect(BASE + url.search, 302));
      return;
    }
    // 回应缓存里的 index.html；地址栏不变，?mock=1 留在页面上
    e.respondWith(caches.match(BASE, { cacheName: CACHE })
      .then(hit => hit || caches.match(new URL('index.html', BASE).href, { cacheName: CACHE }))
      .then(hit => hit || fetch(req))
      .catch(() => caches.match(BASE)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true, cacheName: CACHE })
    .then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    })));
});
