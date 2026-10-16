'use strict';
/* 成员 / 商家 / 项目管理：点击看流水，长按打开编辑（改名 / 删除 / 合并到…），长按后拖动排序；数字是记录笔数 */
function openTagLedger(f,value){const fields={member:'members',merchant:'merchants',project:'projects'};openLedgerDetails({scope:'allBooks',filters:{[fields[f]]:[value]}});}
function manageMembers() { manageTags('member'); }
const tagCount = (f, m) => S.txns.reduce((a, t) => a + ((t[f] || TAGS[f].def) === m ? 1 : 0), 0);
function manageTags(f) {
  const T = TAGS[f], list = S[T.list];
  const cnt = tagCounts(f);
  openSheet(T.name + '管理', (list.map(m => { const n = cnt.get(m) || 0; return `<div class="opt" data-v="${esc(m)}" data-lp="tag" data-lpid="${esc(m)}" data-lpg="${f}" onclick="openTagLedger('${f}',this.dataset.v)"><div class="ci">${T.icon}</div><span>${esc(m)}${n ? `<i class="cnt">${n}</i>` : ''}</span><em>${m === T.def ? '默认' : ''}</em></div>`; }).join('') || empty('还没有' + T.name, T.icon))
    + `<label>添加${T.name}</label><div class="btn-row"><input id="mIn" class="field" placeholder="${T.name}名称" maxlength="12"><button class="btn add-btn" onclick="const v=$('#mIn').value.trim();if(v&&!S['${T.list}'].includes(v)){S['${T.list}'].push(v);save()}manageTags('${f}')">添加</button></div>
    <div class="tip">数字是记录笔数。点击名称查看流水；长按或右键可改名、删除、合并；长按后拖动调整顺序。删除${T.name}不会删除记录，已有记录里的名称会保留。</div>`);
}
/* 从选择面板（记一笔、筛选）长按进来编辑：保存 / 删除 / 合并后回到那个面板，否则回到管理列表 */
let _tagReturn = null;
function tagBack(f) { const r = _tagReturn; _tagReturn = null; r ? r() : manageTags(f); }
/** 编辑一个成员 / 商家 / 项目：和编辑分类同样的按钮（删除 / 合并到… / 保存） */
function editTag(f, m, ret = null) {
  const T = TAGS[f];
  if (m === T.def) return toast(`默认${T.name}「${m}」不能修改`);
  _tagReturn = ret;
  const n = tagCount(f, m);
  _sheetCb = nw => tagSave(f, m, nw);
  openSheet(`编辑${T.name}`, `<input id="tagIn" class="field" value="${esc(m)}" maxlength="12" onkeydown="if(event.key==='Enter')_sheetCb(this.value)">
    <div class="cat-n">${n ? `共 <b>${n}</b> 笔记录，改名会一起改；改成已有的名字就是合并` : '还没有记录，可以直接删除'}</div>
    <div class="btn-row"><button class="btn ghost del" data-v="${esc(m)}" onclick="delTag('${f}',this.dataset.v)">删除</button>${S[T.list].length > 1 ? `<button class="btn ghost" data-v="${esc(m)}" onclick="tagMergeSheet('${f}',this.dataset.v)">合并到…</button>` : ''}<button class="btn" onclick="_sheetCb($('#tagIn').value)">保存</button></div>`);
}
/** 删除：没有记录的直接删，有记录的二次确认（记录里的名字保留） */
function delTag(f, m) {
  const T = TAGS[f], n = tagCount(f, m);
  const drop = () => { S[T.list] = S[T.list].filter(x => x !== m); save(); toast('已删除'); render(); tagBack(f); };
  if (!n) return drop();
  askConfirm(`确定删除${T.name}「${esc(m)}」吗？<br><small style="color:var(--t2)">有 ${n} 笔记录用到它，删除后这些记录里的名称仍会保留，只是不再出现在选择列表里。想把记录归到别的${T.name}，用「合并到…」。</small>`, drop, '删除');
}
function tagMergeSheet(f, m) {
  const T = TAGS[f];
  _sheetCb = to => tagMergeAsk(f, m, to);
  openSheet(`把「${esc(m)}」合并到`, tagRows(f, S[T.list].filter(x => x !== m), () => false, '_sheetCb(this.dataset.v)')
    + `<div class="tip">「${esc(m)}」的所有记录都会改成选中的${T.name}，然后从名单里删除「${esc(m)}」。</div>`);
}
function tagMergeAsk(f, old, nw) {
  const T = TAGS[f], n = tagCount(f, old);
  askConfirm(`把${T.name}「${esc(old)}」合并到「${esc(nw)}」？<br><small style="color:var(--t2)">${n} 条记录会改成「${esc(nw)}」，「${esc(old)}」从名单里删除。</small>`, () => {
    mergeRun(`${T.name}「${old}」合并到「${nw}」`, () => `${T.name}「${esc(old)}」已合并到「${esc(nw)}」，改了 <b>${mergeTag(f, old, nw)}</b> 条记录。`, () => tagBack(f));
  }, '合并');
}
/** 保存改名：改成已有的名字就是合并；否则连带改掉已有记录、看板条件和「上次使用」里的旧名字 */
function tagSave(f, old, nw) {
  const T = TAGS[f];
  nw = (nw || '').trim();
  if (!nw || nw === old) return tagBack(f);
  if (S[T.list].includes(nw) || nw === T.def) return tagMergeAsk(f, old, nw);
  const L2 = S[T.list]; L2[L2.indexOf(old)] = nw;
  if (S.txns.some(t => t[f] === old)) S.txns = S.txns.map(t => (t[f] === old ? { ...t, [f]: nw } : t)); // 换新对象，存储按年份切片靠引用判断变化
  for (const b of S.settings.home.boards) if (b.custom && b[T.list]) b[T.list] = b[T.list].map(x => (x === old ? nw : x));
  for (const k of Object.keys(S.settings.last || {})) { const o = S.settings.last[k]; if (o && o[f] === old) o[f] = nw; }
  save(); toast('已保存'); render(); tagBack(f);
}
