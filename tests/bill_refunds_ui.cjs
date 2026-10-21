const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
function xlsx(status){
 const data=[['微信支付账单'],['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号'],['2026-02-04 09:50:49','商户消费','测试医院','住院预交','支出','3000.00','零钱通',status,'wx-refund-test']];
 const xml=Buffer.from('<worksheet><sheetData>'+data.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>'<c r="'+String.fromCharCode(65+j)+(i+1)+'" t="inlineStr"><is><t>'+v+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>');
 const name=Buffer.from('xl/worksheets/sheet1.xml');let crc=0xffffffff;
 for(const b of xml){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(xml.length,18);local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(xml.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+xml.length,16);
 return Buffer.concat([local,name,xml,central,name,end]);
}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const variants=[];if(process.env.XUNJI_TEST_URL)variants.push(['desktop',process.env.XUNJI_TEST_URL,1280,1000]);if(process.env.XUNJI_MOBILE_TEST_URL)variants.push(['mobile',process.env.XUNJI_MOBILE_TEST_URL,390,844]);assert(variants.length);
  for(const [name,url,width,height]of variants){
   const p=await browser.newPage({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile'}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>typeof S!=='undefined'&&S);
   if(name==='desktop')assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
   await p.evaluate(()=>{S=initData(false);resetTxnOrder();BI=null;openBill();});
   const load=async status=>{await p.locator('#billFile').setInputFiles({name:'微信账单.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:xlsx(status)});await p.waitForFunction(()=>BI&&!BI.busy&&BI.items.length);};
   const commit=async()=>{await p.locator('.oc-bar button').click();await p.locator('#sheet button').getByText('导入',{exact:true}).click();};
   await load('支付成功');await p.evaluate(()=>{BI.acc['wechat|零钱通']=S.accounts[0].id;render();});await commit();assert.equal(await p.evaluate(()=>S.txns.length),1);
   const originalId=await p.evaluate(()=>S.txns[0].id);await p.evaluate(()=>{S.txns[0]={...S.txns[0],note:'保留原备注'};save();saveNow();BI=null;openBill();});
   await load('已退款(¥1856.53)');assert.equal(await p.evaluate(()=>BI.items[0].amount),1143.47);assert.match(await p.locator('.oc-it').innerText(),/更新原支出 3,000.00 → 1,143.47/);
   await p.locator('.oc-it .oc-m').click();assert.match(await p.locator('#sheet .sh-bd').innerText(),/保留原流水/);const out=path.join(__dirname,'../build/screenshots');fs.mkdirSync(out,{recursive:true});await p.waitForTimeout(250);await p.screenshot({path:path.join(out,`bill-refund-update-${name}.png`)});await p.locator('#sheet button').click();await commit();
   assert.equal(await p.evaluate(()=>S.txns.length),1);assert.equal(await p.evaluate(()=>S.txns[0].id),originalId);assert.equal(await p.evaluate(()=>S.txns[0].amount),1143.47);assert.equal(await p.evaluate(()=>S.txns[0].note),'保留原备注');
   await p.evaluate(()=>saveNow());await p.reload();await p.waitForFunction(()=>typeof S!=='undefined'&&S&&S.txns.length===1);assert.equal(await p.evaluate(()=>S.txns[0].amount),1143.47);
   await p.evaluate(()=>{BI=null;openBill();});await load('已退款(¥1856.53)');assert.equal(await p.evaluate(()=>BI.items[0].skip),'已导入过');assert.equal(await p.evaluate(()=>BI.items.filter(billSel).length),0);assert.deepEqual(errors,[]);await p.close();console.log('PASS:',name,'xlsx refund updates one original expense, preserves metadata, survives reload and excludes repeat import');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
