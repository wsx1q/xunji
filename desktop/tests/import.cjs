const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(process.env.XUNJI_TEST_URL);
    await page.waitForFunction(()=>typeof S!=='undefined'&&S);
    assert.match(await page.evaluate(()=>dbInfo().path),/ui-test/);
    await page.evaluate(()=>{S=initData(false);resetTxnOrder();tab('home');});
    await page.locator('.desk-nav [data-page=imports]').click();
    assert.equal(await page.locator('#sheet.on').count(),0,'Import entry is a full page');
    assert.equal(await page.locator('.desk-import-formats article').count(),4);
    for(const width of [1024,1440]) {
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const box=await page.locator('[data-desktop-drop]').boundingBox();assert(box.y+box.height<900);
    }
    await page.screenshot({path:path.join(__dirname,'../build/screenshots/imports.png')});
    async function drop(files) {
      await page.evaluate(files=>{
        const dt=new DataTransfer();
        files.forEach(f=>dt.items.add(new File([new Uint8Array(f.bytes||[])],f.name,{type:f.type||''})));
        const zone=document.querySelector('[data-desktop-drop]')||document.querySelector('#view');
        const over=new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true});zone.dispatchEvent(over);
        if(!over.defaultPrevented)throw Error('Dragover must allow a file drop');
        zone.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
      },files);
    }
    await drop([{name:'bad.exe'}]);
    await page.locator('[role=alert]').filter({hasText:'不支持此文件类型'}).waitFor();
    await drop([{name:'image.png'},{name:'bill.csv'}]);
    await page.locator('[role=alert]').filter({hasText:'不同类型'}).waitFor();
    assert.equal(await page.evaluate(()=>S.txns.length),0);
    await drop([{name:'a.json'},{name:'b.db'}]);
    await page.locator('[role=alert]').filter({hasText:'只能处理一份'}).waitFor();

    const csv=id=>Buffer.from('支付宝交易记录\n交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号\n2026-10-15 12:00:00,餐饮,餐厅,午餐,支出,12.5,余额,交易成功,'+id+'\n');
    await drop([{name:'one.csv',bytes:[...csv('one')]},{name:'two.csv',bytes:[...csv('two')]}]);
    await page.waitForFunction(()=>BI&&!BI.busy&&!desktopImport.busy&&BI.files.length===2);
    assert.equal(await page.evaluate(()=>BI.items.length),2);
    assert.equal(await page.locator('.oc-pick').count(),0,'Bill page promotes dropping');
    assert.equal(await page.locator('.desk-nav [data-page=imports].active').count(),1);
    assert.equal(await page.evaluate(()=>S.txns.length),0,'Preview does not commit');

    await page.evaluate(()=>desktopImports());
    const backup=await page.evaluate(()=>fullJson());
    await drop([{name:'backup.json',bytes:[...Buffer.from(backup)]}]);
    await page.locator('#sheet.on').waitFor();
    assert.match(await page.locator('#sheet').innerText(),/覆盖当前所有数据/);
    assert.equal(await page.evaluate(()=>S.txns.length),0);
    await page.evaluate(()=>closeSheet());
    await page.evaluate(()=>{window._kbfReceived=null;kbfLoad=(name,buf)=>{window._kbfReceived=[name,[...buf]];};});
    await drop([{name:'test.kbf',bytes:[1,2,3]}]);
    await page.waitForFunction(()=>window._kbfReceived);
    assert.deepEqual(await page.evaluate(()=>window._kbfReceived),['test.kbf',[1,2,3]]);

    // Real file-drop event, file bytes, offline engine and order parser.
    const image=fs.readFileSync(path.join(__dirname,'samples/pdd_orders.jpg'));
    await drop([{name:'pdd.jpg',bytes:[...image]}]);
    await page.waitForFunction(()=>OC&&!OC.busy&&!desktopImport.busy&&OC.imgs===1,null,{timeout:90000});
    assert.equal(await page.evaluate(()=>OC.err),'');
    assert.deepEqual(await page.evaluate(()=>OC.items.map(x=>[x.kind,x.amount])),[['expense',.8],['refund',.8],['expense',35.89]]);
    assert.equal(await page.locator('.oc-pick').count(),0,'OCR page promotes dropping');
    assert.equal(await page.locator('[data-desktop-drop]').count(),1);
    assert.equal(await page.evaluate(()=>S.txns.length),0);
    assert.match(await page.evaluate(()=>OC.stats.at(-1).model),/v6 均衡/);
    assert.match(await page.locator('.card-hd').filter({hasText:'本机识别 ·'}).innerText(),/v6 均衡/);
    assert.equal(await page.locator('.desk-ocr-profiles button').count(),0,'Desktop has no legacy model selector');
    await page.locator('#ocrFile').setInputFiles(path.join(__dirname,'samples/pdd_orders.jpg'));
    await page.waitForFunction(()=>!OC.busy&&OC.imgs===2,null,{timeout:90000});
    assert.equal(await page.evaluate(()=>OC.items.length),3,'Repeating a screenshot retains one preview per order');
    assert.equal(await page.evaluate(()=>OC.err),'');
    await page.evaluate(()=>desktopImports());
    await page.locator('[data-desktop-drop] input').setInputFiles({name:'picked.csv',mimeType:'text/csv',buffer:csv('picked')});
    await page.waitForFunction(()=>BI.files.length===3&&!desktopImport.busy);
    assert.deepEqual(errors,[]);
    console.log('PASS: import workspace, desktop widths, drag/drop validation, batch bills, backup confirmation, KBF routing, real offline OCR and secondary file picker');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
