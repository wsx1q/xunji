'use strict';
/* 成员 / 商家 / 项目管理 */
function manageMembers() { manageTags('member'); }
function manageTags(f) {
  const T = TAGS[f], list = S[T.list];
  const cnt = countBy(t => t[f] || T.def), used = m => cnt.get(m) || 0;
  openSheet(T.name + '管理', (list.map((m, i) => `<div class="opt" data-lp="tag" data-lpid="${esc(m)}" data-lpg="${f}"><div class="ci">${T.icon}</div><span>${esc(m)}<small class="opt-sub">${used(m)} 笔记录</small></span>${m === T.def ? '<em>默认</em>' : `<em style="color:#E5484D" onclick="delTag('${f}',${i})">删除</em>`}</div>`).join('') || empty('还没有' + T.name, T.icon))
    + `<label>添加${T.name}</label><div class="btn-row"><input id="mIn" class="field" placeholder="${T.name}名称" maxlength="12"><button class="btn" style="margin:0;width:90px;flex:none;height:44px" onclick="const v=$('#mIn').value.trim();if(v&&!S['${T.list}'].includes(v)){S['${T.list}'].push(v);save()}manageTags('${f}')">添加</button></div>
    <div class="tip">长按改名（已有记录一起改），改成已有的名字就是合并；长按后拖动调整顺序。删除${T.name}不会删除记录，已有记录里的名称会保留。</div>`);
}
/** 删除成员 / 商家 / 项目：先二次确认（显示有多少笔记录用到），取消回到管理列表 */
function delTag(f, i) {
  const T = TAGS[f], m = S[T.list][i];
  if (m === undefined) return manageTags(f);
  const n = S.txns.filter(t => (t[f] || T.def) === m).length;
  _sheetCb = () => { const k = S[T.list].indexOf(m); if (k >= 0) S[T.list].splice(k, 1); save(); toast('已删除'); manageTags(f); render(); };
  openSheet(`删除${T.name}`, `<div class="confirm-msg">确定删除${T.name}「${esc(m)}」吗？${n ? `<br><small style="color:var(--t2)">有 ${n} 笔记录用到它，删除后这些记录里的名称仍会保留，只是不再出现在选择列表里。</small>` : ''}</div>
    <div class="btn-row"><button class="btn ghost" style="color:#666" onclick="manageTags('${f}')">取消</button><button class="btn" style="background:#E5484D" onclick="_sheetCb()">删除</button></div>`);
}
/** 成员 / 商家 / 项目改名：连带改掉已有记录、看板条件和"上次使用"里的旧名字 */
function renameTag(f, old) {
  const T = TAGS[f];
  if (old === T.def) return toast(`默认${T.name}不能改名`);
  _sheetCb = nw => {
    nw = (nw || '').trim();
    if (!nw || nw === old) return manageTags(f);
    if (S[T.list].includes(nw) || nw === T.def) {
      const n = S.txns.filter(t => (t[f] || T.def) === old).length;
      return askConfirm(`已有${T.name}「${esc(nw)}」，把「${esc(old)}」合并进去？<br><small style="color:var(--t2)">${n} 条记录会改成「${esc(nw)}」，「${esc(old)}」从名单里删除。</small>`, () => {
        mergeRun(`${T.name}「${old}」合并到「${nw}」`, () => `${T.name}「${esc(old)}」已合并到「${esc(nw)}」，改了 <b>${mergeTag(f, old, nw)}</b> 条记录。`, () => manageTags(f));
      }, '合并');
    }
    const L2 = S[T.list]; L2[L2.indexOf(old)] = nw;
    if (S.txns.some(t => t[f] === old)) S.txns = S.txns.map(t => (t[f] === old ? { ...t, [f]: nw } : t)); // 换新对象，存储按年份切片靠引用判断变化
    for (const b of S.settings.home.boards) if (b.custom && b[T.list]) b[T.list] = b[T.list].map(x => (x === old ? nw : x));
    for (const k of Object.keys(S.settings.last || {})) { const o = S.settings.last[k]; if (o && o[f] === old) o[f] = nw; }
    save(); toast('已改名'); manageTags(f); render();
  };
  openSheet(`${T.name}改名`, `<input id="tagIn" class="field" value="${esc(old)}" maxlength="12" onkeydown="if(event.key==='Enter')_sheetCb(this.value)">
    <div class="tip">已有记录里的「${esc(old)}」会一起改成新名字。</div>
    <div class="btn-row"><button class="btn ghost" style="color:#555" onclick="manageTags('${f}')">取消</button><button class="btn" onclick="_sheetCb($('#tagIn').value)">保存</button></div>`);
  setTimeout(() => { const i = $('#tagIn'); if (i) { i.focus(); i.select(); } }, 150);
}
