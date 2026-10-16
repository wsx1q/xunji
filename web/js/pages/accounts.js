'use strict';
/* 账户列表、账户详情、编辑账户 */
Pages.accounts = () => {
  const bal = balances(); let asset = 0, debt = 0;
  S.accounts.forEach(a => { const v = bal[a.id]; v >= 0 ? asset += v : debt -= v; });
  const merge = !!S.settings.accMerge, tops = accTops();
  const row = (a, v, sub, kids) => `<div class="acc ${sub ? 'sub' : ''}" data-acc="${a.id}" data-lp="acc" data-lpid="${a.id}" data-lpg="${sub ? 'kid|' + a.pid : 'top|' + a.type}" onclick="accTap('${a.id}')"><div class="ci">${accIcon(a)}</div><span>${esc(a.name)}<small>${sub ? '子账户' : ACC_TYPES[a.type].name}${kids ? ` · ${kids} 个子账户` : ''}${a.note ? ' · ' + esc(a.note) : ''}</small></span><b class="${v < 0 ? 'over' : ''}">${money(v)}</b></div>`;
  const groups = Object.keys(ACC_TYPES).map(k => {
    const list = tops.filter(a => a.type === k); if (!list.length) return '';
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
  return hdr(esc(a.name), `<a onclick="editAcc('${id}')">编辑</a>`) + `<div class="hero grad"><small>${accIcon(a)} ${parent ? esc(parent.name) + ' › 子账户' : ACC_TYPES[a.type].name} · ${kids.length ? '合计余额' : '当前余额'}</small><div class="big" onclick="editAcc('${id}')">${money(bal)}</div>
    ${a.note ? `<div class="hd-sub" style="opacity:.9">📝 ${esc(a.note)}</div>` : ''}
    <div class="hd-sub"><span>本月流入 ${money(mi)}</span><span>本月流出 ${money(mo)}</span></div>
    <div class="hero-btns"><a onclick="editAcc('${id}')">↕️ 调整余额</a><a onclick="startAdd(null,{accountId:'${kids[0] ? kids[0].id : id}'})">✏️ 记一笔</a><a onclick="startAdd(null,{type:'transfer',accountId:'${kids[0] ? kids[0].id : id}'})">🔁 转账</a>${a.pid ? '' : kids.length ? '' : `<a onclick="editAcc('','${id}')">＋ 子账户</a>`}</div></div>`
    + kidRows + `<div id="abody"></div>`;
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
  openSheet(AE.id ? '编辑账户' : '新建账户', `<label>账户类型</label><div class="chips" style="flex-wrap:wrap">${Object.entries(ACC_TYPES).map(([k, v]) => `<i class="chip ${AE.type === k ? 'on' : ''}" onclick="keepAccForm();AE.type='${k}';renderAccSheet()">${v.icon} ${v.name}</i>`).join('')}</div>
    <label>账户名称</label><input id="aName" class="field" value="${esc(AE.name)}" placeholder="${AE.pid ? '如：零钱、零钱通、活期、定期' : '如：工商银行、微信、花呗'}" maxlength="16">
    <label>备注</label><input id="aNote" class="field" value="${esc(AE.note || '')}" placeholder="如：卡号 6222 0000 0000 1234、开户行" maxlength="60">
    ${AE.id && accKids(AE.id).length ? `<div class="kv"><span>上级账户</span><b>无（有 ${accKids(AE.id).length} 个子账户）</b></div>`
    : `<div class="kv" onclick="pickAccParent()"><span>上级账户</span><b>${AE.pid && accById(AE.pid) ? esc(accById(AE.pid).name) : '无'} ›</b></div>`}
    ${AE.id
    ? `<label>${accKids(AE.id).length ? '自身余额（不含子账户）' : '当前余额'}</label><input id="aBal" class="field" type="number" inputmode="decimal" value="${AE._bal}" step="0.01">
      <label>调整原因（改了余额时记在「余额变更」里）</label><input id="aWhy" class="field" value="${esc(AE._why || '')}" placeholder="选填，如：现金盘点、漏记、利息" maxlength="60">
      <div class="tip">修改余额并保存后，会自动在流水中增加一条「余额变更」记录，使账目与余额一致。不计入收支报表。</div>`
    : `<label>初始余额${AE.type === 'credit' ? '（信用卡欠款请填负数）' : ''}</label><input id="aInit" class="field" type="number" inputmode="decimal" value="${AE.init}" step="0.01">`}
    <div class="btn-row">${AE.id ? `<button class="btn ghost del" onclick="delAcc()">删除</button>${S.accounts.length > 1 ? '<button class="btn ghost" onclick="accMergeSheet()">合并到…</button>' : ''}` : ''}<button class="btn" onclick="saveAcc()">保存</button></div>`);
}
function saveAcc() {
  const name = $('#aName').value.trim(); if (!name) return toast('请输入账户名称');
  const pid = AE.pid && accById(AE.pid) ? AE.pid : undefined;
  const note = $('#aNote').value.trim() || undefined;
  if (!AE.id) {
    S.accounts.push({ id: uid(), name, type: AE.type, init: r2(parseFloat($('#aInit').value) || 0), pid, note });
    save(); closeSheet(); toast('已保存'); render(); accBack();
    return;
  }
  const old = accById(AE.id);
  const oldBal = balances()[AE.id];
  const newBal = r2(parseFloat($('#aBal').value));
  if ($('#aBal').value === '' || Number.isNaN(newBal)) return toast('请输入当前余额');
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
