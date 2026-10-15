'use strict';
/* 首页与首页看板设置 */
function homeMonthLedger(type='all', cat='') {
  openLedgerDetails({kind:'month',type,cat,catUnknown:cat===''&&arguments.length>1});
}
function homeRangeLedger(s,e,type='expense',filters={},sourceType='all') {
  const label=s<=0&&e===Infinity?'全部时间':e===Infinity?`${ymd(s)} 至今`:s<=0?`截至 ${ymd(e-1)}`:`${ymd(s)} 至 ${ymd(e-1)}`;
  openLedgerDetails({kind:s<=0&&e===Infinity?'all':'custom',s,e,type,filters,sourceType,label});
}
function homeBoardLedger(index,type='all') {
  const b=S.settings.home.boards[index];if(!b)return;
  const o=boardOf(b);
  homeRangeLedger(o.s,o.e,type,b.custom?b:{},b.custom?b.type:'all');
}
function homeAssetLedger(kind='net') {
  const bal=balances(),ids=S.accounts.filter(a=>kind==='net'||(kind==='asset'?bal[a.id]>=0:bal[a.id]<0)).map(a=>a.id);
  openLedgerDetails({scope:'allBooks',accountIds:ids,accountLabel:{net:'全部资产账户',asset:'资产账户',debt:'负债账户'}[kind],
    detailNote:'当前余额含初始余额；以下是对应账户的历史流水，流水收支合计不等于当前余额。'});
}
Pages.home = () => {
  const tx = bookTx(), now = new Date();
  const [ms, me] = periodRange('month');
  const mt = inRange(tx, ms, me);
  const exp = sumT(mt, 'expense'), inc = sumT(mt, 'income');
  const bg = budget(), left = bg.total - exp;
  const pct = bg.total ? exp / bg.total : 0;
  const h = S.settings.home;
  const cards = h.widgets.filter(w => w.on).map(w => HomeW[w.id]({ tx, mt, exp, bg, h })).join('');
  return `<div class="home-hd grad">
    <div class="hd-top"><span class="book" onclick="pickBook()">${curBook().icon} ${esc(curBook().name)} ▾</span><span class="hd-ic" onclick="go('dash')">🧩</span></div>
    <div class="hd-main"><div><small style="opacity:.85">${now.getMonth() + 1}月支出</small><div class="big" role="button" tabindex="0" onclick="homeMonthLedger('expense')">${money(exp)}</div>
      <div class="hd-sub"><span onclick="homeMonthLedger('income')">收入 ${money(inc)}</span><span onclick="homeMonthLedger()">结余 ${money(inc - exp)}</span></div></div>
      <div class="ring" onclick="${bg.total?"homeMonthLedger('expense')":"go('budget')"}">${ringSvg(pct, 'rgba(255,255,255,.28)', left < 0 ? '#FFE14D' : '#fff')}
        <div class="ring-t"><span style="opacity:.85">预算余额</span><b>${bg.total ? money(left, 0) : '去设置'}</b></div></div></div>
  </div>
  <div class="home-w">${cards || `<div class="card">${empty('看板已全部隐藏，点右上角 🧩 添加模块', '🧩')}</div>`}</div>`;
};
const rankRow = (icon, color, name, sub, amt, max, fn, attr = '') => `<div class="rank" onclick="${fn}" ${attr}><div class="ci" style="background:${color}26">${icon}</div>
  <div class="rank-m"><div class="rank-t"><span>${name}<small>${sub}</small></span><b class="num">${money(amt)}</b></div>
  <div class="prog"><i style="width:${max ? amt / max * 100 : 0}%;background:${color}"></i></div></div></div>`;
const HomeW = {
  quick: ({ h }) => `<div class="quick card">${h.quick.map(k => { const [ic, n, fn, bgc] = QUICK[k]; return `<div class="q-i" onclick="${fn}"><i style="background:${bgc}">${ic}</i>${n}</div>`; }).join('')
    || `<div class="q-empty" onclick="go('dash')">点此选择快捷入口</div>`}</div>`,
  periods: ({ tx, h }) => `<div class="card">${h.boards.map((b, index) => {
    const o = boardOf(b), t = inRange(tx, o.s, o.e).filter(o.match);
    return `<div class="prow" onclick="${o.open}"><div class="pic pic-${o.cls}">${o.icon}</div><div class="pm"><b>${esc(o.name)}</b><small>${t.length ? o.sub : (b.id === 'day' ? '还没有记过账' : o.sub)}</small></div>
      <div class="pv"><span class="inc" onclick="event.stopPropagation();homeBoardLedger(${index},'income')">收 ${money(sumT(t, 'income'))}</span><span class="exp" onclick="event.stopPropagation();homeBoardLedger(${index},'expense')">支 ${money(sumT(t, 'expense'))}</span></div></div>`;
  }).join('') || `<div class="empty" style="padding:18px 0" onclick="go('dash')">点此添加时间看板</div>`}</div>`,
  budget: ({ mt, exp, bg }) => {
    const hd = `<div class="card-hd"><b>预算进度</b><a onclick="go('budget')">管理 ›</a></div>`;
    if (!bg.total) return `<div class="card">${hd}<div class="empty" style="padding:18px 0" onclick="go('budget')">还没有设置本月预算，点此设置</div></div>`;
    const p = exp / bg.total, ex = mt.filter(t => t.type === 'expense');
    const cats = Object.entries(bg.cats).map(([id, amt]) => ({ c: catById(id), amt, sp: sumArr(ex.filter(t => inCat(t.catId, id))) })).sort((a, b) => b.sp / b.amt - a.sp / a.amt).slice(0, 3);
    return `<div class="card">${hd}<div class="rank-t" style="padding:4px 0 0" onclick="homeMonthLedger('expense')"><span>总预算<small>已用 ${money(exp)} / ${money(bg.total, 0)}</small></span><b class="num ${p > 1 ? 'over' : ''}">${p > 1 ? '超支 ' + money(exp - bg.total) : '余 ' + money(bg.total - exp)}</b></div>
      <div class="prog" style="margin-bottom:10px" onclick="homeMonthLedger('expense')"><i style="width:${Math.min(100, p * 100)}%;background:${p > 1 ? '#E5484D' : p > 0.8 ? '#FFB300' : 'var(--c)'}"></i></div>
      ${cats.map(({ c, amt, sp }) => rankRow(c.icon, sp > amt ? '#E5484D' : c.color, esc(c.name), `预算 ${money(amt, 0)}`, sp, amt, `homeMonthLedger('expense','${c.id}')`)).join('')}</div>`;
  },
  catTop: ({ mt }) => {
    const g = {};
    mt.filter(t => t.type === 'expense').forEach(t => { const id = topOf(t.catId).id; g[id] = (g[id] || 0) + t.amount; });
    const items = Object.entries(g).map(([id, amt]) => ({ id, c: catById(id), amt: r2(amt) })).sort((a, b) => b.amt - a.amt).slice(0, 5);
    return `<div class="card"><div class="card-hd"><b>本月支出排行</b><a onclick="R.kind='month';R.ref=Date.now();R.type='expense';R.pcat='';tab('report')">报表 ›</a></div>
      ${items.length ? items.map(it => rankRow(it.c.icon, it.c.color, esc(it.c.name), '', it.amt, items[0].amt, `homeMonthLedger('expense','${it.id}')`)).join('') : empty('本月暂无支出', '🏷️')}</div>`;
  },
  trend: ({ tx }) => {
    const today = sod(Date.now()), labels = [], vals = [], clicks = [];
    for (let i = 6; i >= 0; i--) {
      const s = new Date(today); s.setDate(s.getDate() - i);
      const e = new Date(s); e.setDate(e.getDate() + 1);
      clicks.push(`homeRangeLedger(${s.getTime()},${e.getTime()})`);
      labels.push(i ? `${s.getMonth() + 1}/${s.getDate()}` : '今天'); vals.push(sumT(inRange(tx, s.getTime(), e.getTime()), 'expense'));
    }
    const total = r2(vals.reduce((a, b) => a + b, 0));
    const start=new Date(today);start.setDate(start.getDate()-6);const end=new Date(today);end.setDate(end.getDate()+1);
    return `<div class="card" onclick="homeRangeLedger(${start.getTime()},${end.getTime()})"><div class="card-hd"><b>近 7 日支出</b><small>合计 ${money(total)} · 日均 ${money(total / 7)}</small></div>
      ${barChart([{ vals, color: S.settings.swap ? '#F0533A' : '#19A35B' }], labels,1,clicks)}</div>`;
  },
  assets: () => {
    const bal = balances(); let asset = 0, debt = 0;
    S.accounts.forEach(a => { const v = bal[a.id]; v >= 0 ? asset += v : debt -= v; });
    const list = accTops().map(a => [a, accSum(a.id, bal)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
    return `<div class="card"><div class="card-hd"><b>资产概览</b><a onclick="go('accounts')">全部账户 ›</a></div>
      <div class="sum3 asset3"><div onclick="homeAssetLedger('net')"><small>净资产</small><b>${money(asset - debt)}</b></div><div onclick="homeAssetLedger('asset')"><small>总资产</small><b>${money(asset)}</b></div><div onclick="homeAssetLedger('debt')"><small>总负债</small><b>${money(debt)}</b></div></div>
      ${list.map(([a, v]) => `<div class="acc" onclick="go('account','${a.id}')"><div class="ci">${accIcon(a)}</div><span>${esc(a.name)}</span><b class="${v < 0 ? 'over' : ''}">${money(v)}</b></div>`).join('')}</div>`;
  },
  members: ({ mt }) => {
    const g = {};
    mt.filter(t => t.type === 'expense').forEach(t => { const m = t.member || '本人'; g[m] = (g[m] || 0) + t.amount; });
    const items = Object.entries(g).map(([m, amt]) => ({ m, amt: r2(amt) })).sort((a, b) => b.amt - a.amt);
    const total = items.reduce((a, x) => a + x.amt, 0);
    return `<div class="card"><div class="card-hd"><b>本月成员支出</b><a onclick="manageMembers()">成员 ›</a></div>
      ${items.length ? items.map((it, i) => rankRow('👤', COLORS[(i * 3) % COLORS.length], esc(it.m), (it.amt / total * 100).toFixed(1) + '%', it.amt, items[0].amt,
      'openList(\'month\');L.type=\'expense\';L.member=this.dataset.m;render()', `data-m="${esc(it.m)}"`)).join('') : empty('本月暂无支出', '👥')}</div>`;
  },
  recent: ({ tx, h }) => {
    ensureTxnOrder();
    const recent = tx.slice(0, h.recentN);
    return `<div class="card"><div class="card-hd"><b>最近记录</b><a onclick="openList('all')">全部 ›</a></div>
      ${recent.length ? recent.map(t => txItem(t, { date: true })).join('') : empty('还没有记账，点击下方 ＋ 记一笔')}</div>`;
  }
};

/* ================= 首页看板设置 ================= */
Pages.dash = () => {
  const h = S.settings.home;
  const unused = Object.keys(BOARDS).filter(k => !h.boards.some(b => b.id === k));
  return hdr('首页看板', `<a onclick="editBoard()" style="font-size:22px">＋</a>`) + `
  <div class="sec-t">首页时间看板 <small>长按拖动排序</small></div>
  <div class="card">${h.boards.map((b, i) => {
    const o = boardOf(b);
    return `<div class="dw" data-lp="homeboard" data-lpid="${esc(b.id)}"><em class="rm" onclick="rmBoard(${i})">−</em><div class="pic pic-${o.cls}">${o.icon}</div>
      <span ${b.custom ? `onclick="editBoard('${b.id}')"` : ''}>${esc(o.name)}${b.custom ? ' <u>编辑</u>' : ''}<small>${esc(o.sub)}</small></span>
      <span class="home-drag-handle" aria-hidden="true">⠿</span></div>`;
  }).join('') || empty('首页没有时间看板，从下方添加', '🗓️')}</div>
  <div class="sec-t">可添加看板</div>
  <div class="card">${unused.map(k => { const o = boardOf({ id: k }); return `<div class="dw" onclick="S.settings.home.boards.push({id:'${k}'});save();render()"><em class="ad">＋</em><div class="pic pic-${o.cls}">${o.icon}</div><span>${o.name}<small>${o.sub}</small></span></div>`; }).join('')}
    <div class="dw" onclick="editBoard()"><em class="ad">＋</em><div class="pic pic-custom">⏱</div><span>自定义看板<small>按类型、时间、分类、账户、金额、成员、备注统计</small></span></div></div>
  <div class="sec-t">其他模块 <a onclick="askConfirm('恢复默认的首页看板布局？',()=>{S.settings.home=defaultHome();save();render()})">恢复默认</a></div>
  <div class="card"><div class="card-hd"><b>首页模块</b><small>开关控制显示，长按拖动排序</small></div>
    ${h.widgets.map((w, i) => `<div class="dw" data-lp="homewidget" data-lpid="${esc(w.id)}"><i>${WIDGETS[w.id][0]}</i><span>${WIDGETS[w.id][1]}</span>
      <span class="home-drag-handle" aria-hidden="true">⠿</span>
      <em class="sw ${w.on ? 'on' : ''}" onclick="S.settings.home.widgets[${i}].on=!S.settings.home.widgets[${i}].on;save();render()"></em></div>`).join('')}</div>
  <div class="card"><div class="card-hd"><b>快捷入口</b><small>按点选顺序排列 · 已选 ${h.quick.length}/12</small></div>
    <div class="qsel">${Object.entries(QUICK).map(([k, [ic, nm]]) => `<i class="chip ${h.quick.includes(k) ? 'on' : ''}" onclick="toggleQ('${k}')">${ic} ${nm}${h.quick.includes(k) ? ' · ' + (h.quick.indexOf(k) + 1) : ''}</i>`).join('')}</div></div>
  <div class="card"><div class="card-hd"><b>最近记录显示条数</b></div>
    <div class="chips" style="padding-bottom:14px">${[3, 6, 10, 20].map(k => `<i class="chip ${h.recentN === k ? 'on' : ''}" onclick="S.settings.home.recentN=${k};save();render()">${k} 条</i>`).join('')}</div></div>
  <div class="ver">首页顶部的本月收支与预算环固定显示</div>`;
};
function rmBoard(i) {
  const b = S.settings.home.boards[i];
  const done = () => { S.settings.home.boards.splice(i, 1); save(); render(); };
  b.custom ? askConfirm(`删除自定义看板「${esc(b.name)}」？`, done, '删除') : done();
}
