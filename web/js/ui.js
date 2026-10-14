'use strict';
/* 通用组件：toast、弹窗、日期选择、流水行、左滑 / 多选 */
let _toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('on'), 1600); }
let _sheetCb = null;
function openSheet(title, body) {
  const el = $('#sheet');
  // 弹窗已经开着（在里面点选项、切换）：只换内容区，不重放弹出动画、保留滚动位置，看起来就不会"刷新"
  const box = el.classList.contains('on') && el.querySelector('.sh-box'), bd = box && box.querySelector('.sh-bd');
  if (bd) {
    const y = bd.scrollTop;
    box.querySelector('.sh-hd span').innerHTML = title;
    bd.innerHTML = body;
    bd.scrollTop = y;
    return;
  }
  el.innerHTML = `<div class="sh-mask" onclick="closeSheet()"></div><div class="sh-box"><div class="sh-hd"><span>${title}</span><b onclick="closeSheet()">✕</b></div><div class="sh-bd">${body}</div></div>`;
  el.classList.add('on');
}
function closeSheet() { $('#sheet').classList.remove('on'); $('#sheet').innerHTML = ''; }
function askConfirm(msg, fn, okText = '确定') {
  _sheetCb = fn;
  // 删除 / 清空这类不可恢复的操作，确认按钮统一用红色
  const danger = ['删除', '清空'].includes(okText);
  openSheet('提示', `<div class="confirm-msg">${msg}</div><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn ${danger ? 'del' : ''}" onclick="const f=_sheetCb;closeSheet();f&&f()">${okText}</button></div>`);
}
/** 自带年 / 月 / 日，不用系统日历；现在 = 今天。val 为 YYYY-MM-DD */
function dateSheet(title, val, cb, opt = {}) {
  const now = new Date(), max = opt.max || '';
  let minY = now.getFullYear() - 20;
  if (S && S.txns && S.txns.length) {
    const a = S.txns[0].time, b = S.txns[S.txns.length - 1].time;
    minY = Math.min(minY, new Date(a).getFullYear(), new Date(b).getFullYear());
  }
  const t = val ? new Date(val + 'T00:00:00') : now;
  DS = { title, cb, max, minY, maxY: now.getFullYear(), y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), empty: opt.allowEmpty };
  dateClamp();
  renderDateSheet();
}
let DS = null;
function dateClamp() {
  const dim = new Date(DS.y, DS.m, 0).getDate();
  if (DS.d > dim) DS.d = dim;
  if (!DS.max) return;
  const [my, mm, md] = DS.max.split('-').map(Number);
  if (DS.y > my || (DS.y === my && DS.m > mm)) { DS.y = my; DS.m = mm; DS.d = md; }
  else if (DS.y === my && DS.m === mm && DS.d > md) DS.d = md;
}
function datePickY(y) {
  y = +y;
  if (!(y >= DS_MINY && y <= DS.maxY)) return toast(`年份范围 ${DS_MINY}–${DS.maxY}`);
  DS.y = y; dateClamp();
  // 列表里没有的年份（手输的）补一个按钮，按年份顺序插进去
  const row = $('#dsY');
  if (row && !row.querySelector(`[data-y="${y}"]`)) {
    const chip = document.createElement('i');
    chip.className = 'chip'; chip.dataset.y = y; chip.textContent = y; chip.setAttribute('onclick', `datePickY(${y})`);
    const after = [...row.querySelectorAll('[data-y]')].find(c => +c.dataset.y < y);
    row.insertBefore(chip, after || null);
  }
  dateRefresh(true);
}
function datePickM(m) { DS.m = +m; dateClamp(); dateRefresh(); }
function datePickD(d) { DS.d = +d; dateRefresh(); }
function dateYearInput(el) {
  const v = el.value.replace(/\D/g, '').slice(0, 4);
  if (v !== el.value) el.value = v;
  if (v.length === 4) { datePickY(v); el.value = ''; el.blur(); }
}
function dateNow() {
  const n = new Date();
  DS.y = n.getFullYear(); DS.m = n.getMonth() + 1; DS.d = n.getDate();
  dateOk();
}
function dateOk() {
  const v = `${DS.y}-${pad(DS.m)}-${pad(DS.d)}`, cb = DS.cb;
  closeSheet(); cb && cb(v);
}
const DS_MINY = 1900;
function dateCells() {
  const dim = new Date(DS.y, DS.m, 0).getDate();
  const first = new Date(DS.y, DS.m - 1, 1).getDay();
  let cells = '<i class="wk">日</i><i class="wk">一</i><i class="wk">二</i><i class="wk">三</i><i class="wk">四</i><i class="wk">五</i><i class="wk">六</i>';
  for (let i = 0; i < first; i++) cells += '<i></i>';
  for (let d = 1; d <= dim; d++) {
    const v = `${DS.y}-${pad(DS.m)}-${pad(d)}`;
    const dis = DS.max && v > DS.max;
    cells += `<i class="d${d === DS.d ? ' on' : ''}${dis ? ' dis' : ''}" onclick="${dis ? '' : `datePickD(${d})`}">${d}</i>`;
  }
  return cells;
}
/** 只更新变化的部分：年 / 月按钮的选中态、日期格子、确定按钮文字。弹窗本身不重建，不闪、年份条不跳 */
function dateRefresh(scrollY) {
  const sh = $('#sheet');
  if (!sh || !$('#dsCal')) return renderDateSheet();
  sh.querySelectorAll('#dsY [data-y]').forEach(c => c.classList.toggle('on', +c.dataset.y === DS.y));
  sh.querySelectorAll('#dsM [data-m]').forEach(c => {
    const m = +c.dataset.m;
    c.classList.toggle('on', m === DS.m);
    c.classList.toggle('dis', !!DS.max && `${DS.y}-${pad(m)}` > DS.max.slice(0, 7));
  });
  $('#dsCal').innerHTML = dateCells();
  $('#dsOk').textContent = `确定 ${DS.y}-${pad(DS.m)}-${pad(DS.d)}`;
  if (scrollY) dateScrollY();
}
function dateScrollY() {
  const row = $('#dsY'), on = row && row.querySelector('.chip.on');
  if (on) row.scrollTo({ left: on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
}
function renderDateSheet() {
  const years = [];
  for (let y = DS.maxY; y >= DS.minY; y--) years.push(y);
  if (DS.y < DS.minY) years.push(DS.y);
  // 「其他年份」固定在最前面不跟着滚，后面的年份条单独横向滚动
  openSheet(DS.title, `<div class="cal-yw"><input class="cal-yin" inputmode="numeric" maxlength="4" placeholder="其他年份" oninput="dateYearInput(this)"><div class="cal-y" id="dsY">${years.map(y => `<i class="chip" data-y="${y}" onclick="datePickY(${y})">${y}</i>`).join('')}</div></div>
    <div class="cal-m" id="dsM">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => `<i class="chip" data-m="${m}" onclick="datePickM(${m})">${m}月</i>`).join('')}</div>
    <div class="cal" id="dsCal"></div>
    <div class="btn-row" style="margin-top:14px">${DS.empty ? `<button class="btn ghost" onclick="const f=DS.cb;closeSheet();f&&f('')">清空</button>` : ''}
      <button class="btn ghost" onclick="dateNow()">现在</button>
      <button class="btn" id="dsOk" onclick="dateOk()"></button></div>`);
  dateRefresh();
  // 首次打开直接定位到选中年份，不要动画
  const row = $('#dsY'), on = row && row.querySelector('.chip.on');
  if (on) row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
}
/** 时间段快速选择（流水 / 报表顶部点年月）：月 → 先选年再选月；年 → 选年；日 / 周 → 日历选一天。cb(该时间段内的某个时间点) */
let PS = null;
function periodSheet(kind, ref, cb) {
  if (kind === 'day' || kind === 'week') return dateSheet(kind === 'day' ? '选择日期' : '选择这一周里的任意一天', ymd(ref), v => cb(parseYmd(v)), { max: ymd(Date.now()) });
  const d = new Date(ref), nowY = new Date().getFullYear();
  let minY = nowY - 2;
  if (S && S.txns.length) minY = Math.min(minY, new Date(S.txns[S.txns.length - 1].time).getFullYear());
  PS = { kind, y: d.getFullYear(), y0: d.getFullYear(), m0: d.getMonth() + 1, minY, cb };
  renderPeriodSheet();
}
function renderPeriodSheet() {
  const now = new Date(), nowY = now.getFullYear(), nowM = now.getMonth() + 1, years = [];
  for (let y = nowY; y >= PS.minY; y--) years.push(y);
  if (PS.kind === 'year') {
    openSheet('选择年份', `<div class="ps-grid">${years.map(y => `<i class="chip ${y === PS.y0 ? 'on' : ''}" onclick="periodOk(${y},1)">${y}年</i>`).join('')}</div>`);
    return;
  }
  openSheet('选择月份', `<div class="cal-y" id="psY">${years.map(y => `<i class="chip ${y === PS.y ? 'on' : ''}" onclick="PS.y=${y};renderPeriodSheet()">${y}年</i>`).join('')}</div>
    <div class="ps-grid">${Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
      const dis = PS.y === nowY && m > nowM, on = PS.y === PS.y0 && m === PS.m0;
      return `<i class="chip ${on ? 'on' : ''} ${dis ? 'dis' : ''}" onclick="${dis ? '' : `periodOk(${PS.y},${m})`}">${m}月</i>`;
    }).join('')}</div>`);
  const on = $('#psY .chip.on'), row = $('#psY');
  if (on && row) row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
}
function periodOk(y, m) { const cb = PS.cb; closeSheet(); cb(new Date(y, m - 1, 1).getTime()); }
function numberSheet(title, val, fn, allowNeg = false) {
  _sheetCb = fn;
  openSheet(title, `<input id="numIn" class="field" type="number" inputmode="decimal" step="0.01" value="${val || ''}" placeholder="请输入金额">
    <button class="btn" onclick="const v=parseFloat($('#numIn').value)||0;${allowNeg ? '' : 'if(v<0)return toast(\'金额不能为负\');'}const f=_sheetCb;closeSheet();f(r2(v))">确定</button>`);
  setTimeout(() => $('#numIn') && $('#numIn').focus(), 150);
}
/* 通用选择弹窗：点选后 cb(值) 再刷新页面 */
function sheetPick(v) { const f = _sheetCb; closeSheet(); f && f(v); render(); }
/* ---------- 选择列表：同一类东西在哪里选都长一样，单选点了就关，多选打 ✓ ----------
   分类 → catCardsHtml（分类卡片）；账户 → accRows；成员 / 商家 / 项目 → tagRows */
/** 账户列表：一级账户和缩进的子账户，右边是余额。isOn(id) 是否选中，click(id) 点击时执行的代码，skip 不列出的账户 */
function accRows(isOn, click, skip = '') {
  const bal = balances();
  const opt = (a, sub) => (a.id === skip ? '' : `<div class="opt ${sub ? 'sub' : ''} ${isOn(a.id) ? 'on' : ''}" data-v="${a.id}" onclick="${click(a.id)}"><div class="ci">${accIcon(a)}</div><span>${esc(a.name)}</span><em>${money(bal[a.id])}</em></div>`);
  return accTops().map(a => opt(a) + accKids(a.id).map(k => opt(k, true)).join('')).join('');
}
/** 成员 / 商家 / 项目列表。opts 要列出的名字（'' 表示没有设置，显示成 none），click 里用 this.dataset.v 取值 */
function tagRows(f, opts, isOn, click, none) {
  const T = TAGS[f];
  return opts.map(m => `<div class="opt ${isOn(m) ? 'on' : ''}" data-v="${esc(m)}" onclick="${click}"><div class="ci">${m ? T.icon : '∅'}</div><span>${m ? esc(m) : none}</span></div>`).join('');
}
function accSheet(title, cur, cb) {
  _sheetCb = cb;
  openSheet(title, accRows(id => id === cur, id => `sheetPick('${id}')`) + `<button class="btn" onclick="closeSheet();editAcc()">＋ 新建账户</button>`);
}
function memberSheet(cur, cb) {
  _sheetCb = cb;
  openSheet('选择成员', tagRows('member', S.members.length ? S.members : ['本人'], m => m === cur, 'sheetPick(this.dataset.v)'));
}
/** 选一个分类（导入账单 / 识别订单的分类、分类预算）：最近使用 + 分类卡片，长按可编辑 */
function catSheet(title, type, cur, cb) {
  _sheetCb = cb;
  _catPickReopen = () => catSheet(title, type, cur, cb);
  const rec = recentCats(type);
  openSheet(title, (rec.length ? `<label>最近使用</label><div class="chips" style="flex-wrap:wrap;padding-bottom:4px">${rec.map(id => { const x = catById(id); return `<i class="chip ${id === cur ? 'on' : ''}" onclick="sheetPick('${id}')">${x.icon} ${esc(catLabel(id))}</i>`; }).join('')}</div>` : '')
    + catCardsHtml(type, { sel: cur ? [cur] : [], fn: 'sheetPick' }));
}
function ringSvg(pct, bg, fg, size = 92, sw = 8) {
  const r = (size - sw) / 2, C = 2 * Math.PI * r, len = Math.max(0, Math.min(1, pct)) * C;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${bg}" stroke-width="${sw}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${fg}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${len} ${C}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}
function txItem(t, opt = {}) {
  let icon, color, name, sub, sub2 = '', sign = '', cls = t.type, amt = t.amount;
  const time = opt.date ? `${md(t.time)} ${hm(t.time)}` : hm(t.time);
  if (t.type === 'transfer') {
    icon = '🔁'; color = '#90A4AE'; name = t.note || '转账';
    sub = `${time} · ${esc(accName(t.accountId))} → ${esc(accName(t.toAccountId))}`;
    if (opt.acc) { sign = t.accountId === opt.acc ? '-' : '+'; cls = t.accountId === opt.acc ? 'expense' : 'income'; }
  } else if (t.type === 'adjust') {
    icon = '↕️'; color = '#7E8B9A'; name = '余额变更';
    sub = `${time} · ${esc(accName(t.accountId))}${t.note && t.note !== '余额变更' ? ' · ' + esc(t.note) : ''}`;
    sign = t.amount >= 0 ? '+' : '-'; cls = t.amount >= 0 ? 'income' : 'expense'; amt = Math.abs(t.amount);
  } else {
    const c = catById(t.catId); icon = c.icon; color = topOf(t.catId).color; name = esc(catLabel(t.catId));
    sub = [time, esc(accName(t.accountId)), t.member && t.member !== '本人' && esc(t.member)].filter(Boolean).join(' · ');
    sub2 = [t.merchant && '🏪' + esc(t.merchant), t.project && '📁' + esc(t.project), t.note && esc(t.note)].filter(Boolean).join(' · ');
    // 负数金额（如记成负支出的退款）：支出 -(-5) 显示 +5.00、颜色同收入；负收入显示 -5.00
    sign = (t.type === 'expense') === (t.amount >= 0) ? '-' : '+';
    if (t.amount < 0) { amt = -t.amount; cls = t.type === 'expense' ? 'income' : 'expense'; }
  }
  return `<div class="tx-w ${SEL && SEL.has(t.id) ? 'on' : ''}" data-id="${t.id}"><div class="tx-act"><i class="cp" onclick="txCopy('${t.id}')">⧉<br>复制</i><i class="ed" onclick="txTap('${t.id}',1)">✎<br>编辑</i><i class="dl" onclick="txDel('${t.id}')">🗑<br>删除</i></div>
    <div class="tx" onclick="txTap('${t.id}')"><i class="tx-ck"></i><div class="ci" style="background:${color}26">${icon}</div>
    <div class="tx-m"><div class="tx-t">${name}</div><div class="tx-s">${sub}</div>${sub2 ? `<div class="tx-s">${sub2}</div>` : ''}</div>
    <div class="tx-a ${cls}">${sign}${money(amt)}</div></div></div>`;
}
/* 流水行：左滑出「复制 / 编辑 / 删除」，长按或点「多选」进入批量选择 */
let SEL = null, _swipeAt = 0;
const TX_ACT_W = 198;
function txTap(id, force) {
  if (Date.now() - _swipeAt < 350) return;
  const w = document.querySelector(`.tx-w[data-id="${id}"]`);
  if (!force && w && w.classList.contains('open')) return w.classList.remove('open');
  if (SEL && !force) {
    SEL.has(id) ? SEL.delete(id) : SEL.add(id);
    if (w) w.classList.toggle('on', SEL.has(id));
    return selBar();
  }
  startAdd(id);
}
function txCopy(id) {
  const t = S.txns.find(x => x.id === id); if (!t) return;
  if (t.type === 'adjust') return toast('余额变更记录不能复制');
  const { type, catId, accountId, toAccountId, member, merchant, project, note, amount } = t;
  startAdd(null, { type, catId, accountId, toAccountId, member, merchant, project, note, expr: String(amount), time: Date.now() });
  toast('已复制，修改后点完成保存为新记录');
}
function txDel(id) {
  askConfirm('确定删除这条记录吗？', () => { S.txns = S.txns.filter(x => x.id !== id); save(); toast('已删除'); render(); }, '删除');
}
// 进入 / 退出多选和勾选都只改 class，不重绘列表（重绘会打断正在进行的触摸，且行多时卡顿）
function selMark() { document.querySelectorAll('#lbody .tx-w').forEach(w => w.classList.toggle('on', !!SEL && SEL.has(w.dataset.id))); }
function selStart(id) {
  SEL = new Set(id ? [id] : []);
  document.querySelectorAll('.tx-w.open').forEach(w => w.classList.remove('open'));
  const b = $('#lbody'); if (b) b.classList.add('selm');
  selMark(); selBar();
  try { navigator.vibrate && navigator.vibrate(25); } catch (e) { }
}
function selEnd() {
  SEL = null;
  const b = $('#lbody'); if (b) b.classList.remove('selm');
  selMark(); selBar();
}
function selBar() {
  const bar = $('#lsel'); if (!bar) return;
  document.querySelectorAll('.filters .chip.selc').forEach(c => { c.textContent = SEL ? '☑ 退出多选' : '☑ 多选'; });
  if (!SEL) { bar.innerHTML = ''; return; }
  const ids = L.ids || [], all = ids.length && SEL.size >= ids.length && ids.every(id => SEL.has(id));
  bar.innerHTML = `<div class="sel-bar"><a onclick="selEnd()">取消</a><a onclick="selAll()">${all ? '全不选' : `全选 ${ids.length} 笔`}</a><span>已选 <b>${SEL.size}</b> 笔</span><button class="btn del" onclick="selDelete()">删除</button></div>`;
}
function selAll() {
  const ids = L.ids || [];
  if (SEL.size >= ids.length && ids.every(id => SEL.has(id))) SEL.clear(); else ids.forEach(id => SEL.add(id));
  selMark(); selBar();
}
function selDelete() {
  if (!SEL || !SEL.size) return toast('还没有选中记录');
  askConfirm(`确定删除选中的 <b>${SEL.size}</b> 笔记录吗？删除后无法恢复。`, () => {
    const n = SEL.size, set = SEL;
    S.txns = S.txns.filter(t => !set.has(t.id));
    SEL = null; save(); toast(`已删除 ${n} 笔`); render();
  }, '删除');
}
function txSwipeInit() {
  let sw = null;
  const tx = () => sw.w.querySelector('.tx');
  document.addEventListener('touchstart', e => {
    const w = e.target.closest('.tx-w');
    document.querySelectorAll('.tx-w.open').forEach(o => { if (o !== w) o.classList.remove('open'); });
    sw = null;
    if (!w || e.target.closest('.tx-act')) return;
    const p = e.touches[0];
    sw = { w, x: p.clientX, y: p.clientY, dx: 0, horiz: null, open: w.classList.contains('open') };
    if (!SEL && stack[stack.length - 1].name === 'list') sw.timer = setTimeout(() => { if (sw && sw.horiz === null) { sw.lp = true; _swipeAt = Infinity; selStart(w.dataset.id); setTimeout(() => { if (_swipeAt === Infinity) _swipeAt = 0; }, 3000); } }, 500);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!sw || sw.lp) return;
    const p = e.touches[0], dx = p.clientX - sw.x, dy = p.clientY - sw.y;
    if (sw.horiz === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) { sw.horiz = !SEL && Math.abs(dx) > Math.abs(dy) * 1.3; clearTimeout(sw.timer); }
    if (!sw.horiz) return;
    e.preventDefault();
    sw.dx = dx;
    const x = Math.min(0, Math.max(-TX_ACT_W, (sw.open ? -TX_ACT_W : 0) + dx));
    tx().style.transition = 'none'; tx().style.transform = `translateX(${x}px)`;
  }, { passive: false });
  const end = () => {
    if (!sw) return;
    clearTimeout(sw.timer);
    if (sw.lp) _swipeAt = Date.now();
    else if (sw.horiz) {
      _swipeAt = Date.now();
      tx().style.transition = ''; tx().style.transform = '';
      sw.w.classList.toggle('open', (sw.open ? -TX_ACT_W : 0) + sw.dx < -TX_ACT_W / 3);
    }
    sw = null;
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}
const dayLabel = k => { const d = new Date(k); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
function dayHtml(k, list, accId, attr = '') {
  const today = sod(Date.now()), d = new Date(k);
  const tag = k === today ? '今天' : k === today - 864e5 ? '昨天' : `星期${WEEK[d.getDay()]}`;
  const inc = sumT(list, 'income'), exp = sumT(list, 'expense');
  return `<div class="card"${attr}><div class="day-hd" data-fs="${dayLabel(k)}"><b>${dayLabel(k)} <small style="color:var(--t2);font-weight:400">${tag}</small></b>
      <span>${inc ? `<em class="inc" style="font-style:normal">收 ${money(inc)}</em>` : ''}${exp ? `<em class="exp" style="font-style:normal">支 ${money(exp)}</em>` : ''}</span></div>
      ${list.map(t => txItem(t, { acc: accId })).join('')}</div>`;
}
/** 按天分组（tx 已按时间倒序，同一天连续） */
function dayGroups(tx) {
  const out = [];
  let cur = null;
  for (const t of tx) {
    const k = sod(t.time);
    if (!cur || cur.k !== k) out.push(cur = { k, list: [] });
    cur.list.push(t);
  }
  return out;
}
function groupHtml(tx, accId) {
  if (!tx.length) return `<div class="card">${empty('暂无记录')}</div>`;
  return dayGroups(tx).map(g => dayHtml(g.k, g.list, accId)).join('');
}
