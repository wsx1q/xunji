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
/** 执行一次合并（或批量修改）：fn 做改动并返回提示文字；完成后弹出结果，可以马上撤销。after：关掉结果后回到哪里；kind：合并 / 修改 */
function mergeRun(label, fn, after, kind = '合并') {
  const txns = S.txns, snap = JSON.parse(JSON.stringify({ ...S, txns: null })); // txns 占位，保持字段顺序
  const msg = fn();
  save();
  _mergeUndo = { label, snap, txns, ver: _dataVer, S, after, kind };
  render();
  mergeDone(msg);
}
function mergeDone(msg) {
  const u = _mergeUndo, k = u.kind;
  _sheetCb = u.after;
  openSheet(`${k}完成`, `<div class="confirm-msg">${msg}</div>
    <div class="btn-row"><button class="btn ghost" onclick="undoMerge()">撤销${k}</button><button class="btn" onclick="const f=_sheetCb;closeSheet();f&&f()">好的</button></div>
    <div class="ver">也可以稍后在「我的 → 撤销上一次合并 / 批量修改」撤销；之后再改动数据就不能撤销了</div>`);
}
function undoMerge() {
  if (!canUndoMerge()) { _mergeUndo = null; closeSheet(); render(); return toast('之后数据又有改动，已经不能撤销了'); }
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

/* ---------------- 批量修改（流水页多选之后） ----------------
   改分类 / 账户 / 成员 / 商家 / 项目，追加备注，删掉备注里的某段文字。和合并共用一套撤销（mergeRun）。
   可以先用搜索、筛选把要整理的记录找出来，全选后一次改好。 */
function bulkSheet() {
  if (!SEL || !SEL.size) return toast('还没有选中记录');
  const n = SEL.size;
  const row = (ic, name, fn, sub = '') => `<div class="opt" onclick="${fn}"><div class="ci">${ic}</div><span>${name}${sub ? `<small class="opt-sub">${sub}</small>` : ''}</span><em>›</em></div>`;
  openSheet(`批量修改 ${n} 笔`, row('🗂️', '改分类', 'bulkCat()', '转账、余额变更没有分类，会跳过')
    + row('💳', '改账户', 'bulkAcc()') + row('👤', '改成员', "bulkTag('member')") + row('🏪', '改商家', "bulkTag('merchant')") + row('📁', '改项目', "bulkTag('project')")
    + row('📝', '追加备注', 'bulkNoteAdd()', '加在原备注后面，原来的内容保留')
    + row('🔤', '替换备注关键词', "openNoteReplace('selected')", '只替换指定文字，其他内容不变，可预览、撤销')
    + row('✂️', '删掉备注里的文字', 'bulkNoteDel()', '只删掉指定的文字，备注其余内容保留')
    + `<div class="btn-row"><button class="btn ghost del" onclick="closeSheet();selDelete()">删除这 ${n} 笔</button></div>
    <div class="ver">改完可以马上撤销，或稍后在「我的 → 撤销上一次合并 / 批量修改」撤销</div>`);
}
/** fn(t) 返回要改的字段；返回 null 表示这笔不适用或本来就一样，跳过 */
function bulkApply(label, fn) {
  const set = new Set(SEL);
  mergeRun(label, () => {
    const n = remapTxns(t => (set.has(t.id) ? fn(t) : null));
    selEnd();
    return `${esc(label)}：改了 <b>${n}</b> 笔${n < set.size ? `，另外 ${set.size - n} 笔不适用或本来就是这样，没有改动` : ''}。`;
  }, null, '修改');
}
const bulkTxns = () => S.txns.filter(t => SEL.has(t.id));
function bulkCat() {
  const types = new Set(bulkTxns().filter(t => t.type === 'expense' || t.type === 'income').map(t => t.type));
  if (!types.size) return toast('选中的都是转账或余额变更，没有分类');
  const pick = type => catSheet(`把${type === 'expense' ? '支出' : '收入'}改到哪个分类`, type, '', id =>
    bulkApply(`改分类为「${catLabel(id)}」`, t => (t.type === type && t.catId !== id ? { catId: id } : null)));
  if (types.size === 1) return pick([...types][0]);
  _sheetCb = pick;
  openSheet('选中的有支出也有收入', `<div class="tip" style="margin-top:0">支出和收入的分类是分开的，一次改一种：</div>
    <div class="opt" onclick="_sheetCb('expense')"><div class="ci">💸</div><span>改其中支出记录的分类</span><em>›</em></div>
    <div class="opt" onclick="_sheetCb('income')"><div class="ci">💰</div><span>改其中收入记录的分类</span><em>›</em></div>`);
}
function bulkAcc() {
  // 转账改转出账户；改完和转入账户相同的会变成自己转给自己，跳过
  accSheet('改到哪个账户', '', id => bulkApply(`改账户为「${accName(id)}」`, t => (t.accountId === id || (t.type === 'transfer' && t.toAccountId === id) ? null : { accountId: id })));
}
function bulkTag(f) {
  const T = TAGS[f];
  _sheetCb = v => bulkApply(v ? `改${T.name}为「${v}」` : `清空${T.name}`, t => ((t[f] || T.def) === (v || T.def) ? null : { [f]: v || T.def }));
  openSheet(`改成哪个${T.name}`, tagRows(f, (T.def ? [] : ['']).concat(S[T.list]), () => false, 'sheetPick(this.dataset.v)', '不设置' + T.name));
}
function bulkNoteAdd() {
  _sheetCb = () => {
    const v = $('#bnIn').value.trim(); if (!v) return toast('请输入要追加的文字');
    closeSheet();
    bulkApply(`追加备注「${v}」`, t => ((t.note || '').includes(v) ? null : { note: t.note ? `${t.note} ${v}` : v }));
  };
  openSheet('追加备注', `<input id="bnIn" class="field" placeholder="要加的文字，如：#报销、已核对" maxlength="30" onkeydown="if(event.key==='Enter')_sheetCb()">
    <div class="tip">加在每笔原备注的后面（中间空一格），原来的备注保留；已经含有这段文字的不会重复加。</div>
    <button class="btn" onclick="_sheetCb()">追加到 ${SEL.size} 笔</button>`);
  setTimeout(() => $('#bnIn') && $('#bnIn').focus(), 150);
}
function bulkNoteDel() {
  _sheetCb = () => {
    const v = $('#bnIn').value.trim(); if (!v) return toast('请输入要删掉的文字');
    closeSheet();
    // 英文不分大小写，和搜索一致；删完把多出来的空格合并
    const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), lv = v.toLowerCase();
    bulkApply(`删掉备注里的「${v}」`, t => (hasText(t.note, lv) ? { note: t.note.replace(re, '').replace(/\s{2,}/g, ' ').trim() } : null));
  };
  openSheet('删掉备注里的文字', `<input id="bnIn" class="field" placeholder="要删掉的文字" maxlength="30" onkeydown="if(event.key==='Enter')_sheetCb()">
    <div class="tip">只删掉每笔备注里的这段文字（英文不分大小写），备注其余内容保留。</div>
    <button class="btn" onclick="_sheetCb()">从 ${SEL.size} 笔里删掉</button>`);
  setTimeout(() => $('#bnIn') && $('#bnIn').focus(), 150);
}

/* 备注查找替换：按原文匹配，替换内容按普通文字处理；不改变其他字段。 */
let NR = null;
function noteReplacePlan(txns, find, replacement, ids=null) {
  const changes=new Map();let occurrences=0,tooLong=0;
  if(!find || find===replacement)return {changes,occurrences,tooLong};
  for(const t of txns) {
    if(ids&&!ids.has(t.id))continue;
    const before=t.note||'';if(!before.includes(find))continue;
    const parts=before.split(find),note=parts.join(replacement);
    occurrences+=parts.length-1;
    if(note.length>NOTE_MAX)tooLong++;
    changes.set(t.id,{before:t,note});
  }
  return {changes,occurrences,tooLong};
}
function openNoteReplace(scope='all') {
  if(stack.at(-1).name==='list')renderListBody();
  NR={scope,results:new Set(L.ids||[]),selected:new Set(SEL||[]),plan:null};
  openSheet('备注关键词替换',`<label for="nrFind">查找文字</label><input id="nrFind" class="field" value="${esc(L.q||'')}" placeholder="例如：欠款" maxlength="${NOTE_MAX}" oninput="noteReplaceInvalidate()">
    <label for="nrReplacement">替换为</label><input id="nrReplacement" class="field" placeholder="例如：待付款（留空表示删除）" maxlength="${NOTE_MAX}" oninput="noteReplaceInvalidate()">
    <label>替换范围</label><div class="chips note-replace-scopes">${[['all','全部账本的所有记录'],['results','当前搜索／筛选结果'],...(NR.selected.size?[['selected',`已选 ${NR.selected.size} 笔`]]:[])].map(([v,label])=>`<button type="button" class="chip ${scope===v?'on':''}" data-scope="${v}" onclick="noteReplaceScope(this.dataset.scope)">${label}</button>`).join('')}</div>
    <div class="tip">只替换备注中的文字，包含同一备注里多次出现的文字。按原文匹配，英文区分大小写；金额、日期、分类、账户等保持不变。</div>
    <button class="btn ghost" onclick="previewNoteReplace()">预览替换</button><div id="nrPreview" aria-live="polite"></div>`);
  returnFromPicker(()=>{NR=null;closeSheet();});
}
function noteReplaceInvalidate() { if(NR)NR.plan=null;const el=$('#nrPreview');if(el)el.innerHTML=''; }
function noteReplaceScope(scope) {
  NR.scope=scope;noteReplaceInvalidate();
  document.querySelectorAll('.note-replace-scopes [data-scope]').forEach(el=>el.classList.toggle('on',el.dataset.scope===scope));
}
function previewNoteReplace() {
  const find=$('#nrFind').value,replacement=$('#nrReplacement').value;
  if(!find)return toast('请输入要查找的文字');
  if(find===replacement)return toast('查找文字和替换文字相同，无需修改');
  const ids=NR.scope==='all'?null:NR[NR.scope==='selected'?'selected':'results'];
  const plan=noteReplacePlan(S.txns,find,replacement,ids);
  NR.plan={...plan,find,replacement,data:S,ver:_dataVer};
  const {changes,occurrences,tooLong}=plan;
  const examples=[];for(const row of changes.values()){examples.push(row);if(examples.length===10)break;}
  $('#nrPreview').innerHTML=`<div class="tip">${NR.scope==='all'?'全部账本的所有记录':NR.scope==='selected'?'已选记录':'当前搜索／筛选结果'}：匹配 <b>${changes.size}</b> 笔，共 <b>${occurrences}</b> 处。${!changes.size?'没有需要替换的备注。':''}${tooLong?`<br>有 ${tooLong} 笔替换后超过 ${NOTE_MAX} 字，请缩短替换内容后重新预览。`:''}</div>
    ${examples.map(({before,note})=>`<div class="note-replace-example"><small>${dateDisplay(before.time)} · ${esc((S.books.find(b=>b.id===before.bookId)||{}).name||'账本')}</small><div><b>原文</b><span>${esc(before.note)}</span></div><div><b>替换后</b><span>${esc(note)||'（空备注）'}</span></div></div>`).join('')}
    ${changes.size>10?'<div class="ver">仅预览前 10 笔，确认后会替换范围内全部匹配记录。</div>':''}
    <button class="btn" onclick="applyNoteReplace()" ${!changes.size||tooLong?'disabled':''}>替换 ${changes.size} 笔备注</button>`;
}
function applyNoteReplace() {
  const p=NR?.plan;
  if(!p||!p.changes.size||p.tooLong)return toast('请先预览替换结果');
  if(p.data!==S||p.ver!==_dataVer||p.find!==$('#nrFind').value||p.replacement!==$('#nrReplacement').value) {
    noteReplaceInvalidate();return toast('数据或替换文字已变化，请重新预览');
  }
  const label='备注关键词替换';
  mergeRun(label,()=>{
    const n=remapTxns(t=>p.changes.has(t.id)?{note:p.changes.get(t.id).note}:null);
    if(NR.scope==='selected')selEnd();NR=null;
    return `已替换 <b>${n}</b> 笔备注、共 <b>${p.occurrences}</b> 处，其他内容保持不变。`;
  },null,'修改');
}
