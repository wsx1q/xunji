// Exercise summary-to-ledger links on the shared mobile UI and desktop host.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const sorted=a=>[...a].sort();
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const variants=[];
  if(process.env.XUNJI_TEST_URL)variants.push(['desktop',process.env.XUNJI_TEST_URL,1280,900]);
  if(process.env.XUNJI_MOBILE_TEST_URL)variants.push(['mobile',process.env.XUNJI_MOBILE_TEST_URL,390,844]);
  assert(variants.length);
  for(const [name,url,width,height] of variants){
   const p=await browser.newPage({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'}),errors=[];
   p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>typeof S!=='undefined'&&S);
   if(name==='desktop')assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
   await p.evaluate(()=>{
    S=initData(false);S.books=[{id:'b1',name:'日常账本',icon:'📒'},{id:'b2',name:'旅行账本',icon:'📕'}];S.curBook='b1';
    S.categories.expense=[{id:'food',name:'餐饮',icon:'🍚',color:'#FF8A65',pid:''},{id:'rice',name:'三餐',icon:'🍱',color:'#FF8A65',pid:'food'},
     {id:'drink',name:'饮料',icon:'🥤',color:'#FF8A65',pid:'food'},{id:'pet',name:'宠物',icon:'🐱',color:'#FFD54F',pid:''}];
    S.categories.income=[{id:'salary',name:'工资',icon:'💰',color:'#FF8A65',pid:''}];
    S.accounts=[{id:'a',name:'现金总账户',type:'cash',init:100,pid:''},{id:'ac',name:'零钱',type:'cash',init:0,pid:'a'},{id:'d',name:'信用卡',type:'credit',init:-500,pid:''}];
    S.members=['本人',`甲'"成员`];S.merchants=['店铺甲'];S.projects=['项目A'];
    const now=Date.now(),today=sod(now),prevDay=new Date(today);prevDay.setDate(prevDay.getDate()-1);
    const lastMonth=new Date(new Date(now).getFullYear(),new Date(now).getMonth()-1,15).getTime();
    const tx=(id,type,amount,catId,accountId,time=now,bookId='b1',member='本人',project='',merchant='',note='')=>({id,type,amount,catId,accountId,toAccountId:'',time,bookId,member,project,merchant,note});
    S.txns=[tx('e1','expense',20,'rice','ac',now,'b1',S.members[1],'项目A','店铺甲','采购'),
     tx('e2','expense',30,'rice','a',prevDay.getTime(),'b1',S.members[1],'项目A','店铺甲','采购'),
     tx('e3','expense',40,'pet','ac',now-10),tx('e4','expense',10,'pet','d',now-20),tx('income','income',200,'salary','ac',now-30),
     tx('previous','expense',100,'rice','a',lastMonth),tx('other','expense',70,'rice','a',now-40,'b2',S.members[1],'项目A','店铺甲','采购'),
     {...tx('transfer','transfer',15,'','ac',now-50),toAccountId:'a'},tx('old','expense',2,'food','a',new Date(2023,0,15).getTime()),
     tx('unknown','expense',3,'deleted-category','ac',now-60)];
    S.budgets={b1:{total:1000,cats:{food:100}},b2:{total:0,cats:{}}};
    S.settings.home=defaultHome();S.settings.home.widgets.forEach(w=>w.on=true);
    S.settings.home.boards=[{id:'month'},normBoard({id:'custom',custom:true,name:'采购看板',type:'expense',cats:['food'],members:[S.members[1]],projects:['项目A'],min:10,max:25,note:'采购'})];
    resetTxnOrder();tab('home');
   });
   const home=async()=>p.evaluate(()=>{closeSheet();S.curBook='b1';invalidateCache();tab('home');});
   const ids=async expected=>assert.deepEqual(sorted(await p.evaluate(()=>L.ids)),sorted(expected));
   const card=title=>p.locator('#view .card').filter({has:p.locator('.card-hd>b').getByText(title,{exact:true})});
   await p.evaluate(()=>{L.q='旧条件';L.cat='pet';L.F.min=9999;L.scope='allBooks';});
   await p.locator(name==='mobile'?'.home-hd .big':'.metric-exp').click();await ids(['e1','e2','e3','e4','unknown']);
   assert.equal(await p.evaluate(()=>L.q),'');assert.equal(await p.evaluate(()=>L.scope),'current');
   await home();await p.locator(name==='mobile'?'.hd-sub span:first-child':'.metric-inc').click();await ids(['income']);
   await home();await p.locator(name==='mobile'?'.hd-sub span:last-child':'.metric-balance').click();await ids(['e1','e2','e3','e4','income','transfer','unknown']);
   if(name==='mobile'){await home();await p.locator('.home-hd .ring').click();await ids(['e1','e2','e3','e4','unknown']);}
   await home();await p.locator('.prow').first().locator('.pv .inc').click();await ids(['income']);
   await home();await p.locator('.prow').nth(1).locator('.pv .exp').click();await ids(['e1']);
   assert.equal(await p.evaluate(()=>L.F.note),'采购');assert.equal(await p.evaluate(()=>L.F.max),25);
   await home();await p.locator('.prow').nth(1).locator('.pv .inc').click();await ids([]);
   await p.evaluate(()=>{L.type='all';render();});await ids(['e1']);
   await home();await card('预算进度').locator('.rank').click();await ids(['e1','e2']);
   await home();await card('预算进度').locator('.rank-t').first().click();await ids(['e1','e2','e3','e4','unknown']);
   await home();await card('本月支出排行').locator('.rank').filter({hasText:'餐饮'}).click();await ids(['e1','e2']);
   await home();await card('本月支出排行').locator('.rank').filter({hasText:'未分类'}).click();await ids(['unknown']);
   await home();await card('本月成员支出').locator('.rank').filter({hasText:`甲'"成员`}).click();await ids(['e1','e2']);
   await home();await card('近 7 日支出').locator('rect[role=button]').last().click();await ids(['e1','e3','e4','unknown']);
   await home();await card('近 7 日支出').locator('.card-hd').click();await ids(['e1','e2','e3','e4','unknown']);
   await home();await card('资产概览').locator('.sum3>div').nth(0).click();
   await ids(['e1','e2','e3','e4','income','previous','other','transfer','old','unknown']);
   assert.equal(await p.evaluate(()=>L.scope),'allBooks');assert.match(await p.locator('.ledger-context').last().innerText(),/初始余额/);
   await home();await card('资产概览').locator('.sum3>div').nth(1).click();await ids(['e1','e3','income','transfer','unknown']);
   await home();await card('资产概览').locator('.sum3>div').nth(2).click();await ids(['e2','e4','previous','other','transfer','old']);
   if(name==='desktop'){await home();await p.locator('.metric-assets').click();assert.equal(await p.evaluate(()=>L.scope),'allBooks');}
   await p.evaluate(()=>{CT='expense';go('cats');});await p.locator('.cg-i[data-id=food]').click();
   await p.getByText('餐饮 · 流水详情',{exact:false}).waitFor();assert.match(await p.locator('.cat-ledger-total').innerText(),/共 5 笔.*222.00/);
   await p.locator('#catLedger .btn').click();await ids(['e1','e2','previous','other','old']);
   await p.evaluate(()=>go('cats'));await p.locator('.cg-sub [data-v=rice]').click();
   assert.match(await p.locator('.cat-ledger-total').innerText(),/共 4 笔.*220.00/);
   await p.locator('#catLedger .btn').click();await ids(['e1','e2','previous','other']);
   await p.evaluate(()=>manageTags('project'));await p.locator('#sheet .opt').filter({hasText:'项目A'}).getByText('查看流水',{exact:true}).click();await ids(['e1','e2','other']);
   await p.evaluate(()=>manageTags('merchant'));await p.locator('#sheet .opt').filter({hasText:'店铺甲'}).getByText('查看流水',{exact:true}).click();await ids(['e1','e2','other']);
   await p.evaluate(()=>manageMembers());await p.locator('#sheet .opt').filter({hasText:`甲'"成员`}).getByText('查看流水',{exact:true}).click();await ids(['e1','e2','other']);
   await p.evaluate(()=>{go('books');editBook('b2');});await p.getByText('切换并查看流水',{exact:true}).click();await ids(['other']);
   assert.equal(await p.evaluate(()=>S.curBook),'b2');
   await home();await card('资产概览').locator('.acc').filter({hasText:'现金总账户'}).click();
   assert.deepEqual(sorted(await p.evaluate(()=>AV.tx.map(t=>t.id))),sorted(['e1','e2','e3','income','previous','other','transfer','old','unknown']));
   const out=path.join(__dirname,'../build/screenshots');fs.mkdirSync(out,{recursive:true});
   await p.evaluate(()=>{CT='expense';go('cats');});await p.locator('.cg-i[data-id=food]').click();
   await p.screenshot({path:path.join(out,`category-ledger-${name}.png`)});
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
   await p.close();console.log('PASS:',name,'all home summary links, date/custom filters, zero/custom type, category parent/child, book scope, asset account signs and member/project/merchant details');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
