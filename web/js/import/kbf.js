'use strict';
/* ================= 导入官方随手记备份（.kbf） =================
   .kbf 由原生层解开（zip + 抹了文件头的 SQLite），返回账户 / 分类 / 流水；这里建账户、合并分类和标签、写入流水。
   流水带 src = 'ssj:<随手记流水ID>-<创建时间>'，同一份备份重复导入会跳过已导入的；账户带 ssj 标记，重复导入时复用。 */
let KB = null;
const SSJ_ICON = { 衣服饰品: '👕', 食品酒水: '🍚', 居家物业: '🏠', 行车交通: '🚇', 交流通讯: '📱', 休闲娱乐: '🎮', 学习进修: '📚', 人情往来: '🎁',
  医疗保健: '💊', 金融保险: '🏦', 其他杂项: '📦', 职业收入: '💼', 其他收入: '💰', 投资收入: '📈', 购物退货: '↩️', 家庭内部: '🏠' };
function kbfPick() {
  if (!NATIVE || !Android.readKbf) return toast('仅在 App 中可用');
  $('#kbfFile').click();
}
async function kbfFiles(input) {
  const f = input.files[0]; input.value = '';
  if (f) kbfLoad(f.name, new Uint8Array(await f.arrayBuffer()));
}
function bytesToB64(buf) {
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
function kbfLoad(name, buf) {
  if (!NATIVE || !Android.readKbf) return toast('仅在 App 中可用');
  toast('正在读取随手记备份…');
  setTimeout(() => {
    let r;
    try { r = JSON.parse(Android.readKbf(bytesToB64(buf))); } catch (e) { r = { ok: false, err: '读取失败：' + e.message }; }
    if (!r.ok) return toast(r.err || '读取失败');
    r.name = name;
    r.fp = r.txns.length ? r.txns[0][10] : name; // 用最早一条流水的 ID 区分不同的随手记账本
    KB = r;
    kbfPreview();
  }, 60);
}
function ssjAccType(a) {
  const g = a.group + ' ' + a.pgroup;
  if (+a.gtype === 1) return /信用卡/.test(g) ? 'credit' : 'debt';
  if (+a.gtype === 2) return 'debt';
  if (/现金/.test(g) && !/现金券/.test(g)) return 'cash';
  if (/储蓄|借记|存折|定期/.test(g)) return 'debit';
  if (/在线|支付|储值|现金券|虚拟/.test(g)) return 'online';
  if (/投资|基金|股票|理财|外汇|债券|期货|黄金|保险/.test(g)) return 'invest';
  return 'cash';
}
/** 按随手记的流水重算每个账户的余额（用来预览和导入后核对） */
function ssjBalances(r) {
  const m = {};
  const add = (id, v) => { if (id) m[id] = r2((m[id] || 0) + v); };
  for (const [kind, , amt, acc, to] of r.txns) {
    if (kind === 'expense') add(acc, -amt);
    else if (kind === 'income' || kind === 'adjust') add(acc, amt);
    else if (kind === 'transfer') { add(acc, -amt); add(to, amt); }
  }
  return m;
}
function kbfPreview() {
  const r = KB, cnt = { expense: 0, income: 0, transfer: 0, adjust: 0 };
  for (const t of r.txns) cnt[t[0]]++;
  const srcs = new Set(); for (const t of S.txns) if (t.src) srcs.add(t.src);
  const dup = r.txns.filter(t => srcs.has('ssj:' + t[10])).length;
  const bal = ssjBalances(r), used = new Set(r.txns.flatMap(t => [t[3], t[4]]).filter(Boolean));
  const accs = r.accounts.filter(a => used.has(a.id));
  const fresh = r.txns.length - dup;
  openSheet('导入随手记备份', `<div class="kv"><span>文件</span><b>${esc(r.name)}</b></div>
    <div class="kv"><span>时间范围</span><b>${r.from ? ymd(r.from) + ' ~ ' + ymd(r.to) : '—'}</b></div>
    <div class="kv"><span>流水</span><b>支出 ${cnt.expense} · 收入 ${cnt.income} · 转账 ${cnt.transfer} · 余额变更 ${cnt.adjust}</b></div>
    ${dup ? `<div class="kv"><span>已导入过</span><b>${dup} 条（会跳过）</b></div>` : ''}
    ${r.skipped ? `<div class="kv"><span>不支持的记录</span><b>${r.skipped} 条（跳过）</b></div>` : ''}
    <label>账户（${accs.length} 个，余额按随手记流水计算）</label>
    ${accs.map(a => `<div class="kv"><span>${ACC_TYPES[ssjAccType(a)].icon} ${esc(a.name)}<small style="color:var(--t2)"> · ${esc(a.group || '')}</small></span><b class="${(bal[a.id] || 0) < 0 ? 'over' : ''}">${money(bal[a.id] || 0)}</b></div>`).join('')}
    <div class="tip">分类、成员、商家、项目会按名称合并到洵记现有的名单里；账户会新建（与现有账户重名时名字后加「（随手记）」）。导入后可在流水里按需修改。</div>
    ${fresh ? `<div class="btn-row"><button class="btn ghost" style="color:#555" onclick="kbfCommit(false)">导入到当前账本</button><button class="btn" onclick="kbfCommit(true)">导入到新账本「随手记」</button></div>`
      : '<div class="tip"><b>这份备份已经全部导入过了。</b></div>'}`);
}
function kbfCommit(toNew) {
  const r = KB;
  if (!r) return;
  closeSheet();
  const srcs = new Set(); for (const t of S.txns) if (t.src) srcs.add(t.src);
  let bookId = S.curBook;
  if (toNew) {
    const ex = S.books.find(b => b.ssj === r.fp);
    if (ex) bookId = ex.id;
    else { bookId = uid(); S.books.push({ id: bookId, name: '随手记', icon: '📒', ssj: r.fp }); S.budgets[bookId] = { total: 0, cats: {} }; }
  }
  // 账户：只建流水里用到的；同一份备份再导入时复用上次建的
  const used = new Set(r.txns.flatMap(t => [t[3], t[4]]).filter(Boolean));
  const accMap = {}, names = new Set(S.accounts.map(a => a.name)), made = [];
  for (const a of r.accounts) {
    if (!used.has(a.id)) continue;
    const tag = r.fp + ':' + a.id, old = S.accounts.find(x => x.ssj === tag);
    if (old) { accMap[a.id] = old.id; continue; }
    let name = a.name || '未命名账户';
    for (let k = 1; names.has(name); k++) name = `${a.name}（随手记${k > 1 ? k : ''}）`;
    names.add(name);
    const acc = { id: uid(), name, type: ssjAccType(a), init: 0, ssj: tag };
    if (a.memo) acc.note = a.memo;
    S.accounts.push(acc);
    accMap[a.id] = acc.id;
    made.push(acc);
  }
  // 分类：按名称合并，一级在前、二级挂到对应一级下
  const catMap = {};
  for (const c of r.cats) {
    const list = S.categories[c.type];
    if (!c.pid) {
      let top = list.find(x => !x.pid && x.name === c.name);
      if (!top) { top = { id: uid(), pid: '', name: c.name, icon: SSJ_ICON[c.name] || '📁', color: COLORS[list.filter(x => !x.pid).length % COLORS.length] }; list.push(top); }
      catMap[c.id] = top.id;
    } else {
      const pid = catMap[c.pid], parent = pid && list.find(x => x.id === pid);
      if (!parent) continue;
      let sub = list.find(x => x.pid === pid && x.name === c.name);
      if (!sub) { sub = { id: uid(), pid, name: c.name, icon: parent.icon, color: parent.color }; list.push(sub); }
      catMap[c.id] = sub.id;
    }
  }
  // 成员 / 商家 / 项目：补进名单
  const addTag = (list, v) => { if (v && !S[list].includes(v)) S[list].push(v); };
  const batch = [];
  let dup = 0;
  for (const [kind, time, amount, acc, to, cat, note, merchant, member, project, key] of r.txns) {
    const src = 'ssj:' + key;
    if (srcs.has(src)) { dup++; continue; }
    srcs.add(src);
    addTag('members', member); addTag('merchants', merchant); addTag('projects', project);
    batch.push({ id: uid(), bookId, type: kind, amount: r2(amount), catId: kind === 'expense' || kind === 'income' ? catMap[cat] || '' : '',
      accountId: accMap[acc] || '', toAccountId: kind === 'transfer' ? accMap[to] || '' : '', time, note: note || '',
      merchant: merchant || '', project: project || '', member: member || '', src });
  }
  for (let i = 0; i < batch.length; i += 5000) S.txns.push.apply(S.txns, batch.slice(i, i + 5000));
  _cache.ordered = false;
  ensureTxnOrder();
  S.curBook = bookId;
  save();
  // 核对：洵记里这些账户的余额 vs 随手记流水算出的余额
  const want = ssjBalances(r), bal = balances();
  const rows = Object.keys(accMap).map(id => {
    const a = accById(accMap[id]), ok = Math.abs((bal[a.id] || 0) - (want[id] || 0)) < 0.005;
    return `<div class="kv"><span>${accIcon(a)} ${esc(a.name)}</span><b class="${ok ? '' : 'over'}">${money(bal[a.id] || 0)}${ok ? ' ✓' : ` ≠ ${money(want[id] || 0)}`}</b></div>`;
  }).join('');
  KB = null;
  tab('home');
  openSheet('导入完成', `<div class="kv"><span>导入流水</span><b>${batch.length} 条</b></div>
    ${dup ? `<div class="kv"><span>跳过（已导入过）</span><b>${dup} 条</b></div>` : ''}
    <div class="kv"><span>新建账户</span><b>${made.length} 个</b></div>
    <div class="kv"><span>导入到账本</span><b>${esc((S.books.find(b => b.id === bookId) || {}).name || '')}</b></div>
    <label>账户余额核对（✓ 表示与随手记一致）</label>${rows}
    <div class="tip">账户余额包含所有账本的流水；如果导入前这些账户已有其他记录，余额会和随手记不同。</div>`);
}
