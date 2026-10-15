// Optional real-screenshot regression; input stays outside the repository.
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
  await p.locator('#ocrFile').setInputFiles(process.env.XUNJI_OCR_SAMPLE);
  await p.waitForFunction(()=>OC&&!OC.busy&&OC.imgs===1,null,{timeout:90000});
  const amounts=await p.evaluate(()=>OC.items.map(it=>[it.kind,it.amount]));
  assert.deepEqual(amounts,[['expense',3.97],['refund',38],['expense',26.34],['expense',10.99],['expense',7.57],['refund',16.9],['expense',76],['expense',26.99]]);
  assert.equal(await p.evaluate(()=>Object.values(OC.incompleteByFile).reduce((a,b)=>a+b,0)),2);
  assert(await p.evaluate(()=>OC.items.find(it=>it.amount===26.34).note.includes('护理垫')));
  await p.locator('.oc-bar button').click();await p.locator('#sheet .btn').filter({hasText:/^导入$/}).click();
  assert.equal(await p.evaluate(()=>S.txns.length),6);
  assert.equal(await p.evaluate(()=>sumT(S.txns,'expense')),151.86);
  assert(await p.evaluate(()=>S.txns.some(it=>it.amount===26.34)));
  assert.deepEqual(errors,[]);
  console.log('PASS: real long screenshot retains both signed orders, preserves two refunds, warns for missing amounts and imports 26.34 correctly');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
