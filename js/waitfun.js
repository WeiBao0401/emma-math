// 等一等（v0.9，Wei 10-25）：看照片、讲题、出卷要等十几秒到一分钟，这段时间玩一个小东西，学一点点：
//   word   英语单词：她英语 App 里课本的词（同域名读英语 App 的 kv 'textbook'，只读），没有就用内置的七上常用词；看词选意思，点词能听读音
//   poem   古诗接龙：七上语文的古诗，给上句选下句
//   calc   口算闪电战：有理数口算，三选一，错的那个选项正是常见的坑（−3² 写成 9 这类），连对计数
//   p24    24 点：四个数凑 24，想好了点一下看一种算法
//   fact   数学小知识：一句有意思的事，配一个小问题
// 每次等待出一种，轮着来（kv 'waitTurn'），同一个题最近见过的不再出（kv 'waitSeen'）。内容都在本地，不联网、不花钱。
//
//   createWaitFun(ctx, { kinds }) -> HTMLElement   放进等待的界面里；等完了界面换掉，它就跟着没了
//   loadEnglishWords(ctx) -> Promise<words>        开机时读一次英语 App 的课本词，放在内存（ctx 上的 englishWords）
//   纯函数（测试用）：pickKind(turn, kinds)、calcItem(rand)、choicesFor(answer, pool, rand)、POEMS、WORDS、P24、FACTS
import { h, mathText } from './ui-dom.js';
import { readEnglishKV } from './voice-input.js';

export const KINDS = ['word', 'calc', 'poem', 'p24', 'fact'];
const SEEN_CAP = 40;

export const POEMS = [
  { a: '东临碣石，以观沧海。', b: '水何澹澹，山岛竦峙。', src: '曹操《观沧海》' },
  { a: '日月之行，若出其中；', b: '星汉灿烂，若出其里。', src: '曹操《观沧海》' },
  { a: '我寄愁心与明月，', b: '随君直到夜郎西。', src: '李白《闻王昌龄左迁龙标遥有此寄》' },
  { a: '海日生残夜，', b: '江春入旧年。', src: '王湾《次北固山下》' },
  { a: '乡书何处达？', b: '归雁洛阳边。', src: '王湾《次北固山下》' },
  { a: '枯藤老树昏鸦，', b: '小桥流水人家，', src: '马致远《天净沙·秋思》' },
  { a: '夕阳西下，', b: '断肠人在天涯。', src: '马致远《天净沙·秋思》' },
  { a: '峨眉山月半轮秋，', b: '影入平羌江水流。', src: '李白《峨眉山月歌》' },
  { a: '正是江南好风景，', b: '落花时节又逢君。', src: '杜甫《江南逢李龟年》' },
  { a: '晴空一鹤排云上，', b: '便引诗情到碧霄。', src: '刘禹锡《秋词》' },
  { a: '何当共剪西窗烛，', b: '却话巴山夜雨时。', src: '李商隐《夜雨寄北》' },
  { a: '夜阑卧听风吹雨，', b: '铁马冰河入梦来。', src: '陆游《十一月四日风雨大作》' },
  { a: '不知何处吹芦管，', b: '一夜征人尽望乡。', src: '李益《夜上受降城闻笛》' },
  { a: '学而不思则罔，', b: '思而不学则殆。', src: '《论语》' },
  { a: '三人行，', b: '必有我师焉。', src: '《论语》' },
  { a: '知之者不如好之者，', b: '好之者不如乐之者。', src: '《论语》' },
];

// 内置的英语词（人教版七年级上册常见的词），英语 App 里没有课本词时用
export const WORDS = [
  ['classmate', '同学'], ['favourite', '最喜欢的'], ['delicious', '美味的'], ['healthy', '健康的'], ['hobby', '爱好'],
  ['interesting', '有趣的'], ['library', '图书馆'], ['playground', '操场'], ['subject', '学科'], ['science', '科学'],
  ['history', '历史'], ['geography', '地理'], ['vegetable', '蔬菜'], ['breakfast', '早餐'], ['celebrate', '庆祝'],
  ['festival', '节日'], ['together', '一起'], ['cousin', '堂（表）兄弟姐妹'], ['important', '重要的'], ['usually', '通常'],
  ['exercise', '锻炼'], ['weekend', '周末'], ['different', '不同的'], ['special', '特别的'], ['activity', '活动'],
  ['always', '总是'], ['never', '从不'], ['difficult', '困难的'], ['dictionary', '词典'], ['garden', '花园'],
].map(([w, cn]) => ({ w, cn }));

// 24 点：nums 四个数，way 一种算法（式子），都核过等于 24
export const P24 = [
  { nums: [1, 2, 3, 4], way: '1×2×3×4' },
  { nums: [2, 2, 6, 6], way: '6×2+6×2' },
  { nums: [3, 4, 5, 6], way: '6×(5−4+3)' },
  { nums: [4, 5, 6, 7], way: '(5+7−6)×4' },
  { nums: [2, 4, 8, 8], way: '8+8+4×2' },
  { nums: [3, 3, 4, 7], way: '3×(7+4−3)' },
  { nums: [-2, 3, 4, 6], way: '6×4×[3+(−2)]' },
  { nums: [-1, 2, 3, 8], way: '8×3×[2+(−1)]' },
  { nums: [-3, -4, 2, 1], way: '(−3)×(−4)×2×1' },
  { nums: [5, 5, 5, 1], way: '5×(5−1÷5)' },
];

export const FACTS = [
  { t: '负数最早写在中国的《九章算术》里。古人用红色的算筹表示正数，黑色的算筹表示负数。', q: '用今天的写法，“黑色的 3”是多少？', a: '−3' },
  { t: '珠穆朗玛峰海拔约 8849 米，马里亚纳海沟最深处约在海平面以下 10935 米，记作 −10935 米。', q: '最高处比最低处高多少米？', a: '8849 − (−10935) = 19784 米' },
  { t: '一张纸对折一次是 2 层，对折两次是 4 层。对折 n 次就有 \\(2^n\\) 层。', q: '对折 10 次有多少层？', a: '\\(2^{10}=1024\\) 层' },
  { t: '光一秒大约走 300000 千米，用科学记数法写是 \\(3\\times10^5\\) 千米。', q: '光走 10 秒，大约多少千米？用科学记数法写。', a: '\\(3\\times10^6\\) 千米' },
  { t: '0 既不是正数，也不是负数。它是正数和负数的分界。', q: '比 −2 大、比 2 小的整数有几个？', a: '3 个：−1、0、1' },
  { t: '北京冬天有时最低气温是 −10 ℃，最高 2 ℃。', q: '这一天的温差是多少？', a: '2 − (−10) = 12 ℃' },
  { t: '“负负得正”可以这样想：一个人每天少 3 元记作 −3，“3 天前”记作 −3 天。', q: '3 天前，他的钱比现在多还是少？多多少？', a: '多 9 元：(−3)×(−3)=9' },
  { t: '一个数的绝对值，就是数轴上这个数到 0 的距离，所以绝对值不会是负的。', q: '绝对值等于 5 的数有哪几个？', a: '5 和 −5' },
];

const pick = (arr, rand = Math.random) => arr[Math.floor(rand() * arr.length)];
function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const pickKind = (turn = 0, kinds = KINDS) => kinds[((turn % kinds.length) + kinds.length) % kinds.length];

// 三个选项：答案 + 两个别的（不重复）
export function choicesFor(answer, pool, rand = Math.random) {
  const others = shuffle(pool.filter(x => x !== answer), rand).slice(0, 2);
  return shuffle([answer, ...others], rand);
}

// 一道有理数口算：{ q（LaTeX）, answer, trap }，trap 是常见的坑
const fmt = n => (n < 0 ? `−${-n}` : String(n));
export function calcItem(rand = Math.random) {
  const n = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const a = n(2, 9), b = n(2, 9);
  const kinds = [
    () => ({ q: `-${a}^2`, answer: -a * a, trap: a * a }),
    () => ({ q: `(-${a})^2`, answer: a * a, trap: -a * a }),
    () => ({ q: `(-${a})\\times(-${b})`, answer: a * b, trap: -a * b }),
    () => ({ q: `${a}-(-${b})`, answer: a + b, trap: a - b }),
    () => ({ q: `-${a}+${b}`, answer: b - a, trap: -(a + b) }),
    () => ({ q: `-${a}-${b}`, answer: -(a + b), trap: b - a }),
    () => ({ q: `|-${a}|-${b}`, answer: a - b, trap: -a - b }),
    () => ({ q: `(-${a * b})\\div${b}`, answer: -a, trap: a }),
    () => ({ q: `(-2)^3`, answer: -8, trap: 8 }),
    () => ({ q: `-1^{${2 * n(1, 3)}}`, answer: -1, trap: 1 }),
  ];
  const it = pick(kinds, rand)();
  const near = it.answer + (rand() < 0.5 ? 1 : -1);
  const opts = [...new Set([it.answer, it.trap, near])];
  while (opts.length < 3) opts.push(it.answer + opts.length + 1);
  return { q: it.q, answer: it.answer, options: shuffle(opts, rand).map(fmt), right: fmt(it.answer) };
}

// 英语 App 的课本词（带中文的），最近的单元在前；读不到返回 []
export async function loadEnglishWords(ctx) {
  try {
    const got = await readEnglishKV(['textbook', 'progress']);
    const tb = got && got.textbook;
    const units = ((tb && tb.units) || []).filter(u => u && Array.isArray(u.words)).sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    const cur = got && got.progress && got.progress.unit;
    const upto = cur && units.some(u => u.id === cur) ? units.slice(0, units.findIndex(u => u.id === cur) + 1) : units;
    const words = [];
    for (const u of upto.reverse()) for (const w of u.words) {
      const t = String((w && w.w) || '').trim(), cn = String((w && w.cn) || '').trim();
      if (t && cn && /^[A-Za-z][A-Za-z' .-]*$/.test(t)) words.push({ w: t, cn: cn.split(/[；;，,]/)[0].slice(0, 12) });
    }
    ctx.englishWords = words;
    return words;
  } catch (e) { return []; }
}

// ---------------------------------------------------------------- 界面

export function createWaitFun(ctx, { kinds = KINDS } = {}) {
  const peek = (k, f) => { try { return ctx.kv.peek(k, f); } catch (e) { return f; } };
  const save = (k, v) => { try { ctx.kv.set(k, v); } catch (e) { /* 只是轮换用 */ } };
  const seen = new Set(peek('waitSeen', []) || []);
  const markSeen = id => { seen.add(id); save('waitSeen', [...seen].slice(-SEEN_CAP)); };
  const fresh = (list, idOf) => { const f = list.filter(x => !seen.has(idOf(x))); return pick(f.length ? f : list); };
  let turn = Number(peek('waitTurn', 0)) || 0;

  const body = h('div', { className: 'wf-body' });
  const label = h('span', { className: 'wf-kind' });
  const card = h('section', { className: 'wf', 'aria-label': '等一等，玩一个' },
    h('div', { className: 'wf-head' }, h('span', { className: 'wf-hi', text: '等一等，顺便' }), label,
      h('button', { type: 'button', className: 'text-btn wf-next', text: '换一个', on: { click: () => { turn++; show(); } } })),
    body);

  // 三选一：点了马上说对不对，再给一句
  function choice(opts, right, after) {
    const row = h('div', { className: 'wf-opts' });
    const done = h('p', { className: 'wf-after', hidden: true });
    for (const o of opts) {
      const b = h('button', { type: 'button', className: 'wf-opt' }, typeof o === 'string' && /[\\^]/.test(o) ? mathText(`\\(${o}\\)`) : o);
      b.addEventListener('click', () => {
        if (row.classList.contains('answered')) return;
        row.classList.add('answered');
        for (const x of row.children) if (x.textContent === right) x.classList.add('right');
        if (b.textContent !== right) b.classList.add('wrong');
        done.hidden = false;
        done.replaceChildren(...after(b.textContent === right));
      });
      row.append(b);
    }
    return [row, done];
  }

  const speak = w => {
    try {
      const u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US'; u.rate = 0.85;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* 读不出来也没关系 */ }
  };

  const RENDER = {
    word() {
      const own = Array.isArray(ctx.englishWords) && ctx.englishWords.length >= 6 ? ctx.englishWords : null;
      const list = own || WORDS;
      const it = fresh(list, x => 'w:' + x.w);
      markSeen('w:' + it.w);
      label.textContent = own ? '记一个英语课本里的词' : '记一个英语单词';
      const word = h('button', { type: 'button', className: 'wf-word', lang: 'en', 'aria-label': `${it.w}，点一下听读音`, on: { click: () => speak(it.w) } }, it.w, h('span', { className: 'wf-say', text: '🔊' }));
      const [row, done] = choice(choicesFor(it.cn, list.map(x => x.cn)), it.cn,
        ok => [ok ? '对了。' : `是“${it.cn}”。`, ' 点上面的词听一遍，跟着读一读。']);
      return [word, h('p', { className: 'wf-q', text: '它的意思是？' }), row, done];
    },
    poem() {
      const it = fresh(POEMS, x => 'p:' + x.a);
      markSeen('p:' + it.a);
      label.textContent = '接一句古诗';
      const [row, done] = choice(choicesFor(it.b, POEMS.map(x => x.b)), it.b,
        ok => [ok ? '接对了。' : '是这一句。', ` ${it.src}`]);
      return [h('p', { className: 'wf-poem', text: it.a }), h('p', { className: 'wf-q', text: '下一句是？' }), row, done];
    },
    calc() {
      label.textContent = '口算闪电战';
      let streak = 0;
      const box = h('div', { className: 'wf-calc' });
      const score = h('p', { className: 'small wf-streak' });
      const next = () => {
        const it = calcItem();
        const [row, done] = choice(it.options, it.right, ok => {
          streak = ok ? streak + 1 : 0;
          score.textContent = streak ? `连对 ${streak} 道` : '';
          setTimeout(next, ok ? 700 : 1600);
          return [ok ? '对。' : `是 ${it.right}。`];
        });
        box.replaceChildren(mathText(`\\(${it.q}=\\;?\\)`, { tag: 'p', className: 'wf-calc-q' }), row, done);
      };
      next();
      return [box, score];
    },
    p24() {
      const it = fresh(P24, x => 'g:' + x.nums.join(','));
      markSeen('g:' + it.nums.join(','));
      label.textContent = '24 点';
      const way = h('p', { className: 'wf-after', hidden: true, text: `一种算法：${it.way} = 24` });
      return [h('p', { className: 'wf-q', text: '每个数用一次，加减乘除和括号随便用，凑出 24。' }),
        h('div', { className: 'wf-cards' }, it.nums.map(x => h('span', { className: 'wf-card', text: fmt(x) }))),
        h('button', { type: 'button', className: 'text-btn accent', text: '想好了，看一种算法', on: { click: e => { way.hidden = false; e.currentTarget.hidden = true; } } }), way];
    },
    fact() {
      const it = fresh(FACTS, x => 'f:' + x.q);
      markSeen('f:' + it.q);
      label.textContent = '数学小知识';
      const ans = mathText(`答案：${it.a}`, { tag: 'p', className: 'wf-after' });
      ans.hidden = true;
      return [mathText(it.t, { tag: 'p', className: 'wf-fact' }), mathText(it.q, { tag: 'p', className: 'wf-q' }),
        h('button', { type: 'button', className: 'text-btn accent', text: '算好了，看答案', on: { click: e => { ans.hidden = false; e.currentTarget.hidden = true; } } }), ans];
    },
  };

  function show() {
    const kind = pickKind(turn, kinds);
    save('waitTurn', turn + 1);
    try { body.replaceChildren(...RENDER[kind]()); } catch (e) { console.warn('waitfun', e); body.replaceChildren(); }
  }
  show();
  return card;
}
