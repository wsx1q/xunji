const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fixture=require('../../tests/fixtures/ocr-orders.cjs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(process.env.XUNJI_TEST_URL);await p.waitForFunction(()=>typeof S!=='undefined'&&S);
  assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
  await p.evaluate(async f=>{
   S=initData(false);resetTxnOrder();openOcr();
   shrinkImage=async file=>file;
   localOcr=async()=>({ok:true,...f,model:'test',threads:4,total_ms:100,det_ms:30,rec_ms:70,load_ms:0});
   await ocrFiles({files:[new File(['category fixture'],'category.png',{type:'image/png'})],value:''});
  },fixture);
  assert.equal(await p.evaluate(()=>OC.items.length),2);
  assert(await p.evaluate(()=>OC.items.every(it=>catById(it.catId).name==='餐饮')));
  await p.getByText(/商品关键词推荐/).first().waitFor();
  const note=await p.evaluate(()=>OC.items[0].note);
  // Exercise category picker callback, including a choice equal to the default.
  const selected=await p.evaluate(()=>{
   const id=S.categories.expense.find(c=>c.name==='日用品').id;OC.catId=id;ocrPickCat(0);return id;
  });
  await p.evaluate(id=>sheetPick(id),selected);
  assert.equal(await p.evaluate(()=>OC.items[0].catId),selected);
  assert.equal(await p.evaluate(()=>S.settings.ocrCategoryMemory?.length||0),0,'Preview changes must not train before import');
  assert.equal(await p.evaluate(()=>OC.items[0].note),note);
  await p.locator('.oc-bar button').click();
  await p.locator('#sheet .btn').filter({hasText:/^导入$/}).click();
  assert.equal(await p.evaluate(()=>S.txns.length),2);
  assert.equal(await p.evaluate(()=>S.settings.ocrCategoryMemory.length),1);
  assert(await p.evaluate(id=>S.txns.some(t=>t.catId===id),selected));
  assert.equal(await p.evaluate(()=>sumT(S.txns,'expense')),6.4);
  await p.evaluate(()=>saveNow());await p.reload();await p.waitForFunction(()=>typeof S!=='undefined'&&S&&S.txns.length===2);
  assert.equal(await p.evaluate(f=>OcrCategory.suggest({goods:parseBill(f.lines,f.width,f.height).orders[0].items},OcrCategory.context(S)).catId,fixture),selected);
  assert(await p.evaluate(()=>S.txns.every(t=>t.note.includes('金龙鱼'))));
  assert.deepEqual(errors,[]);
  console.log('PASS: suggested preview, manual default-category override, import-only learning, notes/totals and persistence');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
