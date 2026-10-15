'use strict';
/* Desktop presentation only. All mutations, calculations, imports and undo use the mobile functions. */
const D = { focus: '', anchor: '', dragging: null, dialogFocus: null };
const desktopIcon = (name, size = 20) => {
  const paths = {
    home: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
    chart: '<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
    account: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M15 15h3"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 17h.01"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    edit: '<path d="m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.folder}</svg>`;
};
const desktopAttr = value => esc(JSON.stringify(value));
const desktopNavItems = [
  ['home', 'home', '账本总览', "tab('home')"], ['list', 'list', '收支流水', "openList('month')"],
  ['report', 'chart', '统计报表', "tab('report')"], ['accounts', 'account', '账户资产', "go('accounts')"],
  ['dash', 'home', '自定义看板', "go('dash')"], ['imports', 'folder', '识别与导入', 'desktopImports()'],
  ['me', 'settings', '设置与数据', "tab('me')"],
];
document.body.classList.add('desktop');
document.body.insertAdjacentHTML('afterbegin', `<aside class="desk-sidebar">
  <div class="desk-brand"><i><img src="/desktop/app.png" width="44" height="44" alt=""></i><div>洵记<small>让每一笔，都有迹可循</small></div><span>DESKTOP</span></div>
  <button class="desk-book" onclick="S&&pickBook()"><span>当前账本</span><b id="deskBookName">正在打开…</b><em>⌄</em></button>
  <div class="desk-nav-label">工作空间</div><nav class="desk-nav">${desktopNavItems.map(([id, icon, title, click]) => `<button data-page="${id}" onclick="if(S){${click}}">${desktopIcon(icon)}<span>${title}</span></button>`).join('')}</nav>
  <button id="deskOcrResume" class="desk-ocr-resume" hidden onclick="S&&openOcr()"></button>
  <div class="desk-nav-label desk-manage-label">管理</div><div class="desk-manage"><button onclick="if(S){CT='expense';go('cats')}">分类</button><button onclick="S&&go('books')">账本</button><button onclick="S&&manageMembers()">成员</button><button onclick="S&&manageTags('merchant')">商家</button><button onclick="S&&manageTags('project')">项目</button><button onclick="S&&go('budget')">预算</button></div>
  <footer><span class="desk-offline-dot"></span>数据加密保存在本机<button title="使用说明" onclick="S&&go('help')">${desktopIcon('help', 17)}</button></footer>
</aside><header class="desk-toolbar"><div class="desk-breadcrumb"><button title="返回上一级 Alt+←" onclick="back()">‹</button><span>我的工作空间</span><i>/</i><b id="deskPageName">账本总览</b></div>
  <div class="desk-toolbar-actions"><button class="desk-search-button" onclick="S&&openSearch()">${desktopIcon('search', 17)}<span>搜索账目</span><kbd>Ctrl F</kbd></button><button class="desk-primary" onclick="S&&startAdd()">${desktopIcon('add', 18)}记一笔 <kbd>Ctrl N</kbd></button></div></header>
  <div id="deskContext" class="desk-context" hidden></div>
  <aside id="deskOcrTask" class="desk-ocr-task" hidden aria-label="后台识别任务"><div id="deskOcrTaskBody"></div><div class="desk-ocr-task-actions"><button class="desk-secondary" onclick="openOcr()">查看识别</button><button id="deskOcrDismiss" onclick="D.ocrDone=false;desktopOcrTaskSync()">稍后查看</button></div></aside>`);

function desktopSync() {
  const page = stack[stack.length - 1].name;
  if(D.page!==page||D.book!==S?.curBook){D.focus='';D.anchor='';}
  D.page=page;D.book=S?.curBook;
  document.body.dataset.page = page;
  const active = page === 'account' ? 'accounts' : page === 'board' || page === 'boardEdit' ? 'dash' : ['ocr','bill'].includes(page) ? 'imports' : page;
  document.querySelectorAll('.desk-nav [data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === active));
  const titles = {home:'账本总览', list:'收支流水', report:'统计报表', accounts:'账户资产', account:'账户明细',
    dash:'自定义看板', board:'看板明细', boardEdit:'编辑看板', me:'设置与数据', bill:'导入账单', add:E&&E.editId?'编辑记录':'记一笔',
    cats:'分类管理', books:'账本管理', budget:'预算管理', imports:'识别与导入', ocr:'截图识别', help:'使用说明'};
  $('#deskPageName').textContent = titles[page] || '我的账本';
  $('#deskBookName').textContent = S ? curBook().name : '正在打开…';
  document.title = `洵记 · ${titles[page] || '桌面版'}`;
  desktopEnhance();
  desktopOcrTaskSync();
}
const mobileRender = render;
render = function () { mobileRender(); desktopSync(); };

function desktopEnhance() {
  document.querySelectorAll('#view [data-lp],#sheet [data-lp]').forEach(el => {
    const sortOnly = LP_KINDS[el.dataset.lp]?.sortOnly;
    el.draggable = true; el.title = sortOnly ? '拖动排序 · Alt+↑/↓ 调整顺序' : '右键编辑 · 拖动排序';
    if (sortOnly) { el.tabIndex = 0; el.setAttribute('aria-label', (el.querySelector('span:not(.home-drag-handle)')?.textContent || '看板') + '，可拖动排序'); }
  });
  document.querySelectorAll('#view [onclick],#sheet [onclick]').forEach(el => {
    if (!/^(BUTTON|INPUT|SELECT|TEXTAREA|A|LABEL)$/.test(el.tagName) && !el.hasAttribute('tabindex')) {
      el.tabIndex = 0; el.setAttribute('role', 'button');
    }
  });
  const dialog = $('#sheet .sh-box');
  if (dialog) { dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', $('#sheet .sh-hd span').textContent); }
}
const mobileOpenSheet = openSheet, mobileCloseSheet = closeSheet;
openSheet = function (title, body) {
  if (!$('#sheet').classList.contains('on')) D.dialogFocus = document.activeElement;
  mobileOpenSheet(title.replaceAll('指纹','Windows Hello'), body.replaceAll('指纹','Windows Hello')); desktopEnhance();
  requestAnimationFrame(() => { if ($('#sheet').classList.contains('on') && !$('#sheet').contains(document.activeElement)) ($('#sheet input:not([type=hidden]),#sheet button,#sheet [tabindex="0"]') || $('#sheet .sh-hd b'))?.focus(); });
};
closeSheet = function () { mobileCloseSheet(); if (D.dialogFocus?.isConnected) D.dialogFocus.focus(); };

Pages.home = () => {
  const tx = bookTx(), [s,e] = periodRange('month'), mt = inRange(tx,s,e), exp = sumT(mt,'expense'), inc = sumT(mt,'income');
  const bg = budget(), h = S.settings.home, bal = balances(), net = r2(Object.values(bal).reduce((a,b)=>a+b,0));
  const metric = (label,value,sub,cls,fn) => `<button class="desk-metric ${cls}" onclick="${fn}"><span>${label}</span><b>${value}</b><small>${sub}</small></button>`;
  return `<div class="desk-page-heading"><div><p>${new Date().getFullYear()} 年 ${new Date().getMonth()+1} 月 · 财务概览</p><h1>每一笔收支，心中有数。</h1></div><button class="desk-secondary" onclick="go('dash')">${desktopIcon('settings',16)}自定义总览</button></div>
  <div class="desk-metrics">${metric('本月支出',money(exp),`${mt.filter(t=>t.type==='expense').length} 笔支出记录`,'metric-exp',"openList('month');L.type='expense';render()")}
  ${metric('本月收入',money(inc),`${mt.filter(t=>t.type==='income').length} 笔收入记录`,'metric-inc',"openList('month');L.type='income';render()")}
  ${metric('本月结余',money(inc-exp),'收入 − 支出','metric-balance',"openList('month')")}
  ${metric('净资产',money(net),`${S.accounts.length} 个账户 · 查看流水`,'metric-assets',"homeAssetLedger()")}</div>
  <div class="desk-dashboard">${h.widgets.filter(w=>w.on).map(w=>`<section class="desk-widget widget-${w.id}">${HomeW[w.id]({tx,mt,exp,bg,h}).replaceAll('点击下方 ＋ 记一笔','点击右上角「记一笔」开始记录')}</section>`).join('') || `<section class="desk-widget">${empty('点击自定义总览添加模块')}</section>`}</div>`;
};

const mobileListPage = Pages.list;
const mobileDashPage = Pages.dash;
Pages.dash = () => mobileDashPage().replaceAll('长按拖动排序', '拖动排序，松手自动保存');
const desktopTableHead = () => `<div class="desk-table-head"><span></span><span>日期 / 时间</span><span>分类</span><span>账户</span><span>成员 / 项目</span><span>备注 / 商家</span><span>金额</span><span>操作</span></div>`;
Pages.list = () => mobileListPage().replace('<div id="lbody"', desktopTableHead() + '<div id="lbody"');
const mobileReportPage = Pages.report;
const desktopReportState = { cards: [true, true, true], ranks: {} };
function desktopReportToggle(el, index) {
  if (el.isConnected) desktopReportState.cards[index] = el.open;
}
function desktopReportRanks(el) {
  if (el.isConnected) desktopReportState.ranks[el.dataset.key] = el.open;
}
Pages.report = () => {
  const template = document.createElement('template');
  template.innerHTML = mobileReportPage();
  const key = `${S.curBook}:${R.type}:${R.pcat}`;
  template.content.querySelectorAll('.card').forEach((card, index) => {
    if (index === 0) {
      const rows = [...card.querySelectorAll(':scope > .rank')];
      if (rows.length > 3) {
        const more = document.createElement('details');
        more.className = 'desk-report-ranks';
        more.dataset.key = key;
        more.open = !!desktopReportState.ranks[key];
        more.setAttribute('ontoggle', 'desktopReportRanks(this)');
        more.innerHTML = `<summary><span class="when-closed">展开其余 ${rows.length - 3} 项</span><span class="when-open">收起分类明细</span><small>共 ${rows.length} 项</small></summary><div class="desk-report-rank-scroll" tabindex="0" role="region" aria-label="其余分类明细"></div>`;
        more.firstElementChild.setAttribute('onclick', 'desktopReportState.ranks[this.parentElement.dataset.key]=!this.parentElement.open');
        rows[3].before(more);
        rows.slice(3).forEach(row => more.lastElementChild.append(row));
      }
    }
    const panel = document.createElement('details');
    panel.className = `card desk-report-panel report-panel-${index}`;
    panel.open = desktopReportState.cards[index];
    panel.setAttribute('ontoggle', `desktopReportToggle(this,${index})`);
    const heading = card.querySelector('.card-hd');
    const summary = document.createElement('summary');
    summary.className = 'card-hd';
    summary.setAttribute('onclick', `if(!event.target.closest('a'))desktopReportState.cards[${index}]=!this.parentElement.open`);
    summary.innerHTML = heading.innerHTML + '<span class="desk-report-toggle"><span class="when-open">收起</span><span class="when-closed">展开</span></span>';
    heading.remove();
    const body = document.createElement('div');
    body.className = 'desk-report-body';
    body.append(...card.childNodes);
    panel.append(summary, body);
    card.replaceWith(panel);
  });
  return `<div class="desk-report">${template.innerHTML}</div>`;
};
const mobileReplaceTxn=vlReplaceTxn;
vlReplaceTxn=function(next){return $('#lbody')?false:mobileReplaceTxn(next);};
const mobileSettings = Pages.me;
Pages.me = () => `<div class="desk-settings">${mobileSettings().replaceAll('指纹解锁','Windows Hello').replaceAll('App 内部存储','电脑数据文件夹')}</div>`;
const mobileHelp = Pages.help;
Pages.help = () => mobileHelp().replaceAll('点底部「＋」','点右上角「记一笔」或按 Ctrl+N').replaceAll('向左滑出现','右键或行末操作可').replaceAll('长按后拖动','拖动').replaceAll('长按','右键').replaceAll('短按','单击').replaceAll('底部「搜索」','顶部「搜索账目」').replaceAll('新手机','另一台设备').replaceAll('Download/XunJi','导出时选择的位置');

txItem = function (t, opt={}) {
  const adjustment=t.type==='adjust', transfer=t.type==='transfer';
  const name = transfer?'转账':adjustment?'余额变更':catLabel(t.catId);
  let cls=t.type, sign='', amount=t.amount;
  if (transfer) { if (opt.acc) {sign=t.accountId===opt.acc?'-':'+';cls=t.accountId===opt.acc?'expense':'income';} }
  else {sign=(t.type==='expense')===(amount>=0)?'-':'+';if(adjustment)sign=amount>=0?'+':'-';if(amount<0)cls=t.type==='expense'?'income':'expense';if(adjustment)cls=amount>=0?'income':'expense';amount=Math.abs(amount);}
  const id=desktopAttr(t.id), account=accName(t.accountId)+(transfer?' → '+accName(t.toAccountId):'');
  return `<div class="tx-w desk-row ${SEL&&SEL.has(t.id)?'on':''} ${D.focus===t.id?'is-focused':''}" data-id="${esc(t.id)}"><div class="tx" onclick="desktopTxClick(${id},event)" ondblclick="desktopEdit(${id})">
    <button class="desk-check ${SEL&&SEL.has(t.id)?'checked':''}" aria-label="选择记录" onclick="event.stopPropagation();desktopSelect(${id},event)">${SEL&&SEL.has(t.id)?'✓':''}</button>
    <span class="desk-date">${ymd(t.time)}<small>${hm(t.time)}</small></span><span class="desk-category">${transfer?'🔁':adjustment?'↕':catById(t.catId).icon}<b>${esc(name)}</b></span>
    <span class="desk-cell" title="${esc(account)}">${esc(account)}${opt.book||(stack[stack.length-1].name==='list'&&L.scope==='allBooks')?`<small>${esc(S.books.find(b=>b.id===t.bookId)?.name||'未命名账本')}</small>`:''}</span><span class="desk-cell">${esc(t.member||'本人')}<small>${esc(t.project||'—')}</small></span>
    <span class="desk-cell" title="${esc(t.note||'')}">${esc(t.note||'—')}<small>${esc(t.merchant||'')}</small></span><span class="tx-a ${cls}">${sign}${money(amount)}</span>
    <span class="desk-row-actions"><button title="编辑" aria-label="编辑记录" onclick="event.stopPropagation();desktopEdit(${id})">${desktopIcon('edit',15)}</button><button title="复制" aria-label="复制记录" ${adjustment?'disabled':''} onclick="event.stopPropagation();txCopy(${id})">${desktopIcon('copy',15)}</button><button class="danger" title="删除" aria-label="删除记录" onclick="event.stopPropagation();txDel(${id})">${desktopIcon('trash',15)}</button></span></div></div>`;
};
VL_EST.hd=44; VL_EST.r1=49; VL_EST.r2=49;
function desktopEdit(id) { D.focus=id; closeDesktopContext(); startAdd(id); }
function desktopTxClick(id,event) {
  if (event.ctrlKey||event.metaKey||event.shiftKey||SEL) return desktopSelect(id,event);
  D.focus=id; D.anchor=id; document.querySelectorAll('.desk-row').forEach(el=>el.classList.toggle('is-focused',el.dataset.id===id));
}
function desktopSelect(id,event={}) {
  if (stack[stack.length-1].name!=='list') openList('all');
  if (!SEL) selStart();
  const ids=L.ids||[], a=ids.indexOf(D.anchor), b=ids.indexOf(id);
  if (event.shiftKey&&a>=0&&b>=0) ids.slice(Math.min(a,b),Math.max(a,b)+1).forEach(x=>SEL.add(x));
  else {SEL.has(id)?SEL.delete(id):SEL.add(id);D.anchor=id;}
  D.focus=id; $('#lbody')?.classList.add('selm'); selMark(); selBar();
  document.querySelectorAll('.desk-row .desk-check').forEach(el=>{const on=SEL.has(el.closest('.desk-row').dataset.id);el.classList.toggle('checked',on);el.textContent=on?'✓':'';});
}
const mobileSelMark=selMark;
selMark=function(){mobileSelMark();document.querySelectorAll('.desk-row .desk-check').forEach(el=>{const on=!!SEL&&SEL.has(el.closest('.desk-row').dataset.id);el.classList.toggle('checked',on);el.textContent=on?'✓':'';});};

Pages.add = () => {
  if (!E) {setTimeout(back);return '';}
  const transfer=E.type==='transfer';
  if (!transfer&&!S.categories[E.type].some(c=>c.id===E.catId)) E.catId=defaultCatId(E.type);
  CGS.deskentry={type:E.type,mode:'single',open:transfer?'':topOf(E.catId).id,sel:transfer?[]:[E.catId],
    pick:id=>{E.catId=id;E.recentOn=false;render();},rerender:render};
  _catPickReopen=()=>{if(E)render();};
  const pick=(label,value,fn)=>`<label class="desk-field"><span>${label}</span><button class="field" onclick="${fn}">${esc(value||'未设置')} <em>⌄</em></button></label>`;
  const account=(field,label)=>`<div class="desk-transfer-account"><span>${label}</span><button onclick="pickAcc('${field}')">${esc(accName(E[field]))} ⌄</button><small>余额 ${money(balances()[E[field]]||0)}</small></div>`;
  return `<div class="desk-page-heading"><div><p>记录收支 · ${esc(curBook().name)}</p><h1>${E.editId?'编辑这笔记录':'记下一笔新的收支'}</h1></div><button class="desk-secondary" onclick="back()">取消 · Esc</button></div>
    <div class="desk-entry"><section class="card desk-entry-categories"><div class="desk-entry-title"><h2>${transfer?'转账账户':'选择分类'}</h2><div class="seg light">${[['expense','支出'],['income','收入'],['transfer','转账']].map(([k,n])=>`<i class="${E.type===k?'on':''}" onclick="setType('${k}')">${n}</i>`).join('')}</div></div>
    ${transfer?`<div class="desk-transfer">${account('accountId','转出账户')}<button class="desk-secondary" onclick="swapAcc()">⇄ 交换</button>${account('toAccountId','转入账户')}</div>`:
      `<div class="desk-recent"><span>最近使用</span>${recentCats(E.type).map(id=>`<button class="chip ${E.catId===id?'on':''}" onclick="E.catId=${desktopAttr(id)};E.recentOn=false;render()">${catById(id).icon} ${esc(catLabel(id))}</button>`).join('')||'<small>保存后会记住最近使用的分类</small>'}</div><div class="cg-box">${catGridHtml('deskentry')}</div><button class="desk-text-button" onclick="CT=E.type;go('cats')">管理分类 →</button>`}
    <div class="desk-entry-tip">${transfer?'转账不计入收入和支出，只改变两个账户的余额。':'右键分类可编辑、合并；拖动图标可调整顺序。'}</div></section>
    <section class="card desk-entry-form"><div class="desk-entry-title"><h2>记录详情</h2><span id="amtCat"></span></div>
      <label class="desk-field desk-amount"><span>金额 <small>支持 12+8.5−3 的计算</small></span><div><b>¥</b><input id="deskAmount" aria-label="金额" inputmode="decimal" value="${esc(E.expr)}" placeholder="0.00" autocomplete="off" oninput="desktopAmount(this)"></div></label>
      <div class="desk-amount-result"><small id="expr"></small><span>合计 <b id="amt"></b></span></div>
      <div class="desk-form-grid">${!transfer?pick('账户',accName(E.accountId),"pickAcc('accountId')"):''}
      <label class="desk-field"><span>日期</span><input type="date" aria-label="日期" value="${ymd(E.time)}" max="${ymd(Date.now())}" onchange="desktopDateTime(this.value,null)"></label>
      <label class="desk-field"><span>时间</span><input type="time" aria-label="时间" value="${hm(E.time)}" onchange="desktopDateTime(null,this.value)"></label>
      ${pick('成员',E.member||'本人',"pickTag('member')")}${pick('商家',E.merchant,"pickTag('merchant')")}${pick('项目',E.project,"pickTag('project')")}
      ${S.books.length>1?pick('账本',(S.books.find(b=>b.id===E.bookId)||curBook()).name,'pickTxBook()'):''}</div>
      <label class="desk-field"><span>备注</span><textarea aria-label="备注" maxlength="${NOTE_MAX}" rows="3" placeholder="为这笔记录补充一些说明…" oninput="E.note=this.value">${esc(E.note||'')}</textarea></label>
      <div class="desk-entry-buttons"><button class="desk-secondary" onclick="desktopSave(true)">${E.editId?'保存修改':'保存并继续'}</button><button class="desk-primary" id="kok" onclick="desktopSave(false)">保存记录</button></div>
      <div class="desk-entry-shortcut">Ctrl + Enter 保存 · Esc 返回${E.editId?' · ':''}${E.editId?'<button class="danger" onclick="delTx()">删除这条记录</button>':''}</div></section></div>`;
};
After.add=()=>{updAmt();updCat();requestAnimationFrame(()=>{if(E&&stack.at(-1).name==='add'&&!$('#sheet').classList.contains('on')){const input=$('#deskAmount');input?.focus();if(E.fresh)input?.select();}});};
function desktopAmount(input) {input.value=input.value.replace(/[^\d.+\-]/g,'');E.expr=input.value;E.fresh=false;updAmt();}
function desktopDateTime(date,time) {const value=new Date(`${date||ymd(E.time)}T${time||hm(E.time)}:00`).getTime();if(Number.isFinite(value))E.time=value;}
function desktopSave(again) {if(!E)return;if(hasOp(E.expr)){E.expr=String(evalExpr(E.expr));updAmt();}saveTx(again&&!E.editId);}

function desktopImports() {
  closeSheet();
  if (stack.at(-1).name !== 'imports') go('imports'); else render();
}
const desktopImport = { busy: false, error: '' };
function desktopDropZone(kind = 'all', compact = false) {
  const accept = kind === 'image' ? '.png,.jpg,.jpeg,.webp,.bmp,.gif' : kind === 'bill' ? '.csv,.xlsx' : '.png,.jpg,.jpeg,.webp,.bmp,.gif,.csv,.xlsx,.kbf,.db,.json';
  const busy = desktopImport.busy || OC?.busy || BI?.busy;
  return `<section class="desk-file-drop ${compact ? 'compact' : ''} ${busy ? 'is-busy' : ''}" data-desktop-drop aria-label="文件拖入区域" aria-busy="${!!busy}">
    <div class="desk-drop-icon">${desktopIcon('folder', compact ? 28 : 40)}<span>↓</span></div>
    <h2>${busy ? '正在处理文件…' : kind === 'image' ? '将订单截图拖到这里' : kind === 'bill' ? '将支付宝 / 微信账单拖到这里' : '将截图、账单或备份拖到这里'}</h2>
    <p>${kind === 'image' ? '支持批量图片 · 本机离线识别' : kind === 'bill' ? '支持 CSV / XLSX · 可一次拖入多份账单' : '自动识别文件类型，带你进入对应的预览与确认页面'}</p>
    <div class="desk-drop-alternative"><span>也可以</span><button class="desk-secondary" onclick="this.closest('[data-desktop-drop]').querySelector('input').click()" ${busy ? 'disabled' : ''}>选择文件</button></div>
    <input type="file" hidden multiple accept="${accept}" onchange="desktopImportInput(this)">
    ${desktopImport.error ? `<div class="desk-import-error" role="alert">${esc(desktopImport.error)}</div>` : ''}
  </section>`;
}
Pages.imports = () => `<div class="desk-import-page">
  <div class="desk-page-heading"><div><p>从文件开始，整理你的账目</p><h1>识别与导入</h1></div><div class="desk-import-steps"><b>1 拖入文件</b><span>→</span>2 预览核对<span>→</span>3 确认导入</div></div>
  ${desktopDropZone()}
  <div class="desk-import-formats">
    <article><i>📷</i><h3>订单截图</h3><p>淘宝、京东、拼多多、抖音、超盒算</p><small>PNG / JPG / WEBP / BMP / GIF · 支持批量</small></article>
    <article><i>📥</i><h3>支付宝 / 微信账单</h3><p>自动解析收支，预览时核对分类和账户</p><small>CSV / XLSX · 支持批量</small></article>
    <article><i>🗃️</i><h3>随手记备份</h3><p>保留账户、分类与流水，核对后导入</p><small>KBF · 每次一份</small></article>
    <article><i>💾</i><h3>洵记备份</h3><p>兼容手机备份，加密文件需输入密码</p><small>DB / JSON · 恢复会覆盖当前全部数据</small></article>
  </div><p class="desk-import-note">图片与账单可以批量拖入；不同类型请分次处理。拖入后先预览，确认后才写入账本。</p></div>`;
function desktopImportError(message) { desktopImport.error = message; render(); toast(message); }
function desktopImportInput(input) { const files = [...input.files]; input.value = ''; return desktopAcceptFiles(files); }
async function desktopAcceptFiles(files) {
  if (!S || $('#lock').classList.contains('on') || !files.length) return;
  if ($('#sheet').classList.contains('on')) return toast('请先完成或关闭当前对话框，再拖入文件');
  if (desktopImport.busy || OC?.busy || BI?.busy) return toast('正在处理文件，请完成后再拖入');
  const typeOf = file => /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name) ? 'image' : /\.(csv|xlsx)$/i.test(file.name) ? 'bill' : /\.kbf$/i.test(file.name) ? 'kbf' : /\.(db|json)$/i.test(file.name) ? 'backup' : '';
  const kinds = files.map(typeOf), kind = kinds[0];
  if (kinds.includes('')) return desktopImportError('不支持此文件类型，请拖入图片、CSV、XLSX、KBF 或洵记备份。');
  if (kinds.some(k => k !== kind)) return desktopImportError('不同类型的文件请分次拖入；图片和账单各自支持批量。');
  if (files.length > 1 && ['kbf','backup'].includes(kind)) return desktopImportError('备份文件每次只能处理一份，请单独拖入。');
  if (['image','bill'].includes(kind) && !S.accounts.length) return desktopImportError('请先添加账户，再识别或导入账单。');
  if (kind === 'image' && ocrMode() === 'pc' && !ocrUrl()) { openOcr(); return desktopImportError('请先配置 OCR 服务地址，或切换为本机离线识别。'); }
  desktopImport.error = ''; desktopImport.busy = true;
  try {
    if (kind === 'image') { if (stack.at(-1).name !== 'ocr') openOcr(); await ocrFiles({files,value:''}); }
    else if (kind === 'bill') await billFiles({files,value:''});
    else if (kind === 'kbf') { render(); kbfLoad(files[0].name, new Uint8Array(await files[0].arrayBuffer())); }
    else { render(); importText(await files[0].text()); }
  } catch (error) { desktopImportError('无法读取文件：' + (error.message || String(error))); }
  finally { desktopImport.busy = false; if(['imports','ocr','bill'].includes(stack.at(-1).name))render();else desktopOcrTaskSync(); }
}
dbSheet=function(){const db=dbInfo();openSheet('数据库位置',`<div class="kv"><span>加密方式</span><b>AES-256-GCM</b></div>${[['当前数据库',db.path],['默认位置',db.defaultPath],['自动备份（最近 5 份）',db.backupPath]].map(([l,p])=>`<label>${l}</label><div class="desk-path">${esc(p)}</div>`).join('')}<div class="tip">本机密钥由 Windows 账户保护。设置账本密码后，导出的加密备份可在手机和其他电脑恢复。</div><div class="btn-row"><button class="btn ghost" onclick="Android.openDataFolder()">打开所在文件夹</button><button class="btn" onclick="pickDbDir()">选择存放目录</button></div>${db.custom?'<button class="btn ghost" onclick="useDefaultDir()">改回默认位置</button>':''}`);};
const mobileBackupSheet=backupSheet;
backupSheet=function(){mobileBackupSheet();const body=$('#sheet .sh-bd');body.innerHTML=body.innerHTML.replaceAll('保存到「Download/XunJi」','导出时选择保存位置').replaceAll('新手机','另一台设备').replaceAll('（存在 App 内，保留最近 5 份，卸载 App 会一起删除）','（保存在本机数据文件夹，保留最近 5 份）').replaceAll('退出 App','关闭或切到后台');desktopEnhance();};
const mobileRenderLock=renderLock;
renderLock=function(){mobileRenderLock();document.querySelectorAll('.lk-bio').forEach(el=>el.textContent='使用 Windows Hello 解锁');};
const desktopOcrProfile = () => 'balanced';
window.__DESKTOP_OCR_OPTS__ = () => ({profile: desktopOcrProfile()});
window.__DESKTOP_OCR_NAME__ = () => 'PP-OCRv6 均衡 · 推荐';
window.__DESKTOP_OCR_FILE_KEY__ = async file => ({
  key: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join(''),
  profile: ocrMode() === 'local' ? desktopOcrProfile() : 'pc',
});
// Warm on entering OCR, expire idle models independently of retained results, and
// update progress in place so background results never replace another form.
D.ocrReadyProfiles=[];D.ocrWarm=null;D.ocrWasBusy=false;D.ocrDone=false;
function desktopOcrModelMarkup() {
  if(!S||ocrMode()!=='local')return '';
  const profile=desktopOcrProfile();
  if(D.ocrReadyProfiles.includes(profile))return '<span class="desk-model-ready">● 模型已就绪 · 闲置 3 分钟后释放</span>';
  if(D.ocrWarm?.profile===profile&&D.ocrWarm.error)return `<span class="desk-model-error">模型准备失败：${esc(D.ocrWarm.error)}</span><button onclick="ocrWarm()">重试</button>`;
  if(!D.ocrWarm)return '<span>模型未加载或已释放，识别时会自动准备；结果与备注已保留。</span>';
  return ocrProgressMarkup(D.ocrWarm.progress,'正在后台准备模型…');
}
function desktopOcrTaskSync() {
  const busy=!!OC?.busy,onPage=stack.at(-1).name==='ocr',locked=$('#lock')?.classList.contains('on');
  if(D.ocrWasBusy&&!busy&&!onPage)D.ocrDone=true;
  D.ocrWasBusy=busy;
  if(onPage&&!busy)D.ocrDone=false;
  const model=$('#deskOcrModelState');if(model)model.innerHTML=desktopOcrModelMarkup();
  const resume=$('#deskOcrResume');
  resume.hidden=!!locked||!(busy||OC?.imgs||OC?.items.length||OC?.err);
  resume.textContent=busy?'截图正在识别 · 查看进度':`查看识别结果 · ${OC?.items.length||0} 笔`;
  const task=$('#deskOcrTask');
  const warming=D.ocrWarm&&!D.ocrWarm.error&&!D.ocrReadyProfiles.includes(D.ocrWarm.profile);
  task.hidden=!!locked||onPage||!(busy||warming||D.ocrDone);
  if(!task.hidden){
    $('#deskOcrTaskBody').innerHTML=busy?ocrProgressMarkup():warming?ocrProgressMarkup(D.ocrWarm.progress,'正在后台准备 OCR 模型…'):`<b>${OC?.err?'识别结束，部分图片需要重试':'识别已完成'}</b><p>${OC?.items.length||0} 笔识别结果已保留，返回预览后确认导入。</p>`;
    $('#deskOcrDismiss').hidden=busy||!!warming;
  }
}
window.__DESKTOP_OCR_TASK_CHANGED__=desktopOcrTaskSync;
window.__DESKTOP_OCR_PROGRESS__=(id,progress)=>{
  if(D.ocrWarm?.id===id)D.ocrWarm.progress=progress;
  if(OC?.requestId===id&&progress.stage==='ready')D.ocrReadyProfiles=[desktopOcrProfile()];
  desktopOcrTaskSync();
};
window.__DESKTOP_OCR_RESULT__=(id,result)=>{
  if(Array.isArray(result.profiles))D.ocrReadyProfiles=result.profiles;
  desktopOcrTaskSync();
};
window.onOcrReleased=()=>{D.ocrReadyProfiles=[];desktopOcrTaskSync();};
ocrWarm=function(){
  if(!S||!LOCAL_OCR||ocrMode()!=='local'||OC?.busy||stack.at(-1).name!=='ocr')return;
  const profile=desktopOcrProfile();
  if(D.ocrReadyProfiles.includes(profile)||(D.ocrWarm?.profile===profile&&!D.ocrWarm.error))return;
  const id='deskWarm'+(++_ocrSeq),state={id,profile,progress:{stage:'queued',completed:0,total:0}};
  D.ocrWarm=state;desktopOcrTaskSync();
  const timer=setTimeout(()=>{delete _ocrWait[id];if(D.ocrWarm===state){state.error='准备超时，请重试';desktopOcrTaskSync();}},180000);
  _ocrWait[id]=result=>{clearTimeout(timer);if(D.ocrWarm===state){if(result.ok)D.ocrWarm=null;else state.error=result.err||'无法加载模型';desktopOcrTaskSync();}};
  try{Android.ocrLocal(id,'',JSON.stringify(ocrOpts()));}catch(error){_ocrWait[id]({ok:false,err:error.message});delete _ocrWait[id];}
};
const mobileOcrPage=Pages.ocr;
Pages.ocr=()=> {
  const template=document.createElement('template');
  template.innerHTML=mobileOcrPage().replaceAll('📱 本机识别','本机离线识别').replaceAll('💻 电脑识别','连接其他 OCR 服务').replaceAll('手机和电脑连同一个 WiFi','连接同一局域网中的 OCR 服务').replace(/<button class="btn oc-pick[^]*?<\/button>/, desktopDropZone('image', true));
  if(OC?.busy){
    const drop=template.content.querySelector('[data-desktop-drop]'),progress=template.content.querySelector('#ocrTaskProgress');
    if(drop&&progress){drop.classList.add('is-working');drop.replaceChildren(progress);}
  }
  if(ocrMode()==='local') {
    const heading=[...template.content.querySelectorAll('.card-hd')].find(el=>el.textContent.includes('本机识别 ·'));
    heading?.parentElement.insertAdjacentHTML('beforeend',`<p>完整识别字表，兼顾准确与速度。闲置后自动释放模型，保留识别结果与备注。</p><div id="deskOcrModelState">${desktopOcrModelMarkup()}</div>`);
  }
  return template.innerHTML;
};
const mobileBillPage = Pages.bill;
Pages.bill = () => mobileBillPage().replace(/<button class="btn[^>]*onclick="billPick\(\)"[^]*?<\/button>/, desktopDropZone('bill', true)).replace('也可以在微信 / 文件管理里点开账单文件 →「用其他应用打开」→ 选洵记。', '将下载好的账单文件直接拖入此窗口。');

function closeDesktopContext() {$('#deskContext').hidden=true;}
function desktopContext(event,rows) {const el=$('#deskContext');el.innerHTML=rows.map(([name,fn,danger])=>`<button class="${danger?'danger':''}" onclick="closeDesktopContext();${esc(fn)}">${esc(name)}</button>`).join('');el.hidden=false;el.style.left=Math.min(event.clientX,innerWidth-230)+'px';el.style.top=Math.min(event.clientY,innerHeight-rows.length*40-16)+'px';el.querySelector('button')?.focus();}
document.addEventListener('contextmenu',event=>{
  if($('#lock').classList.contains('on'))return;
  const row=event.target.closest('.desk-row'), item=event.target.closest('[data-lp]');
  if(row){event.preventDefault();const id=JSON.stringify(row.dataset.id);desktopContext(event,[['编辑记录',`desktopEdit(${id})`],['复制记录',`txCopy(${id})`],['选择这条记录',`desktopSelect(${id})`],...(SEL?.size?[['批量修改已选记录','bulkSheet()']]:[]),['删除记录',`txDel(${id})`,true]]);}
  else if(item){event.preventDefault();const {lp,lpid,lpg=''}=item.dataset;if(LP_KINDS[lp]&&!LP_KINDS[lp].sortOnly){closeDesktopContext();LP_KINDS[lp].edit(lpid,lpg);}}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#deskContext'))closeDesktopContext();});
document.addEventListener('dragstart',e=>{const el=e.target.closest('[data-lp]');if(!el||$('#lock').classList.contains('on'))return;D.dragging=el;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',el.dataset.lpid);el.classList.add('desk-dragging');});
document.addEventListener('dragover',e=>{const source=D.dragging,target=e.target.closest('[data-lp]');if(source&&target&&source.parentNode===target.parentNode&&source.dataset.lp===target.dataset.lp&&(source.dataset.lpg||'')===(target.dataset.lpg||'')){e.preventDefault();e.dataTransfer.dropEffect='move';target.classList.add('desk-drop-target');}});
document.addEventListener('dragleave',e=>e.target.closest('[data-lp]')?.classList.remove('desk-drop-target'));
document.addEventListener('drop',e=>{const source=D.dragging,target=e.target.closest('[data-lp]');if(!source||!target||source===target||source.parentNode!==target.parentNode||source.dataset.lp!==target.dataset.lp||(source.dataset.lpg||'')!==(target.dataset.lpg||''))return;e.preventDefault();const rect=target.getBoundingClientRect();target.parentNode.insertBefore(source,(e.clientY-rect.top>rect.height/2)?target.nextSibling:target);const kind=LP_KINDS[source.dataset.lp],g=source.dataset.lpg||'',ids=[...source.parentNode.children].filter(el=>el.dataset.lp===source.dataset.lp&&(el.dataset.lpg||'')===g).map(el=>el.dataset.lpid);kind.order(ids,g);save();D.dragging=null;document.querySelectorAll('.desk-dragging,.desk-drop-target').forEach(el=>el.classList.remove('desk-dragging','desk-drop-target'));if(kind.after)kind.after(g);else render();toast('顺序已保存');});
document.addEventListener('dragend',()=>{D.dragging=null;document.querySelectorAll('.desk-dragging,.desk-drop-target').forEach(el=>el.classList.remove('desk-dragging','desk-drop-target'));});
document.addEventListener('drop',e=>{
  document.querySelectorAll('.desk-file-drop.drag-over').forEach(el=>el.classList.remove('drag-over'));
  if(D.dragging||!e.dataTransfer.types.includes('Files'))return;
  e.preventDefault();desktopAcceptFiles([...e.dataTransfer.files]);
});
document.addEventListener('dragover',e=>{
  if(!e.dataTransfer.types.includes('Files'))return;
  e.preventDefault();e.dataTransfer.dropEffect='copy';
  if(S&&!$('#lock').classList.contains('on'))document.querySelector('[data-desktop-drop]')?.classList.add('drag-over');
});
document.addEventListener('dragleave',e=>{
  if(!e.relatedTarget)document.querySelectorAll('.desk-file-drop.drag-over').forEach(el=>el.classList.remove('drag-over'));
});
document.addEventListener('keydown',e=>{
  const typing=e.target.matches('input,textarea,select,[contenteditable=true]'),cmd=e.ctrlKey||e.metaKey;
  if(e.key==='Escape'){e.preventDefault();if(!$('#deskContext').hidden)closeDesktopContext();else back();return;}
  if($('#lock').classList.contains('on')){if(!typing&&/^\d$/.test(e.key)&&lockLen()){e.preventDefault();lockKey(e.key);}else if(!typing&&e.key==='Backspace'&&lockLen()){e.preventDefault();lockKey('⌫');}return;}
  if(e.key==='Tab'&&$('#sheet').classList.contains('on')){const nodes=[...document.querySelectorAll('#sheet input,#sheet button,#sheet [tabindex="0"]')].filter(el=>el.getClientRects().length),first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;}
  if(cmd&&e.key.toLowerCase()==='s'){e.preventDefault();if(E&&stack.at(-1).name==='add')desktopSave(false);else{saveNow();toast('已提交保存');}return;}
  if(cmd&&e.key==='Enter'&&E){e.preventDefault();desktopSave(false);return;}
  if($('#sheet').classList.contains('on'))return;
  const sortable=e.target.closest('[data-lp]');
  if(!typing&&e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)&&sortable&&LP_KINDS[sortable.dataset.lp]?.sortOnly){
    e.preventDefault();const rows=[...sortable.parentNode.children].filter(el=>el.dataset.lp===sortable.dataset.lp),from=rows.indexOf(sortable),to=from+(e.key==='ArrowUp'?-1:1);
    if(to>=0&&to<rows.length){const ids=rows.map(el=>el.dataset.lpid),id=sortable.dataset.lpid,kind=sortable.dataset.lp;[ids[from],ids[to]]=[ids[to],ids[from]];LP_KINDS[kind].order(ids);save();render();document.querySelector(`[data-lp="${kind}"][data-lpid="${CSS.escape(id)}"]`)?.focus();toast('顺序已保存');}return;
  }
  if(cmd&&e.key.toLowerCase()==='n'){e.preventDefault();startAdd();return;}
  if(cmd&&e.key.toLowerCase()==='f'){e.preventDefault();openSearch();return;}
  if(!typing&&cmd&&e.key.toLowerCase()==='a'&&stack.at(-1).name==='list'){e.preventDefault();if(!SEL)selStart();selAll();return;}
  if(!typing&&cmd&&e.key.toLowerCase()==='z'&&canUndoMerge()){e.preventDefault();undoMerge();return;}
  if(!typing&&e.key==='Delete'&&stack.at(-1).name==='list'){e.preventDefault();if(SEL?.size)selDelete();else{const row=$('.desk-row.is-focused');if(row&&(L.ids||[]).includes(row.dataset.id))txDel(row.dataset.id);}return;}
  if(!typing&&cmd&&e.key.toLowerCase()==='d'){const row=$('.desk-row.is-focused');if(row){e.preventDefault();txCopy(row.dataset.id);}return;}
  if(e.altKey&&e.key==='ArrowLeft'){e.preventDefault();back();return;}
  if(!typing&&(e.key==='Enter'||e.key===' ')&&e.target.getAttribute('role')==='button'){e.preventDefault();e.target.click();}
});
new MutationObserver(()=>desktopEnhance()).observe($('#sheet'),{childList:true,subtree:true});
