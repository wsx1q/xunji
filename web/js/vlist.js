'use strict';
/* ================= 虚拟列表 =================
   以「一天的卡片」为单位：页面里只保留屏幕上下各约一屏的卡片，其余用上下两块空白占位。
   渲染过的卡片记录实际高度，没渲染过的按行数估算；从上方补卡片时以屏幕上已有的卡片为锚点修正滚动，避免跳动。
   卡片按天 key 增删，屏幕上的行不会被重建（不打断正在进行的长按 / 左滑）。 */
const VL_GAP = 12;
const VL_EST = { hd: 58, r1: 62, r2: 82 };
/* 高度封顶：WebView 按物理像素排版，单个页面最大约 3355 万物理像素（3 倍屏约 1100 万 CSS px），
   20 万条流水的真实高度会超过它，超出部分被截断就"滑不动了"。
   所以页面里的占位高度最多 VL_MAXH，用 vl.shift 做映射：逻辑位置 = 物理位置 + shift；
   快滑到占位边界时重设 shift 并同步修正滚动，屏幕内容不动。数据量小时 shift 恒为 0，和原来完全一样。 */
const VL_MAXH = Math.round(Math.min(4e6, 1.6e7 / (window.devicePixelRatio || 1)));
const vlTot = vl => vl.off[vl.h.length];
const vlPhys = vl => Math.min(vlTot(vl), VL_MAXH);
function vlPads(vl) {
  vl.top.style.height = Math.max(0, vl.off[vl.a] - vl.shift) + 'px';
  vl.bot.style.height = Math.max(0, vlPhys(vl) - (vl.off[vl.b] - vl.shift)) + 'px';
}
/** 当前窗口 [a,b) 下合法的 shift 区间；不合法时按比例重新映射（view：屏幕顶部的逻辑位置） */
function vlFixShift(vl, view) {
  const tot = vlTot(vl), P = vlPhys(vl);
  if (tot <= P) return 0;
  const lo = Math.max(0, vl.off[vl.b] - P), hi = Math.min(tot - P, vl.off[vl.a]);
  if (vl.shift >= lo && vl.shift <= hi) return vl.shift;
  const H = innerHeight, phys = view * Math.max(0, P - H) / Math.max(1, tot - H);
  return Math.max(lo, Math.min(hi, view - phys));
}
function vlMount(host, tx, accId, foot = '') {
  if (!tx.length) { host._vl = null; host.innerHTML = `<div class="card">${empty('暂无记录')}</div>`; return; }
  const days = dayGroups(tx);
  const vl = host._vl = { days, accId, h: new Float64Array(days.length), off: null, a: 0, b: 0, shift: 0, nodes: new Map() };
  days.forEach((g, i) => vl.h[i] = vlEst(g));
  vlOffsets(vl);
  host.classList.add('vl');
  host.innerHTML = `<div class="vl-pad"></div><div class="vl-win"></div><div class="vl-pad"></div>${foot}`;
  [vl.top, vl.win, vl.bot] = host.children;
  vl.host = host;
  vlUpdate(vl, true);
}
function vlEst(g) {
  let h = VL_EST.hd + VL_GAP;
  for (const t of g.list) h += t.type !== 'transfer' && t.type !== 'adjust' && (t.merchant || t.project || t.note) ? VL_EST.r2 : VL_EST.r1;
  return h;
}
function vlOffsets(vl) {
  const n = vl.h.length, off = vl.off && vl.off.length === n + 1 ? vl.off : new Float64Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + vl.h[i];
  vl.off = off;
}
/** 第一个底边在 y 之下的卡片下标 */
function vlFind(vl, y) {
  const off = vl.off;
  let lo = 0, hi = vl.h.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (off[mid + 1] > y) hi = mid; else lo = mid + 1; }
  return lo;
}
function vlUpdate(vl, force, noAnchor) {
  if (!vl.host.isConnected) return;
  const H = innerHeight, base = vl.host.getBoundingClientRect().top + VL_GAP;
  const top = vl.shift - base, bot = top + H;
  if (!force && vl.b > vl.a && vl.off[vl.a] <= top - H * 0.3 && vl.off[vl.b] >= bot + H * 0.3) return;
  const n = vl.h.length;
  const a = Math.max(0, vlFind(vl, top - H * 1.5)), b = Math.min(n, vlFind(vl, bot + H * 1.5) + 1);
  // 锚点：新旧窗口都保留的、最靠近屏幕顶部的卡片
  let anchor = null, anchorTop = 0;
  if (!noAnchor) for (let i = Math.max(a, vl.a); i < Math.min(b, vl.b); i++) {
    const el = vl.nodes.get(i), r = el.getBoundingClientRect();
    if (r.bottom > 0) { anchor = el; anchorTop = r.top; break; }
  }
  for (const [i, el] of vl.nodes) if (i < a || i >= b) { el.remove(); vl.nodes.delete(i); }
  const make = (from, to) => {
    let html = '';
    for (let i = from; i < to; i++) html += dayHtml(vl.days[i].k, vl.days[i].list, vl.accId, ` data-vi="${i}"`);
    const t = document.createElement('template'); t.innerHTML = html;
    return t.content;
  };
  const kept = vl.nodes.size;
  if (!kept) { vl.win.appendChild(make(a, b)); }
  else {
    const first = Math.min(...vl.nodes.keys()), last = Math.max(...vl.nodes.keys());
    if (a < first) vl.win.insertBefore(make(a, first), vl.win.firstChild);
    if (last + 1 < b) vl.win.appendChild(make(last + 1, b));
  }
  for (const el of vl.win.children) { const i = +el.dataset.vi; if (!vl.nodes.has(i)) vl.nodes.set(i, el); }
  vl.a = a; vl.b = b;
  // 量出实际高度，重算位置
  let changed = false;
  for (const [i, el] of vl.nodes) { const h = el.offsetHeight + VL_GAP; if (Math.abs(vl.h[i] - h) > 0.5) { vl.h[i] = h; changed = true; } }
  if (changed) vlOffsets(vl);
  const oldShift = vl.shift;
  vl.shift = vlFixShift(vl, top);
  vlPads(vl);
  if (anchor && !FS.drag) { const d = anchor.getBoundingClientRect().top - anchorTop; if (Math.abs(d) > 0.5) scrollBy(0, d); }
  else if (vl.shift !== oldShift) scrollBy(0, oldShift - vl.shift); // 重设映射：逻辑位置不变
  // 估算偏高时实际渲染的卡片可能不够铺满屏幕，再补一次
  if (!vl._again && (changed || vl.shift !== oldShift) && b < n) {
    const t2 = vl.shift - (vl.host.getBoundingClientRect().top + VL_GAP);
    if (vl.off[b] < t2 + H * 1.3 || vl.off[a] > t2 - H * 0.3) { vl._again = true; vlUpdate(vl, true); vl._again = false; }
  }
}
/** 快速滑块拖动时显示的日期：按卡片位置计算，不依赖页面里实际渲染了哪些卡片 */
function vlMarks(vl) {
  const base = vl.host.getBoundingClientRect().top + scrollY + VL_GAP;
  return vl.days.map((g, i) => [base + vl.off[i] - vl.shift, dayLabel(g.k)]);
}
function vlActive() { const h = document.querySelector('#view .vl'); return h && h._vl ? h._vl : null; }
let _vlRaf = 0;
addEventListener('scroll', () => {
  if (FS.drag) return;
  if (_vlRaf) return;
  _vlRaf = requestAnimationFrame(() => { _vlRaf = 0; const vl = vlActive(); if (vl) vlUpdate(vl); });
}, { passive: true });
addEventListener('resize', () => { const vl = vlActive(); if (vl) vlUpdate(vl, true); });
const sum3 = tx => { const i = sumT(tx, 'income'), e = sumT(tx, 'expense'); return `<div><small>收入</small><b>${money(i)}</b></div><div><small>支出</small><b>${money(e)}</b></div><div><small>结余</small><b>${money(i - e)}</b></div>`; };
