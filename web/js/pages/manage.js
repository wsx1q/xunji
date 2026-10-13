'use strict';
/* 预算、分类管理、账本管理 */
Pages.budget = () => {
  const b = budget(), now = new Date();
  const [s, e] = periodRange('month');
  const tx = inRange(bookTx(), s, e).filter(t => t.type === 'expense');
  const spent = sumArr(tx), left = r2(b.total - spent);
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
  const pct = b.total ? spent / b.total : 0;
  const catRows = Object.entries(b.cats).map(([id, amt]) => {
    const c = catById(id), sp = sumArr(tx.filter(t => inCat(t.catId, id))), p = amt ? sp / amt : 0;
    return `<div class="rank" onclick="setCatBudget('${id}')"><div class="ci" style="background:${c.color}26">${c.icon}</div><div class="rank-m">
      <div class="rank-t"><span>${esc(c.name)}<small>已用 ${money(sp)} / ${money(amt, 0)}</small></span><b class="num ${sp > amt ? 'over' : ''}">${sp > amt ? '超支 ' + money(sp - amt) : '余 ' + money(amt - sp)}</b></div>
      <div class="prog"><i style="width:${Math.min(100, p * 100)}%;background:${p > 1 ? '#E5484D' : p > 0.8 ? '#FFB300' : c.color}"></i></div></div></div>`;
  }).join('');
  return hdr(`${now.getMonth() + 1}月预算`) + `<div class="bud-hd grad">
    <div class="ring" onclick="editTotalBudget()">${ringSvg(pct, 'rgba(255,255,255,.28)', left < 0 ? '#FFE14D' : '#fff', 120, 10)}<div class="ring-t"><span style="opacity:.85">${b.total ? (left < 0 ? '已超支' : '剩余') : '未设置'}</span><b>${b.total ? Math.round(Math.abs(1 - pct) * 100) + '%' : '—'}</b></div></div>
    <div class="bud-info"><div><span>总预算</span><b onclick="editTotalBudget()">${money(b.total)} ✎</b></div><div><span>已支出</span><b>${money(spent)}</b></div>
      <div><span>${left < 0 ? '超支' : '剩余'}</span><b>${money(Math.abs(left))}</b></div><div><span>日均可用</span><b>${money(left > 0 ? left / daysLeft : 0)}</b></div></div></div>
  <div class="card"><div class="card-hd"><b>分类预算</b><a onclick="addCatBudget()">＋ 添加</a></div>${catRows || empty('为常用分类设置预算，控制花销更轻松', '🎯')}</div>`;
};
function editTotalBudget() { numberSheet('设置月度总预算', budget().total, v => { budget().total = v; save(); render(); toast('预算已更新'); }); }
function addCatBudget() {
  const b = budget();
  openSheet('选择分类', tops('expense').map(c => `<div class="opt" onclick="closeSheet();setCatBudget('${c.id}')"><div class="ci" style="background:${c.color}26">${c.icon}</div><span>${esc(c.name)}</span><em>${b.cats[c.id] ? money(b.cats[c.id], 0) : ''}</em></div>`).join(''));
}
function setCatBudget(id) {
  numberSheet(`「${esc(catById(id).name)}」月预算（填 0 删除）`, budget().cats[id], v => { const b = budget(); if (v > 0) b.cats[id] = v; else delete b.cats[id]; save(); render(); });
}

/* ================= 分类管理 ================= */
let CT = 'expense', CE = null;
Pages.cats = () => {
  return hdr('分类管理', `<a onclick="editCat()">＋ 一级</a>`) + `<div style="text-align:center;padding:14px 0 0"><div class="seg light">${[['expense', '支出分类'], ['income', '收入分类']].map(([k, n]) => `<i class="${CT === k ? 'on' : ''}" onclick="CT='${k}';render()">${n}</i>`).join('')}</div></div>
  ${tops(CT).map(c => {
    const subs = subsOf(c.id);
    return `<div class="card cat-card" data-lp="cat" data-lpid="${c.id}" data-lpg="${CT}|"><div class="cat-top" onclick="editCat('${c.id}')"><div class="ci" style="background:${c.color}26">${c.icon}</div><b>${esc(c.name)}</b><small>${subs.length ? subs.length + ' 个二级分类' : '无二级分类'}</small><em>编辑</em></div>
      <div class="cat-subs">${subs.map(s => `<i class="chip" data-lp="cat" data-lpid="${s.id}" data-lpg="${CT}|${c.id}" onclick="editCat('${s.id}')">${s.icon} ${esc(s.name)}</i>`).join('')}<i class="chip sub-add" onclick="editCat('','${c.id}')">＋ 二级分类</i></div></div>`;
  }).join('')}
  <div class="card"><div class="cat-top" onclick="editCat()"><div class="ci ci-set">＋</div><b>添加一级分类</b></div></div>
  <div class="ver">点击一级分类或二级分类可修改名称、图标；记账时可以只选一级分类</div>`;
};
function editCat(id, pid = '') {
  const c = id && S.categories[CT].find(x => x.id === id);
  const p = pid && catById(pid);
  CE = c ? { ...c, pid: c.pid || '' } : { id: '', pid, name: '', icon: p ? p.icon : EMOJIS[0], color: p ? p.color : COLORS[0] };
  renderCatSheet();
}
function renderCatSheet() {
  const sub = !!CE.pid, kind = CT === 'expense' ? '支出' : '收入';
  const title = CE.id ? (sub ? '编辑二级分类' : '编辑一级分类') : (sub ? `新建「${esc(catById(CE.pid).name)}」的二级分类` : `新建${kind}一级分类`);
  const color = sub ? catById(CE.pid).color : CE.color;
  openSheet(title, `<div style="display:flex;align-items:center;gap:12px"><div class="ci" id="cePrev" style="width:52px;height:52px;font-size:26px;background:${color}">${CE.icon}</div>
    <input id="cName" class="field" value="${esc(CE.name)}" placeholder="${sub ? '二级分类名称' : '分类名称'}" maxlength="8" oninput="CE.name=this.value"></div>
    ${sub ? `<label>所属一级分类</label><div class="chips" style="flex-wrap:wrap">${tops(CT).map(t => `<i class="chip ${t.id === CE.pid ? 'on' : ''}" onclick="CE.pid='${t.id}';renderCatSheet()">${t.icon} ${esc(t.name)}</i>`).join('')}</div>` : ''}
    <label>图标</label><div class="emo-grid">${EMOJIS.map(e => `<i class="${e === CE.icon ? 'on' : ''}" onclick="CE.icon='${e}';renderCatSheet()">${e}</i>`).join('')}</div>
    ${sub ? '' : `<label>颜色（二级分类跟随一级分类）</label><div class="color-grid">${COLORS.map(c => `<i class="${c === CE.color ? 'on' : ''}" style="background:${c}" onclick="CE.color='${c}';renderCatSheet()"></i>`).join('')}</div>`}
    <div class="btn-row">${CE.id ? `<button class="btn ghost" onclick="delCat()">删除</button><button class="btn ghost" onclick="catMergeSheet()">合并到…</button>` : ''}<button class="btn" onclick="saveCat()">保存</button></div>`);
}
function saveCat() {
  const name = (CE.name || '').trim(); if (!name) return toast('请输入分类名称');
  const list = S.categories[CT], pid = CE.pid || '';
  if (list.some(x => x.id !== CE.id && x.pid === pid && x.name === name)) return toast('已有同名分类');
  const rec = { id: CE.id || uid(), pid, name, icon: CE.icon, color: pid ? catById(pid).color : CE.color };
  if (CE.id) list[list.findIndex(x => x.id === CE.id)] = rec; else list.push(rec);
  if (!pid) list.forEach(x => { if (x.pid === rec.id) x.color = rec.color; });
  if (!CE.id && pid && E && stack[stack.length - 1].name === 'add') E.catId = rec.id;
  save(); closeSheet(); render(); toast('已保存');
}
function delCat() {
  const list = S.categories[CT];
  if (CE.pid) {
    const n = S.txns.filter(t => t.catId === CE.id).length, parent = catById(CE.pid);
    return askConfirm(n ? `该二级分类下有 ${n} 条记录，删除后这些记录将归入「${esc(parent.name)}」，确定删除？<br><small style="color:var(--t2)">想归到别的分类，用「合并到…」</small>` : '确定删除该二级分类？', () => {
      S.txns = S.txns.map(t => t.catId === CE.id ? { ...t, catId: parent.id } : t);
      S.categories[CT] = list.filter(x => x.id !== CE.id); save(); render(); toast('已删除');
    }, '删除');
  }
  if (tops(CT).length <= 1) return toast('至少保留一个一级分类');
  const ids = [CE.id, ...subsOf(CE.id).map(s => s.id)];
  const n = S.txns.filter(t => ids.includes(t.catId)).length, ns = ids.length - 1;
  askConfirm(`${ns ? `将同时删除其下 ${ns} 个二级分类。` : ''}${n ? `共有 ${n} 条记录，删除后将显示为「未分类」（想保留分类，用「合并到…」）。` : ''}确定删除「${esc(CE.name)}」？`, () => {
    S.categories[CT] = list.filter(x => !ids.includes(x.id));
    Object.values(S.budgets).forEach(b => delete b.cats[CE.id]);
    save(); render(); toast('已删除');
  }, '删除');
}

/* ================= 账本管理 ================= */
Pages.books = () => {
  const [s, e] = periodRange('month');
  const n = countBy(t => t.bookId), exp = new Map();
  for (const t of inRange(S.txns, s, e)) if (t.type === 'expense') exp.set(t.bookId, (exp.get(t.bookId) || 0) + t.amount);
  return hdr('账本管理', `<a onclick="editBook()">＋ 新建</a>`) + `<div class="card">${S.books.map(b => {
    return `<div class="bk-i" data-lp="book" data-lpid="${b.id}" onclick="switchBook('${b.id}')"><div class="bk-ic">${b.icon}</div><span>${esc(b.name)}<small>${n.get(b.id) || 0} 笔 · 本月支出 ${money(r2(exp.get(b.id) || 0))}</small></span>
      ${b.id === S.curBook ? '<i class="tag">当前</i>' : ''}<a class="bk-ed" onclick="event.stopPropagation();editBook('${b.id}')">编辑</a></div>`;
  }).join('')}</div><div class="ver">点击账本即可切换；长按改名，长按后拖动调整顺序</div>`;
};
let BE = null;
function editBook(id) { const b = id && S.books.find(x => x.id === id); BE = b ? { ...b } : { id: '', name: '', icon: BOOK_ICONS[1] }; renderBookSheet(); }
function renderBookSheet() {
  openSheet(BE.id ? '编辑账本' : '新建账本', `<label>账本名称</label><input id="bName" class="field" value="${esc(BE.name)}" placeholder="如：旅行账本、装修账本" maxlength="12" oninput="BE.name=this.value">
    <label>封面图标</label><div class="emo-grid">${BOOK_ICONS.map(e => `<i class="${e === BE.icon ? 'on' : ''}" onclick="BE.icon='${e}';renderBookSheet()">${e}</i>`).join('')}</div>
    <div class="btn-row">${BE.id && S.books.length > 1 ? `<button class="btn ghost" onclick="delBook()">删除</button><button class="btn ghost" onclick="bookMergeSheet()">合并到…</button>` : ''}<button class="btn" onclick="saveBook()">保存</button></div>`);
}
function saveBook() {
  const name = (BE.name || '').trim(); if (!name) return toast('请输入账本名称');
  if (BE.id) Object.assign(S.books.find(b => b.id === BE.id), { name, icon: BE.icon });
  else { const id = uid(); S.books.push({ id, name, icon: BE.icon }); S.budgets[id] = { total: 0, cats: {} }; S.curBook = id; }
  save(); closeSheet(); render(); toast('已保存');
}
function delBook() {
  const n = S.txns.filter(t => t.bookId === BE.id).length;
  askConfirm(`删除账本「${esc(BE.name)}」将同时删除其中 ${n} 条记录，无法恢复，确定吗？`, () => {
    S.books = S.books.filter(b => b.id !== BE.id); S.txns = S.txns.filter(t => t.bookId !== BE.id); delete S.budgets[BE.id];
    if (S.curBook === BE.id) S.curBook = S.books[0].id; save(); render(); toast('已删除');
  }, '删除');
}
