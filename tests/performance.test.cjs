// Run with Node.js: node --test tests/performance.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const root = path.join(__dirname, '..');

function runtime(native = false) {
  const nodes = new Map(['#lbody', '#lsum', '#lock'].map(id => [id,
    { innerHTML: '', className: '', classList: { toggle() {}, remove() {} } }]));
  const android = { dbOpen() {}, testTools: () => true, ocrLocalAvailable: () => false };
  const ctx = vm.createContext({
    console, performance, setTimeout, clearTimeout,
    requestAnimationFrame: cb => setImmediate(() => cb(performance.now())),
    document: { querySelector: id => nodes.get(id) || null, querySelectorAll: () => [] },
    navigator: {}, window: native ? { Android: android } : {}, Android: android,
    localStorage: { setItem() {}, removeItem() {} },
  });
  for (const file of ['util', 'defaults', 'store', 'query', 'router', 'ui',
    'pages/list', 'pages/board', 'stress']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'web/js', file + '.js'), 'utf8'), ctx, { filename: file });
  }
  vm.runInContext(`S = initData(false); toast = () => {}; openSheet = (title, body) => { window.sheet = {title, body}; };
    closeSheet = () => {}; vlMount = (host, tx) => { window.shown = tx; };`, ctx);
  return { ctx, run: source => vm.runInContext(source, ctx), nodes, android };
}

test('200k records: list results, totals and selection match a full scan across filters', () => {
  const { run, nodes } = runtime();
  run(`
    const base = new Date(2026, 9, 1).getTime(), step = 36e5;
    const cats = S.categories.expense, parent = cats.find(c => !c.pid), child = cats.find(c => c.pid === parent.id);
    S.accounts.push({ id: 'child-account', pid: S.accounts[0].id, name: 'Wallet', init: 0 });
    S.txns = Array.from({length: 200000}, (_, i) => ({ id: String(i).padStart(7, '0'),
      bookId: i % 9 ? S.curBook : 'another-book', time: base + (1000 - i) * step,
      amount: i % 2 ? i % 100 : -(i % 100), type: ['expense', 'income', 'transfer', 'adjust'][i % 4],
      catId: i % 2 ? child.id : parent.id, accountId: 'child-account', toAccountId: S.accounts[0].id,
      note: i % 3 ? 'HELLO' : 'other', member: i % 2 ? '本人' : 'Alice', merchant: 'SHOP', project: 'Work' }));
    resetTxnOrder();
    window.cases = [
      {kind: 'month', ref: base}, {kind: 'year', ref: base}, {kind: 'all'},
      {kind: 'custom', s: base, e: base + step},
      {kind: 'custom', s: base + 1, e: base + step},
      {kind: 'custom', s: base - 10 * step, e: base - 10 * step},
      {kind: 'month', ref: base, q: 'hElLo', type: 'expense'},
      {kind: 'month', ref: base, cat: parent.id},
      {kind: 'month', ref: base, cat: child.id, exact: true},
      {kind: 'month', ref: base, F: normBoard({accs: [S.accounts[0].id], min: '-20', max: '40', members: ['Alice']})},
      {kind: 'all', F: normBoard({start: '2026-10-01', end: '2026-10-15', note: 'hello'})},
      {kind: 'custom', s: base + 2000 * step, e: Infinity},
    ];
  `);
  const count = run('window.cases.length');
  for (let i = 0; i < count; i++) {
    run(`{ Object.assign(L, L0, {F: normBoard({}), s: 0, e: Infinity}, window.cases[${i}]);
      const bounds = lfDates() ? boardRange(L.F) : L.kind === 'custom' ? [L.s, L.e] : periodRange(L.kind, L.ref);
      const predicate = lfActive().some(k => k !== 'time') ? boardMatch({...L.F, type:'all'}) : null;
      window.expected = bookTx().filter(t => matchListTx(t, ...bounds, L.q.trim().toLowerCase(), predicate));
      window.expectedTotals = [sumT(window.expected, 'income'), sumT(window.expected, 'expense')];
      renderListBody(); }`);
    assert.equal(run('JSON.stringify(L.ids)'), run('JSON.stringify(window.expected.map(t => t.id))'), `case ${i}`);
    assert.equal(run('JSON.stringify(window.shown)'), run('JSON.stringify(window.expected)'), `case ${i}`);
    for (const amount of run('window.expectedTotals')) assert.ok(nodes.get('#lsum').innerHTML.includes(run(`money(${amount})`)));
  }
  run(`Object.assign(L, L0, {kind:'month', ref:base, F:normBoard({})});
    const realMatch = matchListTx; window.visited = 0;
    matchListTx = (...args) => { window.visited++; return realMatch(...args); };
    renderListBody();`);
  assert.ok(run('window.visited') < 1000, 'monthly filtering must avoid scanning 200k records');
  console.log(`200k fixture: monthly filter visited ${run('window.visited')} records`);
});

test('save timing waits for native background completion and includes encoding', async () => {
  const { run, android } = runtime(true);
  let polls = 0, commits = 0;
  android.dbPart = () => {};
  android.dbCommit = () => { commits++; return ''; };
  android.dbSaveStatus = () => JSON.stringify({ saving: ++polls < 3, error: '' });
  const elapsed = await run('stressSave()');
  assert.equal(commits, 1);
  assert.equal(polls, 3);
  assert.ok(elapsed >= 40, 'must not stop timing when the request is merely queued');
});

test('save timing reports native write and commit errors', async () => {
  const { run, android } = runtime(true);
  android.dbPart = () => {};
  android.dbCommit = () => '';
  android.dbSaveStatus = () => JSON.stringify({ saving: false, error: 'disk full' });
  await assert.rejects(run('stressSave()'), /disk full/);
  android.dbCommit = () => 'commit failed';
  await assert.rejects(run('stressSave()'), /commit failed/);
});

test('browser save errors are not reported as successful completion', async () => {
  const { run, ctx } = runtime();
  assert.ok(await run('stressSave()') >= 0);
  ctx.localStorage.setItem = () => { throw new Error('quota'); };
  await assert.rejects(run('stressSave()'), /存储空间不足/);
});

test('startup distinguishes cold launch and recreation; later data reloads retain the first measurement', async () => {
  for (const cold of [true, false]) {
    const { run, android } = runtime(true);
    android.startupInfo = () => JSON.stringify({ cold, elapsedMs: 1234 });
    await run(`(async () => { render=()=>{}; showLock=()=>{}; checkSharedFile=()=>{};
      _startupWaited = true; start(JSON.stringify({...S, txnFmt:3, txnDict:[]})); await afterPaint(); })()`);
    assert.equal(run('_startupPerf.cold'), cold);
    assert.equal(run('_startupPerf.ms'), 1234);
    assert.equal(run('_startupPerf.waited'), true);
    android.startupInfo = () => JSON.stringify({ cold, elapsedMs: 9999 });
    await run(`(async () => { start(JSON.stringify({...S, txnFmt:3, txnDict:[]})); await afterPaint(); })()`);
    assert.equal(run('_startupPerf.ms'), 1234);
  }
});

test('pressure test waits for each page to display and reports save failures separately', async () => {
  const { run, android } = runtime(true);
  let polls = 0;
  android.dbPart = () => {};
  android.dbCommit = () => '';
  android.dbSaveStatus = () => JSON.stringify({ saving: ++polls < 2, error: '' });
  run(`window.displays=[]; window.frames=0;
    tab=p=>window.displays.push(p); openList=p=>window.displays.push(p);
    requestAnimationFrame=cb=>{window.frames++;setTimeout(()=>cb(performance.now()),0);}; runStress(10); runStress(10);`);
  while (run('_stressRunning')) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(run('S.txns.length'), 10, 'duplicate runs should not append another batch');
  assert.equal(run('window.frames'), 10);
  assert.equal(run('JSON.stringify(window.displays)'), JSON.stringify(['home', 'month', 'report', 'me', 'all', 'home']));
  assert.equal(run('window.sheet.title'), '压测结果');
  assert.match(run('window.sheet.body'), /保存完成（含压缩、加密、写盘）/);
  android.dbSaveStatus = () => JSON.stringify({ saving: false, error: 'disk full' });
  run('runStress(1)');
  while (run('_stressRunning')) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(run('window.sheet.title'), '压测未完成');
  assert.match(run('window.sheet.body'), /disk full/);
});

test('desktop releases serialized ledger copies and rebuilds exports and missing native chunks', () => {
  const {run,android}=runtime(true);
  const parts=new Map();let sends=0,missing=false;
  android.dbPart=(year,text)=>{assert.equal(typeof text,'string');parts.set(year,text);sends++;};
  android.dbCommit=()=>{if(missing){missing=false;return 'missing';}return '';};
  run(`window.XUNJI_DESKTOP=true;
    S.txns=[{id:'memory',time:Date.now(),amount:3.2,type:'expense',note:'保留备注',bookId:S.curBook}];
    resetTxnOrder();save();flushSave();`);
  assert.equal(sends,1);
  assert(run('[..._yc.values()].every(c=>c.str===null)'));
  run('save();flushSave();');assert.equal(sends,1,'Unchanged years should not be re-encoded or sent');
  const exported=run('JSON.stringify(decodeDb(JSON.parse(fullJson())).txns)');
  assert.equal(JSON.parse(exported)[0].note,'保留备注');
  run('save();flushSave();');
  missing=true;parts.clear();run('save();flushSave();');
  assert.equal(sends,2);assert.equal(parts.size,1);
  assert(run('[..._yc.values()].every(c=>c.str===null)'));
  run(`S.txns=S.txns.map(t=>({...t,note:'已修改'}));save();flushSave();`);
  assert.equal(sends,3);
  assert([...parts.values()][0].includes('已修改'));
});
