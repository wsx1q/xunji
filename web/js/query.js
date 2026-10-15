'use strict';
/* 数据查询：缓存、按时间二分、余额 / 分类 / 账户查询 */
const UNKNOWN = { id: '', pid: '', name: '未分类', icon: '❔', color: '#BDBDBD' };
let _cache = { bal: null, cats: null, days: null, bookId: '', book: null, ordered: false };
function invalidateCache() { _cache = { bal: null, cats: null, days: null, bookId: '', book: null, ordered: _cache.ordered }; }
/** 整库换掉（启动、恢复、导入、清空、撤销）后调用：不能沿用上一份数据「已排好序」的标记 */
function resetTxnOrder() { invalidateCache(); _cache.ordered = false; ensureTxnOrder(); }
function ensureTxnOrder() {
  if (_cache.ordered || !S || !S.txns.length) { _cache.ordered = true; return; }
  // 库里本来就是按时间倒序存的：先线性检查一遍，已经有序就不用排了
  const A = S.txns;
  let sorted = true;
  for (let i = 1; i < A.length; i++) {
    const p = A[i - 1], q = A[i];
    if (p.time < q.time || (p.time === q.time && p.id < q.id)) { sorted = false; break; }
  }
  if (!sorted) A.sort((a, b) => b.time - a.time || (a.id < b.id ? 1 : -1));
  _cache.ordered = true;
}
function insertTxn(rec) {
  ensureTxnOrder();
  const arr = S.txns;
  if (!arr.length || rec.time >= arr[0].time) arr.unshift(rec);
  else if (rec.time <= arr[arr.length - 1].time) arr.push(rec);
  else {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].time > rec.time) lo = mid + 1; else hi = mid;
    }
    arr.splice(lo, 0, rec);
  }
  invalidateCache();
  _cache.ordered = true;
}
function catMap() {
  if (_cache.cats) return _cache.cats;
  const m = new Map();
  for (const c of S.categories.expense) m.set(c.id, c);
  for (const c of S.categories.income) m.set(c.id, c);
  return _cache.cats = m;
}
const curBook = () => S.books.find(b => b.id === S.curBook) || S.books[0];
function bookTx() {
  if (_cache.book && _cache.bookId === S.curBook) return _cache.book;
  ensureTxnOrder();
  const id = S.curBook, out = [];
  for (const t of S.txns) if (t.bookId === id) out.push(t);
  _cache.bookId = id; _cache.book = out;
  _sortedTx.add(out);
  return out;
}
/* 已知按时间倒序排好的数组（bookTx 的结果）：时间段用二分查找直接切片，不用扫 20 万条 */
const _sortedTx = new WeakSet();
const txLowerIdx = (tx, v) => { // 第一个 time < v 的下标
  let lo = 0, hi = tx.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tx[m].time >= v) lo = m + 1; else hi = m; }
  return lo;
};
const inRange = (tx, s, e) => {
  if (s <= 0 && e === Infinity) return tx;
  if (_sortedTx.has(tx)) return tx.slice(e === Infinity ? 0 : txLowerIdx(tx, e), txLowerIdx(tx, s));
  const out = [];
  for (const t of tx) { if (t.time >= s && t.time < e) out.push(t); }
  return out;
};
/** 扫一遍全库按 key 计数（给每个账本 / 成员各 filter 一遍，20 万条时要扫好几遍） */
function countBy(key) {
  const m = new Map();
  for (const t of S.txns) { const k = key(t); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
const sumT = (tx, type) => r2(tx.reduce((a, t) => a + (t.type === type ? t.amount : 0), 0));
const sumArr = tx => r2(tx.reduce((a, t) => a + t.amount, 0));
const catById = id => (id && catMap().get(id)) || UNKNOWN;
const topOf = id => { const c = catById(id); return c.pid ? catById(c.pid) : c; };
const catLabel = id => { const c = catById(id); return c.pid ? `${catById(c.pid).name} › ${c.name}` : c.name; };
const tops = type => S.categories[type].filter(c => !c.pid);
const subsOf = id => id ? S.categories.expense.concat(S.categories.income).filter(c => c.pid === id) : [];
const inCat = (catId, id) => catId === id || (!!catId && catById(catId).pid === id);
const accById = id => S.accounts.find(a => a.id === id);
const accName = id => (accById(id) || { name: '未知账户' }).name;
const accIcon = a => (ACC_TYPES[a.type] || ACC_TYPES.other).icon;
const accTypeName = a => (ACC_TYPES[a.type]||ACC_TYPES.other).name;
function accountGroup(a, bal=balances()) {
  if(a.type==='credit')return 'payable';
  if(a.type==='debt'&&['receivable','payable'].includes(a.debtSide))return a.debtSide;
  if(a.type==='debt')return (accSum(a.id,bal)<0||(/应付|欠款|借入|贷款/.test(a.name)&&accSum(a.id,bal)===0))?'payable':'receivable';
  return Object.keys(ACC_TYPES).includes(a.type)?a.type:'other';
}
// 二级账户：子账户 pid 指向上级（只有两级）；上级的合计 = 自身余额 + 各子账户余额
const accKids = id => S.accounts.filter(a => a.pid === id);
const accTops = () => S.accounts.filter(a => !a.pid || !accById(a.pid));
const accSum = (id, bal = balances()) => r2((bal[id] || 0) + accKids(id).reduce((x, k) => x + (bal[k.id] || 0), 0));
const accFull = a => { const p = a.pid && accById(a.pid); return p ? `${p.name} › ${a.name}` : a.name; };
function balances() {
  if (_cache.bal) return _cache.bal;
  // 按年份汇总后相加，只有改动过的年份需要重算
  const m = {};
  S.accounts.forEach(a => m[a.id] = +a.init || 0);
  for (const c of yearChunks()) { const b = chunkStats(c).bal; for (const k in b) if (k in m) m[k] += b[k]; }
  for (const k in m) m[k] = r2(m[k]);
  return _cache.bal = m;
}
function dayCount() {
  if (_cache.days != null) return _cache.days;
  return _cache.days = yearChunks().reduce((a, c) => a + chunkStats(c).days, 0);
}
function budget() { return S.budgets[S.curBook] || (S.budgets[S.curBook] = { total: 0, cats: {} }); }
