// Run against an isolated desktop host with XUNJI_TEST_URL set.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(process.env.XUNJI_TEST_URL);
    await page.waitForFunction(()=>typeof S!=='undefined'&&S);
    await page.waitForFunction(()=>document.querySelector('.desk-brand img')?.naturalWidth===256);
    assert.match(await page.evaluate(()=>dbInfo().path),/ui-test/);
    await page.evaluate(()=>{
      S=initData(false);
      S.categories.expense=Array.from({length:80},(_,i)=>({id:'report'+i,name:'测试分类 '+(i+1),icon:'📁',color:COLORS[i%COLORS.length],pid:''}));
      S.categories.expense.push({id:'report-sub',name:'子分类',icon:'📁',color:COLORS[0],pid:'report0'});
      S.txns=S.categories.expense.map((c,i)=>({id:'rt'+i,bookId:S.curBook,type:'expense',amount:i+1,catId:c.id,accountId:S.accounts[0].id,time:Date.now(),note:''}));
      resetTxnOrder(); R.pcat='';R.kind='month';R.type='expense';R.ref=Date.now();tab('report');
    });
    for(const [width,height] of [[1440,900],[1024,720]]) {
      await page.setViewportSize({width,height});
      assert.equal(await page.locator('.desk-report-panel').count(),3);
      for(const el of await page.locator('.desk-report-panel .card-hd').all()) {
        const box=await el.boundingBox();assert(box.y+box.height<height,'All chart headings visible');
      }
      for(const el of await page.locator('.desk-report-panel svg').all()) {
        const box=await el.boundingBox();assert(box.y+box.height<height,'All charts visible');
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    assert.equal(await page.locator('.report-panel-0 > .desk-report-body > .rank').count(),3);
    assert.equal(await page.locator('.desk-report-rank-scroll .rank').count(),77);
    await page.locator('.desk-report-ranks>summary').click();
    assert(await page.locator('.desk-report-ranks').evaluate(el=>el.open));
    assert(await page.locator('.desk-report-rank-scroll').evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=260));
    await page.evaluate(()=>render());
    assert(await page.locator('.desk-report-ranks').evaluate(el=>el.open),'Expansion survives render');
    await page.locator('.report-panel-1>summary').click();
    assert.equal(await page.locator('.report-panel-1').evaluate(el=>el.open),false);
    await page.locator('.report-panel-1>summary').click();
    await page.locator('.report-panel-0 .rank').filter({hasText:'测试分类 1 ›'}).click();
    assert.equal(await page.evaluate(()=>R.pcat),'report0');
    assert.equal(await page.locator('.report-panel-0 .rank').count(),2);
    await page.locator('.report-panel-0 summary a').click();
    assert.equal(await page.evaluate(()=>R.pcat),'');
    assert(await page.locator('.report-panel-0').evaluate(el=>el.open),'Back link does not collapse card');
    await page.locator('.r-hd .seg i').filter({hasText:'收入'}).click();
    assert.equal(await page.locator('.report-panel-0 .rank').count(),0);
    await page.locator('.r-hd .seg i').filter({hasText:'支出'}).click();
    await page.locator('.r-hd .seg i').filter({hasText:'年报'}).click();
    assert.equal(await page.locator('.report-panel-0 .rank').count(),80);
    await page.locator('.r-hd .seg i').filter({hasText:'月报'}).click();
    await page.locator('.desk-report-ranks>summary').click();
    await page.setViewportSize({width:1440,height:900});
    await page.screenshot({path:path.join(__dirname,'../build/screenshots/report-many.png')});
    assert.deepEqual(errors,[]);
    console.log('PASS: 80 categories, all charts visible at 1440/1024, bounded expansion, collapse, drill/back, income and year/month');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
