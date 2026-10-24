// Her data on the iPad: IndexedDB "emmamath" v1, and the backup file (export / import). Owner: 数据 (CONTRACTS.md 6).
// Nothing touches indexedDB at import time; openStore takes the factory as an argument, so tests/db.test.mjs runs it
// in Node against tests/fake-idb.mjs.
//
//   openStore({ indexedDB, IDBKeyRange, name, version, timeoutMs, now }) -> Promise<store>   (all options optional)
//     get(name, id) -> record | undefined
//     put(name, rec) -> id                  photos / items without an id get newId('p' / 'q'), written back to rec.id
//     putMany(name, recs) -> count          one transaction
//     del(name, id)
//     all(name) -> [records] by primary key
//     byIndex(name, index, query, limit) -> [records], oldest first (ascending index value)
//     latest(name, index, query, limit) -> [records], newest first (descending index value)
//     count(name, index?, query?) -> number
//       query: undefined / null = all; a plain value = exact match; an IDBKeyRange; or { lo, hi, loOpen, hiOpen }
//       ('' or a missing end = open), e.g. byIndex('items', 'due', { hi: '2026-10-24' }) = due today or earlier
//     addAttempt(rec) -> id                 rec: { itemId, at, kind, given, ok, reason, ms, hints }; `at` defaults to now
//     attemptsFor(itemId) -> [attempts], oldest first
//     kvGet(key, fallback), kvSet(key, value), kvDel(key), kvAll() -> [{ key, value, updated }]
//     exportAll({ photos = true }) -> { format: 'emmamath-export', version: 1, app, at, photos, items, attempts, kv }
//       Blobs anywhere in a record become data: URLs, their paths listed in the record's `_blobs` (so photo.blob is a
//       data: URL string in the file). settings.poeKey is never in the file. photos: false leaves the photos out
//       (photosOmitted: true), for a small file; importing such a file never touches the photos on the iPad.
//     importAll(obj, { replace = false }) -> { photos, items, attempts, kv, skipped }   counts written / skipped
//       merge (default): adds what is missing; a photo or item already here is replaced only when the file's copy is
//         newer (`updated`, else `at`); attempts are matched by itemId + at + kind; kv keys already here are kept.
//       replace: the iPad ends up with exactly the file's photos, items, attempts and kv, except settings.poeKey,
//         which stays the iPad's own (a key never comes from a file, only from pasting it in 家长区).
//       One write transaction: a failed import changes nothing. A malformed record is skipped, not fatal.
//     close()
//   newId(prefix, t = Date.now()) -> 'q-0mh4x2k1c-7fk2a9zq'   time (fixed width, base 36, sorts by time) + random
//   parseExportText(text) -> object (validated), exportFileName(date) -> 'emmamath-backup-2026-10-24.json'
//   blobToDataURL(blob), dataURLToBlob(url), encodeBlobs(rec), decodeBlobs(rec), validateExport(obj), upgradeDB(db)
//   DBError { code: 'timeout' | 'blocked' | 'unsupported' | 'format' | 'data' | 'error' }
//
// Index values must be strings or numbers: IndexedDB leaves a record out of an index when the value is missing, null,
// true / false or an object. Use ISO strings for `at`, `due` ('YYYY-MM-DD' or ISO) and `updated`.

// The same values as config.js (DB_NAME, DB_VERSION); tests/db.test.mjs checks they agree. Kept here so this file
// has no imports and opens even when another module is broken.
export const DB_NAME = 'emmamath';
export const DB_VERSION = 1;
export const DB_TIMEOUT_MS = 8000;
// Deliberately different from the English teacher ('emma-export') and the dictionary ('wordcoach-export').
export const EXPORT_FORMAT = 'emmamath-export';
export const EXPORT_VERSION = 1;
export const STORES = ['photos', 'items', 'attempts', 'kv'];
const ID_PREFIX = { photos: 'p', items: 'q' };

export class DBError extends Error {
  constructor(message, code = 'error') { super(message); this.name = 'DBError'; this.code = code; }
}

// ---------------------------------------------------------------- ids

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
// Time first and fixed width, so ids sort by creation time as plain strings (handy in the all() order and in a
// backup diff); 8 random base-36 characters (about 41 bits) so two ids made in the same millisecond never collide.
export function newId(prefix = '', t = Date.now()) {
  const time = Math.max(0, Math.floor(Number(t) || 0)).toString(36).padStart(9, '0');
  const bytes = new Uint8Array(8);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const rand = Array.from(bytes, b => ALPHABET[b % 36]).join('');
  return (prefix ? prefix + '-' : '') + time + '-' + rand;
}

// ---------------------------------------------------------------- schema

// Every store and index, created once at version 1 so the version never has to go up (an upgrade on iOS can block
// behind a second open window). Only missing ones are created.
//   photos    {id, at, blob, width, height, page, status}   page = what the model read off the photo
//   items     {id, at, status, due, section, ...}           one mistake; the UI stage owns the shape
//   attempts  autoIncrement id, {itemId, at, kind, given, ok, reason, ms, hints}
//   kv        {key, value, updated}                         settings, budget, small state
export function upgradeDB(db) {
  const has = n => db.objectStoreNames.contains(n);
  if (!has('photos')) db.createObjectStore('photos', { keyPath: 'id' }).createIndex('at', 'at');
  if (!has('items')) {
    const s = db.createObjectStore('items', { keyPath: 'id' });
    for (const ix of ['at', 'status', 'due', 'section']) s.createIndex(ix, ix);
  }
  if (!has('attempts')) {
    const s = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
    s.createIndex('itemId', 'itemId');
    s.createIndex('at', 'at');
  }
  if (!has('kv')) db.createObjectStore('kv', { keyPath: 'key' });
}

// ---------------------------------------------------------------- IndexedDB with timeouts

// One connection, opened on first use and reopened after a reset. Copied from the English teacher: iOS 26 can stall
// IndexedDB requests forever or drop the connection without telling us.
function connection(idb, name, version, upgrade) {
  let promise = null;
  // A database already at a higher version (a newer build, then rolled back) is opened at the version it has
  // instead of failing with VersionError: the stores this build uses are all still there.
  const attempt = (resolve, reject, withVersion) => {
    let req;
    try { req = withVersion ? idb.open(name, version) : idb.open(name); } catch (e) { promise = null; reject(e); return; }
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); promise = null; };
      db.onclose = () => { promise = null; };
      resolve(db);
    };
    req.onerror = () => {
      const err = req.error;
      if (withVersion && err && err.name === 'VersionError') { attempt(resolve, reject, false); return; }
      promise = null;
      reject(err || new Error('open failed'));
    };
    req.onblocked = () => { promise = null; reject(new DBError('数据库被另一个窗口占用了。关掉其他窗口再试。', 'blocked')); };
  };
  return {
    open() {
      if (!promise) promise = new Promise((resolve, reject) => attempt(resolve, reject, true));
      return promise;
    },
    reset() {
      const p = promise;
      promise = null;
      if (p) p.then(db => { try { db.close(); } catch (e) { /* ignore */ } }, () => {});
    },
  };
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => { if (onTimeout) onTimeout(); reject(new DBError('timeout', 'timeout')); }, ms); }),
  ]).finally(() => clearTimeout(timer));
}

// fn(stores) queues requests synchronously and returns a value, or a function that reads the results after the
// transaction completes. Never await inside fn: the transaction commits as soon as it has nothing queued.
function runOnce(conn, storeNames, mode, fn, ms) {
  let tx = null;
  const work = conn.open().then(db => new Promise((resolve, reject) => {
    tx = db.transaction(storeNames, mode);
    const names = [].concat(storeNames);
    const stores = Object.fromEntries(names.map(n => [n, tx.objectStore(n)]));
    let out;
    try { out = fn(stores); } catch (e) { try { tx.abort(); } catch (_) { /* ignore */ } reject(e); return; }
    tx.oncomplete = () => { try { resolve(typeof out === 'function' ? out() : out); } catch (e) { reject(e); } };
    tx.onerror = ev => reject((ev && ev.target && ev.target.error) || tx.error || new Error('transaction error'));
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  }));
  return withTimeout(work, ms, () => { try { if (tx) tx.abort(); } catch (e) { /* ignore */ } });
}

// Errors that come out the same on a fresh connection: a bad record or a bad store name. No retry for these.
const NO_RETRY = new Set(['DataError', 'ConstraintError', 'NotFoundError', 'ReadOnlyError', 'DataCloneError', 'TypeError', 'QuotaExceededError']);

function finalError(e) {
  if (e instanceof DBError && e.code === 'timeout') return new DBError('本机数据库没有响应：上滑关掉 App 再打开。', 'timeout');
  if (e instanceof DBError) return e;
  if (e && e.name === 'QuotaExceededError') return new DBError('iPad 存储空间不够了：删掉一些照片或别的东西再试。', 'error');
  return new DBError('本机数据库出错：' + ((e && e.message) || e), 'error');
}

async function runOn(conn, storeNames, mode, fn, ms) {
  try {
    return await runOnce(conn, storeNames, mode, fn, ms);
  } catch (e) {
    if (e && NO_RETRY.has(e.name)) throw finalError(e);
    conn.reset();
    try {
      return await runOnce(conn, storeNames, mode, fn, ms);
    } catch (e2) {
      conn.reset();
      throw finalError(e2);
    }
  }
}

const reqResult = req => () => req.result;
const isPlainObject = x => Object.prototype.toString.call(x) === '[object Object]';
const isKey = k => (typeof k === 'string' && k !== '') || (typeof k === 'number' && Number.isFinite(k));

function checkName(name) {
  if (!STORES.includes(name)) throw new DBError('没有这张表：' + name, 'data');
}

// query (see the header) -> what getAll / count / openCursor take
function toQuery(q, KeyRange) {
  if (q === undefined || q === null) return null;
  if (KeyRange && q instanceof KeyRange) return q;
  if (isPlainObject(q)) {
    const has = v => v !== undefined && v !== null && v !== '';
    const { lo, hi, loOpen = false, hiOpen = false } = q;
    if (!KeyRange) throw new DBError('这台设备不能按范围查找。', 'unsupported');
    try {
      if (has(lo) && has(hi)) return KeyRange.bound(lo, hi, loOpen, hiOpen);
      if (has(lo)) return KeyRange.lowerBound(lo, loOpen);
      if (has(hi)) return KeyRange.upperBound(hi, hiOpen);
    } catch (e) { throw new DBError('查找范围不对：' + ((e && e.message) || e), 'data'); }
    return null;
  }
  return q;
}

// ---------------------------------------------------------------- blobs <-> data: URLs (pure, async)

export async function blobToDataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  // String.fromCharCode in chunks: one call with a whole photo overflows the argument limit
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export function dataURLToBlob(url) {
  const m = /^data:([^,]*),([\s\S]*)$/.exec(String(url || ''));
  if (!m) throw new DBError('不是图片数据。', 'format');
  const meta = m[1].split(';');
  const type = meta[0] || 'application/octet-stream';
  let bytes;
  if (meta.slice(1).some(p => p.toLowerCase() === 'base64')) {
    const bin = atob(m[2].replace(/\s+/g, ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(m[2]));
  }
  return new Blob([bytes], { type });
}

const isBlob = v => typeof Blob !== 'undefined' && v instanceof Blob;

// A record -> a copy that JSON can hold: every Blob (at any depth) becomes a data: URL, and `_blobs` lists the paths,
// e.g. [['blob'], ['crops', 0, 'image']]. Marking paths (rather than guessing from "starts with data:") means a field
// that really is a data: URL string, like a thumbnail, comes back as a string.
export async function encodeBlobs(rec) {
  const paths = [];
  const walk = async (v, path) => {
    if (isBlob(v)) { paths.push(path); return blobToDataURL(v); }
    if (Array.isArray(v)) { const out = []; for (let i = 0; i < v.length; i++) out.push(await walk(v[i], [...path, i])); return out; }
    if (isPlainObject(v)) { const out = {}; for (const [k, x] of Object.entries(v)) out[k] = await walk(x, [...path, k]); return out; }
    return v;
  };
  const out = await walk(rec, []);
  if (isPlainObject(out)) {
    delete out._blobs;
    if (paths.length) out._blobs = paths;
  }
  return out;
}

// The reverse. Also takes a photo whose `blob` is a data: URL without `_blobs` (a hand-made or very early file).
export async function decodeBlobs(rec) {
  const out = structuredClone(rec);
  const paths = Array.isArray(out._blobs) ? out._blobs : [];
  delete out._blobs;
  if (!paths.length && typeof out.blob === 'string' && out.blob.startsWith('data:')) paths.push(['blob']);
  for (const path of paths) {
    if (!Array.isArray(path) || !path.length) continue;
    let o = out;
    for (const p of path.slice(0, -1)) { o = o == null ? undefined : o[p]; }
    const last = path[path.length - 1];
    if (o && typeof o === 'object' && typeof o[last] === 'string' && o[last].startsWith('data:')) o[last] = dataURLToBlob(o[last]);
  }
  return out;
}

// ---------------------------------------------------------------- backup format (pure)

export function validateExport(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new DBError('这个文件不是数学老师的备份。', 'format');
  if (obj.format === 'emma-export') throw new DBError('这是英语老师的备份，不是数学老师的。', 'format');
  if (obj.format !== EXPORT_FORMAT) throw new DBError('这个文件不是数学老师的备份。', 'format');
  if (Number(obj.version) > EXPORT_VERSION) throw new DBError('这个备份是新版 App 做的，先更新 App 再导入。', 'format');
  for (const k of ['photos', 'items', 'attempts']) {
    if (obj[k] != null && !Array.isArray(obj[k])) throw new DBError('备份文件坏了（' + k + ' 不是列表）。', 'format');
  }
  if (obj.kv != null && !Array.isArray(obj.kv) && !isPlainObject(obj.kv)) throw new DBError('备份文件坏了（kv 不对）。', 'format');
  return obj;
}

export function parseExportText(text) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  let data;
  try { data = JSON.parse(s); } catch (e) { throw new DBError('文件打不开：不是有效的备份文件。', 'format'); }
  return validateExport(data);
}

export function exportFileName(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `emmamath-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

// The Poe key stays on this iPad: it is never written to a file, and never taken from one. The same for the Doubao
// voice access key (v0.3, settings.doubao.accessKey); its App ID is not a secret and travels with the backup.
function withoutKey(rec) {
  if (!rec || rec.key !== 'settings' || !isPlainObject(rec.value)) return rec;
  const d = rec.value.doubao;
  const hasDoubaoKey = isPlainObject(d) && 'accessKey' in d;
  if (!('poeKey' in rec.value) && !hasDoubaoKey) return rec;
  const value = { ...rec.value };
  delete value.poeKey;
  if (hasDoubaoKey) { value.doubao = { ...d }; delete value.doubao.accessKey; }
  return { ...rec, value };
}

// kv in a file: [{key, value, updated}], or (hand-made) { key: value }
function kvRecords(kv, stamp) {
  if (Array.isArray(kv)) return kv.filter(r => r && typeof r === 'object' && typeof r.key === 'string' && r.key !== '');
  if (isPlainObject(kv)) return Object.entries(kv).map(([key, value]) => ({ key, value, updated: stamp }));
  return [];
}

const stampOf = r => String(r.updated != null ? r.updated : r.at != null ? r.at : '');
const attemptSig = a => `${a.itemId}|${a.at}|${a.kind || ''}`;
const byAt = (a, b) => String(a.at || '').localeCompare(String(b.at || '')) || (Number(a.id) || 0) - (Number(b.id) || 0);

// ---------------------------------------------------------------- the store

export async function openStore({
  indexedDB = globalThis.indexedDB,
  IDBKeyRange = globalThis.IDBKeyRange,
  name = DB_NAME,
  version = DB_VERSION,
  timeoutMs = DB_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  if (!indexedDB) throw new DBError('这台设备不能在本机存数据。', 'unsupported');
  const conn = connection(indexedDB, name, version, upgradeDB);
  const run = (storeNames, mode, fn, ms = timeoutMs) => runOn(conn, storeNames, mode, fn, ms);
  const iso = () => now().toISOString();

  // open now, so a broken database shows up at launch rather than at the first tap
  await run('kv', 'readonly', s => reqResult(s.kv.count()));

  const source = (s, name, index) => (index ? s[name].index(index) : s[name]);

  const store = {
    async get(name, id) {
      checkName(name);
      return run(name, 'readonly', s => reqResult(s[name].get(id)));
    },
    async put(name, rec) {
      checkName(name);
      if (ID_PREFIX[name] && rec && rec.id == null) rec.id = newId(ID_PREFIX[name]);
      return run(name, 'readwrite', s => reqResult(s[name].put(rec)));
    },
    async putMany(name, recs) {
      checkName(name);
      const list = [...(recs || [])];
      if (ID_PREFIX[name]) for (const r of list) if (r && r.id == null) r.id = newId(ID_PREFIX[name]);
      await run(name, 'readwrite', s => { for (const r of list) s[name].put(r); }, timeoutMs * 3);
      return list.length;
    },
    async del(name, id) {
      checkName(name);
      await run(name, 'readwrite', s => { s[name].delete(id); });
    },
    async all(name) {
      checkName(name);
      return run(name, 'readonly', s => reqResult(s[name].getAll()), timeoutMs * 3);
    },
    async byIndex(name, index, query, limit) {
      checkName(name);
      const q = toQuery(query, IDBKeyRange);
      return run(name, 'readonly', s => {
        const src = source(s, name, index);
        // only pass a count when there is one: getAll(q, 0) means "no limit" in some engines and "nothing" in none
        return reqResult(limit > 0 ? src.getAll(q, Math.floor(limit)) : src.getAll(q));
      }, timeoutMs * 3);
    },
    // Newest first needs a cursor: getAll can only go ascending, and "the last 20" is the common question.
    async latest(name, index, query, limit = 0) {
      checkName(name);
      const q = toQuery(query, IDBKeyRange);
      return run(name, 'readonly', s => {
        const out = [];
        const r = source(s, name, index).openCursor(q, 'prev');
        r.onsuccess = () => {
          const c = r.result;
          if (!c) return;
          out.push(c.value);
          if (!(limit > 0) || out.length < limit) c.continue();
        };
        return () => out;
      }, timeoutMs * 3);
    },
    async count(name, index, query) {
      checkName(name);
      const q = toQuery(query, IDBKeyRange);
      return run(name, 'readonly', s => reqResult(source(s, name, index).count(q)));
    },

    // ---- attempts
    async addAttempt(rec) {
      if (!rec || !isKey(rec.itemId)) throw new DBError('作答记录缺 itemId。', 'data');
      const { id, ...r } = rec;   // the store numbers attempts; a stale id must not overwrite another attempt
      if (r.at == null) r.at = iso();
      return run('attempts', 'readwrite', s => reqResult(s.attempts.add(r)));
    },
    async attemptsFor(itemId) {
      const list = await run('attempts', 'readonly', s => reqResult(s.attempts.index('itemId').getAll(itemId)));
      return list.sort(byAt);
    },

    // ---- kv
    async kvGet(key, fallback) {
      return run('kv', 'readonly', s => { const r = s.kv.get(key); return () => (r.result ? r.result.value : fallback); });
    },
    async kvSet(key, value) {
      await run('kv', 'readwrite', s => { s.kv.put({ key, value, updated: iso() }); });
    },
    async kvDel(key) {
      await run('kv', 'readwrite', s => { s.kv.delete(key); });
    },
    async kvAll() {
      return run('kv', 'readonly', s => reqResult(s.kv.getAll()));
    },

    // ---- backup
    async exportAll({ photos: withPhotos = true } = {}) {
      const names = withPhotos ? STORES : STORES.filter(n => n !== 'photos');
      // one readonly transaction: the four lists are a consistent snapshot
      const got = await run(names, 'readonly', s => {
        const reqs = names.map(n => [n, s[n].getAll()]);
        return () => Object.fromEntries(reqs.map(([n, r]) => [n, r.result || []]));
      }, timeoutMs * 4);
      const enc = list => Promise.all((list || []).map(encodeBlobs));
      const out = {
        format: EXPORT_FORMAT, version: EXPORT_VERSION, app: 'Emma 的数学老师', at: iso(),
        photos: withPhotos ? await enc(got.photos) : [],
        items: await enc(got.items),
        attempts: await enc(got.attempts),
        kv: await enc(got.kv.map(withoutKey)),
      };
      if (!withPhotos) out.photosOmitted = true;
      return out;
    },

    async importAll(obj, { replace = false } = {}) {
      const data = validateExport(obj);
      let skipped = 0;
      // Decode first, outside any transaction: blob decoding is async and a transaction would commit while we wait.
      const decodeList = async (list, ok) => {
        const out = [];
        for (const r of Array.isArray(list) ? list : []) {
          if (!isPlainObject(r) || !ok(r)) { skipped++; continue; }
          try { out.push(await decodeBlobs(r)); } catch (e) { skipped++; }
        }
        return out;
      };
      const touches = {
        photos: Array.isArray(data.photos) && !data.photosOmitted,
        items: Array.isArray(data.items),
        attempts: Array.isArray(data.attempts),
        kv: data.kv != null,
      };
      const photos = touches.photos ? await decodeList(data.photos, r => isKey(r.id)) : [];
      const items = await decodeList(data.items, r => isKey(r.id));
      const attempts = await decodeList(data.attempts, r => isKey(r.itemId));
      const stamp = iso();
      const kvIn = [];
      const kvList = kvRecords(data.kv, stamp);
      if (Array.isArray(data.kv)) skipped += data.kv.length - kvList.length;
      for (const r of kvList) {
        try { kvIn.push(withoutKey(await decodeBlobs(r))); } catch (e) { skipped++; }
      }

      let write;   // { photos, items, attempts, kv } lists to write
      if (replace) {
        const localSettings = await run('kv', 'readonly', s => reqResult(s.kv.get('settings')));
        const localKey = localSettings && isPlainObject(localSettings.value) ? localSettings.value.poeKey : undefined;
        const localDoubao = localSettings && isPlainObject(localSettings.value) && isPlainObject(localSettings.value.doubao) ? localSettings.value.doubao.accessKey : undefined;
        const kv = kvIn.map(r => {
          if (r.key !== 'settings' || !isPlainObject(r.value)) return r;
          const value = { ...r.value };
          if (localKey) value.poeKey = localKey;
          if (localDoubao) value.doubao = { ...(isPlainObject(value.doubao) ? value.doubao : {}), accessKey: localDoubao };
          return { ...r, value };
        });
        // a file without settings keeps the iPad's settings (and so its key)
        if (touches.kv && localSettings && !kv.some(r => r.key === 'settings')) kv.push(localSettings);
        write = { photos, items, attempts, kv };
      } else {
        // (a photo's blob read back from IndexedDB is a handle to a file on disk, so reading all photos is cheap)
        const local = await run(STORES, 'readonly', s => {
          const rs = { photos: s.photos.getAll(), items: s.items.getAll(), attempts: s.attempts.getAll(), kv: s.kv.getAllKeys() };
          return () => Object.fromEntries(Object.entries(rs).map(([n, r]) => [n, r.result || []]));
        }, timeoutMs * 4);
        const newer = (incoming, localList) => {
          const m = new Map(localList.map(r => [r.id, r]));
          return incoming.filter(r => !m.has(r.id) || stampOf(r) > stampOf(m.get(r.id)));
        };
        const sigs = new Set(local.attempts.map(attemptSig));
        const newAttempts = [];
        for (const a of attempts) { const k = attemptSig(a); if (!sigs.has(k)) { sigs.add(k); newAttempts.push(a); } }
        const haveKv = new Set(local.kv);
        write = {
          photos: newer(photos, local.photos),
          items: newer(items, local.items),
          attempts: newAttempts,
          kv: kvIn.filter(r => !haveKv.has(r.key)),
        };
      }

      await run(STORES, 'readwrite', s => {
        if (replace) for (const n of STORES) if (touches[n]) s[n].clear();
        for (const p of write.photos) s.photos.put(p);
        for (const it of write.items) s.items.put(it);
        for (const a of write.attempts) {
          // replace keeps the file's numbering (the store was just cleared); merge lets the store number them
          if (replace && Number.isInteger(a.id) && a.id > 0) s.attempts.put(a);
          else { const { id, ...r } = a; s.attempts.add(r); }
        }
        for (const r of write.kv) s.kv.put(r);
      }, timeoutMs * 4);
      return { photos: write.photos.length, items: write.items.length, attempts: write.attempts.length, kv: write.kv.length, skipped };
    },

    close() { conn.reset(); },
  };
  return store;
}
