const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const variants=[];
  if(process.env.XUNJI_TEST_URL)variants.push(['desktop',process.env.XUNJI_TEST_URL,1280,900]);
  if(process.env.XUNJI_MOBILE_TEST_URL)variants.push(['mobile',process.env.XUNJI_MOBILE_TEST_URL,390,700]);
  assert(variants.length);
  for(const [name,url,width,height] of variants){
   const p=await browser.newPage({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'}),errors=[];
   p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>typeof S!=='undefined'&&S);
   if(name==='desktop')assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
   await p.evaluate(()=>{
    S=initData(false);S.categories.expense=Array.from({length:12},(_,i)=>({id:'r'+i,name:'最近使用的测试分类'+i,icon:'📁',color:'#FF8A65',pid:''}));
    S.categories.income=[{id:'salary',name:'工资',icon:'💰',color:'#FF8A65',pid:''}];
    S.settings.recentCats={expense:S.categories.expense.map(c=>c.id),income:['salary']};
    S.settings.last={expense:{catId:'r0',member:'本人',accountId:S.accounts[0].id}};
    S.txns=[{id:'kept',type:'expense',amount:18,time:Date.now(),catId:'r2',accountId:S.accounts[0].id,bookId:S.curBook,member:'本人',note:'已有账目'}];
    resetTxnOrder();startAdd(null,{expr:'123.45',note:'正在填写的备注',merchant:'测试商家',project:'测试项目'});
   });
   const before=await p.evaluate(()=>({draft:{...E},tx:JSON.stringify(S.txns),last:JSON.stringify(S.settings.last)}));
   const container=p.locator(name==='mobile'?'#subrow .recent-chips':'.desk-recent .recent-chips');
   assert.equal(await container.locator('.chip').count(),12);
   const box=await container.evaluate(el=>({h:el.clientHeight,total:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
   assert(box.h<=96&&box.total>box.h);assert.equal(box.overflow,'auto');
   await container.evaluate(el=>el.scrollTop=el.scrollHeight);assert(await container.evaluate(el=>el.scrollTop>0));
   if(name==='mobile'){
    assert(await p.locator('.add-body').evaluate(el=>el.clientHeight>60));
    assert(await p.locator('#kok').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));
   }
   const out=path.join(__dirname,'../build/screenshots');fs.mkdirSync(out,{recursive:true});
   await p.screenshot({path:path.join(out,`recent-categories-${name}.png`)});
   await p.locator(name==='mobile'?'#subrow .recent-clear':'.desk-recent .recent-clear').click();
   const after=await p.evaluate(()=>({draft:{...E},tx:JSON.stringify(S.txns),last:JSON.stringify(S.settings.last),recent:S.settings.recentCats}));
   assert.deepEqual(after.draft,{...before.draft,recentOn:false});assert.equal(after.tx,before.tx);assert.equal(after.last,before.last);
   assert.deepEqual(after.recent,{expense:[],income:['salary']});
   assert.equal(await p.locator('.recent-clear').count(),0);
   await p.evaluate(()=>saveNow());await p.reload();await p.waitForFunction(()=>typeof S!=='undefined'&&S);
   assert.deepEqual(await p.evaluate(()=>S.settings.recentCats),{expense:[],income:['salary']});
   assert.equal(await p.evaluate(()=>S.txns[0].id),'kept');
   await p.evaluate(()=>{startAdd(null,{type:'income',expr:'9'});catSheet('选择收入分类','income',E.catId,id=>E.catId=id);});
   await p.locator('#sheet .recent-clear').click();
   assert.equal(await p.locator('#sheet .recent-clear').count(),0);assert(await p.locator('#sheet').evaluate(el=>el.classList.contains('on')));
   assert.equal(await p.evaluate(()=>E.expr),'9');assert.equal(await p.evaluate(()=>E.catId),'salary');
   assert.deepEqual(await p.evaluate(()=>S.settings.recentCats),{expense:[],income:[]});
   await p.evaluate(()=>{closeSheet();rememberLast();saveNow();});
   assert.deepEqual(await p.evaluate(()=>S.settings.recentCats),{expense:[],income:['salary']});
   assert.deepEqual(errors,[]);await p.close();
   console.log('PASS:',name,'recent category height, scrolling, clear, draft preservation, type isolation, persistence and reuse');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
