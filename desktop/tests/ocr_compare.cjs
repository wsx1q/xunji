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
   const note='商品明细\n<img src=x onerror="window.compareInjected=true">\n'+('完整商品名称与规格；'.repeat(60));
   const base={bookId:S.curBook,type:'expense',amount:35.89,catId:OC.catId,accountId:OC.accountId,
    time:Date.now()-86400000,note,member:'本人',merchant:'拼多多',project:'',toAccountId:''};
   insertTxn({...base,id:uid()});insertTxn({...base,id:uid(),time:base.time-86400000});
   insertTxn({...base,id:uid(),amount:99});
   OC.items=[{kind:'expense',note,amount:35.89,platform:'拼多多',ocrTime:Date.now(),sel:false,dup:true}];OC.imgs=1;
   window.existingBefore=JSON.stringify(S.txns);render();
  });
  await p.locator('.oc-compare-link').click();
  await p.getByText('与已有账目对比',{exact:true}).waitFor();
  assert.equal(await p.locator('#ocA').count(),0,'Comparison link must not also open the edit sheet');
  await p.getByText('匹配账目 1 / 2',{exact:true}).waitFor();
  assert.equal(await p.locator('.oc-compare tbody tr').count(),8);
  assert.equal(await p.locator('.oc-compare tbody tr').last().locator('td').first().textContent(),await p.evaluate(()=>OC.items[0].note));
  assert.equal(await p.locator('.oc-compare img').count(),0,'Notes render as escaped text');
  assert(await p.locator('.oc-compare tr.different').count()>0);
  await p.getByText('下一笔',{exact:true}).click();await p.getByText('匹配账目 2 / 2',{exact:true}).waitFor();
  assert(await p.getByText('下一笔',{exact:true}).isDisabled());
  await p.getByText('仍选中待导入',{exact:true}).click();
  assert.equal(await p.evaluate(()=>OC.items[0].sel),true);
  assert.equal(await p.evaluate(()=>JSON.stringify(S.txns)===existingBefore),true);
  await p.locator('.oc-compare-link').click();await p.getByText('本条不导入',{exact:true}).click();
  assert.equal(await p.evaluate(()=>OC.items[0].sel),false);
  assert.equal(await p.evaluate(()=>JSON.stringify(S.txns)===existingBefore),true);
  // Stale duplicate warnings safely disappear if the existing entries changed.
  await p.evaluate(()=>{S.txns.forEach(t=>t.note='已修改');ocrCompare(0);});
  assert.equal(await p.evaluate(()=>OC.items[0].dup),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: duplicate comparison, all candidate navigation, full escaped notes, differences, selection decisions and existing data preservation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
