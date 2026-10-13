'use strict';
/* 路由：页面栈、渲染、返回键 */
const Pages = {}, After = {};
const TABS = ['home', 'list', 'report', 'me'];
const stack = [{ name: 'home' }];
let _rendered = null;
/* 返回上一页时直接复用离开时摘下来的 DOM。L/R/AV 等页面状态是全局共用的，
   所以只有数据没变（_dataVer）且该页面类型最后一次渲染就是这个栈条目时才复用 */
const _owner = {};
function render() {
  const cur = stack[stack.length - 1];
  if (SEL && cur.name !== 'list') SEL = null;
  const same = cur === _rendered;
  const y = same ? window.scrollY : (cur.y || 0);
  const inner = same && $('.add-body') ? $('.add-body').scrollTop : 0;
  const isTab = TABS.includes(cur.name);
  $('#tabbar').style.display = isTab ? '' : 'none';
  $('#app').classList.toggle('notab', !isTab);
  document.querySelectorAll('#tabbar a[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === cur.name));
  document.body.classList.toggle('swap', !!S.settings.swap);
  const node = cur.node; cur.node = null;
  if (!same && node && cur.ver === _dataVer && _owner[cur.name] === cur) $('#view').replaceChildren(node);
  else {
    $('#view').innerHTML = Pages[cur.name](cur.p);
    After[cur.name] && After[cur.name](cur.p);
  }
  _owner[cur.name] = cur;
  _rendered = cur;
  const vl = vlActive();
  if (vl && !same && cur.vs && vl.shift !== cur.vs) {
    // 重新渲染的长列表：恢复离开时的映射偏移，否则回到的位置不对
    vl.shift = cur.vs; window.scrollTo(0, y); vlUpdate(vl, true, true);
  } else { window.scrollTo(0, y); if (vl) vlUpdate(vl); }
  if (inner && $('.add-body')) $('.add-body').scrollTop = inner;
}
function go(name, p) {
  const cur = stack[stack.length - 1];
  cur.y = window.scrollY;
  const vl0 = vlActive(); cur.vs = vl0 ? vl0.shift : 0;
  if (cur === _rendered && !SEL) {
    const f = document.createDocumentFragment(), v = $('#view');
    while (v.firstChild) f.appendChild(v.firstChild);
    cur.node = f; cur.ver = _dataVer;
  }
  stack.push({ name, p }); render(); window.scrollTo(0, 0);
}
function tab(name) { stack.length = 0; stack.push({ name }); render(); }
function back() {
  if ($('#sheet').classList.contains('on')) { closeSheet(); return true; }
  if ($('#lock').classList.contains('on')) return false;
  const top = stack[stack.length - 1];
  if (top.name === 'report' && R.pcat) { R.pcat = ''; render(); return true; }
  if (top.name === 'ocr') releaseLocalOcr();
  if (stack.length > 1) { stack.pop(); render(); return true; }
  if (stack[0].name !== 'home') { tab('home'); return true; }
  return false;
}
window.appBack = back;
const hdr = (title, right = '') => `<header class="bar"><b class="bk" onclick="back()">‹</b><h1>${title}</h1><div class="bar-r">${right}</div></header>`;
const empty = (msg, icon = '📝') => `<div class="empty"><i>${icon}</i>${msg}</div>`;
