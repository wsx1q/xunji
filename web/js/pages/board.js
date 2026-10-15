'use strict';
/* 自定义看板：编辑与详情 */
let BD = null;
function editBoard(id) {
  const b = id && S.settings.home.boards.find(x => x.id === id);
  BD = normBoard(b ? JSON.parse(JSON.stringify(b)) : {});
  go('boardEdit');
}
Pages.boardEdit = () => {
  if (!BD) { setTimeout(back); return ''; }
  const row = (icon, label, val, fn) => `<div class="fr" onclick="${fn}"><i>${icon}</i><span>${label}</span><b class="${val === '全部' || val === '全部时间' ? '' : 'set'}">${esc(val)}</b><em>›</em></div>`;
  return hdr(BD.id ? '编辑看板' : '新建看板', `<a onclick="saveBoard()" style="font-size:20px">✓</a>`) + `
  <div class="card be">
    <div class="be-name"><small>名称</small><input value="${esc(BD.name)}" placeholder="给看板起个名字，如：4-20" maxlength="12" oninput="BD.name=this.value"></div>
    ${row('🔖', '流水类型', TX_TYPES[BD.type], 'pickBdType()')}
    ${row('🕘', '时间', whenText(BD), 'pickBdTime()')}
    ${row('🗂️', '分类', namesText(BD.cats.map(catLabel)), 'pickBdCats()')}
    ${row('💳', '账户', namesText(BD.accs.map(accName)), 'pickBdAccs()')}
    <div class="fr"><i>💎</i><span>金额区间</span><input class="be-num" type="number" inputmode="decimal" value="${BD.min}" placeholder="不限" oninput="BD.min=this.value"><small>–</small><input class="be-num" type="number" inputmode="decimal" value="${BD.max}" placeholder="不限" oninput="BD.max=this.value"></div>
    ${row('🏪', '商家', namesText(BD.merchants.map(m => m || '无商家')), "pickBdTags('merchant')")}
    ${row('📁', '项目', namesText(BD.projects.map(m => m || '无项目')), "pickBdTags('project')")}
    ${row('👥', '成员', namesText(BD.members), "pickBdTags('member')")}
    <div class="fr"><i>📝</i><span>备注</span><input class="be-note" value="${esc(BD.note)}" placeholder="填写备注关键词" maxlength="20" oninput="BD.note=this.value"></div>
  </div>
  <div class="ver">所有条件同时满足的流水才会被统计；没设置的条件表示不限</div>
  ${BD.id ? `<div class="ver"><a style="color:#E5484D" onclick="delBoard()">删除这个看板</a></div>` : ''}
  <div style="height:76px"></div>
  <div class="be-btns"><button class="btn" onclick="saveBoard()">保存看板</button><button class="btn ghost" onclick="resetBd()">重置</button></div>`;
};
function pickBdType() {
  openSheet('流水类型', Object.entries(TX_TYPES).map(([k, n]) => `<div class="opt ${BD.type === k ? 'on' : ''}" onclick="BD.type='${k}';closeSheet();render()"><span>${n}</span></div>`).join(''));
}
function pickBdTime() {
  const now = Date.now(), d30 = sod(now) - 29 * 864e5;
  const presets = [['不限', '', ''], ['本月', ymd(periodRange('month')[0]), ''], ['上月', ...periodRange('month', shiftRef('month', now, -1)).map((t, i) => ymd(i ? t - 864e5 : t))],
    ['本年', ymd(periodRange('year')[0]), ''], ['近 30 天', ymd(d30), ''], ['近 90 天', ymd(sod(now) - 89 * 864e5), '']];
  openSheet('时间', `<div class="chips" style="flex-wrap:wrap">${presets.map(([n, s, e]) => `<i class="chip ${BD.start === s && BD.end === e ? 'on' : ''}" onclick="BD.start='${s}';BD.end='${e}';pickBdTime()">${n}</i>`).join('')}</div>
    <label>开始日期（留空表示不限）</label><div class="btn-row"><b class="field pick" onclick="pickBdDate('start','开始日期')">${BD.start || '不限'}</b><b class="clr" onclick="BD.start='';pickBdTime()">清空</b></div>
    <label>结束日期（留空表示至今，含当天）</label><div class="btn-row"><b class="field pick" onclick="pickBdDate('end','结束日期')">${BD.end || '至今'}</b><b class="clr" onclick="BD.end='';pickBdTime()">清空</b></div>
    <button class="btn" onclick="if(BD.start&&BD.end&&BD.end<BD.start)return toast('结束日期不能早于开始日期');closeSheet();render()">确定</button>`);
}
function pickBdDate(field, title) {
  dateSheet(title, BD[field], v => { BD[field] = v; pickBdTime(); }, { allowEmpty: true });
}
function multiSheet(title, field, items) {
  const y = $('.sh-bd') ? $('.sh-bd').scrollTop : 0;
  const sel = BD[field];
  openSheet(title, items + `<div class="btn-row ms-ok"><button class="btn ghost" onclick="BD['${field}']=[];closeSheet();render()">全部（不限）</button><button class="btn" onclick="closeSheet();render()">确定${sel.length ? '（' + sel.length + '）' : ''}</button></div>`);
  if (y) $('.sh-bd').scrollTop = y;
}
function toggleBd(field, v, again) {
  const a = BD[field], i = a.indexOf(v);
  i >= 0 ? a.splice(i, 1) : a.push(v);
  // 就地切换选中态和「确定（n）」，不重建弹窗内容
  const chip = [...document.querySelectorAll('#sheet [data-v]')].find(c => c.dataset.v === v); // 分类标签或账户 / 标签列表行
  const ok = [...document.querySelectorAll('#sheet .btn')].find(b => b.textContent.startsWith('确定'));
  if (chip && ok) { chip.classList.toggle('on', i < 0); ok.textContent = '确定' + (a.length ? '（' + a.length + '）' : ''); return; }
  again();
}
/** 分类筛选面板：和记一笔、分类管理同一套分类网格（catGridHtml），短按选择，长按编辑 */
function pickBdCats() {
  const types = BD.type === 'income' ? ['income'] : BD.type === 'expense' ? ['expense'] : ['expense', 'income'];
  _catPickReopen = () => BD && pickBdCats();
  for (const tp of types) {
    const st = CGS['multi-' + tp] || (CGS['multi-' + tp] = { type: tp, mode: 'multi', open: '' });
    Object.assign(st, { sel: BD.cats, toggle: pickBdCat, rerender: pickBdCats });
  }
  multiSheet('分类（可多选）', 'cats', `<div class="tip" style="margin:0 0 4px">✓ 表示整类选中，− 表示只选了部分二级分类。点一级分类选中整类，再点二级分类可细选；数字是记录笔数，长按可编辑</div>`
    + types.map(tp => `${types.length > 1 ? `<label>${tp === 'expense' ? '支出分类' : '收入分类'}</label>` : ''}<div class="cg-box">${catGridHtml('multi-' + tp)}</div>`).join(''));
}
function pickBdCat(id) {
  const c = catById(id);
  // 已选整个一级分类时点它的二级分类：改成只选这个二级分类
  if (c.pid && BD.cats.includes(c.pid)) BD.cats = BD.cats.filter(x => x !== c.pid);
  // 选中整个一级分类时去掉已单独选的二级分类（已经包含在内）
  if (!c.pid && !BD.cats.includes(id)) BD.cats = BD.cats.filter(x => catById(x).pid !== id);
  const i = BD.cats.indexOf(id);
  i >= 0 ? BD.cats.splice(i, 1) : BD.cats.push(id);
  pickBdCats();
}
/** 账户多选：和记账时选账户同一个列表（accRows），选中的打 ✓ */
function pickBdAccs() {
  _pickReopen = pickBdAccs;
  multiSheet('账户（可多选）', 'accs', accRows(id => BD.accs.includes(id), id => `toggleBd('accs','${id}',pickBdAccs)`, '', true));
}
/** 成员 / 商家 / 项目多选：和记账时选的同一个列表（tagRows） */
function pickBdTags(f) {
  const T = TAGS[f], sel = BD[T.list], opts = (T.def ? [] : ['']).concat(S[T.list]);
  sel.filter(v => !opts.includes(v)).forEach(v => opts.push(v));
  _pickReopen = () => pickBdTags(f);
  multiSheet(`${T.name}（可多选）`, T.list, tagRows(f, opts, m => sel.includes(m), `toggleBd('${T.list}',this.dataset.v,()=>pickBdTags('${f}'))`, '无' + T.name, true));
}
function resetBd() { BD = normBoard({ id: BD.id, name: BD.name, goal: BD.goal }); render(); toast('已重置筛选条件'); }
function saveBoard() {
  const name = (BD.name || '').trim(); if (!name) return toast('请输入看板名称');
  if (BD.start && BD.end && BD.end < BD.start) return toast('结束日期不能早于开始日期');
  const min = BD.min === '' ? '' : r2(+BD.min), max = BD.max === '' ? '' : r2(+BD.max);
  if ((min !== '' && Number.isNaN(min)) || (max !== '' && Number.isNaN(max))) return toast('金额请填写数字');
  if (min !== '' && max !== '' && max < min) return toast('最高金额不能小于最低金额');
  const rec = normBoard({ ...BD, id: BD.id || 'c' + uid(), name, min, max, note: BD.note.trim() });
  const list = S.settings.home.boards, i = list.findIndex(x => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  const w = S.settings.home.widgets.find(x => x.id === 'periods'); if (w) w.on = true;
  save(); BD = null; back(); toast('已保存');
}
function delBoard() {
  askConfirm(`删除看板「${esc(BD.name)}」？`, () => {
    S.settings.home.boards = S.settings.home.boards.filter(x => x.id !== BD.id); save(); BD = null;
    while (stack.length > 1 && ['board', 'boardEdit'].includes(stack[stack.length - 1].name)) stack.pop();
    render(); toast('已删除');
  }, '删除');
}

/* ================= 自定义看板：详情 ================= */
const BV = { group: 'month', time: 'month', open: {}, fold: {}, lim: {} };
const BV_GROUPS = {
  day: { name: '日', time: true, outer: t => periodRange('month', t.time)[0], outerLabel: k => `${new Date(k).getFullYear()}年${new Date(k).getMonth() + 1}月`, key: t => sod(t.time), label: k => { const d = new Date(k); return [`${d.getDate()}日`, `周${WEEK[d.getDay()]}`]; } },
  month: { name: '月', time: true, outer: t => new Date(t.time).getFullYear(), outerLabel: k => `${k}年`, key: t => periodRange('month', t.time)[0], label: k => { const d = new Date(k); return [`${d.getMonth() + 1}月`, `${d.getFullYear()}`]; } },
  year: { name: '年', time: true, key: t => new Date(t.time).getFullYear(), label: k => [`${k}年`, ''] },
  cat: { name: '分类', key: t => t.type === 'transfer' ? '_t' : t.type === 'adjust' ? '_a' : topOf(t.catId).id, label: k => { if (k === '_t') return ['🔁 转账', '']; if (k === '_a') return ['↕️ 余额变更', '']; const c = catById(k); return [`${c.icon} ${c.name}`, '']; } },
  acc: { name: '账户', key: t => t.accountId, label: k => { const a = accById(k); return [a ? `${accIcon(a)} ${a.name}` : '未知账户', '']; } },
  member: { name: '成员', key: t => t.member || '本人', label: k => [`👤 ${k}`, ''] },
  project: { name: '项目', key: t => t.project || '', label: k => [k ? `📁 ${k}` : '无项目', ''] },
  merchant: { name: '商家', key: t => t.merchant || '', label: k => [k ? `🏪 ${k}` : '无商家', ''] }
};
const BV_PAGE = 100;
function boardData(key, tx, G) {
  tx.sort((x, y) => y.time - x.time);
  const sum = list => { let i = 0, e = 0; for (const t of list) { if (t.type === 'income') i += t.amount; else if (t.type === 'expense') e += t.amount; } return { i: r2(i), e: r2(e), n: list.length }; };
  const map = new Map();
  for (const t of tx) {
    const ok = G.outer ? G.outer(t) : '', k = G.key(t);
    if (!map.has(ok)) map.set(ok, new Map());
    const m = map.get(ok); if (!m.has(k)) m.set(k, []); m.get(k).push(t);
  }
  const sections = [...map].map(([ok, m]) => {
    const groups = [...m].map(([k, list]) => ({ k, list, s: sum(list) }));
    if (!G.time) groups.sort((a, c) => (c.s.i + c.s.e) - (a.s.i + a.s.e));
    return { k: ok, groups, s: sum(groups.flatMap(g => g.list)) };
  });
  return { key, tx, inc: sumT(tx, 'income'), exp: sumT(tx, 'expense'), sections };
}
function openBoard(id) { BV.open = {}; BV.fold = {}; BV.lim = {}; go('board', id); }
Pages.board = id => {
  const b = S.settings.home.boards.find(x => x.id === id && x.custom);
  if (!b) { setTimeout(back); return ''; }
  const o = boardOf(b), G = BV_GROUPS[BV.group];
  const ck = `${JSON.stringify(b)}|${o.s}|${o.e}|${BV.group}`;
  let C = _cache.bv;
  if (!C || C.key !== ck) C = _cache.bv = boardData(ck, inRange(bookTx(), o.s, o.e).filter(o.match), G);
  const { tx, inc, exp } = C;
  const isInc = b.type === 'income', base = isInc ? inc : exp, gName = isInc ? '收入' : '支出';
  let goal;
  if (b.goal) {
    const p = base / b.goal, over = !isInc && p > 1;
    goal = `<div class="card-hd"><b>目标</b><a onclick="setBoardGoal('${b.id}')">修改 ✎</a></div>
      <div class="prog"><i style="width:${Math.min(100, p * 100)}%;background:${over ? '#E5484D' : 'var(--c)'}"></i></div>
      <div class="bv-gt"><span>${gName} ${money(base)} / ${money(b.goal)}</span><span class="${over ? 'over' : ''}">${isInc ? (p >= 1 ? '已达成 🎉' : '还差 ' + money(b.goal - base)) : (over ? '超出 ' + money(base - b.goal) : '剩余 ' + money(b.goal - base))}</span></div>`;
  } else goal = `<div class="card-hd"><b>目标</b></div><div class="bv-gt" style="justify-content:flex-start;gap:6px">未设置目标 <a onclick="setBoardGoal('${b.id}')" style="color:var(--c)">点此设置</a></div>`;
  // 外层分组（按日时的月份、按月时的年份）默认只展开最近两组，展开的明细分段渲染，数据多时页面才不卡
  let body = '';
  C.sections.forEach((sec, si) => {
    const fk = `${BV.group}|${sec.k}`, folded = BV.fold[fk] ?? (!!G.outer && si >= 2);
    if (G.outer) body += `<div class="bg-hd" data-k="${esc(fk)}" data-fs="${esc(G.outerLabel(sec.k))}" onclick="BV.fold[this.dataset.k]=${!folded};render()"><b>${G.outerLabel(sec.k)}</b><span>结余 ${money(sec.s.i - sec.s.e)}</span><em class="${folded ? '' : 'up'}">⌃</em></div>`;
    if (folded) return;
    body += sec.groups.map(({ k, list, s }) => {
      const [l1, l2] = G.label(k), gk = `${BV.group}|${sec.k}|${k}`, open = BV.open[gk], lim = BV.lim[gk] || BV_PAGE;
      const more = open && list.length > lim ? `<div class="l-more" data-k="${esc(gk)}" onclick="BV.lim[this.dataset.k]=${lim + BV_PAGE * 3};render()">已显示 ${lim} / ${list.length} 笔，点击再显示</div>` : '';
      return `<div class="bg-row" data-k="${esc(gk)}" data-fs="${esc(l1)} ${esc(l2)}" onclick="BV.open[this.dataset.k]=!BV.open[this.dataset.k];render()">
        <div class="bg-l"><b>${esc(l1)}</b><small>${esc(l2)}</small></div>
        <div class="bg-m"><b class="num">${money(s.i - s.e)}</b><small><span class="inc">收入 ${money(s.i)}</span> | <span class="exp">支出 ${money(s.e)}</span> · ${s.n}笔</small></div>
        <em class="${open ? 'up' : ''}">⌄</em></div>${open ? `<div class="bg-tx">${list.slice(0, lim).map(t => txItem(t, { date: true })).join('')}${more}</div>` : ''}`;
    }).join('');
  });
  const customs = S.settings.home.boards.filter(x => x.custom);
  const timeOn = BV_GROUPS[BV.group].time;
  const bar = [['time', `${BV_GROUPS[BV.time].name} ▾`, timeOn, timeOn ? 'pickBvTime()' : `BV.group=BV.time;render()`],
    ['cat', '分类', BV.group === 'cat', "BV.group='cat';render()"], ['acc', '账户', BV.group === 'acc', "BV.group='acc';render()"],
    ['project', '项目', BV.group === 'project', "BV.group='project';render()"],
    ['more', `${['member', 'merchant'].includes(BV.group) ? BV_GROUPS[BV.group].name : '更多'} ▾`, ['member', 'merchant'].includes(BV.group), 'pickBvMore()']];
  return `<header class="bar"><b class="bk" onclick="back()">‹</b><h1 onclick="${customs.length > 1 ? 'pickBoardView()' : ''}">${esc(b.name)}${customs.length > 1 ? ' ▾' : ''}</h1><div class="bar-r"><a onclick="editBoard('${b.id}')">筛选</a></div></header>
  <div class="hero grad"><small>结余</small><div class="big">${money(inc - exp)}</div>
    <div class="hd-sub"><span>收入 ${money(inc)}</span><span>支出 ${money(exp)}</span><span>${tx.length} 笔</span></div>
    <div class="bv-sub">${esc(o.sub)}</div></div>
  <div class="card bv-goal">${goal}</div>
  <div class="card bv-list">${body || empty('没有符合条件的流水', '🔍')}</div>
  <div style="height:64px"></div>
  <nav class="bv-bar">${bar.map(([, n, on, fn]) => `<a class="${on ? 'on' : ''}" onclick="${fn}">${n}</a>`).join('')}</nav>`;
};
function pickBvTime() {
  openSheet('按时间分组', ['day', 'month', 'year'].map(k => `<div class="opt ${BV.time === k ? 'on' : ''}" onclick="BV.time=BV.group='${k}';closeSheet();render()"><span>按${BV_GROUPS[k].name}</span></div>`).join(''));
}
function pickBvMore() {
  openSheet('更多分组', ['member', 'merchant'].map(k => `<div class="opt ${BV.group === k ? 'on' : ''}" onclick="BV.group='${k}';closeSheet();render()"><span>按${BV_GROUPS[k].name}</span></div>`).join(''));
}
function pickBoardView() {
  const cur = stack[stack.length - 1].p;
  openSheet('切换看板', S.settings.home.boards.filter(x => x.custom).map(x => `<div class="opt ${x.id === cur ? 'on' : ''}" onclick="BV.open={};BV.fold={};BV.lim={};stack[stack.length-1].p='${x.id}';closeSheet();render();scrollTo(0,0)"><div class="ci">⏱</div><span>${esc(x.name)}</span></div>`).join(''));
}
function setBoardGoal(id) {
  const b = S.settings.home.boards.find(x => x.id === id);
  numberSheet(`设置${b.type === 'income' ? '收入' : '支出'}目标（填 0 清除）`, b.goal, v => { b.goal = v; save(); render(); });
}
function toggleQ(k) {
  const q = S.settings.home.quick, i = q.indexOf(k);
  if (i >= 0) q.splice(i, 1); else if (q.length >= 12) return toast('最多 12 个'); else q.push(k);
  save(); render();
}
function pickBook() {
  const n = countBy(t => t.bookId);
  openSheet('切换账本', S.books.map(b => `<div class="opt ${b.id === S.curBook ? 'on' : ''}" onclick="switchBook('${b.id}')"><div class="ci">${b.icon}</div><span>${esc(b.name)}</span><em>${n.get(b.id) || 0} 笔</em></div>`).join('')
    + `<button class="btn" onclick="closeSheet();go('books')">管理账本</button>`);
}
function switchBook(id) { S.curBook = id; save(); closeSheet(); render(); toast('已切换到「' + curBook().name + '」'); }
