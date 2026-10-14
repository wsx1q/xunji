'use strict';
/* 整理数据：把分类 / 账户 / 账本 / 成员·商家·项目合并到另一个，所有流水和引用（预算、看板条件、上次使用、导入时记住的对应关系）一起改。
   流水按年份分片保存时靠对象引用判断变化，所以改流水一律换新对象，不原地修改。 */

/** fn(t) 返回要改的字段（或 null 表示不改）；返回改了多少条 */
function remapTxns(fn) {
  let n = 0;
  S.txns = S.txns.map(t => { const p = fn(t); if (!p) return t; n++; return { ...t, ...p }; });
  return n;
}
const uniq = arr => [...new Set(arr)];
const mapIds = (arr, m) => uniq(arr.map(x => (m.has(x) ? m.get(x) : x)));

/* ---------------- 撤销上一次合并 ----------------
   合并前拍快照：流水只记旧数组（合并时流水换新对象、生成新数组，旧数组和旧对象原样保留，不占额外内存），
   分类 / 账户 / 账本 / 预算 / 设置这些小数据整份复制。合并后只要数据又有任何改动（_dataVer 变了）就不能撤销，
   免得把合并之后新记的账也一起撤掉。只在内存里，重启 App 后就没有了。 */
let _mergeUndo = null;
const canUndoMerge = () => !!_mergeUndo && _mergeUndo.ver === _dataVer && _mergeUndo.S === S;
/** 执行一次合并：fn 做改动并返回提示文字；完成后弹出结果，可以马上撤销。after：关掉结果后回到哪里 */
function mergeRun(label, fn, after) {
  const txns = S.txns, snap = JSON.parse(JSON.stringify({ ...S, txns: null })); // txns 占位，保持字段顺序
  const msg = fn();
  save();
  _mergeUndo = { label, snap, txns, ver: _dataVer, S, after };
  render();
  mergeDone(msg);
}
function mergeDone(msg) {
  _sheetCb = _mergeUndo.after;
  openSheet('合并完成', `<div class="confirm-msg">${msg}</div>
    <div class="btn-row"><button class="btn ghost" onclick="undoMerge()">撤销合并</button><button class="btn" onclick="const f=_sheetCb;closeSheet();f&&f()">好的</button></div>
    <div class="ver">也可以稍后在「我的 → 撤销上一次合并」撤销；合并后再改动数据就不能撤销了</div>`);
}
function undoMerge() {
  if (!canUndoMerge()) { _mergeUndo = null; closeSheet(); render(); return toast('合并后数据又有改动，已经不能撤销了'); }
  const u = _mergeUndo;
  _mergeUndo = null;
  S = u.snap; S.txns = u.txns;
  resetTxnOrder();
  save(); closeSheet();
  // 合并时打开的页面（如被合并的账户详情）可能已经不存在，回到上一级
  while (stack.length > 1 && stack[stack.length - 1].name === 'account' && !accById(stack[stack.length - 1].p)) stack.pop();
  render(); toast(`已撤销：${u.label}`);
}

/* ---------------- 分类 ---------------- */
/** 一级分类合并到一级分类时，同名二级分类合并、其余二级分类挂过去；合并到二级分类时，它的二级分类也都并进去 */
function mergeCat(type, fromId, toId) {
  const list = S.categories[type], from = list.find(c => c.id === fromId), to = list.find(c => c.id === toId);
  if (!from || !to || from === to) return 0;
  const map = new Map([[fromId, toId]]), drop = new Set([fromId]);
  // 返回受影响的记录数：整个搬过去的二级分类下的记录不用改，但也算在内
  const tree = new Set([fromId, ...list.filter(c => c.pid === fromId).map(c => c.id)]);
  const affected = S.txns.reduce((a, t) => a + (tree.has(t.catId) ? 1 : 0), 0);
  if (!from.pid) {
    if (to.pid === fromId) { to.pid = ''; to.color = from.color; } // 一级分类并进自己的二级分类：这个二级分类升为一级，其余的挂到它下面
    for (const s of list.filter(c => c.pid === fromId)) {
      const same = !to.pid && list.find(c => c.pid === toId && c.name === s.name);
      if (to.pid || same) { map.set(s.id, to.pid ? toId : same.id); drop.add(s.id); }
      else { s.pid = toId; s.color = to.color; }
    }
  }
  remapTxns(t => (map.has(t.catId) ? { catId: map.get(t.catId) } : null));
  S.categories[type] = list.filter(c => !drop.has(c.id));
  for (const b of Object.values(S.budgets)) {
    for (const [id, amt] of Object.entries(b.cats)) {
      if (!map.has(id)) continue;
      const k = map.get(id);
      b.cats[k] = r2((b.cats[k] || 0) + amt);
      delete b.cats[id];
    }
  }
  const st = S.settings;
  for (const bd of st.home.boards) if (bd.custom && bd.cats) bd.cats = mapIds(bd.cats, map);
  for (const o of Object.values(st.last || {})) if (o && map.has(o.catId)) o.catId = map.get(o.catId);
  if (st.recentCats && st.recentCats[type]) st.recentCats[type] = mapIds(st.recentCats[type], map);
  for (const k of Object.keys(st.billCat || {})) if (map.has(st.billCat[k])) st.billCat[k] = map.get(st.billCat[k]);
  if (map.has(st.ocrCat)) st.ocrCat = map.get(st.ocrCat);
  return affected;
}
function catMergeSheet(again) {
  const from = catById(CE.id), own = new Set(subsOf(from.id).map(s => s.id));
  if (!again) CGS.merge = { type: CT, mode: 'single', noLp: true, open: from.pid || '', sel: [], pick: catMergePick, rerender: () => catMergeSheet(true) };
  // 目标列表和其他地方选分类是同一套分类网格（catGridHtml）
  openSheet(`把「${esc(from.name)}」合并到`, `<div class="cg-box">${catGridHtml('merge')}</div><div class="tip">「${esc(from.name)}」${own.size ? '和它的二级分类' : ''}下的所有记录都会改到选中的分类，然后删除「${esc(from.name)}」。${!from.pid && own.size ? '合并到一级分类时，同名的二级分类会合并，其余二级分类一起搬过去。' : ''}</div>`);
}
function catMergePick(id) {
  if (id === CE.id) return toast('不能合并到它自己');
  catMergeAsk(id);
}
function catMergeAsk(toId) {
  const from = catById(CE.id), to = catById(toId), ids = new Set([from.id, ...subsOf(from.id).map(s => s.id)]);
  const n = S.txns.filter(t => ids.has(t.catId)).length;
  askConfirm(`把「${esc(catLabel(from.id))}」合并到「${esc(catLabel(to.id))}」？<br><small style="color:var(--t2)">${n} 条记录会改到「${esc(to.name)}」，「${esc(from.name)}」将被删除。</small>`, () => {
    const ret = _catReturn; _catReturn = null; // 从筛选面板来的：合并完点「好的」回到面板
    mergeRun(`分类「${from.name}」合并到「${to.name}」`, () => `「${esc(from.name)}」已合并到「${esc(to.name)}」，改了 <b>${mergeCat(CT, from.id, to.id)}</b> 条记录。`, ret);
  }, '合并');
}

/* ---------------- 账户 ---------------- */
/** 两个账户之间的转账合并后变成自己转给自己，对余额没有影响，直接删掉 */
function mergeAcc(fromId, toId) {
  const from = accById(fromId), to = accById(toId);
  if (!from || !to || from === to) return { n: 0, gone: 0 };
  const before = S.txns.length;
  S.txns = S.txns.filter(t => !(t.type === 'transfer' && [t.accountId, t.toAccountId].sort().join() === [fromId, toId].sort().join()));
  const gone = before - S.txns.length;
  const n = remapTxns(t => {
    const a = t.accountId === fromId, b = t.toAccountId === fromId;
    return a || b ? { ...(a && { accountId: toId }), ...(b && { toAccountId: toId }) } : null;
  });
  to.init = r2((+to.init || 0) + (+from.init || 0));
  if (to.pid === fromId) to.pid = from.pid || undefined; // 并进自己的子账户：子账户顶上来
  for (const k of accKids(fromId)) if (k !== to) k.pid = to.pid || to.id;
  S.accounts = S.accounts.filter(a => a !== from);
  const st = S.settings, m = new Map([[fromId, toId]]);
  if (st.lastAcc === fromId) st.lastAcc = toId;
  for (const o of Object.values(st.last || {})) {
    if (o && o.accountId === fromId) o.accountId = toId;
    if (o && o.toAccountId === fromId) o.toAccountId = toId;
  }
  for (const k of Object.keys(st.billAcc || {})) if (st.billAcc[k] === fromId) st.billAcc[k] = toId;
  for (const bd of st.home.boards) if (bd.custom && bd.accs) bd.accs = mapIds(bd.accs, m);
  return { n, gone };
}
function accMergeSheet() {
  keepAccForm();
  const from = accById(AE.id);
  openSheet(`把「${esc(from.name)}」合并到`, accRows(() => false, id => `accMergeAsk('${id}')`, from.id)
    + `<div class="tip">「${esc(from.name)}」的所有记录都会改到选中的账户，余额并过去，然后删除「${esc(from.name)}」。两者之间的转账会抵消掉。</div>`);
}
function accMergeAsk(toId) {
  const from = accById(AE.id), to = accById(toId), bal = balances();
  const n = S.txns.filter(t => t.accountId === from.id || t.toAccountId === from.id).length;
  askConfirm(`把「${esc(from.name)}」合并到「${esc(to.name)}」？<br><small style="color:var(--t2)">${n} 条记录改到「${esc(to.name)}」，合并后余额 ${money(r2((bal[to.id] || 0) + (bal[from.id] || 0)))}。</small>`, () => {
    const ret = _accReturn; _accReturn = null; // 从选择面板来的：合并完点「好的」回到面板
    mergeRun(`账户「${from.name}」合并到「${to.name}」`, () => {
      const { n: k, gone } = mergeAcc(from.id, to.id);
      if (stack[stack.length - 1].name === 'account') stack[stack.length - 1].p = to.id;
      return `「${esc(from.name)}」已合并到「${esc(to.name)}」，改了 <b>${k}</b> 条记录${gone ? `，抵消 ${gone} 笔互转` : ''}。`;
    }, ret);
  }, '合并');
}

/* ---------------- 账本 ---------------- */
function mergeBook(fromId, toId) {
  const from = S.books.find(b => b.id === fromId), to = S.books.find(b => b.id === toId);
  if (!from || !to || from === to) return 0;
  const n = remapTxns(t => (t.bookId === fromId ? { bookId: toId } : null));
  if (from.ssj && !to.ssj) to.ssj = from.ssj; // 以后再导入同一份随手记备份，进合并后的账本
  S.books = S.books.filter(b => b !== from);
  delete S.budgets[fromId];
  if (S.curBook === fromId) S.curBook = toId;
  return n;
}
function bookMergeSheet() {
  const from = S.books.find(b => b.id === BE.id);
  openSheet(`把「${esc(from.name)}」合并到`, S.books.filter(b => b !== from).map(b => `<div class="opt" onclick="bookMergeAsk('${b.id}')"><div class="ci">${b.icon}</div><span>${esc(b.name)}</span></div>`).join('')
    + `<div class="tip">「${esc(from.name)}」的所有记录都会移到选中的账本，然后删除「${esc(from.name)}」和它的预算。</div>`);
}
function bookMergeAsk(toId) {
  const from = S.books.find(b => b.id === BE.id), to = S.books.find(b => b.id === toId);
  const n = S.txns.filter(t => t.bookId === from.id).length;
  askConfirm(`把账本「${esc(from.name)}」的 ${n} 条记录移到「${esc(to.name)}」，并删除「${esc(from.name)}」？`, () => {
    mergeRun(`账本「${from.name}」合并到「${to.name}」`, () => `账本「${esc(from.name)}」已合并到「${esc(to.name)}」，移动了 <b>${mergeBook(from.id, to.id)}</b> 条记录。`);
  }, '合并');
}

/* ---------------- 成员 / 商家 / 项目 ---------------- */
function mergeTag(f, old, nw) {
  const T = TAGS[f], st = S.settings;
  const n = remapTxns(t => ((t[f] || T.def) === old ? { [f]: nw } : null));
  S[T.list] = S[T.list].filter(x => x !== old);
  if (!S[T.list].includes(nw) && nw) S[T.list].push(nw);
  for (const b of st.home.boards) if (b.custom && b[T.list]) b[T.list] = uniq(b[T.list].map(x => (x === old ? nw : x)));
  for (const o of Object.values(st.last || {})) if (o && o[f] === old) o[f] = nw;
  return n;
}
