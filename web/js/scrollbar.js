'use strict';
/* 快速滚动条 */
// 系统滚动条太细拖不动：长页面滚动时右侧出现滑块，拖动时气泡显示所在日期（取页面里带 data-fs 的元素）
const FS = { el: null, bub: null, drag: false, t: 0, marks: [] };
const FS_TOP = 70, FS_BOT = 90, FS_H = 44;
const fsMax = () => document.documentElement.scrollHeight - innerHeight;
const fsTrack = () => innerHeight - FS_TOP - FS_BOT - FS_H;
function fsInit() {
  const el = FS.el = document.createElement('div');
  el.id = 'fs'; el.innerHTML = '<i>⇕</i><span></span>';
  document.body.appendChild(el);
  FS.bub = el.querySelector('span');
  const move = e => {
    FS.r = Math.max(0, Math.min(1, (e.touches[0].clientY - FS_TOP - FS_H / 2) / fsTrack()));
    el.style.transform = `translateY(${FS_TOP + FS.r * fsTrack()}px)`;
    const m = FS.marks;
    let lo = 0, hi = m.length - 1, hit = '';
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (m[mid][0] <= FS.r) { hit = m[mid][1]; lo = mid + 1; } else hi = mid - 1; }
    FS.bub.textContent = hit;
    if (!FS.raf) FS.raf = requestAnimationFrame(fsApply);
    e.preventDefault();
  };
  el.addEventListener('touchstart', e => {
    FS.drag = true;
    FS.max = fsMax();
    const vl = vlActive();
    if (vl) {
      const tot = vl.off[vl.off.length - 1] || 1;
      FS.marks = vl.days.map((g, i) => [vl.off[i] / tot, dayLabel(g.k)]);
    } else {
      const tot = document.documentElement.scrollHeight || 1;
      FS.marks = [...document.querySelectorAll('#view [data-fs]')].map(n => [(n.getBoundingClientRect().top + scrollY) / tot, n.dataset.fs]);
    }
    el.classList.add('drag'); move(e);
  }, { passive: false });
  el.addEventListener('touchmove', move, { passive: false });
  const end = () => {
    if (FS.raf) { cancelAnimationFrame(FS.raf); FS.raf = 0; fsApply(); }
    FS.drag = false; el.classList.remove('drag'); fsUpdate();
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
  addEventListener('scroll', fsUpdate, { passive: true });
}
function fsApply() {
  FS.raf = 0;
  const r = FS.r || 0, y = r * (FS.max || fsMax());
  const vl = vlActive();
  // 长列表封顶后：物理位置和映射偏移同比例走，r=0 到顶、r=1 到底
  if (vl) vl.shift = r * Math.max(0, vlTot(vl) - vlPhys(vl));
  scrollTo(0, y);
  if (vl) vlUpdate(vl, true);
}
function fsUpdate() {
  const el = FS.el, max = fsMax();
  if (!el) return;
  if (max < innerHeight * 2 || $('.add')) { el.classList.remove('on'); return; }
  if (!FS.drag) {
    const vl = vlActive(), ex = vl ? Math.max(0, vlTot(vl) - vlPhys(vl)) : 0;
    const r = ((scrollY + (vl ? vl.shift : 0)) / (max + ex)) || 0;
    el.style.transform = `translateY(${FS_TOP + Math.max(0, Math.min(1, r)) * fsTrack()}px)`;
  }
  el.classList.add('on');
  clearTimeout(FS.t);
  if (!FS.drag) FS.t = setTimeout(() => el.classList.remove('on'), 1500);
}
