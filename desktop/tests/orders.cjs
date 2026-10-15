const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixture=require('../../tests/fixtures/ocr-orders.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.XUNJI_TEST_URL);await page.waitForFunction(()=>typeof S!=='undefined'&&S);
  assert.match(await page.evaluate(()=>dbInfo().path),/ui-test/);
  await page.evaluate(async fixture=>{
   S=initData(false);resetTxnOrder();openOcr();
   shrinkImage=async file=>file;
   localOcr=async()=>({ok:true,...fixture,model:'PP-OCRv6 均衡',threads:4,total_ms:100,det_ms:30,rec_ms:70,load_ms:0,lines:fixture.lines});
   await ocrFiles({files:[new File(['synthetic-ocr-fixture'],'orders.png',{type:'image/png'})],value:''});
  },fixture);
  assert.equal(await page.evaluate(()=>OC.items.length),2,'Identical independent orders are retained');
  assert.deepEqual(await page.evaluate(()=>OC.items.map(x=>x.amount)),[3.2,3.2]);
  const note=await page.evaluate(()=>OC.items[0].note);
  assert(note.length>60);assert.match(note,/海天.*生抽/);assert.match(note,/金龙鱼.*料酒/);assert.match(note,/×1/);assert.match(note,/11.50/);assert.match(note,/5.80/);assert.match(note,/实付.*3.20/);
  await page.getByText(/有 1 笔订单未显示完整实付款/).waitFor();
  await page.locator('.oc-m').first().click();
  assert.equal(await page.locator('#ocN').inputValue(),note);
  assert.equal(await page.locator('#ocN').getAttribute('maxlength'),'4000');
  await page.evaluate(()=>closeSheet());
  await page.locator('.oc-bar button').click();
  await page.locator('#sheet .btn').filter({hasText:/^导入$/}).click();
  assert.equal(await page.evaluate(()=>S.txns.length),2);
  assert.equal(await page.evaluate(()=>sumT(S.txns,'expense')),6.4);
  assert.equal(await page.evaluate(()=>S.txns[0].note),note);
  await page.evaluate(()=>startAdd(S.txns[0].id));
  assert.equal(await page.locator('textarea[aria-label=备注]').inputValue(),note);
  await page.locator('textarea[aria-label=备注]').fill(note+'\n已核对合单优惠');
  await page.locator('#kok').click();
  await page.locator('#sheet .btn').filter({hasText:/^保存$/}).click();
  await page.waitForFunction(()=>E===null);
  assert((await page.evaluate(()=>S.txns.map(t=>t.note))).some(n=>n===note+'\n已核对合单优惠'),'Edited note must be retained before saving');
  await page.evaluate(()=>saveNow());
  await page.reload();await page.waitForFunction(()=>typeof S!=='undefined'&&S&&S.txns.length===2);
  const notes=await page.evaluate(()=>S.txns.map(t=>t.note));
  assert(notes.some(n=>n===note+'\n已核对合单优惠'));
  assert(notes.every(n=>n.includes('金龙鱼')&&n.includes('\n')));
  assert.deepEqual(errors,[]);
  console.log('PASS: one entry per paid order, both goods in long notes, no false dedup, cutoff warning, preview/edit/import/persistence');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
