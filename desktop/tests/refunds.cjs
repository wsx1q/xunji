const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const p=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(process.env.XUNJI_TEST_URL);await p.waitForFunction(()=>typeof S!=='undefined'&&S);
  assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
  await p.evaluate(()=>{
   S=initData(false);resetTxnOrder();openOcr();
   OC.items=['expense','refund','refund_pending','skip'].map((kind,i)=>({key:String(i),kind,
    note:'核对订单'+i,amount:i===3?0:10+i,status:kind,sel:kind==='expense',goods:[]}));
   OC.imgs=1;render();
  });
  await p.locator('.oc-bar button').click();
  await p.locator('#sheet .btn').filter({hasText:/^导入$/}).click();
  assert.equal(await p.evaluate(()=>S.txns.length),1);
  assert.equal(await p.evaluate(()=>OC.items.length),3);
  // Editing a refund does not select it for expense import.
  await p.locator('.oc-m').first().click();
  await p.locator('#ocA').fill('12.34');await p.locator('#ocN').fill('已核对退款备注');
  await p.locator('#sheet .btn').filter({hasText:/^确定$/}).click();
  assert.deepEqual(await p.evaluate(()=>[OC.items[0].kind,OC.items[0].sel,OC.items[0].amount]),['refund',false,12.34]);
  await p.locator('.oc-ck').first().click();
  assert.equal(await p.evaluate(()=>OC.items[0].reviewSel),true);
  assert.equal(await p.evaluate(()=>OC.items.filter(x=>x.sel&&ocrCanImport(x)).length),0);
  // Explicitly correct a misclassified refund into an expense.
  await p.locator('.oc-m').first().click();await p.locator('#ocKind').selectOption('expense');
  await p.locator('#sheet .btn').filter({hasText:/^确定$/}).click();
  assert.deepEqual(await p.evaluate(()=>[OC.items[0].kind,OC.items[0].sel,OC.items[0].reviewSel]),['expense',true,false]);
  await p.locator('.oc-bar button').click();await p.locator('#sheet .btn').filter({hasText:/^导入$/}).click();
  assert.equal(await p.evaluate(()=>S.txns.length),2);
  assert(await p.evaluate(()=>S.txns.some(t=>t.note==='已核对退款备注'&&t.amount===12.34)));
  // Closed zero-amount records remain editable and excluded.
  await p.locator('.oc-m').last().click();await p.locator('#ocN').fill('关闭订单已核对');
  await p.locator('#sheet .btn').filter({hasText:/^确定$/}).click();
  assert.equal(await p.evaluate(()=>OC.items.at(-1).sel),false);
  await p.getByText('全选不导入记录',{exact:true}).click();
  assert.equal(await p.evaluate(()=>OC.items.filter(x=>x.reviewSel).length),2);
  await p.getByText('取消全选',{exact:true}).click();
  assert.equal(await p.evaluate(()=>OC.items.filter(x=>x.reviewSel).length),0);
  await p.getByText('全选不导入记录',{exact:true}).click();
  await p.getByText('忽略选中 2 笔',{exact:true}).click();
  await p.locator('#sheet .btn').filter({hasText:/^忽略$/}).click();
  assert.equal(await p.evaluate(()=>OC.items.length),0);
  assert.equal(await p.evaluate(()=>S.txns.length),2,'Ignoring exclusions cannot modify imported transactions');
  assert.deepEqual(errors,[]);
  console.log('PASS: expense import leaves editable refunds, explicit correction, exclusion selection, bulk ignore and imported transactions preserved');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
