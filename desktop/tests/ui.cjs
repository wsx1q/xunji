// Test only against an isolated host: app.py --headless --data-dir desktop/build/ui-test
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = process.env.XUNJI_TEST_URL;
if (!url) throw new Error('Set XUNJI_TEST_URL to an isolated test host');
const artifacts = path.join(__dirname, '../build/screenshots');
fs.mkdirSync(artifacts, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  try {
    await page.goto(url);
    await page.waitForFunction(() => typeof S !== 'undefined' && S);
    assert.match(await page.evaluate(() => dbInfo().path), /ui-test/, 'Refuse to modify a real ledger');
    await page.evaluate(() => {S=initData(false);resetTxnOrder();save();tab('home');});

    // Native database bridge and actual desktop form: account, income, expense, refund, transfer.
    await page.locator('.desk-nav [data-page=accounts]').click();
    await page.locator('[onclick="editAcc()"]').first().click();
    await page.locator('#aName').fill('测试银行卡');
    await page.locator('#aInit').fill('1000');
    await page.locator('[onclick="saveAcc()"]').click();
    assert.equal(await page.evaluate(() => S.accounts.length), 2);
    console.log('PASS: account creation');
    async function add(type, amount, note) {
      await page.keyboard.press('Control+n');
      await page.locator('.desk-entry .seg i').filter({hasText: {expense:'支出',income:'收入',transfer:'转账'}[type]}).click();
      await page.locator('#deskAmount').fill(amount);
      await page.locator('textarea[aria-label=备注]').fill(note);
      await page.keyboard.press('Control+Enter');
      await page.waitForFunction(() => E === null);
    }
    await add('expense', '12+8.5', '桌面午餐 Hello');
    await add('expense', '-5', '测试退款');
    await add('income', '300', '测试收入');
    await add('transfer', '100', '账户转账');
    assert.equal(await page.evaluate(() => S.txns.length), 4);
    assert.equal(await page.evaluate(() => sumT(S.txns,'expense')), 15.5);
    assert.equal(await page.evaluate(() => r2(Object.values(balances()).reduce((a,b)=>a+b,0))), 1284.5);
    console.log('PASS: expense, refund, income and transfer');

    await page.locator('.desk-nav [data-page=list]').click();
    assert.equal(await page.locator('.desk-row').count(), 4);
    await page.locator('.desk-row').first().click({button:'right'});
    await page.locator('#deskContext button').filter({hasText:'复制记录'}).click();
    await page.locator('textarea[aria-label=备注]').fill('复制的转账');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => S.txns.length===5);
    console.log('PASS: context-menu copy');

    // Batch edit with undo, using the same real mobile mutation functions through desktop controls.
    await page.locator('.desk-nav [data-page=list]').click();
    await page.keyboard.press('Control+a');
    assert.equal(await page.evaluate(() => SEL.size), 5);
    await page.locator('.sel-bar button').click();
    await page.locator('#sheet .opt').filter({hasText:'追加备注'}).click();
    await page.locator('#bnIn').fill('#核对');
    await page.locator('#sheet button').filter({hasText:'追加到'}).click();
    assert.equal(await page.evaluate(() => S.txns.every(t=>t.note.includes('#核对'))), true);
    await page.locator('#sheet button').filter({hasText:'撤销修改'}).click();
    console.log('PASS: batch append/undo');
    assert.equal(await page.evaluate(() => S.txns.some(t=>t.note.includes('#核对'))), false);
    await page.keyboard.press('Control+a');
    await page.locator('.sel-bar button').click();
    await page.locator('#sheet .opt').filter({hasText:'删掉备注里的文字'}).click();
    await page.locator('#bnIn').fill('HELLO');
    await page.locator('#sheet button').filter({hasText:'从 5 笔里删掉'}).click();
    assert.equal(await page.evaluate(() => S.txns.some(t=>(t.note||'').toLowerCase().includes('hello'))), false);
    await page.locator('#sheet button').filter({hasText:'撤销修改'}).click();

    await page.locator('#q').fill('hello');
    await page.waitForFunction(() => L.ids.length===1);
    await page.locator('.desk-row [aria-label=编辑记录]').click();
    await page.locator('textarea[aria-label=备注]').fill('不再匹配');
    await page.keyboard.press('Control+Enter');
    await page.locator('#sheet button').filter({hasText:'保存'}).click();
    await page.waitForFunction(() => L.ids.length===0);
    await page.locator('#q').fill('');
    await page.waitForFunction(() => L.ids.length===5);
    await page.locator('.desk-row').first().dblclick();
    assert.equal(await page.locator('#deskAmount').count(), 1);
    await page.keyboard.press('Escape');
    console.log('PASS: batch delete text/undo and filtered edit');

    // Categories: desktop right-click and native HTML drag sort.
    await page.locator('.desk-manage button').filter({hasText:'分类'}).click();
    const original = await page.evaluate(() => S.categories.expense.filter(c=>!c.pid).map(c=>c.id));
    const tiles = page.locator('#view [data-lp=cat]').filter({visible:true});
    await tiles.first().click({button:'right'});
    await page.locator('#cName').fill('桌面餐饮');
    await page.locator('#sheet [onclick="saveCat()"]').click();
    assert.equal(await page.evaluate(() => S.categories.expense.some(c=>c.name==='桌面餐饮')), true);
    const first = page.locator(`#view [data-lpid="${original[0]}"]`).first();
    const third = page.locator(`#view [data-lpid="${original[2]}"]`).first();
    await first.dragTo(third);
    assert.notEqual(await page.evaluate(() => S.categories.expense.filter(c=>!c.pid)[0].id), original[0]);
    console.log('PASS: category edit and drag order');

    // All pages remain available; check DOM overflow at supported desktop sizes.
    for (const name of ['home','list','report','accounts','dash','me','budget','books','cats','help']) {
      await page.evaluate(name => {closeSheet();['home','list','report','me'].includes(name)?tab(name):go(name);}, name);
      await page.waitForTimeout(40);
      assert.equal(await page.locator('#view').innerText().then(t=>!!t.trim()), true, name);
    }
    for (const width of [1440, 1024]) {
      await page.setViewportSize({width,height:900});
      for (const name of ['home','list','report','accounts','me','add']) {
        await page.evaluate(name=>name==='add'?startAdd():['home','list','report','me'].includes(name)?tab(name):go(name),name);
        await page.waitForTimeout(50);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} at ${width}: horizontal overflow`);
      }
    }

    // Save, password/backup compatibility through the native bridge, then actual browser restart.
    await page.evaluate(() => {tab('home');saveNow();});
    assert.equal(await page.evaluate(() => JSON.parse(Android.dbSaveStatus()).error), '');
    assert.equal(await page.evaluate(() => Android.dbSetPassword(Android.dbHasPassword()?'desktop-test-pass':'', 'desktop-test-pass', fullJson())), '');
    const backup = await page.evaluate(() => JSON.parse(Android.forceBackup()));
    assert.equal(backup.ok, true);
    assert.equal(await page.evaluate(() => JSON.parse(Android.listBackups()).items.length>0), true);
    await page.reload();
    await page.waitForFunction(() => typeof S!=='undefined'&&S&&S.txns.length===5);
    assert.equal(await page.evaluate(() => Android.dbCheckPassword('desktop-test-pass')), true);

    // Browser file selection and real offline recognition; Android result callback feeds the shared parser.
    await page.evaluate(() => openOcr());
    await page.locator('#ocrFile').setInputFiles(path.join(__dirname,'samples/pdd_orders.jpg'));
    await page.waitForFunction(()=>OC&&!OC.busy&&OC.imgs===1,null,{timeout:90000});
    assert.equal(await page.evaluate(()=>OC.err),'');
    assert.deepEqual(await page.evaluate(()=>OC.items.map(x=>[x.kind,x.amount])),[['expense',.8],['refund',.8],['expense',35.89]]);

    // Showcase screenshots use isolated demo data, never included in the distributable.
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(()=>{S=initData(true);resetTxnOrder();save();tab('home');});
    for (const name of ['home','list','report','add']) {
      await page.evaluate(name=>name==='add'?startAdd():name==='list'?openList('month'):tab(name),name);
      await page.evaluate(()=>$('#toast').classList.remove('on'));
      await page.waitForTimeout(220);
      await page.screenshot({path:path.join(artifacts,`${name}.png`),fullPage:false});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: desktop create/edit/refund/transfer, batch edit/undo, search, context menu, drag order, routes, 1024/1440 layout, persistence, encrypted backup and offline OCR');
  } catch(error) {
    console.error('APP ERRORS',errors);
    console.error('CURRENT UI', (await page.locator('body').innerText()).slice(-3500));
    await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true});
    throw error;
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
