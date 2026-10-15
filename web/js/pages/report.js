'use strict';
/* 报表 */
const R = { kind: 'month', ref: Date.now(), type: 'expense', pcat: '' };
function donutSvg(items, total, size = 190, sw = 30) {
  // 有负数金额（退款记成负支出）时，分类合计可能是负的：环形图只画正的部分
  items = items.filter(it => it.amt > 0); total = items.reduce((a, it) => a + it.amt, 0);
  const r = (size - sw) / 2, C = 2 * Math.PI * r, c = size / 2;
  let acc = 0, segs = '';
  if (!total) segs = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#F1F2F4" stroke-width="${sw}"/>`;
  else for (const it of items) {
    const len = it.amt / total * C;
    segs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${sw}" stroke-dasharray="${Math.max(len - 1.5, 0.5)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${c} ${c})"/>`;
    acc += len;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segs}</svg>`;
}
function barChart(series, labels, everyN = 1, clicks = []) {
  const W = 340, H = 160, pb = 22, pt = 18, pl = 4;
  const n = labels.length, max = Math.max(1, ...series.flatMap(s => s.vals));
  const gw = (W - pl) / n, bw = Math.min(16, gw * 0.7 / series.length);
  let out = `<line x1="0" y1="${H - pb}" x2="${W}" y2="${H - pb}" stroke="#EEE"/>`;
  for (let g = 1; g <= 2; g++) { const y = pt + (H - pb - pt) * (g - 1) / 2; out += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#F4F4F6" stroke-dasharray="3 3"/>`; }
  out += `<text x="2" y="${pt - 6}" font-size="10" fill="#aaa">${money(max, 0)}</text>`;
  labels.forEach((lb, i) => {
    const gx = pl + i * gw + (gw - bw * series.length) / 2;
    series.forEach((s, j) => {
      const v = s.vals[i], h = (H - pb - pt) * v / max;
      if (v > 0) out += `<rect ${clicks[i]?`role="button" tabindex="0" aria-label="${esc(labels[i]+'流水详情')}" onclick="event.stopPropagation();${clicks[i]}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();${clicks[i]}}"`: ''} x="${gx + j * bw}" y="${H - pb - h}" width="${bw - (series.length > 1 ? 1 : 0)}" height="${Math.max(h, 1.5)}" rx="${Math.min(3, bw / 3)}" fill="${s.color}"/>`;
    });
    if (i % everyN === 0 || i === n - 1) out += `<text x="${pl + i * gw + gw / 2}" y="${H - 6}" font-size="10" fill="#999" text-anchor="middle">${lb}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${out}</svg>`;
}
// 和 openList 一样清掉流水页筛选栏（L.F）：否则之前在搜索页设过的分类 / 金额 / 时间等条件会叠加上来，明细变成空的
function reportList(cat, exact = false) { Object.assign(L, L0, { kind: R.kind, ref: R.ref, type: R.type, cat, exact, limit: LIST_PAGE, F: normBoard({}) }); showList(); }
Pages.report = () => {
  const [s, e] = periodRange(R.kind, R.ref);
  const all = inRange(bookTx(), s, e);
  if (R.pcat && catById(R.pcat) === UNKNOWN) R.pcat = '';
  const tx = all.filter(t => t.type === R.type && (!R.pcat || inCat(t.catId, R.pcat)));
  const total = sumArr(tx);
  const g = {};
  tx.forEach(t => { const k = R.pcat ? t.catId : topOf(t.catId).id; const o = g[k] || (g[k] = { amt: 0, n: 0 }); o.amt += t.amount; o.n++; });
  const items = Object.entries(g).map(([id, v]) => ({ id, c: catById(id), amt: r2(v.amt), n: v.n })).sort((a, b) => b.amt - a.amt);
  items.forEach((it, i) => {
    it.color = R.pcat ? COLORS[(i * 3) % COLORS.length] : it.c.color;
    it.name = R.pcat && it.id === R.pcat ? `${it.c.name}（未细分）` : it.c.name;
    it.fn = !R.pcat && subsOf(it.id).length ? `R.pcat='${it.id}';render()` : `reportList('${it.id}',${R.pcat === it.id})`;
  });
  const tName = R.type === 'expense' ? '支出' : '收入';
  const color = R.type === 'expense' ? 'var(--exp)' : 'var(--inc)';
  const colorHex = (R.type === 'expense') !== !!S.settings.swap ? '#19A35B' : '#F0533A';
  // trend
  let labels = [], vals = [], everyN = 1;
  if (R.kind === 'month') {
    const d = new Date(R.ref), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    vals = Array(days).fill(0); labels = Array.from({ length: days }, (_, i) => i + 1); everyN = 5;
    tx.forEach(t => vals[new Date(t.time).getDate() - 1] += t.amount);
  } else if (R.kind === 'year') {
    vals = Array(12).fill(0); labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月'); everyN = 1;
    tx.forEach(t => vals[new Date(t.time).getMonth()] += t.amount);
  } else {
    const years = new Map();
    tx.forEach(t => {const year=new Date(t.time).getFullYear();years.set(year,(years.get(year)||0)+t.amount);});
    const ordered=[...years].sort((a,b)=>a[0]-b[0]);
    labels=ordered.map(([year])=>year+'年');vals=ordered.map(([,amount])=>amount);
    everyN=Math.max(1,Math.ceil(labels.length/6));
  }
  const unit = R.kind === 'month' ? '日' : '月';
  const now = Date.now();
  const passed = R.kind === 'month' ? (now >= e ? vals.length : now < s ? 0 : new Date().getDate()) : (now >= e ? 12 : now < s ? 0 : new Date().getMonth() + 1);
  // 6 months compare
  const mLabels = [], mi = [], mex = [];
  for (let k = 5; k >= 0; k--) {
    const ref = shiftRef('month', R.ref, -k), [a, b] = periodRange('month', ref), t = inRange(bookTx(), a, b);
    mLabels.push((new Date(ref).getMonth() + 1) + '月'); mi.push(sumT(t, 'income')); mex.push(sumT(t, 'expense'));
  }
  const incHex = S.settings.swap ? '#19A35B' : '#F0533A', expHex = S.settings.swap ? '#F0533A' : '#19A35B';
  return `<div class="r-hd grad">
    <div style="display:flex;justify-content:center;gap:10px;padding-top:6px">
      <div class="seg">${[['expense', '支出'], ['income', '收入']].map(([k, n]) => `<i class="${R.type === k ? 'on' : ''}" onclick="R.type='${k}';R.pcat='';render()">${n}</i>`).join('')}</div>
      <div class="seg">${[['month', '月报'], ['year', '年报'], ['all', '全部']].map(([k, n]) => `<i class="${R.kind === k ? 'on' : ''}" onclick="R.kind='${k}';R.ref=Date.now();render()">${n}</i>`).join('')}</div>
    </div>
    <div class="period">${R.kind==='all'?'<span>全部时间</span>':`<b onclick="R.ref=shiftRef(R.kind,R.ref,-1);render()">‹</b><span class="pp" onclick="periodSheet(R.kind,R.ref,t=>{R.ref=t;render()})">${periodLabel(R.kind, R.ref)}</span><b class="${isFuture(R.kind, R.ref) ? 'dis' : ''}" onclick="R.ref=shiftRef(R.kind,R.ref,1);render()">›</b>`}</div>
    <div class="sum3">${sum3(all)}</div></div>
  <div class="card"><div class="card-hd">${R.pcat ? `<b><a onclick="R.pcat='';render()" style="color:var(--c);font-size:15px">‹ 全部</a> ${esc(catById(R.pcat).name)} · 二级分类</b>` : `<b>${tName}构成</b>`}<small>共 ${tx.length} 笔</small></div>
    <div class="donut-wrap">${donutSvg(items, total)}<div class="donut-c"><small>${R.pcat ? esc(catById(R.pcat).name) : '总' + tName}</small><b>${money(total)}</b></div></div>
    ${R.pcat && tx.length ? `<div class="r-all" onclick="reportList('${R.pcat}')"><span>📋 查看「${esc(catById(R.pcat).name)}」全部明细</span><em>${tx.length} 笔 ›</em></div>` : ''}
    ${items.length ? items.map(it => rankRow(it.c.icon, it.color, esc(it.name) + (!R.pcat && subsOf(it.id).length ? ' ›' : ''), `${(it.amt / total * 100).toFixed(1)}% · ${it.n}笔`, it.amt, items[0].amt, it.fn)).join('') : empty('本期暂无' + tName, '📊')}
    ${R.pcat ? '' : `<div class="ver" style="padding:6px 0 12px">点击带 › 的分类查看二级分类构成</div>`}
  </div>
  <div class="card"><div class="card-hd"><b>${tName}趋势</b><small>${R.kind==='all'?`按年汇总 · ${labels.length} 年`:`${unit}均 ${money(passed ? total / passed : 0)}`}</small></div>
    ${barChart([{ vals: vals.map(r2), color: colorHex }], labels, everyN)}</div>
  <div class="card"><div class="card-hd"><b>近 6 个月收支对比</b></div>
    ${barChart([{ vals: mi, color: incHex }, { vals: mex, color: expHex }], mLabels)}
    <div class="legend"><span><i style="background:${incHex}"></i>收入</span><span><i style="background:${expHex}"></i>支出</span></div></div>`;
};
