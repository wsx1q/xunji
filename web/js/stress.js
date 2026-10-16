'use strict';
/* 压力测试（生成大量数据） */
let _stressRunning = false;
function startupPerfHtml() {
  const p = _startupPerf;
  if (!p) return '<div class="kv"><span>本次启动首屏</span><b>尚未测得</b></div>';
  const label = p.cold === null ? '网页启动首屏' : p.cold ? '本次冷启动首屏' : '本次 Activity 重建首屏';
  return `<div class="kv"><span>${label}${p.waited ? '（含密码等待）' : ''}</span><b>${Math.round(p.ms)} ms</b></div>`;
}
/** 强制提交本次保存，再异步等到原生后台写盘返回，不阻塞界面。 */
async function stressSave() {
  const t0 = performance.now();
  save();
  const err = flushSave();
  if (err) throw new Error(err);
  if (NATIVE) {
    if (!Android.dbSaveStatus) throw new Error('当前安装版本不支持保存完成计时，请安装新版 Beta');
    while (true) {
      const status = JSON.parse(Android.dbSaveStatus());
      if (!status.saving) {
        if (status.error) throw new Error(status.error);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  return performance.now() - t0;
}
function stressSheet() {
  if (_stressRunning) return toast('压测进行中，请稍候');
  openSheet('压力测试', `<div class="tip">在当前账本上追加生成大量随机流水，用于观察首页 / 流水 / 报表在上万条数据时的流畅度。生成后建议再打开各页面滑动检查。不会删除现有数据。</div>
    <div class="chips" style="flex-wrap:wrap">${[10000, 50000, 100000, 200000].map(n => `<i class="chip" onclick="runStress(${n})">＋${n.toLocaleString()} 条</i>`).join('')}</div>
    <div class="tip">当前已有 <b>${S.txns.length.toLocaleString()}</b> 条记录。目标规模约 20 万条以内。</div>
    ${startupPerfHtml()}<div class="tip">启动测到首页或锁屏首次显示；要测追加数据后的冷启动，请结束 App 进程后重新打开，再到这里查看。</div>`);
}
function runStress(n) {
  if (_stressRunning) return;
  _stressRunning = true;
  closeSheet();
  toast(`正在生成 ${n.toLocaleString()} 条…`);
  setTimeout(async () => {
    try {
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
      toast('正在等待保存完成…');
      const saveMs = await stressSave();
      const pages = ['home', 'list', 'report', 'me'];
      const times = {};
      for (const p of pages) {
        const a = performance.now();
        if (p === 'list') openList('month'); else tab(p);
        await afterPaint();
        times[p] = Math.round(performance.now() - a);
      }
      const la = performance.now();
      openList('all');
      await afterPaint();
      times.listAll = Math.round(performance.now() - la);
      tab('home');
      openSheet('压测结果', `<div class="kv"><span>新增</span><b>${n.toLocaleString()} 条</b></div>
        <div class="kv"><span>总记录</span><b>${S.txns.length.toLocaleString()} 条</b></div>
        <div class="kv"><span>生成耗时</span><b>${Math.round(genMs)} ms</b></div>
        <div class="kv"><span>${NATIVE ? '保存完成（含压缩、加密、写盘）' : '浏览器存储完成'}</span><b>${Math.round(saveMs)} ms</b></div>
        ${pages.map(p => `<div class="kv"><span>显示 ${{ home: '首页', list: '当月流水', report: '报表', me: '我的' }[p]}</span><b>${times[p]} ms</b></div>`).join('')}
        <div class="kv"><span>显示全部流水</span><b>${times.listAll} ms</b></div>
        ${startupPerfHtml()}
        <div class="tip">保存计时包含数据编码和等待后台完成，不含平时合并保存请求的 250ms 延迟。页面显示耗时为近似值。启动数据来自本次启动；测新增数据后的冷启动，需要结束 App 进程后重新打开。</div>
        <button class="btn" onclick="closeSheet()">知道了</button>`);
    } catch (e) {
      openSheet('压测未完成', `<div class="tip">${esc(e.message || String(e))}</div><button class="btn" onclick="closeSheet()">知道了</button>`);
    } finally {
      _stressRunning = false;
    }
  }, 40);
}
