const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const variants=process.env.XUNJI_MOBILE_TEST_URL?
   [['desktop',process.env.XUNJI_TEST_URL,1280,900],['mobile',process.env.XUNJI_MOBILE_TEST_URL,390,844]]:
   [['desktop',process.env.XUNJI_TEST_URL,1280,900]];
  for(const [name,url,width,height] of variants){
   const p=await browser.newPage({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'});
   const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.goto(url);await p.waitForFunction(()=>typeof S!=='undefined'&&S);
   if(name==='desktop')assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
   await p.evaluate(()=>{
    S=initData(false);
    S.categories.expense=[{id:'transport',name:'交通',icon:'🚆',color:'#64B5F6',pid:''},
     {id:'train',name:'火车',icon:'🚄',color:'#64B5F6',pid:'transport'},
     {id:'metro',name:'地铁',icon:'🚇',color:'#64B5F6',pid:'transport'},
     {id:'pet',name:'宠物',icon:'🐱',color:'#FFD54F',pid:''},
     {id:'smoke',name:'烟酒',icon:'🍺',color:'#A1887F',pid:''}];
    S.categories.income=[{id:'salary',name:'工资',icon:'💰',color:'#FF8A65',pid:''}];
    const tx=(id,type,amount,catId,year,bookId=S.curBook)=>({id,type,amount,catId,time:new Date(year,0,15).getTime(),bookId,accountId:S.accounts[0].id,note:'报表测试',member:'本人'});
    S.txns=[tx('a','expense',40,'train',2024),tx('b','expense',60,'metro',2025),tx('c','income',500,'salary',2026),tx('other','expense',999,'train',2024,'other-book')];
    resetTxnOrder();R.kind='year';R.ref=Date.now();R.type='expense';R.pcat='transport';tab('report');
   });
   await p.locator('.r-hd .seg i').getByText('全部',{exact:true}).click();
   assert.equal(await p.evaluate(()=>R.kind),'all');
   assert.equal(await p.evaluate(()=>R.pcat),'transport','All-time preserves category drilldown');
   assert.equal(await p.locator('.r-hd .period').innerText(),'全部时间');
   assert.equal(await p.locator('.r-hd .period [onclick]').count(),0);
   assert.equal(await p.locator('.donut-c b').textContent(),'100.00');
   await p.getByText('按年汇总 · 2 年',{exact:true}).waitFor();
   assert.equal(await p.locator('svg text').getByText('2024年',{exact:true}).count(),1);
   assert.equal(await p.locator('svg text').getByText('2025年',{exact:true}).count(),1);
   await p.locator('.r-all').click();
   assert.equal(await p.evaluate(()=>L.kind),'all');
   assert.equal(await p.evaluate(()=>L.ids.length),2);
   await p.evaluate(()=>{tab('report');R.type='income';R.pcat='';render();});
   assert.equal(await p.locator('.donut-c b').textContent(),'500.00');
   await p.evaluate(()=>{R.type='expense';R.pcat='';render();});
   await p.screenshot({path:path.join(__dirname,`../build/screenshots/report-all-${name}.png`)});
   await p.evaluate(()=>{BD=normBoard({type:'all',cats:['train','pet','salary']});CGS['multi-expense']={type:'expense',mode:'multi',open:'transport'};pickBdCats();});
   const tile=id=>p.locator(`#sheet .cg-i[data-id="${id}"]`);
   assert.equal(await tile('transport').getAttribute('aria-checked'),'mixed');
   assert.equal(await tile('transport').locator('.cg-check').innerText(),'−');
   assert.equal(await tile('pet').getAttribute('aria-checked'),'true');
   assert.equal(await tile('smoke').getAttribute('aria-checked'),'false');
   assert(await tile('pet').locator('.cg-check').isVisible());
   assert.equal(await tile('smoke').locator('.cg-check').isVisible(),false);
   assert.notEqual(await tile('pet').evaluate(el=>getComputedStyle(el).backgroundColor),await tile('smoke').evaluate(el=>getComputedStyle(el).backgroundColor));
   assert.notEqual(await tile('pet').evaluate(el=>getComputedStyle(el).borderColor),await tile('smoke').evaluate(el=>getComputedStyle(el).borderColor));
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await p.locator('.sh-box').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
   await p.screenshot({path:path.join(__dirname,`../build/screenshots/category-selection-${name}.png`)});
   await tile('transport').click();
   assert.equal(await tile('transport').getAttribute('aria-checked'),'true');
   assert.equal(await tile('transport').locator('.cg-check').innerText(),'✓');
   assert.deepEqual(await p.evaluate(()=>BD.cats.sort()),['pet','salary','transport']);
   await tile('transport').click();assert.equal(await tile('transport').getAttribute('aria-checked'),'false');
   await tile('pet').focus();await p.keyboard.press('Space');assert.equal(await tile('pet').getAttribute('aria-checked'),'false');
   await p.getByText('全部（不限）',{exact:true}).click();assert.deepEqual(await p.evaluate(()=>BD.cats),[]);
   await p.evaluate(()=>{pickBdCats();});assert.equal(await p.locator('#sheet .cg-i[aria-checked=true]').count(),0);
   if(name==='mobile'){
    await p.evaluate(()=>{
     for(let i=0;i<25;i++)S.categories.expense.push({id:'more'+i,name:'更多分类'+i,icon:'📁',color:'#90A4AE',pid:''});
     invalidateCache();pickBdCats();
    });
    await p.locator('.sh-box').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
    const confirm=p.locator('#sheet .ms-ok .btn').last();
    const box=await confirm.boundingBox();assert(box.y>=0&&box.y+box.height<=height,'Confirmation stays visible with many categories');
    await p.locator('#sheet .sh-bd').evaluate(el=>el.scrollTop=el.scrollHeight);
    const after=await confirm.boundingBox();assert(after.y>=0&&after.y+after.height<=height);
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   }
   assert.deepEqual(errors,[]);await p.close();
   console.log('PASS:',name,'all-time report totals, yearly trend, category drilldown/details, visible full/partial selection and clearing');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
