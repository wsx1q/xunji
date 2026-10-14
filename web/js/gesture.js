'use strict';
/* 通用长按手势：长按编辑、长按拖动排序 */
let _lpAt = 0;
/* ---------- 通用长按手势（全软件通用）----------
   元素带 data-lp="类型" data-lpid="id" data-lpg="分组"：
   · 长按松手（没移动）→ 改名 / 编辑（LP_KINDS[类型].edit）
   · 长按后拖动 → 在同一父元素、同类型同分组的兄弟之间调整顺序，松手保存（LP_KINDS[类型].order）  */
function reorderBy(list, key, ids) {
  // 只重排这些 id 对应的元素：它们在数组里原来占的位置不变，按新顺序依次填回
  const pos = [], map = new Map();
  list.forEach((x, i) => { const k = key(x); if (ids.includes(k)) { pos.push(i); map.set(k, x); } });
  ids.forEach((k, j) => { if (j < pos.length) list[pos[j]] = map.get(k); });
}
const LP_KINDS = {
  cat: {
    edit: (id, g) => { CT = g.split('|')[0]; editCat(id); },
    order: (ids, g) => reorderBy(S.categories[g.split('|')[0]], c => c.id, ids),
  },
  // 选择面板里的账户、成员 / 商家 / 项目：编辑 / 排序完回到打开它的面板
  accpick: { edit: id => editAcc(id, '', _pickReopen), order: ids => reorderBy(S.accounts, a => a.id, ids), after: () => _pickReopen && _pickReopen() },
  tagpick: { edit: (v, f) => editTag(f, v, _pickReopen), order: (ids, f) => reorderBy(S[TAGS[f].list], x => x, ids), after: () => _pickReopen && _pickReopen() },
  // 选择面板里的分类：编辑 / 排序完回到打开它的面板
  catpick: {
    edit: (id, g) => { CT = g.split('|')[0]; editCat(id, '', _catPickReopen); },
    order: (ids, g) => reorderBy(S.categories[g.split('|')[0]], c => c.id, ids),
    after: () => _catPickReopen && _catPickReopen(),
  },
  acc: { edit: id => editAcc(id), order: ids => reorderBy(S.accounts, a => a.id, ids), rerender: true },
  book: { edit: id => editBook(id), order: ids => reorderBy(S.books, b => b.id, ids) },
  tag: {
    edit: (v, f) => editTag(f, v),
    order: (ids, f) => { const T = TAGS[f]; reorderBy(S[T.list], x => x, ids); },
    after: f => manageTags(f),
  },
};
function lpInit() {
  let el = null, timer = 0, armed = false, dragging = false, x0 = 0, y0 = 0, ghost = null, dx = 0, dy = 0;
  const sibs = () => [...el.parentNode.children].filter(n => n.dataset && n.dataset.lp === el.dataset.lp && (n.dataset.lpg || '') === (el.dataset.lpg || ''));
  const reset = () => {
    clearTimeout(timer); timer = 0;
    // 长按触发时 _lpAt 设成 Infinity 表示"进行中"；任何情况下收尾都要还原，否则之后所有点击都会被下面的拦截吞掉
    if (_lpAt === Infinity) _lpAt = Date.now();
    if (ghost) ghost.remove();
    if (el) el.classList.remove('lp-lift', 'lp-hold');
    el = ghost = null; armed = dragging = false;
  };
  document.addEventListener('touchstart', e => {
    reset();
    if (_lpAt === Infinity) _lpAt = 0;
    const t = e.target.closest('[data-lp]'); if (!t || e.touches.length > 1) return;
    el = t; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    timer = setTimeout(() => {
      armed = true; _lpAt = Infinity;
      try { navigator.vibrate && navigator.vibrate(25); } catch (err) { }
      el.classList.add('lp-hold');
    }, 450);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!el) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    if (!armed) { if (Math.abs(x - x0) > 8 || Math.abs(y - y0) > 8) reset(); return; }
    e.preventDefault(); // 拖动中不让页面滚动
    if (!dragging) {
      if (Math.abs(x - x0) < 6 && Math.abs(y - y0) < 6) return;
      if (sibs().length < 2) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      dx = x0 - r.left; dy = y0 - r.top;
      ghost = el.cloneNode(true);
      ghost.className += ' lp-ghost';
      Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px' });
      document.body.appendChild(ghost);
      el.classList.remove('lp-hold'); el.classList.add('lp-lift');
    }
    ghost.style.left = (x - dx) + 'px'; ghost.style.top = (y - dy) + 'px';
    ghost.style.visibility = 'hidden';
    const under = document.elementFromPoint(x, y);
    ghost.style.visibility = '';
    const target = under && under.closest('[data-lp]');
    if (!target || target === el || target.parentNode !== el.parentNode || target.dataset.lp !== el.dataset.lp || (target.dataset.lpg || '') !== (el.dataset.lpg || '')) return;
    const list = sibs();
    el.parentNode.insertBefore(el, list.indexOf(target) > list.indexOf(el) ? target.nextSibling : target);
  }, { passive: false });
  const end = () => {
    if (!el) return;
    const k = LP_KINDS[el.dataset.lp], g = el.dataset.lpg || '';
    if (armed && k) {
      _lpAt = Date.now();
      if (dragging) {
        const ids = sibs().map(n => n.dataset.lpid);
        k.order(ids, g); save();
        if (k.after) k.after(g); else if (k.rerender) render();
        toast('已调整顺序');
      } else {
        const id = el.dataset.lpid;
        reset();
        k.edit(id, g);
        return;
      }
    }
    reset();
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', () => { const was = armed; reset(); if (was) _lpAt = Date.now(); });
  // 长按后的那次点击不触发原来的点击动作
  // （不管点在哪：长按后弹出的编辑面板正好在手指下面，那次点击会落在遮罩上把面板关掉）
  document.addEventListener('click', e => { if (_lpAt !== Infinity && Date.now() - _lpAt < 450) { e.stopPropagation(); e.preventDefault(); } }, true);
  document.addEventListener('contextmenu', e => { if (e.target.closest('[data-lp]')) e.preventDefault(); });
}
