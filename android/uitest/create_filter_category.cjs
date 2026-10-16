// Run against an isolated browser server serving web/.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(process.env.XUNJI_MOBILE_TEST_URL||'http://127.0.0.1:11652/');
  await p.waitForFunction(()=>typeof S!=='undefined'&&S);
  const original=await p.evaluate(()=>{
   S=initData(false);resetTxnOrder();openSearch();L.q='原搜索条件';L.F.min='12';
   const id=tops('expense')[0].id;L.F.cats=[id];lfPick('cats');return id;
  });
  const save=async name=>{await p.locator('#cName').fill(name);await p.locator('#sheet .btn').getByText('保存',{exact:true}).click();};
  await p.getByRole('button',{name:'新建支出一级分类',exact:true}).click();await save('测试新支出');
  const parent=await p.evaluate(()=>S.categories.expense.find(c=>c.name==='测试新支出').id);
  assert.deepEqual(await p.evaluate(()=>L.F.cats),[original]);
  assert.equal(await p.evaluate(()=>L.q),'原搜索条件');assert.equal(await p.evaluate(()=>L.F.min),'12');
  assert.equal(await p.locator(`#sheet .cg-i[data-id="${parent}"]`).getAttribute('aria-checked'),'false');
  await p.locator('#sheet .cg-sub .sub-add').first().click();await save('测试新二级');
  const child=await p.evaluate(()=>S.categories.expense.find(c=>c.name==='测试新二级'));
  assert.equal(child.pid,parent);assert.deepEqual(await p.evaluate(()=>L.F.cats),[original]);
  await p.locator('#sheet .cg-sub .sub-add').first().click();await save('测试新二级');
  assert.equal(await p.evaluate(()=>S.categories.expense.filter(c=>c.name==='测试新二级').length),1);
  assert.equal(await p.locator('#cName').count(),1,'Duplicate-name validation keeps the editor open');
  await p.locator('#sheet .btn').getByText('取消',{exact:true}).click();
  await p.getByRole('button',{name:'新建收入一级分类',exact:true}).click();await save('测试新收入');
  assert(await p.evaluate(()=>S.categories.income.some(c=>c.name==='测试新收入')));
  assert.equal(await p.evaluate(()=>S.categories.expense.some(c=>c.name==='测试新收入')),false);
  const incomeParent=await p.evaluate(()=>S.categories.income.find(c=>c.name==='测试新收入').id);
  await p.locator('#sheet .cg-sub .sub-add').last().click();await save('测试收入二级');
  assert.equal(await p.evaluate(()=>S.categories.income.find(c=>c.name==='测试收入二级').pid),incomeParent);
  assert.equal(await p.evaluate(()=>S.categories.expense.some(c=>c.name==='测试收入二级')),false);
  assert.deepEqual(await p.evaluate(()=>L.F.cats),[original]);
  await p.getByRole('button',{name:'新建支出一级分类',exact:true}).click();await p.locator('#cName').fill('取消的新分类');
  await p.locator('#sheet .sh-hd b').click();
  assert.equal(await p.evaluate(()=>S.categories.expense.some(c=>c.name==='取消的新分类')),false);
  await p.locator(`#sheet .cg-sub [data-v="${child.id}"]`).click();
  assert.deepEqual(await p.evaluate(()=>L.F.cats),[original,child.id]);
  await p.locator('#sheet .sh-bd').evaluate(el=>el.scrollTop=0);
  await p.locator('.sh-box').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const out=path.join(__dirname,'../build/screenshots');fs.mkdirSync(out,{recursive:true});
  await p.screenshot({path:path.join(out,'create-filter-category.png')});
  await p.locator('#sheet .ms-ok .btn').last().click();
  assert.deepEqual(await p.evaluate(()=>L.F.cats),[original,child.id]);
  await p.evaluate(()=>saveNow());await p.reload();await p.waitForFunction(()=>typeof S!=='undefined'&&S);
  assert(await p.evaluate(()=>S.categories.expense.some(c=>c.name==='测试新二级')));
  assert(await p.evaluate(()=>S.categories.income.some(c=>c.name==='测试新收入')));
  assert.deepEqual(errors,[]);
  console.log('PASS: search filter creates expense/income parents and children, preserves filters, validates duplicates, cancels and persists');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
