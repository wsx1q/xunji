'use strict';
/* 流水页与筛选栏 */
const L = { kind: 'month', ref: Date.now(), type: 'all', q: '', cat: '', member: '', note: '', s: 0, e: Infinity, label: '', limit: 200, F: normBoard({}) };
const L0 = { type: 'all', q: '', cat: '', exact: false, member: '', note: '', limit: 200 };
const LIST_PAGE = 200;
function showList() { stack[stack.length - 1].name === 'list' ? render() : go('list'); }
function openList(kind, cat = '') { Object.assign(L, L0, { kind, ref: Date.now(), cat, limit: LIST_PAGE, F: normBoard({}) }); showList(); }
/* 搜索历史：搜索框失去焦点（按回车 / 点别处）时记下关键词，最多 8 个；搜索框为空且获得焦点时显示 */
const Q_HIST_MAX = 8;
const qHist = () => (Array.isArray(S.settings.searchHist) ? S.settings.searchHist : []);
function qHistAdd(v) {
  v = (v || '').trim();
  if (!v || qHist()[0] === v) return;
  S.settings.searchHist = [v, ...qHist().filter(x => x !== v)].slice(0, Q_HIST_MAX);
  save();
}
function qHistShow(on) {
  const box = $('#qhist'), q = $('#q'); if (!box) return;
  const list = qHist();
  if (!on || !list.length || (q && q.value.trim()) || document.activeElement !== q) { box.innerHTML = ''; return; }
  // 按下时 preventDefault，搜索框不会先失去焦点把列表收起来
  box.innerHTML = `<div class="qh-hd"><span>最近搜索</span><a onpointerdown="event.preventDefault()" onclick="S.settings.searchHist=[];save();qHistShow(false)">清除</a></div>
    <div class="qh-list">${list.map(v => `<i class="chip" data-v="${esc(v)}" onpointerdown="event.preventDefault()" onclick="qHistUse(this.dataset.v)"><span>${esc(v)}</span><b class="qh-x" onclick="event.stopPropagation();qHistDel(this.parentNode.dataset.v)">✕</b></i>`).join('')}</div>`;
}
/** 删掉一个历史关键词（右上角 ✕），列表留着继续选 */
function qHistDel(v) {
  S.settings.searchHist = qHist().filter(x => x !== v);
  save();
  qHistShow(true);
}
function qHistUse(v) {
  const q = $('#q'); if (q) { q.value = v; q.blur(); }
  L.q = v; L.limit = LIST_PAGE; renderListBody();
}
function openSearch() { Object.assign(L, L0, { kind: 'all', limit: LIST_PAGE, F: normBoard({}) }); tab('list'); setTimeout(() => $('#q') && $('#q').focus(), 50); }

/* ---------- 流水页筛选栏：像 Excel 表头的下拉筛选，条件和自定义看板同一套（L.F 结构同 normBoard），随时改、可存成看板 ---------- */
const lfDates = () => !!(L.F.start || L.F.end);
const shortYmd = v => v.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, '$1.$2.$3');
const lfWhenShort = () => L.F.start && L.F.end ? `${shortYmd(L.F.start)}–${shortYmd(L.F.end)}` : L.F.start ? `${shortYmd(L.F.start)}起` : L.F.end ? `至${shortYmd(L.F.end)}` : '';
const LF_FIELDS = {
  time: { icon: '🕘', name: '时间', val: lfWhenShort, pick: () => pickBdTime(), clear: () => { L.F.start = L.F.end = ''; } },
  cats: { icon: '🗂️', name: '分类', val: () => (L.F.cats.length ? namesText(L.F.cats.map(id => catById(id).name)) : ''), pick: () => pickBdCats(), clear: () => { L.F.cats = []; } },
  accs: { icon: '💳', name: '账户', val: () => (L.F.accs.length ? namesText(L.F.accs.map(accName)) : ''), pick: () => pickBdAccs(), clear: () => { L.F.accs = []; } },
  members: { icon: '👥', name: '成员', val: () => (L.F.members.length ? namesText(L.F.members) : ''), pick: () => pickBdTags('member'), clear: () => { L.F.members = []; } },
  merchants: { icon: '🏪', name: '商家', val: () => (L.F.merchants.length ? namesText(L.F.merchants.map(m => m || '无商家')) : ''), pick: () => pickBdTags('merchant'), clear: () => { L.F.merchants = []; } },
  projects: { icon: '📁', name: '项目', val: () => (L.F.projects.length ? namesText(L.F.projects.map(m => m || '无项目')) : ''), pick: () => pickBdTags('project'), clear: () => { L.F.projects = []; } },
  amount: { icon: '💎', name: '金额', val: () => amountText(L.F).replace(' 元', ''), pick: () => pickLfAmount(), clear: () => { L.F.min = L.F.max = ''; } },
  note: { icon: '📝', name: '备注', val: () => (L.F.note ? `含“${L.F.note}”` : ''), pick: () => pickLfNote(), clear: () => { L.F.note = ''; } },
};
const lfActive = () => Object.keys(LF_FIELDS).filter(k => LF_FIELDS[k].val());
/** 复用看板编辑的选择面板：选择期间让 BD 指向 L.F，面板里的「确定」会 render() 回到流水页 */
function lfPick(k) { L.F.type = L.type; BD = L.F; L.limit = LIST_PAGE; LF_FIELDS[k].pick(); }
function lfClear(k, ev) { if (ev) ev.stopPropagation(); LF_FIELDS[k].clear(); L.limit = LIST_PAGE; render(); }
function lfClearAll() { L.F = normBoard({}); L.cat = L.member = L.note = ''; L.limit = LIST_PAGE; render(); }
function pickLfAmount() {
  const quick = (n, a, b) => `<i class="chip ${L.F.min === a && L.F.max === b ? 'on' : ''}" onclick="L.F.min=${a === '' ? "''" : a};L.F.max=${b === '' ? "''" : b};L.limit=${LIST_PAGE};closeSheet();render()">${n}</i>`;
  openSheet('金额区间', `<div class="chips" style="flex-wrap:wrap;margin-bottom:10px">${quick('小于 0（负数）', '', -0.01)}${quick('大于 0', 0.01, '')}</div>
    <div class="btn-row"><input id="lfMin" class="field" type="number" inputmode="decimal" placeholder="最低（不限）" value="${L.F.min}">
    <input id="lfMax" class="field" type="number" inputmode="decimal" placeholder="最高（不限）" value="${L.F.max}"></div>
    <div class="tip" style="margin-top:0">可以填负数，比如最高填 -0.01 就是只看负数金额的记录</div>
    <div class="btn-row"><button class="btn ghost" onclick="L.F.min=L.F.max='';closeSheet();render()">不限</button>
    <button class="btn" onclick="lfAmountOk()">确定</button></div>`);
  setTimeout(() => $('#lfMin') && $('#lfMin').focus(), 150);
}
function lfAmountOk() {
  const a = $('#lfMin').value.trim(), b = $('#lfMax').value.trim();
  const min = a === '' ? '' : r2(+a), max = b === '' ? '' : r2(+b);
  if ((min !== '' && Number.isNaN(min)) || (max !== '' && Number.isNaN(max))) return toast('金额请填写数字');
  if (min !== '' && max !== '' && max < min) return toast('最高金额不能小于最低金额');
  L.F.min = min; L.F.max = max; L.limit = LIST_PAGE; closeSheet(); render();
}
function pickLfNote() {
  openSheet('备注包含', `<input id="lfNote" class="field" placeholder="备注关键词" maxlength="20" value="${esc(L.F.note)}" onkeydown="if(event.key==='Enter')lfNoteOk()">
    <div class="btn-row"><button class="btn ghost" onclick="L.F.note='';closeSheet();render()">不限</button><button class="btn" onclick="lfNoteOk()">确定</button></div>`);
  setTimeout(() => $('#lfNote') && $('#lfNote').focus(), 150);
}
function lfNoteOk() { L.F.note = $('#lfNote').value.trim(); closeSheet(); render(); }
/** 当前筛选存成首页看板：带上类型、时间段（自定义日期）和所有条件，进看板编辑页起名保存 */
function lfSaveBoard() {
  const f = JSON.parse(JSON.stringify(L.F));
  if (L.cat && !f.cats.includes(L.cat)) f.cats.push(L.cat);
  if (L.member && !f.members.includes(L.member)) f.members.push(L.member);
  if (L.note && !f.note) f.note = L.note;
  BD = normBoard({ ...f, id: '', name: '', type: L.type });
  go('boardEdit');
  toast(lfDates() ? '已带入当前筛选条件，起个名字保存' : '已带入当前筛选条件（时间为不限，可在这里设置）');
}
function lfBar() {
  const act = lfActive(), extra = !!(L.cat || L.member || L.note);
  const chip = k => {
    const f = LF_FIELDS[k], v = f.val();
    return `<i class="chip fc ${v ? 'on' : ''}" onclick="lfPick('${k}')">${v ? `${f.name}：${esc(v)}<b class="fx" onclick="lfClear('${k}',event)">✕</b>` : `${f.icon} ${f.name} ▾`}</i>`;
  };
  // 已生效的条件排在前面，不用横向滑才看得到
  const keys = [...act, ...Object.keys(LF_FIELDS).filter(k => !act.includes(k))];
  return `<div class="chips lf">${act.length || extra ? `<i class="chip fc clr" onclick="lfClearAll()">清除全部</i>` : ''}${keys.map(chip).join('')}
    <i class="chip fc sv" onclick="lfSaveBoard()">⭐ 存为看板</i></div>`;
}
function shiftL(dir) { L.ref = shiftRef(L.kind, L.ref, dir); L.limit = LIST_PAGE; render(); }
Pages.list = () => {
  const kinds = [['day', '日'], ['week', '周'], ['month', '月'], ['year', '年'], ['all', '全部']];
  return `<div class="l-hd grad">${stack.length > 1 ? '<b class="l-bk" onclick="back()">‹</b>' : ''}
    <div class="seg">${kinds.map(([k, n]) => `<i class="${!lfDates() && L.kind === k ? 'on' : ''}" onclick="L.kind='${k}';L.ref=Date.now();L.F.start=L.F.end='';L.limit=${LIST_PAGE};render()">${n}</i>`).join('')}</div>
    <div class="period">${lfDates() ? `<span onclick="lfPick('time')">${esc(whenText(L.F))}</span>` : L.kind === 'custom' ? `<span>${esc(L.label)}</span>` : L.kind === 'all' ? '<span>全部时间</span>' : `<b onclick="shiftL(-1)">‹</b><span class="pp" onclick="periodSheet(L.kind,L.ref,t=>{L.ref=t;L.limit=LIST_PAGE;render()})">${periodLabel(L.kind, L.ref)}</span><b class="${isFuture(L.kind, L.ref) ? 'dis' : ''}" onclick="shiftL(1)">›</b>`}</div>
    <div class="sum3" id="lsum"></div></div>
  <div class="filters"><input id="q" class="search" placeholder="搜索备注 / 分类 / 账户 / 商家 / 项目 / 金额" value="${esc(L.q)}" oninput="L.q=this.value;L.limit=${LIST_PAGE};clearTimeout(L._qt);L._qt=setTimeout(renderListBody,180);qHistShow(true)"
      onfocus="qHistShow(true)" onblur="qHistAdd(this.value);setTimeout(()=>qHistShow(false),200)" onkeydown="if(event.key==='Enter')this.blur()" enterkeyhint="search">
    <div id="qhist" class="qhist"></div>
    <div class="chips">${[['all', '全部'], ['expense', '支出'], ['income', '收入'], ['transfer', '转账'], ['adjust', '余额变更']].map(([k, n]) => `<i class="chip ${L.type === k ? 'on' : ''}" onclick="L.type='${k}';L.limit=${LIST_PAGE};render()">${n}</i>`).join('')}
    ${L.cat ? `<i class="chip on" onclick="L.cat='';L.limit=${LIST_PAGE};render()">${catById(L.cat).icon} ${esc(catLabel(L.cat))}${L.exact && subsOf(L.cat).length ? '（未细分）' : ''} ✕</i>` : ''}
    ${L.member ? `<i class="chip on" onclick="L.member='';L.limit=${LIST_PAGE};render()">👤 ${esc(L.member)} ✕</i>` : ''}
    ${L.note ? `<i class="chip on" onclick="L.note='';L.limit=${LIST_PAGE};render()">📝 备注含“${esc(L.note)}” ✕</i>` : ''}
    <i class="chip selc" onclick="SEL?selEnd():selStart()">☑ ${SEL ? '退出多选' : '多选'}</i></div>
    ${lfBar()}</div>
  <div id="lbody" class="${SEL ? 'selm' : ''}"></div><div id="lsel"></div>`;
};
function matchListTx(t, s, e, q, fm) {
  if (t.time < s || t.time >= e) return false;
  if (fm && !fm(t)) return false;
  if (L.type !== 'all' && t.type !== L.type) return false;
  if (!matchTx(t, L.member, L.note)) return false;
  if (L.cat && !(L.exact ? t.catId === L.cat : inCat(t.catId, L.cat))) return false;
  // q 已经转成小写：英文不分大小写
  if (q && !(hasText(t.note, q) || hasText(catLabel(t.catId), q) || hasText(accName(t.accountId), q) || String(t.amount).includes(q) || hasText(t.member, q) || hasText(t.merchant, q) || hasText(t.project, q))) return false;
  return true;
}
function renderListBody(append) {
  clearTimeout(L._qt);
  if (!$('#lbody')) return;
  ensureTxnOrder();
  const [s, e] = lfDates() ? boardRange(L.F) : L.kind === 'custom' ? [L.s, L.e] : periodRange(L.kind, L.ref);
  const q = L.q.trim().toLowerCase();
  // 筛选栏的条件（类型由上面的类型按钮管，这里不重复判断）
  const fm = lfActive().some(k => k !== 'time') ? boardMatch({ ...L.F, type: 'all' }) : null;
  const shown = [], ids = [];
  let inc = 0, exp = 0, tf = 0;
  // 先用二分定位时间范围，再做关键词和其他筛选，避免按月查看仍扫描整个账本。
  for (const t of inRange(bookTx(), s, e)) {
    if (!matchListTx(t, s, e, q, fm)) continue;
    shown.push(t);
    ids.push(t.id);
    if (t.type === 'income') inc += t.amount;
    else if (t.type === 'expense') exp += t.amount;
    else tf += t.amount;
  }
  $('#lsum').innerHTML = `<div><small>收入</small><b class="inc">${money(inc)}</b></div><div><small>支出</small><b class="exp">${money(exp)}</b></div><div><small>${L.type === 'transfer' ? '转账' : '结余'}</small><b>${L.type === 'transfer' ? money(tf) : money(inc - exp)}</b></div>`;
  const body = $('#lbody');
  vlMount(body, shown, '', shown.length > 20 ? `<div class="l-more dim">共 ${shown.length} 笔</div>` : '');
  body.classList.toggle('selm', !!SEL);
  L.ids = ids;
  selBar();
}
After.list = () => renderListBody();
