'use strict';
/* 压力测试（生成大量数据） */
function stressSheet() {
  openSheet('压力测试', `<div class="tip">在当前账本上追加生成大量随机流水，用于观察首页 / 流水 / 报表在上万条数据时的流畅度。生成后建议再打开各页面滑动检查。不会删除现有数据。</div>
    <div class="chips" style="flex-wrap:wrap">${[10000, 50000, 100000, 200000].map(n => `<i class="chip" onclick="runStress(${n})">＋${n.toLocaleString()} 条</i>`).join('')}</div>
    <div class="tip">当前已有 <b>${S.txns.length.toLocaleString()}</b> 条记录。目标规模约 20 万条以内。</div>`);
}
function runStress(n) {
  closeSheet();
  toast(`正在生成 ${n.toLocaleString()} 条…`);
  setTimeout(() => {
    const t0 = performance.now();
    const B = S.curBook;
    const E = S.categories.expense.filter(c => c.pid), I = S.categories.income.filter(c => c.pid);
    const topsE = S.categories.expense.filter(c => !c.pid), topsI = S.categories.income.filter(c => !c.pid);
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const accs = S.accounts.map(a => a.id);
    const members = S.members.length ? S.members : ['本人'];
    const merchants = S.merchants.length ? S.merchants : [''];
    const projects = ['', '', '', ...(S.projects || [])];
    const now = Date.now();
    const dayMs = 864e5;
    const batch = new Array(n);
    for (let i = 0; i < n; i++) {
      const isInc = Math.random() < 0.12;
      const type = Math.random() < 0.04 ? 'transfer' : (isInc ? 'income' : 'expense');
      let catId = '';
      if (type !== 'transfer') {
        const subs = type === 'expense' ? E : I;
        const tops = type === 'expense' ? topsE : topsI;
        catId = (subs.length ? pick(subs) : pick(tops)).id;
      }
      const acc = pick(accs);
      let to = '';
      if (type === 'transfer') {
        to = pick(accs.filter(x => x !== acc).concat(accs[0]));
        if (to === acc) to = accs.find(x => x !== acc) || acc;
      }
      batch[i] = {
        id: uid(), bookId: B, type, amount: r2(3 + Math.random() * (type === 'income' ? 8000 : 400)),
        catId, accountId: acc, toAccountId: type === 'transfer' ? to : '',
        time: now - Math.floor(Math.random() * 3650) * dayMs - Math.floor(Math.random() * dayMs),
        note: Math.random() < 0.2 ? '压测' : '', member: pick(members),
        merchant: type === 'expense' ? pick(merchants) : '', project: type === 'expense' ? pick(projects) : ''
      };
    }
    for (let i = 0; i < batch.length; i += 5000) S.txns.push.apply(S.txns, batch.slice(i, i + 5000));
    _cache.ordered = false;
    ensureTxnOrder();
    const genMs = performance.now() - t0;
    const s0 = performance.now();
    save();
    const saveMs = performance.now() - s0;
    const pages = ['home', 'list', 'report', 'me'];
    const times = {};
    for (const p of pages) {
      const a = performance.now();
      tab(p);
      times[p] = Math.round(performance.now() - a);
    }
    const la = performance.now();
    openList('all');
    times.listAll = Math.round(performance.now() - la);
    tab('home');
    openSheet('压测结果', `<div class="kv"><span>新增</span><b>${n.toLocaleString()} 条</b></div>
      <div class="kv"><span>总记录</span><b>${S.txns.length.toLocaleString()} 条</b></div>
      <div class="kv"><span>生成耗时</span><b>${Math.round(genMs)} ms</b></div>
      <div class="kv"><span>保存耗时</span><b>${Math.round(saveMs)} ms</b></div>
      ${pages.map(p => `<div class="kv"><span>渲染 ${p}</span><b>${times[p]} ms</b></div>`).join('')}
      <div class="kv"><span>全部流水</span><b>${times.listAll} ms</b></div>
      <div class="tip">日常按「月 / 年」查看通常很快；「全部」会扫一遍全库算合计，20 万条约几百毫秒量级属正常。导出 CSV/JSON 在大数据量时可能要等几秒到几十秒。</div>
      <button class="btn" onclick="closeSheet()">知道了</button>`);
  }, 40);
}
