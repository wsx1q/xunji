'use strict';
/* 账户列表、账户详情、编辑账户 */
Pages.accounts = () => {
  const bal = balances(); let asset = 0, debt = 0;
  S.accounts.forEach(a => { const v = bal[a.id]; v >= 0 ? asset += v : debt -= v; });
  const merge = !!S.settings.accMerge, tops = accTops();
  const row = (a, v, sub, kids) => `<div class="acc ${sub ? 'sub' : ''}" data-acc="${a.id}" data-lp="acc" data-lpid="${a.id}" data-lpg="${sub ? 'kid|' + a.pid : 'top|' + a.type}" onclick="accTap('${a.id}')"><div class="ci">${accIcon(a)}</div><span>${esc(a.name)}<small>${sub ? '子账户' : accTypeName(a)}${kids ? ` · ${kids} 个子账户` : ''}${a.note ? ' · ' + esc(a.note) : ''}</small></span><b class="${v < 0 ? 'over' : ''}">${money(v)}</b></div>`;
  const groups = Object.keys(ACC_TYPES).map(k => {
    const list = tops.filter(a => accountGroup(a,bal) === k); if (!list.length) return '';
    const sum = list.reduce((x, a) => x + accSum(a.id, bal), 0);
    return `<div class="card"><div class="acc-g"><span>${ACC_TYPES[k].name}</span><span class="num">${money(sum)}</span></div>
      ${list.map(a => {
        const kids = accKids(a.id);
        if (!kids.length) return row(a, bal[a.id]);
        return row(a, accSum(a.id, bal), false, kids.length) + (merge ? '' : kids.map(c => row(c, bal[c.id], true)).join('')
          + (bal[a.id] ? `<div class="acc sub dim" onclick="go('account','${a.id}')"><div class="ci">·</div><span>直接记在「${esc(a.name)}」<small>未分到子账户</small></span><b>${money(bal[a.id])}</b></div>` : ''));
      }).join('')}</div>`;
  }).join('');
  return hdr('账户', `<a onclick="editAcc()">＋ 添加</a>`) + `<div class="hero grad"><small>净资产（元）</small><div class="big" onclick="homeAssetLedger('net')">${money(asset - debt)}</div>
    <div class="hd-sub"><span onclick="homeAssetLedger('asset')">总资产 ${money(asset)}</span><span onclick="homeAssetLedger('debt')">总负债 ${money(debt)}</span></div>
    <div class="hero-btns"><a onclick="startAdd(null,{type:'transfer'})">🔁 转账</a><a onclick="editAcc()">＋ 添加账户</a></div></div>`
    + `<div class="card"><div class="card-hd"><b>默认账户分类</b><a onclick="completeDefaultAccounts()">补齐缺少的类型 ›</a></div><div class="tip">资产用正余额，欠款用负余额。借还本金、账户互转和投资申购不计收支；利息、费用与盈亏另记。旧账户和余额不会自动改动。</div></div>`
    + (S.accounts.some(a => a.pid) ? `<div class="seg acc-seg">${[[0, '分开显示子账户'], [1, '合计显示']].map(([v, n]) => `<i class="${+merge === v ? 'on' : ''}" onclick="S.settings.accMerge=${!!v};save();render()">${n}</i>`).join('')}</div>` : '')
    + (groups ? groups + '<div class="ver">长按账户可修改名称、备注（如卡号）；长按后拖动可调整顺序</div>' : `<div class="card">${empty('还没有账户', '💳')}</div>`);
};
function accTap(id) { if (Date.now() - _lpAt < 400) return; go('account', id); }
Pages.account = id => {
  const a = accById(id); if (!a) { setTimeout(back); return ''; }
  const all = balances(), kids = accKids(id), ids = new Set([id, ...kids.map(k => k.id)]);
  const bal = accSum(id, all);
  ensureTxnOrder();
  const tx = S.txns.filter(t => ids.has(t.accountId) || ids.has(t.toAccountId));
  const [s, e] = periodRange('month'); const mt = inRange(tx, s, e);
  let mi = 0, mo = 0;
  mt.forEach(t => {
    const from = ids.has(t.accountId), to = ids.has(t.toAccountId);
    if (t.type === 'transfer' && from && to) return; // 子账户之间互转不算流入流出
    if (t.type === 'income' || (t.type === 'transfer' && to) || (t.type === 'adjust' && t.amount > 0)) mi += t.amount;
    else if (t.type === 'adjust') mo += Math.abs(t.amount);
    else if (t.type === 'transfer' || t.type === 'expense') mo += t.amount;
  });
  const kidRows = kids.length ? `<div class="card"><div class="card-hd"><b>子账户</b><a onclick="editAcc('','${id}')">＋ 添加子账户</a></div>
      ${kids.map(k => `<div class="acc" data-acc="${k.id}" data-lp="acc" data-lpid="${k.id}" data-lpg="kid|${id}" onclick="accTap('${k.id}')"><div class="ci">${accIcon(k)}</div><span>${esc(k.name)}</span><b class="${all[k.id] < 0 ? 'over' : ''}">${money(all[k.id])}</b></div>`).join('')}
      ${all[id] ? `<div class="acc dim"><div class="ci">·</div><span>直接记在「${esc(a.name)}」<small>未分到子账户</small></span><b>${money(all[id])}</b></div>` : ''}</div>` : '';
  const parent = a.pid && accById(a.pid);
  AV.tx = tx; AV.acc = kids.length ? '' : id;
  return hdr(esc(a.name), `<a onclick="editAcc('${id}')">编辑</a>`) + `<div class="hero grad"><small>${accIcon(a)} ${parent ? esc(parent.name) + ' › 子账户' : accTypeName(a)} · ${kids.length ? '合计余额' : '当前余额'}</small><div class="big" onclick="editAcc('${id}')">${money(bal)}</div>
    ${a.note ? `<div class="hd-sub" style="opacity:.9">📝 ${esc(a.note)}</div>` : ''}
    <div class="hd-sub"><span>本月流入 ${money(mi)}</span><span>本月流出 ${money(mo)}</span></div>
    <div class="hero-btns"><a onclick="editAcc('${id}')">↕️ 调整余额</a><a onclick="startAdd(null,{accountId:'${kids[0] ? kids[0].id : id}'})">✏️ 记一笔</a><a onclick="startAdd(null,{type:'transfer',accountId:'${kids[0] ? kids[0].id : id}'})">🔁 转账</a>${a.pid ? '' : kids.length ? '' : `<a onclick="editAcc('','${id}')">＋ 子账户</a>`}</div></div>`
    + accountActionPanel(a) + kidRows + `<div id="abody"></div>`;
};
const AV = { tx: [], acc: '' };
After.account = () => { const b = $('#abody'); if (b) vlMount(b, AV.tx, AV.acc, AV.tx.length > 20 ? `<div class="l-more dim">共 ${AV.tx.length} 笔</div>` : ''); };
let AE = null;
/* 从选择面板（记一笔、筛选）长按进来编辑：保存 / 删除 / 合并后回到那个面板 */
let _accReturn = null;
function accBack() { const r = _accReturn; _accReturn = null; if (r) r(); }
function editAcc(id, pid = '', ret = null) {
  _accReturn = ret;
  const a = id && accById(id), p = pid && accById(pid);
  AE = a ? { pid: '', ...a, _bal: balances()[a.id] } : { id: '', name: '', type: p ? p.type : 'debit', pid: p ? p.id : '', init: 0, _bal: 0 };
  renderAccSheet();
}
function pickAccParent() {
  keepAccForm();
  // 只有两级：有子账户的账户不能再挂到别的账户下
  const list = accTops().filter(a => a.id !== AE.id);
  _sheetCb = id => { AE.pid = id; const p = accById(id); if (p) AE.type = p.type; };
  openSheet('上级账户', `<div class="opt ${!AE.pid ? 'on' : ''}" onclick="const f=_sheetCb;f('');renderAccSheet()"><div class="ci">—</div><span>无（作为一级账户）</span></div>`
    + list.map(a => `<div class="opt ${a.id === AE.pid ? 'on' : ''}" onclick="const f=_sheetCb;f('${a.id}');renderAccSheet()"><div class="ci">${accIcon(a)}</div><span>${esc(a.name)}</span></div>`).join(''));
}
function keepAccForm() {
  if ($('#aName')) AE.name = $('#aName').value;
  if ($('#aNote')) AE.note = $('#aNote').value;
  if ($('#aInit')) AE.init = $('#aInit').value;
  if ($('#aBal')) AE._bal = $('#aBal').value;
  if ($('#aWhy')) AE._why = $('#aWhy').value;
}
function renderAccSheet() {
  openSheet(AE.id ? '编辑账户' : '新建账户', `<label>账户类型</label><div class="chips" style="flex-wrap:wrap">${Object.entries(ACC_TYPES).map(([k, v]) => `<i class="chip ${(AE.type===k||accountGroup(AE)===k)?'on':''}" onclick="keepAccForm();AE.type='${k}';renderAccSheet()">${v.icon} ${v.name}</i>`).join('')}</div>
    <label>账户名称</label><input id="aName" class="field" value="${esc(AE.name)}" placeholder="${AE.pid ? '如：零钱、零钱通、活期、定期' : '如：工商银行、微信、花呗'}" maxlength="16">
    <label>备注</label><input id="aNote" class="field" value="${esc(AE.note || '')}" placeholder="如：卡号 6222 0000 0000 1234、开户行" maxlength="60">
    ${AE.id && accKids(AE.id).length ? `<div class="kv"><span>上级账户</span><b>无（有 ${accKids(AE.id).length} 个子账户）</b></div>`
    : `<div class="kv" onclick="pickAccParent()"><span>上级账户</span><b>${AE.pid && accById(AE.pid) ? esc(accById(AE.pid).name) : '无'} ›</b></div>`}
    ${AE.id
    ? `<label>${accKids(AE.id).length ? '自身余额（不含子账户）' : '当前余额'}</label><input id="aBal" class="field" type="number" inputmode="decimal" value="${AE._bal}" step="0.01">
      <label>调整原因（改了余额时记在「余额变更」里）</label><input id="aWhy" class="field" value="${esc(AE._why || '')}" placeholder="选填，如：现金盘点、漏记、利息" maxlength="60">
      <div class="tip">修改余额并保存后，会自动在流水中增加一条「余额变更」记录，使账目与余额一致。不计入收支报表。</div>`
    : `<label>初始余额${accountGroup(AE)==='payable'?'（欠款填负数，预存款填正数）':accountGroup(AE)==='receivable'?'（待收回款项填正数）':'（资产为正，负债为负）'}</label><input id="aInit" class="field" type="number" inputmode="decimal" value="${AE.init}" step="0.01">`}
    <div class="btn-row">${AE.id ? `<button class="btn ghost del" onclick="delAcc()">删除</button>${S.accounts.length > 1 ? '<button class="btn ghost" onclick="accMergeSheet()">合并到…</button>' : ''}` : ''}<button class="btn" onclick="saveAcc()">保存</button></div>`);
}
function saveAcc() {
  const name = $('#aName').value.trim(); if (!name) return toast('请输入账户名称');
  const pid = AE.pid && accById(AE.pid) ? AE.pid : undefined;
  if(pid&&(accById(pid).pid||pid===AE.id))return toast('账户最多支持两级，请选择一级账户');
  if(pid)AE.type=accById(pid).type;
  if(!ACC_TYPES[AE.type])AE.type='other';
  const note = $('#aNote').value.trim() || undefined;
  if (!AE.id) {
    const initial=Number($('#aInit').value);if(!Number.isFinite(initial))return toast('请输入有效的初始余额');
    S.accounts.push({ id: uid(), name, type: AE.type, init: r2(initial), pid, note });
    save(); closeSheet(); toast('已保存'); render(); accBack();
    return;
  }
  const old = accById(AE.id);
  const oldBal = balances()[AE.id];
  const newBal = r2(parseFloat($('#aBal').value));
  if ($('#aBal').value === '' || !Number.isFinite(newBal)) return toast('请输入当前余额');
  // 在原对象上改：保留随手记导入标记（ssj）等其他字段，否则再次导入同一份备份会重复建账户
  const rec = { ...old, name, type: AE.type, init: +old.init || 0, pid, note };
  // 上级改类型时子账户跟着改，保持在同一分组
  accKids(AE.id).forEach(k => { k.type = AE.type; });
  const i = S.accounts.findIndex(a => a.id === AE.id);
  S.accounts[i] = rec;
  const delta = r2(newBal - oldBal);
  if (delta !== 0) {
    insertTxn({
      id: uid(), bookId: S.curBook, type: 'adjust', amount: delta, catId: '',
      accountId: AE.id, toAccountId: '', time: Date.now(), note: ($('#aWhy').value || '').trim() || '余额变更',
      member: '本人', merchant: '', project: ''
    });
  }
  save(); closeSheet();
  toast(delta !== 0 ? `已保存，并记入余额变更 ${delta >= 0 ? '+' : ''}${money(delta)}` : '已保存');
  render(); accBack();
}
function delAcc() {
  const used = S.txns.some(t => t.accountId === AE.id || t.toAccountId === AE.id);
  if (used) return toast('该账户下有流水记录，不能删除；可以用「合并到…」把记录转到别的账户');
  if (accKids(AE.id).length) return toast('请先删除或移走它的子账户');
  askConfirm(`确定删除账户「${esc(AE.name)}」吗？`, () => { S.accounts = S.accounts.filter(a => a.id !== AE.id); save(); toast('已删除'); if (stack[stack.length - 1].name === 'account') back(); else render(); accBack(); }, '删除');
}

function completeDefaultAccounts() {
  const missing=Object.keys(ACC_TYPES).filter(type=>!S.accounts.some(a=>accountGroup(a)===type));
  if(!missing.length)return toast('七类账户已齐全');
  missing.forEach(type=>S.accounts.push({id:uid(),name:ACC_TYPES[type].name,type,init:0}));
  save();render();toast(`已补齐 ${missing.length} 类零余额账户`);
}
const ACCOUNT_FLOWS={
  lend:{group:'receivable',name:'借出／垫付',direction:'out',help:'付款账户转入应收款，形成待收回本金，不计支出。'},
  collect:{group:'receivable',name:'收回本金',direction:'in',extra:'另收利息',extraType:'income',help:'应收款转回收款账户，不重复计收入；另收利息单独计收入。'},
  borrow:{group:'payable',name:'借入款项',direction:'in',help:'应付款转入收款账户，形成负余额，不计收入。'},
  repay:{group:'payable',name:'偿还本金',direction:'out',extra:'另付利息／费用',extraType:'expense',help:'付款账户转入应付款，减少欠款，不重复计支出；利息费用另计支出。'},
  buy:{group:'invest',name:'投资申购',direction:'out',extra:'另付手续费',extraType:'expense',help:'申购本金转入投资账户，不计支出；另付手续费单独计支出。'},
  redeem:{group:'invest',name:'投资赎回',direction:'in',help:'按转出的账面金额减少投资余额，实际到账与账面金额的差额单独计入盈亏。已记录过的收益不要重复填写。'}
};
function accountActionPanel(a) {
  const group=accountGroup(a),entries=Object.entries(ACCOUNT_FLOWS).filter(([,f])=>f.group===group);
  if(!entries.length&&group!=='other')return '';
  const disabled=!!accKids(a.id).length;
  return `<div class="card"><div class="card-hd"><b>${ACC_TYPES[group].name}做账</b></div>
    ${disabled?'<div class="tip">请选择具体子账户操作，避免把金额记入父账户的自身余额。</div>':`<div class="account-actions">${entries.map(([key,f])=>`<button class="btn ghost" onclick="openAccountFlow('${a.id}','${key}')">${f.name}</button>`).join('')}
    ${group==='receivable'?`<button class="btn ghost" onclick="accountEntry('${a.id}','income','应收收入')">登记应收收入</button><button class="btn ghost" onclick="accountEntry('${a.id}','expense','坏账核销')">坏账核销</button>`:''}
    ${group==='payable'?`<button class="btn ghost" onclick="accountEntry('${a.id}','expense','赊购消费')">赊购／信用消费</button>`:''}
    ${group==='invest'?`<button class="btn ghost" onclick="accountEntry('${a.id}','income','投资收益')">记录收益</button><button class="btn ghost" onclick="accountEntry('${a.id}','expense','投资亏损')">记录亏损</button>`:''}
    ${group==='invest'||group==='other'?`<button class="btn ghost" onclick="editAcc('${a.id}')">估值／余额调整</button>`:''}</div>`}
    <div class="tip">${group==='receivable'?'借出与收回用本金转账；已确认收入但尚未收到的钱，可登记应收收入，到账时再收回本金。坏账核销记支出。':group==='payable'?'信用卡、花呗、借款可分别建子账户。消费记支出，借入和还本走转账，避免重复计算。余额为正表示预存款或多还款。':group==='invest'?'投资本金走转账；现金收益选实际入账账户，留在投资账户的收益选本账户。估值调整只改变资产余额，不计收支。':'正余额计资产，负余额计负债；盘点或估值通过余额调整记录，不计收支。'}</div></div>`;
}
function flowCategory(type,interest=false,purpose='') {
  const cats=S.categories[type];
  const names=type==='income'?(interest?['其他资产收益','利息','银行利息','理财收益','理财']:['理财收益','理财','投资与资产收入','其他收入','其他']):purpose==='loan'?['贷款利息','利息','其他金融费用','其他支出','其他']:purpose==='fee'?['投资交易手续费','银行／支付手续费','手续费','其他金融费用','其他支出','其他']:['特殊支出','其他支出','其他'];
  return names.map(n=>cats.find(c=>c.name===n)).find(Boolean)?.id||cats.find(c=>!c.pid)?.id||cats[0]?.id||'';
}
function accountEntry(id,type,note) {
  const group=accountGroup(accById(id));
  const cat=group==='invest'?flowCategory(type):(S.categories[type].find(c=>c.name===(type==='expense'?'其他支出':'其他收入'))||S.categories[type].find(c=>c.name==='其他')||S.categories[type][0]||{}).id||'';
  startAdd(null,{accountId:id,type,catId:cat,note});
}
let AF=null;
function openAccountFlow(id,kind) {
  const a=accById(id),f=ACCOUNT_FLOWS[kind];
  if(!a||!f||accountGroup(a)!==f.group||accKids(id).length)return;
  const options=S.accounts.filter(x=>['cash','debit','online'].includes(accountGroup(x)));
  AF={id,kind,other:options[0]?.id||'',amount:'',extra:'',received:'',catId:flowCategory(f.extraType||'income',kind==='collect',kind==='repay'?'loan':kind==='buy'?'fee':''),note:'',time:Date.now(),gainCatId:flowCategory('income'),lossCatId:flowCategory('expense')};
  renderAccountFlow();
}
function keepAccountFlow() {
  if(!AF)return;
  for(const k of ['amount','extra','received','note'])if($('#af_'+k))AF[k]=$('#af_'+k).value;
}
function renderAccountFlow() {
  const f=ACCOUNT_FLOWS[AF.kind],a=accById(AF.id);if(!a)return closeSheet();
  const options=S.accounts.filter(x=>['cash','debit','online'].includes(accountGroup(x)));
  const current=balances()[a.id],available=AF.kind==='repay'?Math.max(0,-current):Math.max(0,current);
  openSheet(f.name,`<div class="kv"><span>${esc(accFull(a))}</span><b>${money(current)}</b></div><div class="tip">${f.help}${['collect','repay','redeem'].includes(AF.kind)?` 可处理本金／账面余额 ${money(available)}。`:''}</div>
    <label>${f.direction==='out'?'付款':'收款'}账户</label><button type="button" class="field account-choice" id="af_other" data-value="${esc(AF.other)}" onclick="pickAccountFlowOther()"><span>${accById(AF.other)?accIcon(accById(AF.other))+' '+esc(accFull(accById(AF.other)))+(accKids(AF.other).length?'（自身余额）':''):'请选择账户'}</span><em>›</em></button>
    <label>${AF.kind==='redeem'?'本次转出的账面金额':'本金金额'}</label><input class="field" id="af_amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${esc(AF.amount)}">
    ${AF.kind==='redeem'?`<label>实际到账金额（扣费后，可为 0）</label><input class="field" id="af_received" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(AF.received)}">`:''}
    ${f.extra?`<label>${f.extra}（选填）</label><input class="field" id="af_extra" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(AF.extra)}"><div class="kv" onclick="keepAccountFlow();catSheet('选择${f.extraType==='income'?'收入':'费用'}分类','${f.extraType}',AF.catId,id=>{AF.catId=id;renderAccountFlow()})"><span>${f.extraType==='income'?'收入':'费用'}分类</span><b>${esc(catLabel(AF.catId))} ›</b></div>`:''}
    ${AF.kind==='redeem'?`<div class="kv" onclick="keepAccountFlow();catSheet('收益分类','income',AF.gainCatId,id=>{AF.gainCatId=id;renderAccountFlow()})"><span>收益分类</span><b>${esc(catLabel(AF.gainCatId))} ›</b></div><div class="kv" onclick="keepAccountFlow();catSheet('亏损分类','expense',AF.lossCatId,id=>{AF.lossCatId=id;renderAccountFlow()})"><span>亏损分类</span><b>${esc(catLabel(AF.lossCatId))} ›</b></div>`:''}
    <label>日期与时间</label><div class="flow-datetime"><button type="button" class="chip" id="af_date" onclick="pickAccountFlowDate()">📅 ${dateDisplay(AF.time)}</button><button type="button" class="chip" id="af_time" onclick="pickAccountFlowTime()">🕘 ${hm(AF.time)}</button></div><label>备注</label><input class="field" id="af_note" value="${esc(AF.note)}" maxlength="120"><div class="btn-row"><button class="btn ghost" onclick="closeSheet()">取消</button><button class="btn" onclick="saveAccountFlow()" ${options.length?'':'disabled'}>确认记账</button></div>`);
  $('#sheet .sh-hd b').onclick=closeSheet;$('#sheet .sh-mask').onclick=closeSheet;
}
function pickAccountFlowOther() {
  if(!AF)return;keepAccountFlow();
  const eligible=a=>['cash','debit','online'].includes(accountGroup(a));
  const rows=accRows(id=>id===AF.other,id=>`chooseAccountFlowOther('${id}')`,'',false,eligible,true);
  openSheet(ACCOUNT_FLOWS[AF.kind].direction==='out'?'选择付款账户':'选择收款账户',rows||empty('请先建立现金、银行卡或微信／支付宝账户','💳'));
  const body=$('#sheet .sh-bd');
  body.insertAdjacentHTML('beforeend',`<div class="btn-row"><button class="btn ghost" onclick="renderAccountFlow()">返回做账</button><button class="btn" onclick="editAcc('','',()=>pickAccountFlowOther())">＋ 新建账户</button></div>`);
  body.scrollTop=0;
  $('#sheet .sh-hd b').onclick=renderAccountFlow;$('#sheet .sh-mask').onclick=renderAccountFlow;
}
function chooseAccountFlowOther(id) {
  const a=accById(id);if(!AF||!a||!['cash','debit','online'].includes(accountGroup(a)))return;
  AF.other=id;renderAccountFlow();
}
function saveAccountFlow() {
  keepAccountFlow();const a=accById(AF?.id),f=ACCOUNT_FLOWS[AF?.kind],other=accById(AF?.other);
  if(!a||!f||accountGroup(a)!==f.group||accKids(a.id).length||!other||!['cash','debit','online'].includes(accountGroup(other)))return toast('请选择有效的收付款账户');
  if(!Number.isFinite(AF.time)||sod(AF.time)>sod(Date.now()))return toast('请选择有效日期，不能晚于今天');
  const amount=r2(Number(AF.amount)),extra=r2(Number(AF.extra||0)),received=r2(Number(AF.received));
  if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(extra)||extra<0)return toast('请输入有效金额，本金应大于 0');
  if(AF.kind==='redeem'&&(AF.received===''||!Number.isFinite(received)||received<0))return toast('请输入有效的实际到账金额');
  const bal=balances()[a.id],cap=AF.kind==='repay'?Math.max(0,-bal):Math.max(0,bal);
  if(['collect','repay','redeem'].includes(AF.kind)&&amount>r2(cap))return toast('本金／账面金额不能超过当前待收、欠款或投资余额');
  const note=AF.note.trim(),base={bookId:S.curBook,time:AF.time,member:'本人',merchant:'',project:'',flowId:uid(),flowKind:AF.kind};
  const from=f.direction==='out'?other.id:a.id,to=f.direction==='out'?a.id:other.id;
  const records=[{...base,id:uid(),type:'transfer',amount,catId:'',accountId:from,toAccountId:to,note:f.name+(note?' · '+note:'')}];
  const add=(type,value,catId,label)=>records.push({...base,id:uid(),type,amount:value,catId,accountId:other.id,toAccountId:'',note:label+(note?' · '+note:'')});
  if(f.extra&&extra){if(!S.categories[f.extraType].some(c=>c.id===AF.catId))return toast('请选择有效的利息／费用分类');add(f.extraType,extra,AF.catId,f.extra);}
  if(AF.kind==='redeem'){
    const gain=r2(received-amount),type=gain>=0?'income':'expense',catId=type==='income'?AF.gainCatId:AF.lossCatId;
    if(gain&&!S.categories[type].some(c=>c.id===catId))return toast('请先建立投资盈亏的收入／支出分类');
    if(gain)add(type,Math.abs(gain),catId,gain>0?'投资赎回收益':'投资赎回亏损');
  }
  if(a.type==='debt')a.debtSide=f.group;
  records.forEach(insertTxn);save();closeSheet();render();AF=null;toast(`已记账，共 ${records.length} 笔流水`);
}

function accountEntryHint() {
  if(!E)return '';
  if(E.type==='transfer')return '本金在账户之间转移，不计入收支；利息、手续费另记。';
  const a=accById(E.accountId);if(!a)return '';
  const group=accountGroup(a);
  if(group==='payable')return E.type==='expense'?'消费计支出并增加欠款；偿还本金请用账户详情的“偿还本金”。':'借入本金请用“借入款项”；收入记入本账户会减少欠款。';
  if(group==='receivable')return E.type==='income'?'此笔确认收入并增加应收；实际到账时请用“收回本金”，避免重复计收入。':'此笔计支出并减少应收；借出或垫付本金请用账户详情的“借出／垫付”。';
  if(group==='invest')return '这里只记录收益或亏损；投资申购、赎回本金请用账户详情的专用入口。';
  return '';
}

function pickAccountFlowDate() {
  if(!AF)return;keepAccountFlow();
  dateSheet('选择日期',ymd(AF.time),v=>{const [y,m,d]=v.split('-').map(Number),t=new Date(AF.time);t.setFullYear(y,m-1,d);AF.time=t.getTime();renderAccountFlow();},{max:ymd(Date.now())});
  returnFromPicker(renderAccountFlow);
}
function pickAccountFlowTime() {
  if(!AF)return;keepAccountFlow();
  timeSheet('选择时间',hm(AF.time),v=>{const [h,m]=v.split(':').map(Number),t=new Date(AF.time);t.setHours(h,m,0,0);AF.time=t.getTime();renderAccountFlow();});
  returnFromPicker(renderAccountFlow);
}
