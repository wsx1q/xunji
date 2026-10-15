const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(process.env.XUNJI_TEST_URL);await p.waitForFunction(()=>typeof S!=='undefined'&&S);
  assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
  await p.evaluate(()=>{S=initData(false);resetTxnOrder();openOcr();});
  await p.locator('#ocrFile').setInputFiles(process.env.XUNJI_CHAOHE_SAMPLE);
  await p.waitForFunction(()=>!OC.busy&&OC.imgs===1,null,{timeout:90000});
  assert.deepEqual(await p.evaluate(()=>OC.items.map(it=>it.amount)),[30.8,14.9,37.7]);
  assert(await p.evaluate(()=>OC.items.every(it=>it.platform==='超盒算'&&it.shop==='超盒算')));
  assert(await p.evaluate(()=>OC.items.every(it=>it.note.includes('件商品（截图未显示商品名称）'))));
  assert.deepEqual(await p.evaluate(()=>OC.items.map(it=>ymd(it.ocrTime))),['2026-10-12','2026-10-06','2026-10-05']);
  await p.getByText(/有 1 笔订单未显示完整实付款/).waitFor();
  await p.locator('.oc-bar button').click();await p.locator('#sheet .btn').filter({hasText:/^导入$/}).click();
  assert.equal(await p.evaluate(()=>S.txns.length),3);
  assert.equal(await p.evaluate(()=>sumT(S.txns,'expense')),83.4);
  assert(await p.evaluate(()=>S.txns.every(it=>it.merchant==='超盒算')));
  assert.deepEqual(errors,[]);
  console.log('PASS: actual Chaohe screenshot, merchant, three order totals, dates, quantity notes, cutoff warning and import');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
