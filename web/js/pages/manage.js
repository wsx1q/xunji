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
function editTotalBudget() { numberSheet('设置月度总预算', budget().total, v => { budget().total = v; save(); render(); toast('已保存'); }); }
function addCatBudget() { catSheet('给哪个分类设预算', 'expense', '', id => setCatBudget(id)); }
function setCatBudget(id) {
  numberSheet(`「${esc(catById(id).name)}」月预算（填 0 删除）`, budget().cats[id], v => { const b = budget(); if (v > 0) b.cats[id] = v; else delete b.cats[id]; save(); render(); });
}

/* ================= 分类管理 ================= */
let CT = 'expense', CE = null;
/** 分类下的记录数（所有账本）；一级分类算上它的二级分类。数据没变时用缓存（invalidateCache 会清掉） */
const catCounts = () => _cache.catCnt || (_cache.catCnt = countBy(t => t.catId));
const catTotal = (cnt, id) => (cnt.get(id) || 0) + subsOf(id).reduce((a, s) => a + (cnt.get(s.id) || 0), 0);
/* ================= 分类网格：记一笔、分类管理、所有选分类的面板共用 =================
   一级分类是图标网格（和记一笔一样），点一个在下面一行展开它的二级分类；图标右上角的数字是记录笔数。
   短按 = 选择（分类管理里：点一级展开、点二级编辑）；长按 = 编辑（改名、图标、删除、合并）；长按后拖动排序。 */
const cgNum = n => (n ? `<i class="cg-n">${n > 9999 ? '9999+' : n}</i>` : '');
/** 一级分类的图标格子（记一笔页也用这个） */
function cgTile(c, { on, open, n, tap, lp, type }) {
  return `<div class="cg-i ${on ? 'on' : ''} ${open ? 'open' : ''}" data-id="${c.id}" ${lp ? `data-lp="${lp}" data-lpid="${c.id}" data-lpg="${type}|"` : ''} onclick="${tap}"><div class="ci" style="--cc:${c.color};background:${c.color}26">${c.icon}${cgNum(n)}</div><span>${esc(c.name)}</span></div>`;
}
/** 二级分类的小标签 */
function cgChip(s, { on, n, tap, lp, type }) {
  return `<i class="chip ${on ? 'on' : ''}" data-v="${s.id}" ${lp ? `data-lp="${lp}" data-lpid="${s.id}" data-lpg="${type}|${s.pid}"` : ''} onclick="${tap}">${s.icon} ${esc(s.name)}${n ? `<i class="cnt">${n}</i>` : ''}</i>`;
}
/**
 * 网格状态 CGS[key] = { type, mode: 'manage' | 'single' | 'multi', open: 展开的一级分类, sel: 已选 id,
 *   pick(id): 单选选中, toggle(id): 多选切换, rerender(): 重画, noLp: 不能长按编辑 }
 * 选一级分类本身：单选时点下面一行的「只记到 X」；多选时直接点一级分类图标（包含其下所有二级分类），再点二级分类就改成只选它。
 */
const CGS = {};
let _catPickReopen = null; // 面板里长按编辑完回到这个面板
function catGridHtml(key) {
  const st = CGS[key], cnt = catCounts(), list = tops(st.type), sel = st.sel || [];
  if (!list.some(t => t.id === st.open)) st.open = (list.find(t => sel.some(id => inCat(id, t.id))) || list[0] || {}).id || '';
  const lp = st.noLp ? '' : st.mode === 'manage' ? 'cat' : 'catpick';
  const grid = list.map(t => cgTile(t, { on: st.mode !== 'manage' && sel.some(id => inCat(id, t.id)), open: t.id === st.open,
    n: catTotal(cnt, t.id), tap: `cgTop('${key}','${t.id}')`, lp, type: st.type })).join('');
  const top = list.find(t => t.id === st.open);
  let sub = '';
  if (top) {
    const all = sel.includes(top.id);
    const whole = st.mode === 'single' ? `<i class="chip ${all ? 'on' : ''}" onclick="cgPick('${key}','${top.id}')">只记到「${esc(top.name)}」</i>`
      : '';
    sub = `<div class="cg-sub"><small>${top.icon} ${esc(top.name)} ›</small>${whole}${subsOf(top.id).map(s => cgChip(s, { on: sel.includes(s.id) || (st.mode === 'multi' && all),
      n: cnt.get(s.id) || 0, tap: `cgPick('${key}','${s.id}')`, lp, type: st.type })).join('')}${st.mode === 'manage' ? `<i class="chip sub-add" onclick="editCat('','${top.id}')">＋ 二级分类</i>` : ''}</div>`;
  }
  return `<div class="cgrid">${grid}</div>${sub}`;
}
function cgTop(key, id) {
  const st = CGS[key];
  // 单选时没有二级分类的一级分类，点一下就选中
  if (st.mode === 'single' && !subsOf(id).length) return st.pick(id);
  // 多选：短按一级分类就是选中 / 取消整个分类（同时展开它的二级分类，可以再细选）
  if (st.mode === 'multi') { st.open = id; return st.toggle(id); }
  st.open = id;
  st.rerender();
}
function cgPick(key, id) {
  const st = CGS[key];
  if (st.mode === 'manage') return editCat(id);
  if (st.mode === 'single') return st.pick(id);
  st.toggle(id);
}
Pages.cats = () => {
  const st = CGS.manage || (CGS.manage = { mode: 'manage', open: '', rerender: () => render() });
  st.type = CT;
  return hdr('分类管理', `<a onclick="editCat()">＋ 一级</a>`) + `<div style="text-align:center;padding:14px 0 0"><div class="seg light">${[['expense', '支出分类'], ['income', '收入分类']].map(([k, n]) => `<i class="${CT === k ? 'on' : ''}" onclick="CT='${k}';render()">${n}</i>`).join('')}</div></div>
  <div class="card cg-card">${catGridHtml('manage')}</div>
  <div class="ver">图标上的数字是记录笔数。点一级分类展开它的二级分类；长按任何分类可以改名、换图标、删除、合并，长按后拖动调整顺序</div>`;
};
/* 从筛选面板长按进来编辑：保存 / 删除 / 合并后回到筛选面板 */
let _catReturn = null;
function catBack() { const f = _catReturn; _catReturn = null; if (f) f(); }
function editCat(id, pid = '', ret = null) {
  _catReturn = ret;
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
    ${CE.id ? (() => {
      const cnt = catCounts(), own = cnt.get(CE.id) || 0, all = sub ? own : catTotal(cnt, CE.id);
      return `<div class="cat-n">${all ? `共 <b>${all}</b> 笔记录${!sub && own && all !== own ? `（其中直接记在「${esc(CE.name)}」下 ${own} 笔）` : ''}，删除前可以用「合并到…」转到别的分类` : '这个分类下还没有记录，可以直接删除'}</div>`;
    })() : ''}
    ${sub ? `<label>所属一级分类</label><div class="chips" style="flex-wrap:wrap">${tops(CT).map(t => `<i class="chip ${t.id === CE.pid ? 'on' : ''}" onclick="CE.pid='${t.id}';renderCatSheet()">${t.icon} ${esc(t.name)}</i>`).join('')}</div>` : ''}
    <label>图标</label><div class="emo-grid">${EMOJIS.map(e => `<i class="${e === CE.icon ? 'on' : ''}" onclick="CE.icon='${e}';renderCatSheet()">${e}</i>`).join('')}</div>
    ${sub ? '' : `<label>颜色（二级分类跟随一级分类）</label><div class="color-grid">${COLORS.map(c => `<i class="${c === CE.color ? 'on' : ''}" style="background:${c}" onclick="CE.color='${c}';renderCatSheet()"></i>`).join('')}</div>`}
    <div class="btn-row">${CE.id ? `<button class="btn ghost del" onclick="delCat()">删除</button><button class="btn ghost" onclick="catMergeSheet()">合并到…</button>` : ''}<button class="btn" onclick="saveCat()">保存</button></div>`);
}
function saveCat() {
  const name = (CE.name || '').trim(); if (!name) return toast('请输入分类名称');
  const list = S.categories[CT], pid = CE.pid || '';
  if (list.some(x => x.id !== CE.id && x.pid === pid && x.name === name)) return toast('已有同名分类');
  const rec = { id: CE.id || uid(), pid, name, icon: CE.icon, color: pid ? catById(pid).color : CE.color };
  if (CE.id) list[list.findIndex(x => x.id === CE.id)] = rec; else list.push(rec);
  if (!pid) list.forEach(x => { if (x.pid === rec.id) x.color = rec.color; });
  if (!CE.id && pid && E && stack[stack.length - 1].name === 'add') E.catId = rec.id;
  save(); closeSheet(); render(); toast('已保存'); catBack();
}
function delCat() {
  const list = S.categories[CT];
  const drop = ids => { S.categories[CT] = S.categories[CT].filter(x => !ids.includes(x.id)); Object.values(S.budgets).forEach(b => ids.forEach(id => delete b.cats[id])); save(); closeSheet(); render(); toast('已删除'); catBack(); };
  if (CE.pid) {
    const n = S.txns.filter(t => t.catId === CE.id).length, parent = catById(CE.pid);
    if (!n) return drop([CE.id]); // 没有记录：直接删
    return askConfirm(n ? `该二级分类下有 ${n} 条记录，删除后这些记录将归入「${esc(parent.name)}」，确定删除？<br><small style="color:var(--t2)">想归到别的分类，用「合并到…」</small>` : '确定删除该二级分类？', () => {
      S.txns = S.txns.map(t => t.catId === CE.id ? { ...t, catId: parent.id } : t);
      S.categories[CT] = list.filter(x => x.id !== CE.id); save(); render(); toast('已删除'); catBack();
    }, '删除');
  }
  if (tops(CT).length <= 1) return toast('至少保留一个一级分类');
  const ids = [CE.id, ...subsOf(CE.id).map(s => s.id)];
  const n = S.txns.filter(t => ids.includes(t.catId)).length, ns = ids.length - 1;
  if (!n && !ns) return drop(ids); // 没有记录也没有二级分类：直接删
  askConfirm(`${ns ? `将同时删除其下 ${ns} 个二级分类。` : ''}${n ? `共有 ${n} 条记录，删除后将显示为「未分类」（想保留分类，用「合并到…」）。` : ''}确定删除「${esc(CE.name)}」？`, () => {
    S.categories[CT] = list.filter(x => !ids.includes(x.id));
    Object.values(S.budgets).forEach(b => delete b.cats[CE.id]);
    save(); render(); toast('已删除'); catBack();
  }, '删除');
}

/* ================= 账本管理 ================= */
Pages.books = () => {
  const [s, e] = periodRange('month');
  const n = countBy(t => t.bookId), exp = new Map();
  for (const t of inRange(S.txns, s, e)) if (t.type === 'expense') exp.set(t.bookId, (exp.get(t.bookId) || 0) + t.amount);
  return hdr('账本管理', `<a onclick="editBook()">＋ 新建</a>`) + `<div class="card">${S.books.map(b => {
    const k = n.get(b.id) || 0;
    return `<div class="bk-i" data-lp="book" data-lpid="${b.id}" onclick="editBook('${b.id}')"><div class="bk-ic">${b.icon}</div><span>${esc(b.name)}${k ? `<i class="cnt">${k}</i>` : ''}<small>本月支出 ${money(r2(exp.get(b.id) || 0))}</small></span>
      ${b.id === S.curBook ? '<i class="tag">当前</i>' : ''}<em class="bk-ed">编辑</em></div>`;
  }).join('')}</div><div class="ver">数字是记录笔数。点击或长按账本可以改名、切换、删除、合并；长按后拖动调整顺序。首页左上角也能切换账本</div>`;
};
let BE = null;
function editBook(id) { const b = id && S.books.find(x => x.id === id); BE = b ? { ...b } : { id: '', name: '', icon: BOOK_ICONS[1] }; renderBookSheet(); }
function renderBookSheet() {
  openSheet(BE.id ? '编辑账本' : '新建账本', `<label>账本名称</label><input id="bName" class="field" value="${esc(BE.name)}" placeholder="如：旅行账本、装修账本" maxlength="12" oninput="BE.name=this.value">
    <label>封面图标</label><div class="emo-grid">${BOOK_ICONS.map(e => `<i class="${e === BE.icon ? 'on' : ''}" onclick="BE.icon='${e}';renderBookSheet()">${e}</i>`).join('')}</div>
    ${BE.id ? `<div class="cat-n">${BE.id === S.curBook ? '这是当前账本' : `<a onclick="switchBook('${BE.id}')" style="color:var(--c)">切换到这个账本 ›</a>`}</div>` : ''}
    <div class="btn-row">${BE.id && S.books.length > 1 ? `<button class="btn ghost del" onclick="delBook()">删除</button><button class="btn ghost" onclick="bookMergeSheet()">合并到…</button>` : ''}<button class="btn" onclick="saveBook()">保存</button></div>`);
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
