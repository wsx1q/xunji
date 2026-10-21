const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const variants=[];if(process.env.XUNJI_TEST_URL)variants.push(['desktop',process.env.XUNJI_TEST_URL,1280,1000]);if(process.env.XUNJI_MOBILE_TEST_URL)variants.push(['mobile',process.env.XUNJI_MOBILE_TEST_URL,390,844]);assert(variants.length);
  for(const [name,url,width,height]of variants){
   const p=await browser.newPage({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>typeof S!=='undefined'&&S);
   if(name==='desktop')assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
   await p.evaluate(()=>{S=initData(false);S.books.push({id:'other',name:'另一账本',icon:'📒'});S.txns=Array.from({length:700},(_,i)=>({id:'t'+i,time:Date.now()-i*1000,bookId:i%2?'other':S.curBook,type:'expense',amount:12.34,catId:S.categories.expense[0].id,accountId:S.accounts[0].id,note:i<600?'  欠款待还\n另有欠款  ':'无须修改',member:'本人',merchant:'欠款',project:'保持项目',src:'test:'+i}));resetTxnOrder();openSearch();});
   const original=await p.evaluate(()=>JSON.stringify(S.txns));
   await p.locator('.note-replace-entry').click();await p.locator('#nrFind').fill('欠款');await p.locator('#nrReplacement').fill('待付款');await p.getByRole('button',{name:'预览替换',exact:true}).click();
   assert.match(await p.locator('#nrPreview').innerText(),/匹配 600 笔，共 1200 处/);assert.equal(await p.locator('.note-replace-example').count(),10);assert.equal(await p.evaluate(()=>JSON.stringify(S.txns)),original);
   const out=path.join(__dirname,'../build/screenshots');fs.mkdirSync(out,{recursive:true});await p.waitForTimeout(250);await p.screenshot({path:path.join(out,`note-replace-${name}.png`)});
   await p.getByRole('button',{name:'替换 600 笔备注',exact:true}).click();assert.equal(await p.evaluate(()=>S.txns.filter(t=>(t.note||'').includes('待付款')).length),600);
   const changed=await p.evaluate(()=>JSON.stringify(S.txns));assert.deepEqual(JSON.parse(changed).map((t,i)=>({...t,note:JSON.parse(original)[i].note})),JSON.parse(original));
   await p.getByRole('button',{name:'撤销修改',exact:true}).click();assert.equal(await p.evaluate(()=>JSON.stringify(S.txns)),original);
   await p.evaluate(()=>{L.q='欠款';L.type='all';L.kind='all';render();});
   await p.locator('.note-replace-entry').click();await p.locator('#nrReplacement').fill('待付款');await p.getByRole('button',{name:'当前搜索／筛选结果',exact:true}).click();await p.getByRole('button',{name:'预览替换',exact:true}).click();assert.match(await p.locator('#nrPreview').innerText(),/匹配 300 笔/);
   await p.evaluate(()=>save());await p.getByRole('button',{name:'替换 300 笔备注',exact:true}).click();assert.equal(await p.evaluate(()=>JSON.stringify(S.txns)),original);assert.equal(await p.locator('#nrPreview button').count(),0);
   await p.getByRole('button',{name:'预览替换',exact:true}).click();await p.getByRole('button',{name:'替换 300 笔备注',exact:true}).click();await p.getByRole('button',{name:'好的',exact:true}).click();await p.evaluate(()=>saveNow());await p.reload();await p.waitForFunction(()=>typeof S!=='undefined'&&S&&S.txns.length===700);
   assert.equal(await p.evaluate(()=>S.txns.filter(t=>t.note.includes('待付款')).length),300);assert.equal(await p.evaluate(()=>S.txns.filter(t=>t.bookId==='other'&&t.note.includes('欠款')).length),300);
   await p.evaluate(()=>{openSearch();SEL=new Set([S.txns.find(t=>t.note.includes('欠款')).id]);bulkSheet();});await p.locator('#sheet .opt').filter({hasText:'替换备注关键词'}).click();await p.locator('#nrFind').fill('欠款');await p.locator('#nrReplacement').fill('');await p.getByRole('button',{name:'预览替换',exact:true}).click();await p.getByRole('button',{name:'替换 1 笔备注',exact:true}).click();assert.equal(await p.evaluate(()=>S.txns.filter(t=>t.note==='  待还\n另有  ').length),1);
   assert.deepEqual(errors,[]);await p.close();console.log('PASS:',name,'all-book/results/selected note replacement, exact preservation, preview, stale guard, undo and persistence');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
