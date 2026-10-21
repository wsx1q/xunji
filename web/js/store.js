'use strict';
/* 存储：启动读库、迁移、紧凑格式编解码、按年份分片保存 */
// App 内由原生层写入 AES-256-GCM 加密的数据库文件；桌面浏览器调试时退回 localStorage（明文）
const NATIVE = !!(window.Android && Android.dbOpen);
let S = null;
function migrate(d) {
  if ((d.v || 1) < 2) { addDefaultSubs(d,true); d.v = 2; }
  if (!Array.isArray(d.merchants)) d.merchants = [...DEFAULT_MERCHANTS];
  if (!Array.isArray(d.projects)) d.projects = [...DEFAULT_PROJECTS];
  d.settings = d.settings || {};
  const st = d.settings;
  st.home = normHome(st.home);
  if (!st.last || typeof st.last !== 'object') st.last = {};
  if (!st.recentCats || typeof st.recentCats !== 'object') st.recentCats = { expense: [], income: [] };
  st.recentCats.expense = Array.isArray(st.recentCats.expense) ? st.recentCats.expense : [];
  st.recentCats.income = Array.isArray(st.recentCats.income) ? st.recentCats.income : [];
  if (st.backupDays == null || st.backupDays === '') st.backupDays = 1;
  st.backupDays = Math.max(0, +st.backupDays || 0);
  if (st.bio == null) st.bio = false;
  if (st.ocrUrl == null) st.ocrUrl = '';
  delete st.ocrModel; delete st.ocrOpt; delete st.ocrV6Migrated; delete st.ocrV5fMigrated; // 本机识别已固定模型和参数
  return d;
}
/* 保存：流水按年份切片，只重新序列化有变化的年份（按对象引用比较，所以流水对象不要原地修改，改就换新对象）；
   250ms 内的多次保存合并；App 里只把变化的年份片段传给原生，由后台线程加密写盘 */
let _saveT = 0, _saveDirty = false, _dataVer = 0;
function save() {
  invalidateCache();
  _dataVer++;
  _saveDirty = true;
  clearTimeout(_saveT);
  _saveT = setTimeout(flushSave, 250);
}
function saveCancel() { clearTimeout(_saveT); _saveDirty = false; }
/** 立即写盘并等后台写完（切换目录读取前用） */
function saveNow() { flushSave(); if (NATIVE && Android.dbWait) Android.dbWait(); }
/* 紧凑存储格式（txnFmt 3，按列存）：每个年份片段是 {id:[], a:金额[], t:时间[], n:备注[], c:字典下标[每条 8 个], x:{行号:其他字段}}，
   8 个字典字段（账本 / 类型 / 分类 / 账户 / 转入账户 / 成员 / 商家 / 项目）的字符串只在 txnDict 里存一次。
   20 万条从 48MB 降到约 13MB；按列存比按行存少了 20 万个小数组，解析和垃圾回收都更快。
   字典每次启动重新建、只追加不删除，已缓存的年份片段始终有效。txnFmt 2（按行）仍能读。导出明文 JSON 用普通对象格式。 */
const TX_DICT_F = ['bookId', 'type', 'catId', 'accountId', 'toAccountId', 'member', 'merchant', 'project'];
const TX_KNOWN = new Set(['id', 'amount', 'time', 'note', ...TX_DICT_F]);
let _txDict = { list: [], map: new Map() };
function txDictReset() { _txDict = { list: [], map: new Map() }; }
function txCode(v) {
  const D = _txDict;
  let c = D.map.get(v);
  if (c === undefined) { c = D.list.length; D.list.push(v); D.map.set(v, c); }
  return c;
}
/** 一个年份的流水 → 列式对象 */
function txEncYear(refs) {
  const n = refs.length, id = new Array(n), a = new Array(n), t = new Array(n), no = new Array(n), c = new Array(n * 8);
  let x = null;
  for (let i = 0, k = 0; i < n; i++) {
    const r = refs[i];
    id[i] = r.id; a[i] = r.amount; t[i] = r.time;
    let ext = null;
    if (typeof r.note === 'string') no[i] = r.note;
    else { no[i] = null; if (r.note !== undefined) (ext = {}).note = r.note; }
    for (let j = 0; j < 8; j++, k++) {
      const v = r[TX_DICT_F[j]];
      if (typeof v === 'string') c[k] = txCode(v);
      else { c[k] = -1; if (v !== undefined) (ext = ext || {})[TX_DICT_F[j]] = v; }
    }
    for (const key in r) if (!TX_KNOWN.has(key)) (ext = ext || {})[key] = r[key];
    if (ext) (x = x || {})[i] = ext;
  }
  const o = { id, a, t, n: no, c };
  if (x) o.x = x;
  return o;
}
/* 还原时每条都用同样的字段顺序建对象（形状一致，V8 建得快）；缺的字段是 undefined，保存时会被省略 */
function txDecYears(parts, D) {
  let total = 0;
  for (const p of parts) total += p.id.length;
  const out = new Array(total);
  let o = 0;
  for (const p of parts) {
    const { id, a, t, n: no, c, x } = p, n = id.length;
    for (let i = 0, k = 0; i < n; i++, k += 8) {
      const b = c[k], ty = c[k + 1], ca = c[k + 2], ac = c[k + 3], to = c[k + 4], me = c[k + 5], mc = c[k + 6], pr = c[k + 7];
      const r = {
        id: id[i], bookId: b >= 0 ? D[b] : undefined, type: ty >= 0 ? D[ty] : undefined, amount: a[i],
        catId: ca >= 0 ? D[ca] : undefined, accountId: ac >= 0 ? D[ac] : undefined, toAccountId: to >= 0 ? D[to] : undefined,
        time: t[i], note: no[i] === null ? undefined : no[i],
        member: me >= 0 ? D[me] : undefined, merchant: mc >= 0 ? D[mc] : undefined, project: pr >= 0 ? D[pr] : undefined
      };
      if (x && x[i]) Object.assign(r, x[i]);
      out[o++] = r;
    }
  }
  return out;
}
/** txnFmt 2（按行）：[id, 金额, 时间, 备注, 8 个字典下标, 其他字段?] */
function txDecRows(rows, D) {
  const out = new Array(rows.length), F = TX_DICT_F;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], o = { id: r[0], amount: r[1], time: r[2] };
    if (r[3] !== null) o.note = r[3];
    for (let j = 0; j < 8; j++) { const c = r[4 + j]; if (c >= 0) o[F[j]] = D[c]; }
    if (r.length > 12) Object.assign(o, r[12]);
    out[i] = o;
  }
  return out;
}
/** 读进来的库如果是紧凑格式，还原成普通流水对象 */
function decodeDb(d) {
  if (d && Array.isArray(d.txns)) {
    if (d.txnFmt === 3) d.txns = txDecYears(d.txns, d.txnDict || []);
    else if (d.txnFmt === 2) d.txns = txDecRows(d.txns, d.txnDict || []);
  }
  if (d) { delete d.txnFmt; delete d.txnDict; }
  return d;
}
function saveParts(unsentOnly = false) {
  const chunks = yearChunks();
  const { txns, ...meta } = S;
  for (const c of chunks) if (c.str == null && (!unsentOnly || !c.sent)) c.str = JSON.stringify(txEncYear(c.refs));
  // 字典放在所有片段编码之后再序列化，保证包含新加的字符串
  return { meta: JSON.stringify({ ...meta, txnFmt: 3, txnDict: _txDict.list }), chunks };
}
/** 导出给其他软件看的明文：普通对象格式 */
function plainJson() { return JSON.stringify(S); }
function fullJson() {
  const { meta, chunks } = saveParts();
  return meta.slice(0, -1) + (meta.length > 2 ? ',' : '') + '"txns":[' + chunks.map(c => c.str).join(',') + ']}';
}
function flushSave() {
  clearTimeout(_saveT);
  if (!_saveDirty || !S) return '';
  _saveDirty = false;
  if (!NATIVE) {
    try { localStorage.setItem(KEY, fullJson()); } catch (e) { const err = '浏览器存储空间不足，请改用 App'; toast(err); return err; }
    window._dbDirty = true;
    return '';
  }
  if (!Android.dbCommit) { const err = Android.dbSave(fullJson()); if (err) toast('保存失败：' + err); return err || ''; }
  const { meta, chunks } = saveParts(!!window.XUNJI_DESKTOP);
  const send = all => chunks.forEach(c => { if (all || !c.sent) {
    if(c.str == null)c.str = JSON.stringify(txEncYear(c.refs));
    Android.dbPart(String(c.y), c.str); c.sent = true;
  } });
  send(false);
  const years = chunks.map(c => c.y).join(',');
  let err = Android.dbCommit(meta, years);
  if (err === 'missing') { send(true); err = Android.dbCommit(meta, years); }
  if (err) toast('保存失败：' + err);
  else if(window.XUNJI_DESKTOP)chunks.forEach(c => { c.str = null; }); // Native host owns the saved serialized chunks.
  return err || '';
}
window.onSaveError = err => toast('保存失败：' + err);
/** 流水按年份分片（S.txns 按时间倒序，同一年连续），与上次相同引用的年份复用缓存 */
let _yc = new Map();
function yearChunks() {
  ensureTxnOrder();
  const arr = S.txns, out = [];
  let i = 0;
  while (i < arr.length) {
    const y = new Date(arr[i].time).getFullYear(), start = new Date(y, 0, 1).getTime();
    let j = i + 1;
    while (j < arr.length && arr[j].time >= start) j++;
    const old = _yc.get(y);
    let same = !!old && old.refs.length === j - i;
    if (same) for (let k = i; k < j; k++) if (old.refs[k - i] !== arr[k]) { same = false; break; }
    out.push(same ? old : { y, refs: arr.slice(i, j), str: null, sent: false, bal: null, days: 0 });
    i = j;
  }
  _yc = new Map(out.map(c => [c.y, c]));
  return out;
}
function chunkStats(c) {
  if (c.bal) return c;
  const m = {}, days = new Set();
  const add = (id, v) => { if (id) m[id] = (m[id] || 0) + v; };
  for (const t of c.refs) {
    days.add(sod(t.time));
    if (t.type === 'expense') add(t.accountId, -t.amount);
    else if (t.type === 'income' || t.type === 'adjust') add(t.accountId, t.amount);
    else { add(t.accountId, -t.amount); add(t.toAccountId, t.amount); }
  }
  c.bal = m; c.days = days.size;
  return c;
}
function appVersion() {
  try { if (NATIVE && Android.appVersion) return Android.appVersion(); } catch (e) { }
  return 'web';
}
function recentCats(type) {
  const ids = (S.settings.recentCats && S.settings.recentCats[type]) || [];
  return ids.filter(id => S.categories[type] && S.categories[type].some(c => c.id === id));
}
/** Only clears recent category shortcuts; keeps the draft, records and last-used defaults. */
function clearRecentCats(type, redraw) {
  if(type!=='expense'&&type!=='income')return;
  S.settings.recentCats ||= {expense:[],income:[]};
  S.settings.recentCats[type]=[];
  if(typeof E!=='undefined'&&E?.type===type)E.recentOn=false;
  save();(redraw||render)();toast('已清空最近使用，账目和当前填写内容已保留');
}
function removeRecentCat(type, id, redraw) {
  if(type!=='expense'&&type!=='income')return;
  const list=S.settings.recentCats?.[type];if(!Array.isArray(list))return;
  S.settings.recentCats[type]=list.filter(v=>v!==id);
  if(typeof E!=='undefined'&&E?.type===type&&!recentCats(type).length)E.recentOn=false;
  save();(redraw||render)();
}
function defaultCatId(type) {
  const last = (S.settings.last || {})[type];
  if (last && last.catId && catById(last.catId) !== UNKNOWN && S.categories[type].some(c => c.id === last.catId)) return last.catId;
  const tops = S.categories[type].filter(c => !c.pid);
  const first = tops[0];
  if (!first) return '';
  const sub = S.categories[type].find(c => c.pid === first.id);
  return (sub || first).id;
}
function rememberLast() {
  if (!E) return;
  const st = S.settings;
  st.lastAcc = E.accountId;
  st.last = st.last || {};
  const o = { member: E.member || '本人', merchant: E.merchant || '', project: E.project || '', accountId: E.accountId };
  if (E.type === 'transfer') o.toAccountId = E.toAccountId;
  else {
    o.catId = E.catId;
    const list = st.recentCats || (st.recentCats = { expense: [], income: [] });
    const arr = [E.catId, ...(list[E.type] || []).filter(x => x !== E.catId)].slice(0, 12);
    list[E.type] = arr;
  }
  st.last[E.type] = o;
}
/** 原生层返回的明文：新版分段取（{chunks:n}），旧版直接在 data 里 */
function nativeData(r) {
  if (r.chunks == null) return r.data;
  const parts = new Array(r.chunks);
  try { for (let i = 0; i < r.chunks; i++) parts[i] = Android.dbChunk(i); }
  finally { try { Android.dbChunkDrop(); } catch (e) { } }
  return parts.length ? parts.join('') : null;
}
let _startupPerf = null, _startupMeasuring = false, _startupWaited = false;
function boot() {
  closeSheet();
  if (!NATIVE) return start(localStorage.getItem(KEY));
  const r = JSON.parse(Android.dbOpen());
  if (r.ok) start(nativeData(r));
  else if (r.need === 'password') { _startupWaited = true; dbUnlockScreen(); }
  else dbErrorScreen(r.err);
}
let _bootS = null;
function start(data, demo = false) {
  let d = null;
  const fresh = !data;
  if (data) {
    try { d = JSON.parse(data); } catch (e) { }
    if (!d || !d.v) return dbErrorScreen('数据库内容无法解析');
  } else {
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { }
    if (!d || !d.v) d = initData(demo);
  }
  data = null;
  const legacy = !!d && d.txnFmt !== 3 && Array.isArray(d.txns) && d.txns.length > 0;
  decodeDb(d);
  // 读出来的库没变就不再整库重写一遍（20 万条时这一下要序列化几十 MB）；新建 / 旧版本升级才立即保存
  const upgrade = (d.v || 1) < 2;
  saveCancel();
  S = migrate(d);
  _yc = new Map();
  txDictReset();
  resetTxnOrder();
  if (fresh || upgrade) save();
  // 旧格式的库：首页出来后在后台转成紧凑格式写一次，之后每次启动都快
  else if (legacy) setTimeout(() => { if (S === _bootS) save(); }, 1500);
  _bootS = S;
  if (NATIVE) localStorage.removeItem(KEY);
  $('#lock').className = '';
  stack.length = 0; stack.push({ name: 'home' });
  render(); showLock();
  if (TEST_TOOLS && !_startupMeasuring) {
    _startupMeasuring = true;
    afterPaint().then(() => {
      let native = null;
      try { if (NATIVE && Android.startupInfo) native = JSON.parse(Android.startupInfo()); } catch (e) { }
      _startupPerf = { ms: native ? native.elapsedMs : performance.now(), cold: native ? native.cold : null,
        waited: _startupWaited };
    });
  }
  checkSharedFile();
}
/** 从其他应用「用其他应用打开」/ 分享过来的账单文件 */
function checkSharedFile() {
  if (!NATIVE || !Android.takeSharedFile || !S) return;
  const s = Android.takeSharedFile();
  if (!s) return;
  const f = JSON.parse(s);
  if (f.err) return toast(f.err);
  const bin = atob(f.data), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  if (/\.kbf$/i.test(f.name || '')) return kbfLoad(f.name, buf);
  billLoad(f.name || '账单文件', buf);
}
window.onSharedFile = checkSharedFile;
