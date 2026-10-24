// ctx.flow（CONTRACTS.md 第 10 节）：拍照到讲完这一路的状态。内存里一份，同时写 kv 'flow'，切走、关掉再打开能接着做。
// 负责：外壳（接线）。ui-capture、ui-explain 读写，别的界面不碰。
//
// 导出
//   createFlow({ kv, key = 'flow', schedule }) -> { get(), set(patch), clear(), flush() }
//     get()         -> 当前状态的浅拷贝（同步）。带着只在内存的东西，比如确认屏放进去的 diagnosing（诊断的 Promise）
//     set(patch)    -> 合并后的状态（同步返回）。内存马上改，kv 稍后写一次（同一轮里连着 set 好几次只写一次）
//     clear()       -> 清空内存，删掉 kv 'flow'
//     flush()       -> Promise：等排着的写完（App 退到后台时 app.js 调一次，免得最后一下没写进去）
//   storable(state) -> 能写进 IndexedDB 的那部分（纯函数，node 能测）
//
// 为什么
// - 确认屏点“对，就是这样”时把诊断的 Promise 放进 flow（讲题屏接着等它）。Promise 和函数没法 structuredClone，
//   直接写 kv 会抛 DataCloneError，所以写之前去掉，只留在内存；重新打开 App 后没有这个 Promise，讲题屏自己再诊断一次。
// - crop 是长边 1200 的 dataURL（一两百 KB），讲题屏每走一步都 set 一次。合并成一次写，免得一秒写好几遍。
// - 写失败只记一笔，不打断她做题：flow 只是“接着做”的方便，丢了最多从这道题的开头再来。
// - 写入排成一条队，旧的状态不会在新的之后落地；clear 也排在队里。

const isThenable = v => !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
const clone = typeof structuredClone === 'function' ? structuredClone : v => JSON.parse(JSON.stringify(v));

export function storable(state) {
  const out = {};
  if (!state || typeof state !== 'object') return out;
  for (const [k, v] of Object.entries(state)) {
    if (v === undefined || typeof v === 'function' || isThenable(v)) continue;
    try { out[k] = clone(v); } catch (e) { /* 存不进去的（Blob 以外的怪东西）：只留在内存 */ }
  }
  return out;
}

export function createFlow({ kv, key = 'flow', schedule = fn => setTimeout(fn, 0) } = {}) {
  const saved = kv && typeof kv.peek === 'function' ? kv.peek(key, null) : null;
  let state = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {};
  let queued = false;
  let chain = Promise.resolve();
  const warn = e => console.warn('flow:', (e && e.message) || e);
  const enqueue = op => { chain = chain.then(op).catch(warn); return chain; };

  function write() {
    queued = false;
    const value = storable(state);
    return enqueue(() => (kv && kv.set ? kv.set(key, value) : undefined));
  }

  return {
    get: () => ({ ...state }),
    set(patch) {
      if (patch && typeof patch === 'object') state = { ...state, ...patch };
      if (!queued) { queued = true; schedule(() => { if (queued) write(); }); }
      return { ...state };
    },
    clear() {
      state = {};
      queued = false;
      return enqueue(() => (kv && kv.delete ? kv.delete(key) : kv && kv.set ? kv.set(key, {}) : undefined));
    },
    flush() { return queued ? write() : chain; },
  };
}
