'use strict';
/* 记一笔 */
let E = null;
function startAdd(id, preset = {}) {
  const t = id && S.txns.find(x => x.id === id);
  if (t && t.type === 'adjust') {
    openSheet('余额变更', `<div class="kv"><span>账户</span><b>${esc(accName(t.accountId))}</b></div>
      <div class="kv"><span>调整金额</span><b class="${t.amount >= 0 ? 'inc' : 'exp'}">${t.amount >= 0 ? '+' : '-'}${money(Math.abs(t.amount))}</b></div>
      <div class="kv"><span>时间</span><b>${ymd(t.time)} ${hm(t.time)}</b></div>
      <label>备注（调整原因）</label><input id="adjNote" class="field" value="${esc(t.note && t.note !== '余额变更' ? t.note : '')}" placeholder="如：现金盘点、漏记、利息" maxlength="60" onkeydown="if(event.key==='Enter')adjNoteSave('${t.id}')">
      <div class="tip">由修改账户余额自动生成，不计入收支报表。</div>
      <div class="btn-row"><button class="btn ghost del" onclick="askConfirm('删除这条余额变更记录后，账户余额会相应回退，确定吗？',()=>{S.txns=S.txns.filter(x=>x.id!=='${t.id}');save();closeSheet();toast('已删除');render()},'删除')">删除记录</button>
      <button class="btn" onclick="adjNoteSave('${t.id}')">保存备注</button></div>`);
    return;
  }
  const firstAcc = (S.settings.lastAcc && accById(S.settings.lastAcc)) ? S.settings.lastAcc : (S.accounts[0] || {}).id;
  if (t) E = { ...t, expr: String(t.amount), editId: t.id, recentOn: false };
  else {
    const type = preset.type || 'expense';
    const last = (S.settings.last || {})[type] || {};
    const acc = (last.accountId && accById(last.accountId)) ? last.accountId : firstAcc;
    const toAcc = (last.toAccountId && accById(last.toAccountId)) ? last.toAccountId : (S.accounts.find(a => a.id !== acc) || {}).id;
    const catId = type === 'transfer' ? '' : defaultCatId(type);
    const rec = recentCats(type);
    E = {
      type, expr: '', catId, accountId: acc, toAccountId: toAcc, time: Math.min(S.settings.lastTime || Date.now(), Date.now()), note: '',
      member: last.member || '本人', merchant: last.merchant || '', project: last.project || '',
      bookId: S.curBook, recentOn: type !== 'transfer' && !!catId && rec.includes(catId), ...preset
    };
    if (E.type !== 'transfer' && !S.categories[E.type].some(c => c.id === E.catId)) E.catId = defaultCatId(E.type);
    if (E.type !== 'transfer') E.recentOn = recentCats(E.type).includes(E.catId);
  }
  // 编辑 / 复制时带着原金额进来：金额处于"选中"状态，直接按数字就替换，按 + − 则在原金额上继续算
  E.fresh = !!E.expr;
  if (!S.accounts.length) return toast('请先添加账户');
  go('add');
}
/** 余额变更只能改备注（金额和账户由调整余额决定）；换新对象，按年份分片保存才认得出改动 */
function adjNoteSave(id) {
  const i = S.txns.findIndex(x => x.id === id); if (i < 0) return closeSheet();
  const note = $('#adjNote').value.trim() || '余额变更';
  if (S.txns[i].note !== note) { S.txns[i] = { ...S.txns[i], note }; save(); }
  closeSheet(); toast('备注已保存'); render();
}
Pages.add = () => {
  if (!E) { setTimeout(back); return ''; }
  const isT = E.type === 'transfer';
  const cats = isT ? [] : tops(E.type);
  const rec = isT ? [] : recentCats(E.type);
  if (!isT && !S.categories[E.type].some(c => c.id === E.catId)) { E.catId = defaultCatId(E.type); E.recentOn = rec.includes(E.catId); }
  if (!isT && E.recentOn && !rec.length) E.recentOn = false;
  const curTop = isT ? '' : (E.recentOn ? '__recent__' : topOf(E.catId).id);
  const bal = balances(), cnt = catCounts(); // 分类图标上的数字是记录笔数，和分类管理一样
  const accCard = (field, label) => { const a = accById(E[field]); return `<div class="tf-card" onclick="pickAcc('${field}')"><small>${label}</small><b>${a ? accIcon(a) + ' ' + esc(accFull(a)) : '请选择账户'}</b><span>${a ? '余额 ' + money(bal[a.id]) : ''}</span></div>`; };
  const body = isT ? `<div class="tf">${accCard('accountId', '转出账户')}<div class="tf-sw" onclick="swapAcc()">⇅</div>${accCard('toAccountId', '转入账户')}</div>`
    : `<div class="cgrid">${rec.length ? `<div class="cg-i ${curTop === '__recent__' ? 'on' : ''}" data-id="__recent__" onclick="pickRecent()"><div class="ci" style="--cc:#FF8A65;background:#FF8A6526">🕒</div><span>最近使用</span></div>` : ''}
       ${cats.map(c => cgTile(c, { on: c.id === curTop, n: catTotal(cnt, c.id), tap: `pickCat('${c.id}')`, lp: 'cat', type: E.type })).join('')}
       <div class="cg-i" onclick="CT=E.type;go('cats')"><div class="ci ci-set">⚙️</div><span>设置</span></div></div>`;
  // 右上角一格分成 AC（清空）和 ⌫ 两个半宽键，整体还是 4×4，键盘高度不变
  const keys = [['1'], ['2'], ['3'], ['acdel'], ['4'], ['5'], ['6'], ['+', '+', 'fn'], ['7'], ['8'], ['9'], ['-', '−', 'fn'], ['again', E.editId ? '取消' : '再记', 'fn'], ['0'], ['.'], ['ok', '完成', 'ok']];
  return `<div class="add">
    <header class="add-hd"><b class="bk" onclick="back()">✕</b>
      <div class="seg">${[['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(([k, n]) => `<i class="${E.type === k ? 'on' : ''}" onclick="setType('${k}')">${n}</i>`).join('')}</div>
      <span class="bar-r">${E.editId ? '<a onclick="delTx()">删除</a>' : (HAS_OCR ? '<a onclick="stack.pop();E=null;openOcr()">📷识别</a>' : '')}</span></header>
    <div class="add-body">${body}</div>
    <div class="pad">
      <div class="subrow" id="subrow"></div>
      <div class="amt-row"><div class="amt-cat" id="amtCat"></div><div class="amt"><small id="expr"></small><b id="amt">0.00</b></div></div>
      <div class="opts">
        ${isT ? '' : `<i class="chip" onclick="pickAcc('accountId')">💳 ${esc(accById(E.accountId) ? accFull(accById(E.accountId)) : '未知账户')}</i>`}
        <i class="chip" onclick="pickTxDate()">📅 <span id="dlabel">${dateLabel(E.time)}</span></i>
        <label class="chip">🕘 <span id="tlabel">${hm(E.time)}</span><input type="time" value="${hm(E.time)}" onclick="try{this.showPicker()}catch(e){}" onchange="setTime(this.value)"></label>
        <i class="chip now ${Math.abs(Date.now() - E.time) < 6e4 ? 'hide' : ''}" id="nowChip" onclick="setNow()">⟲ 现在</i>
        <i class="chip" onclick="pickTag('member')">👤 ${esc(E.member || '本人')}</i>
        <i class="chip ${E.merchant ? 'set' : ''}" onclick="pickTag('merchant')">🏪 ${esc(E.merchant || '商家')}</i>
        <i class="chip ${E.project ? 'set' : ''}" onclick="pickTag('project')">📁 ${esc(E.project || '项目')}</i>
        ${S.books.length > 1 ? `<i class="chip" onclick="pickTxBook()">📒 ${esc((S.books.find(b => b.id === E.bookId) || curBook()).name)}</i>` : ''}
      </div>
      <textarea class="note" placeholder="添加备注..." oninput="E.note=this.value" maxlength="${NOTE_MAX}" rows="2">${esc(E.note)}</textarea>
      <div class="keys">${keys.map(([k, l, c]) => k === 'acdel' ? `<div class="k2"><button class="k fn" onclick="key('ac')">AC</button><button class="k fn" onclick="key('del')">⌫</button></div>` : `<button class="k ${c || ''}" ${k === 'ok' ? 'id="kok"' : ''} onclick="${k === 'ok' ? 'saveTx(false)' : k === 'again' ? (E.editId ? 'back()' : 'saveTx(true)') : `key('${k}')`}">${l || k}</button>`).join('')}</div>
    </div></div>`;
};
After.add = () => { updAmt(); updCat(); renderSubRow(); };
function dateLabel(t) {
  const k = sod(t), today = sod(Date.now());
  return k === today ? '今天' : k === today - 864e5 ? '昨天' : md(t);
}
function setType(k) {
  if (E.type === k) return;
  E.type = k;
  if (E.editId) { render(); return; }
  const last = (S.settings.last || {})[k] || {};
  if (k === 'transfer') {
    E.recentOn = false;
    if (last.accountId && accById(last.accountId)) E.accountId = last.accountId;
    if (last.toAccountId && accById(last.toAccountId)) E.toAccountId = last.toAccountId;
  } else {
    E.catId = defaultCatId(k);
    E.recentOn = recentCats(k).includes(E.catId);
    E.member = last.member || E.member || '本人';
    E.merchant = last.merchant != null ? last.merchant : (E.merchant || '');
    E.project = last.project != null ? last.project : (E.project || '');
    if (last.accountId && accById(last.accountId)) E.accountId = last.accountId;
  }
  render();
}
function pickRecent() {
  const rec = recentCats(E.type);
  if (!rec.length) return toast('还没有最近使用的分类');
  E.recentOn = true;
  if (!rec.includes(E.catId)) E.catId = rec[0];
  document.querySelectorAll('.cgrid .cg-i[data-id]').forEach(el => el.classList.toggle('on', el.dataset.id === '__recent__'));
  updCat(); renderSubRow();
}
function pickCat(id) {
  E.recentOn = false;
  E.catId = id;
  const top = topOf(id).id;
  document.querySelectorAll('.cgrid .cg-i[data-id]').forEach(el => el.classList.toggle('on', el.dataset.id === top));
  updCat(); renderSubRow();
}
function renderSubRow() {
  const el = $('#subrow'); if (!el) return;
  if (E.type === 'transfer') { el.style.display = 'none'; return; }
  if (E.recentOn) {
    const rec = recentCats(E.type);
    el.style.display = '';
    el.innerHTML = `<small>最近使用 ›</small>` + rec.map(id => {
      const c = catById(id), top = topOf(id);
      return `<i class="chip ${id === E.catId ? 'on' : ''}" onclick="E.catId='${id}';updCat();renderSubRow()">${c.icon} ${esc(c.name)}<em class="sub-p">${esc(top.name)}</em></i>`;
    }).join('');
    return;
  }
  const top = topOf(E.catId), subs = top ? subsOf(top.id) : [];
  el.style.display = top && top.id ? '' : 'none';
  if (!top || !top.id) return;
  const cnt = catCounts();
  el.innerHTML = `<small>${esc(top.name)} ›</small>` + subs.map(s => cgChip(s, { on: s.id === E.catId, n: cnt.get(s.id) || 0, tap: `pickCat('${s.id === E.catId ? top.id : s.id}')`, lp: 'cat', type: E.type })).join('')
    + `<i class="chip" onclick="CT=E.type;editCat('','${top.id}')">＋ 二级分类</i>`;
}
function updCat() {
  const el = $('#amtCat'); if (!el) return;
  if (E.type === 'transfer') el.textContent = '🔁 转账';
  else if (E.recentOn) el.textContent = `🕒 最近使用 › ${catById(E.catId).name}`;
  else el.textContent = `${catById(E.catId).icon} ${catLabel(E.catId)}`;
}
function pickTxDate() { dateSheet('选择日期', ymd(E.time), setDate, { max: ymd(Date.now()) }); }
function setDate(v) {
  if (!v) return;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(E.time); t.setFullYear(y, m - 1, d); E.time = t.getTime();
  $('#dlabel').textContent = dateLabel(E.time);
  $('#nowChip').classList.toggle('hide', Math.abs(Date.now() - E.time) < 6e4);
}
function setTime(v) {
  if (!v) return;
  const [h, m] = v.split(':').map(Number);
  const t = new Date(E.time); t.setHours(h, m, 0, 0); E.time = t.getTime();
  $('#tlabel').textContent = hm(E.time);
  $('#nowChip').classList.toggle('hide', Math.abs(Date.now() - E.time) < 6e4);
}
function setNow() { E.time = Date.now(); render(); }
function evalExpr(s) { const m = s.match(/[+\-]?[^+\-]+/g) || []; return r2(m.reduce((a, x) => a + (parseFloat(x) || 0), 0)); }
const hasOp = s => /\d[+\-]\d/.test(s);
function key(k) {
  if (E.fresh) { E.fresh = false; if (/^[\d.]$/.test(k)) E.expr = ''; }
  let s = E.expr;
  const last = s.split(/[+\-]/).pop();
  if (k === 'ac') s = '';
  else if (k === 'del') s = s.slice(0, -1);
  else if (k === '+' || k === '-') {
    // 开头按 − 就是输入负数（如退款记成负的支出）；只有一个负号时再按 + 等于取消负号
    if (!s || s === '-') s = k === '-' ? '-' : '';
    else { if (/[+\-]$/.test(s)) s = s.slice(0, -1); s += k; }
  }
  else if (k === '.') { if (last.includes('.')) return; s += last === '' ? '0.' : '.'; }
  else {
    if (/\.\d{2}$/.test(last)) return;
    if (last.replace('.', '').length >= 9) return;
    if (last === '0') s = s.slice(0, -1);
    s += k;
  }
  E.expr = s; updAmt();
}
function updAmt() {
  if (!$('#amt')) return;
  $('#expr').textContent = /\d[+\-]/.test(E.expr) ? E.expr : ''; // 只有一个负数时不重复显示算式
  $('#amt').textContent = money(evalExpr(E.expr));
  $('#amt').classList.toggle('fresh', !!E.fresh);
  $('#kok').textContent = hasOp(E.expr) ? '=' : '完成';
}
function saveTx(again) {
  if (hasOp(E.expr)) { E.expr = String(evalExpr(E.expr)); updAmt(); return; }
  const amt = evalExpr(E.expr);
  if (!amt) return toast('请输入金额');
  if (amt < 0 && E.type === 'transfer') return toast('转账金额不能为负，可以点 ⇅ 交换转出和转入账户');
  if (E.type === 'transfer' && (!E.toAccountId || E.accountId === E.toAccountId)) return toast('转出和转入账户不能相同');
  const isT = E.type === 'transfer';
  const rec = {
    id: E.editId || uid(), bookId: E.bookId || S.curBook, type: E.type, amount: amt, catId: isT ? '' : E.catId,
    accountId: E.accountId, toAccountId: isT ? E.toAccountId : '', time: E.time, note: (E.note || '').trim(), member: E.member || '本人', merchant: E.merchant || '', project: E.project || ''
  };
  if (E.editId) {
    const i = S.txns.findIndex(x => x.id === E.editId);
    if (i >= 0) {
      const old = S.txns[i], next = { ...old, ...rec };
      if (Object.keys(rec).every(k => old[k] === next[k] || (k === 'bookId' && !old[k]))) { E = null; back(); return; }
      if (!E._ok) return askConfirm('确定保存对这条记录的修改吗？', () => { E._ok = true; saveTx(); }, '保存');
      if (old.time === rec.time) S.txns[i] = next;
      else { S.txns.splice(i, 1); insertTxn(next); }
    }
  } else { insertTxn(rec); S.settings.lastTime = rec.time; }
  rememberLast(); save();
  toast(E.editId ? '修改成功' : '记账成功 ✓');
  if (again && !E.editId) { E.expr = ''; E.fresh = false; E.note = ''; E.recentOn = recentCats(E.type).includes(E.catId); render(); return; }
  // 流水 / 账户页的 DOM 缓存仍可用，先马上返回，避免按保存卡住；下一帧再补这一笔
  const saved = rec, edited = !!E.editId;
  stack.forEach(s => { if (s.node && (s.name === 'list' || s.name === 'account')) s.ver = _dataVer; });
  E = null;
  back();
  requestAnimationFrame(() => {
    if (edited && vlReplaceTxn(saved)) return;
    if ($('#lbody')) renderListBody();
    else if ($('#abody')) After.account();
  });
}
/** 改的是同一天：只换那一张日期卡片，不重扫全部流水 */
function vlReplaceTxn(next) {
  const host = document.querySelector('#view .vl'), vl = host && host._vl;
  if (!vl) return false;
  for (let i = 0; i < vl.days.length; i++) {
    const list = vl.days[i].list, j = list.findIndex(t => t.id === next.id);
    if (j < 0) continue;
    if (sod(list[j].time) !== sod(next.time)) return false;
    list[j] = next;
    if (AV.tx) { const k = AV.tx.findIndex(t => t.id === next.id); if (k >= 0) AV.tx[k] = next; }
    const el = vl.nodes.get(i);
    if (!el) return true;
    const t = document.createElement('template');
    t.innerHTML = dayHtml(vl.days[i].k, list, vl.accId, ` data-vi="${i}"`);
    const neu = t.content.firstChild;
    el.replaceWith(neu); vl.nodes.set(i, neu);
    const h = neu.offsetHeight + VL_GAP;
    if (Math.abs(vl.h[i] - h) > 0.5) { vl.h[i] = h; vlOffsets(vl); vlPads(vl); }
    return true;
  }
  return false;
}
function delTx() { askConfirm('确定删除这条记录吗？', () => { S.txns = S.txns.filter(x => x.id !== E.editId); save(); E = null; toast('已删除'); back(); }, '删除'); }
function pickAcc(field) { accSheet('选择账户', E[field], id => { E[field] = id; }); }
function swapAcc() { [E.accountId, E.toAccountId] = [E.toAccountId, E.accountId]; render(); }
function pickTag(f) {
  const T = TAGS[f], cur = E[f] || T.def, opts = (T.def ? [] : ['']).concat(S[T.list]);
  _pickReopen = () => pickTag(f);
  openSheet('选择' + T.name, tagRows(f, opts, m => m === cur, `E['${f}']=this.dataset.v;closeSheet();render()`, '不设置' + T.name, true)
    + `<label>添加${T.name}</label><div class="btn-row"><input id="mIn" class="field" placeholder="${T.name}名称" maxlength="12"><button class="btn add-btn" onclick="addTag('${f}')">添加</button></div>`);
}
function addTag(f) {
  const T = TAGS[f], v = $('#mIn').value.trim(); if (!v) return;
  if (!S[T.list].includes(v)) S[T.list].push(v);
  save(); E[f] = v; closeSheet(); render();
}
function pickTxBook() {
  openSheet('记到账本', S.books.map(b => `<div class="opt ${b.id === E.bookId ? 'on' : ''}" onclick="E.bookId='${b.id}';closeSheet();render()"><div class="ci">${b.icon}</div><span>${esc(b.name)}</span></div>`).join(''));
}
