'use strict';
/* 支付宝 / 微信账单文件导入 */
const BILL_PF = { alipay: '支付宝', wechat: '微信' };
let BI = null;
// 关键词 → 候选分类名（按顺序找用户分类里第一个存在的）
const BILL_CAT_RULES = [
  [/打车|快车|专车|出租|滴滴|顺风车|花小猪|曹操出行|T3出行|代驾/, ['打车', '交通']],
  [/地铁|轨道交通/, ['地铁', '交通']], [/公交|巴士/, ['公交', '交通']],
  [/火车|高铁|动车|12306|铁路|中铁|机票|航空|携程|飞猪|去哪儿|同程/, ['火车', '机票', '旅行', '交通']],
  [/加油|中石化|中石油|石化|停车|ETC|高速/, ['加油', '停车', '汽车', '交通']],
  [/外卖|饿了么|美团外卖/, ['外卖', '餐饮']],
  [/早餐|包子|豆浆|油条|烧饼|煎饼/, ['早餐', '餐饮']],
  [/奶茶|咖啡|瑞幸|星巴克|喜茶|蜜雪|茶百道|古茗|霸王茶姬|库迪/, ['奶茶', '饮品', '零食', '餐饮']],
  [/餐饮|餐厅|饭店|食堂|火锅|烧烤|麦当劳|肯德基|汉堡|饺子|小吃|面馆|米线|美食/, ['餐饮']],
  [/水果|果业|鲜果/, ['水果']],
  [/生鲜|蔬菜|买菜|菜市场|谊品|叮咚|盒马|朴朴|钱大妈/, ['蔬菜', '买菜', '日用']],
  [/超市|便利店|百货|日用/, ['超市', '日用', '购物']],
  [/话费|流量|中国移动|中国联通|中国电信|宽带|充值缴费/, ['话费', '通讯']],
  [/电费|水费|燃气|物业|住房/, ['水电燃气', '物业', '住房']],
  [/房租|租房/, ['房租', '住房']],
  [/医院|药房|药店|诊所|医疗|健康/, ['医疗']],
  [/酒店|宾馆|住宿|民宿/, ['住宿', '旅行']],
  [/景区|门票|观光|旅游|旅行/, ['旅行']],
  [/电影|KTV|游戏|娱乐|休闲|演出|剧本杀/, ['娱乐']],
  [/红包/, ['红包', '人情']], [/转账/, ['人情', '转账', '其他']],
  [/服饰|服装|鞋|衣/, ['服饰']], [/数码|电器|手机|电脑/, ['数码', '购物']],
  [/运动|健身|户外|球/, ['运动']], [/宠物|猫|狗粮/, ['宠物']], [/教育|学费|培训|书店|图书/, ['教育']],
  [/美容|美发|理发|美甲/, ['美容']], [/烟|酒/, ['烟酒']],
  [/淘宝|天猫|京东|拼多多|抖音|唯品会/, ['网购', '购物']]
];
const BILL_INC_RULES = [[/红包/, ['红包', '其他']], [/转账/, ['转账', '其他']], [/工资|薪/, ['工资']], [/利息|收益|理财/, ['利息', '理财']]];
function catByNames(type, names) {
  const list = S.categories[type];
  for (const n of names) { const c = list.find(x => x.name === n); if (c) return c.id; }
  for (const n of names) { const c = list.find(x => x.name.includes(n)); if (c) return c.id; }
  return '';
}
function billGuessCat(r) {
  const learned = (S.settings.billCat || {})[r.party];
  if (learned && S.categories[r.type].some(c => c.id === learned)) return learned;
  const text = `${r.party} ${r.goods} ${r.cls}`;
  for (const [re, names] of r.type === 'income' ? BILL_INC_RULES : BILL_CAT_RULES) if (re.test(text)) { const id = catByNames(r.type, names); if (id) return id; }
  return catByNames(r.type, ['其他', '其它']) || defaultCatId(r.type);
}
function billGuessAcc(method, pf) {
  const saved = (S.settings.billAcc || {})[`${pf}|${method}`];
  if (saved && accById(saved)) return saved;
  const m = method || '', digits = (m.match(/\((\d{4})\)/) || [])[1], credit = /信用|花呗|白条/.test(m);
  let best = null, bs = 0;
  for (const a of S.accounts) {
    const n = a.name, isCredit = a.type === 'credit' || /信用|花呗/.test(n);
    let s = 0;
    if (digits && n.includes(digits)) s += 5;
    if (/花呗/.test(m) && /花呗/.test(n)) s += 5;
    if (/零钱/.test(m) && /微信|零钱/.test(n)) s += 5;
    if (/余额/.test(m) && /支付宝|余额/.test(n)) s += 5;
    const bank = (m.match(/^(.{2,4}?)银行/) || [])[1];
    if (bank && n.includes(bank)) s += 3;
    if (m && credit !== isCredit && /信用卡|储蓄卡|借记卡/.test(m)) s -= 4;
    else if (/信用卡/.test(m) && isCredit) s += 3;
    else if (m && credit === isCredit) s += 1;
    if (!m && n.includes(BILL_PF[pf])) s += 4;
    if (s > bs) { bs = s; best = a.id; }
  }
  return bs >= 3 ? best : '';
}
const BILL_GENERIC = /^(收钱码收款|二维码收款|微信转账|转账|商品|收款|付款|\/)$/;
function billNote(r) {
  const g = r.goods.replace(/^(收款方备注|转账备注)[:：]/, '').trim();
  return [r.party, g && !BILL_GENERIC.test(g) && g !== r.party ? g : ''].filter(Boolean).join(' · ').slice(0, 60) || BILL_PF[r.pf];
}
function billMerchant(r) {
  const text = r.party + ' ' + r.goods;
  return S.merchants.filter(m => m && text.includes(m)).sort((a, b) => b.length - a.length)[0] || '';
}
function openBill() {
  if (!S.accounts.length) return toast('请先添加账户');
  if (!BI) BI = { items: [], files: [], acc: {}, member: ((S.settings.last || {}).expense || {}).member || '本人', view: 'todo', lim: 200, busy: '' };
  if (stack[stack.length - 1].name !== 'bill') go('bill'); else render();
}
function billPick() { if (!BI.busy) $('#billFile').click(); }
async function billFiles(input) {
  const files = [...input.files]; input.value = '';
  for (const f of files) await billLoad(f.name, new Uint8Array(await f.arrayBuffer()));
}
async function billLoad(name, buf) {
  openBill();
  BI.busy = '正在读取 ' + name; render();
  try {
    const { platform, rows } = await parseBillFile(name, buf);
    const srcs = new Set(), near = new Map();
    for (const t of S.txns) {
      if (t.src) srcs.add(t.src);
      else if (t.type === 'expense' || t.type === 'income') { const k = t.type + t.amount; if (!near.has(k)) near.set(k, []); near.get(k).push(t.time); }
    }
    const have = new Set(BI.items.map(it => it.key));
    let added = 0;
    for (const r of rows) {
      r.pf = platform;
      const key = `${platform}:${r.id || r.time + '_' + r.amount}`;
      if (have.has(key)) continue;
      have.add(key);
      const amount = r2(r.amount - r.refund);
      const it = { key, pf: platform, r, type: r.type, amount, time: r.time, method: r.method, skip: r.skip, note: billNote(r), merchant: billMerchant(r) };
      if (!it.skip && srcs.has(key)) it.skip = '已导入过';
      if (!it.skip && !(amount > 0)) it.skip = '金额为 0';
      if (!it.skip) {
        it.catId = billGuessCat(r);
        it.dup = (near.get(r.type + amount) || []).some(x => Math.abs(x - r.time) < 15 * 6e4);
        it.sel = !it.dup;
        const mk = `${platform}|${r.method}`;
        if (!(mk in BI.acc)) BI.acc[mk] = billGuessAcc(r.method, platform);
      }
      BI.items.push(it);
      added++;
    }
    BI.items.sort((a, b) => b.time - a.time);
    BI.files.push(`${BILL_PF[platform]} · ${name}`);
    toast(`读取到 ${added} 条记录`);
  } catch (e) { toast(e.message || String(e)); }
  BI.busy = '';
  render();
}
Pages.bill = () => {
  if (!BI) { setTimeout(back); return ''; }
  const todo = BI.items.filter(it => !it.skip), sel = BI.items.filter(billSel);
  const sum = type => r2(sel.filter(it => it.type === type).reduce((a, it) => a + it.amount, 0));
  const skipBy = {};
  BI.items.filter(it => it.skip).forEach(it => skipBy[it.skip] = (skipBy[it.skip] || 0) + 1);
  const views = [['todo', '待导入', todo.length], ['expense', '支出', todo.filter(it => it.type === 'expense').length], ['income', '收入', todo.filter(it => it.type === 'income').length],
    ['dup', '可能重复', todo.filter(it => it.dup).length], ['skip', '不导入', BI.items.length - todo.length]];
  const shown = BI.items.map((it, i) => [it, i]).filter(([it]) => BI.view === 'skip' ? it.skip : !it.skip && (BI.view === 'todo' || (BI.view === 'dup' ? it.dup : it.type === BI.view)));
  const row = ([it, i]) => {
    const off = !!it.skip && !it.sel, c = it.catId ? catById(it.catId) : null;
    return `<div class="oc-it ${off ? 'off' : it.dup ? 'warn' : ''} ${it.sel ? 'sel' : ''}">
      <i class="oc-ck" onclick="billToggle(${i})">${it.sel ? '✓' : ''}</i>
      <div class="oc-m" onclick="${it.skip && !it.forced ? `billToggle(${i})` : `billEdit(${i})`}">
        <div class="oc-t">${esc(it.note)}</div>
        <div class="oc-s">${[`${ymd(it.time).slice(5)} ${hm(it.time)}`, `<em>${BILL_PF[it.pf]}</em>`, it.method && esc(it.method), c && `${c.icon} ${esc(c.name)}`, it.skip && `<span class="oc-k">${esc(it.skip)}${it.sel ? ' · 仍导入' : ''}</span>`,
          it.r.refund && !off && `<span class="oc-k">已扣退款 ${money(it.r.refund)}</span>`, it.dup && '<span class="oc-k warn">可能已记过</span>'].filter(Boolean).join(' · ')}</div>
      </div>
      <b class="oc-a ${it.type === 'income' ? 'inc' : ''}">${it.type === 'income' ? '+' : ''}${money(it.amount)}</b></div>`;
  };
  const methods = [...new Set(todo.concat(sel).map(it => `${it.pf}|${it.method}`))];
  return `${hdr('导入支付宝 / 微信账单')}
  <div class="card" style="padding:14px">
    <button class="btn oc-pick ${BI.busy ? 'dim' : ''}" onclick="billPick()">${BI.busy ? '⏳ ' + esc(BI.busy) : '📂 选择账单文件（可多选）'}</button>
    <div class="tip">支付宝：我的 → 账单 → 右上角 ⋯ → 开具交易流水证明 → 用于个人对账，发到邮箱后解压得到 CSV。<br>
      微信：我 → 服务 → 钱包 → 账单 → 下载账单 → 用于个人对账，得到 xlsx。<br>
      也可以在微信 / 文件管理里点开账单文件 →「用其他应用打开」→ 选洵记。<br>
      退款、交易关闭、金额为 0、转账到余额宝 / 还花呗这类不计收支的记录默认不导入（识别有误的可以在「不导入」里勾选）；部分退款会从原订单金额里扣掉。</div>
    ${BI.files.length ? `<div class="ver" style="text-align:left;padding-top:8px">已读取：${BI.files.map(esc).join('，')}</div>` : ''}</div>
  ${methods.length ? `
  <div class="card"><div class="card-hd"><b>付款方式对应账户</b><small>导入后会记住</small></div>
    ${methods.map(mk => { const [pf, m] = mk.split('|'), a = accById(BI.acc[mk]); return `<div class="kv" data-k="${esc(mk)}" onclick="billPickAcc(this.dataset.k)"><span>${BILL_PF[pf]} · ${esc(m || '未注明')}</span><b>${a ? accIcon(a) + ' ' + esc(a.name) : '<em style="color:#E5484D;font-style:normal">请选择</em>'} ›</b></div>`; }).join('')}
    <div class="kv" onclick="billPickMember()"><span>成员</span><b>${esc(BI.member)} ›</b></div></div>` : ''}
  ${BI.items.length ? `<div class="card">
    <div class="chips" style="flex-wrap:wrap;padding:12px 0 6px">${views.map(([k, n, c]) => `<i class="chip ${BI.view === k ? 'on' : ''}" onclick="BI.view='${k}';BI.lim=200;render()">${n} ${c}</i>`).join('')}</div>
    ${BI.view === 'skip' && Object.keys(skipBy).length ? `<div class="ver" style="text-align:left;padding-bottom:6px">${Object.entries(skipBy).map(([k, n]) => `${esc(k)} ${n} 条`).join(' · ')}</div>` : ''}
    ${BI.view === 'skip' ? `<div class="ver" style="text-align:left;padding-bottom:4px">识别有误的可以勾选，仍然导入（退款按收入记，其余按支出记，点开可修改）</div>` : ''}
    ${shown.length ? `<div class="ver" style="text-align:right;padding-bottom:4px"><a onclick="billSelAll(true)">全选</a> · <a onclick="billSelAll(false)">全不选</a></div>` : ''}
    ${shown.slice(0, BI.lim).map(row).join('') || empty('没有记录')}
    ${shown.length > BI.lim ? `<div class="l-more" onclick="BI.lim+=300;render()">已显示 ${BI.lim} / ${shown.length} 条，点击再显示</div>` : ''}</div>
  <div class="oc-bar"><span>已选 <b>${sel.length}</b> 笔 · 支出 <b>${money(sum('expense'))}</b>${sum('income') ? ` · 收入 <b>${money(sum('income'))}</b>` : ''}</span><button class="btn" onclick="billImport()">导入</button></div>` : ''}`;
};
const billSel = it => it.sel && (!it.skip || it.forced);
// 不导入的记录被勾选时补齐类型、金额、分类和账户
function billForce(it) {
  if (it.forced) return;
  const r = it.r;
  if (it.skip === '退款') it.type = 'income';
  else if (!it.type) it.type = 'expense';
  if (!(it.amount > 0)) it.amount = r2(r.amount);
  it.catId = it.skip === '退款' ? (catByNames('income', ['退款']) || billGuessCat({ ...r, type: 'income' })) : billGuessCat({ ...r, type: it.type });
  const mk = `${it.pf}|${it.method}`;
  if (!(mk in BI.acc)) BI.acc[mk] = billGuessAcc(it.method, it.pf);
  if (it.skip === '已导入过') it.dup = true;
  it.forced = true;
}
function billToggle(i) {
  const it = BI.items[i];
  if (it.skip && !it.sel) billForce(it);
  it.sel = !it.sel;
  render();
}
function billSelAll(on) {
  BI.items.forEach(it => {
    if (BI.view === 'skip' ? !it.skip || it.skip === '已导入过' : it.skip || !(BI.view === 'todo' || (BI.view === 'dup' ? it.dup : it.type === BI.view))) return;
    if (on && it.skip) billForce(it);
    it.sel = on;
  });
  render();
}
function billPickAcc(mk) { accSheet(`「${esc(mk.split('|')[1] || '未注明')}」记到`, BI.acc[mk], id => { BI.acc[mk] = id; }); }
function billPickMember() { memberSheet(BI.member, m => { BI.member = m; }); }
function billEdit(i) {
  const it = BI.items[i];
  openSheet('修改这笔', `<div class="chips" style="margin-bottom:6px">${[['expense', '支出'], ['income', '收入']].map(([k, n]) => `<i class="chip ${it.type === k ? 'on' : ''}" onclick="billSetType(${i},'${k}')">${n}</i>`).join('')}</div>
    <label>金额</label><input id="biA" class="field" type="number" inputmode="decimal" step="0.01" value="${it.amount}">
    <label>备注</label><input id="biN" class="field" value="${esc(it.note)}" maxlength="60">
    <div class="kv" onclick="billSaveEdit(${i},true)"><span>分类</span><b>${esc(catLabel(it.catId))} ›</b></div>
    <div class="kv"><span>时间</span><b>${ymd(it.time)} ${hm(it.time)}</b></div>
    <div class="tip">${esc([BILL_PF[it.pf], it.r.cls, it.r.party, it.r.status, it.method].filter(Boolean).join(' · '))}<br>${esc(it.r.goods)}${it.r.refund ? `<br>原金额 ${money(it.r.amount)}，已扣除退款 ${money(it.r.refund)}` : ''}</div>
    <button class="btn" onclick="billSaveEdit(${i})">确定</button>`);
}
function billSetType(i, type) {
  const it = BI.items[i];
  if (it.type === type) return;
  const v = r2(parseFloat($('#biA').value) || 0);
  if (v > 0) it.amount = v;
  it.note = $('#biN').value.trim() || it.note;
  it.type = type; it.catSet = false;
  it.catId = billGuessCat({ ...it.r, type });
  billEdit(i);
}
function billSaveEdit(i, thenCat) {
  const it = BI.items[i], v = r2(parseFloat($('#biA').value) || 0);
  if (!(v > 0)) return toast('请输入金额');
  it.amount = v; it.note = $('#biN').value.trim() || it.note;
  if (thenCat) return billPickCat(i);
  it.sel = true; closeSheet(); render();
}
function billPickCat(i) {
  const it = BI.items[i];
  catSheet('这笔的分类', it.type, it.catId, id => {
    it.catId = id; it.catSet = true; it.sel = true;
    // 同一交易对方的其他记录一起改
    if (it.r.party) BI.items.forEach(x => { if (!x.skip && !x.catSet && x.type === it.type && x.r.party === it.r.party) x.catId = id; });
  });
}
function billImport() {
  const sel = BI.items.filter(billSel);
  if (!sel.length) return toast('没有选中要导入的记录');
  const zero = sel.find(it => !(it.amount > 0));
  if (zero) return toast(`「${zero.note}」金额为 0，请点开修改金额或取消勾选`);
  const miss = [...new Set(sel.map(it => `${it.pf}|${it.method}`).filter(mk => !accById(BI.acc[mk])))];
  if (miss.length) return toast(`请先选择「${miss[0].split('|')[1] || '未注明'}」对应的账户`);
  const dupN = sel.filter(it => it.dup).length;
  const exp = r2(sel.filter(it => it.type === 'expense').reduce((a, it) => a + it.amount, 0));
  const inc = r2(sel.filter(it => it.type === 'income').reduce((a, it) => a + it.amount, 0));
  askConfirm(`导入 ${sel.length} 笔：支出 ${money(exp)}${inc ? `，收入 ${money(inc)}` : ''}？${dupN ? `<br><b>其中 ${dupN} 笔可能已经记过。</b>` : ''}`, () => {
    const st = S.settings;
    st.billAcc = st.billAcc || {}; st.billCat = st.billCat || {};
    for (const it of sel) {
      const mk = `${it.pf}|${it.method}`;
      st.billAcc[mk] = BI.acc[mk];
      if (it.catSet && it.r.party) st.billCat[it.r.party] = it.catId;
      insertTxn({
        id: uid(), bookId: S.curBook, type: it.type, amount: it.amount, catId: it.catId, accountId: BI.acc[mk], toAccountId: '',
        time: it.time, note: it.note, member: BI.member, merchant: it.merchant, project: '', src: it.key
      });
      it.skip = '已导入过'; it.sel = false; it.forced = false;
    }
    save();
    toast(`已导入 ${sel.length} 笔 ✓`);
    render();
  }, '导入');
}
