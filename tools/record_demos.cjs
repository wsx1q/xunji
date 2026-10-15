// Record the real desktop UI with synthetic orders; never use a personal ledger.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),out=path.join(root,'desktop/build/demo-frames');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const source=await browser.newPage({viewport:{width:900,height:1600}});
  const card=(i)=>`<section><header>超盒算 <span>交易完成</span></header><div class="goods">${['新鲜蔬菜组合','早餐牛奶组合','厨房调味组合'][i%3]}<strong>¥${['18.80','39.90','25.60'][i%3]}</strong></div><p>共${i%3+1}件</p><footer>下单时间: 2026-10-${String(1+i).padStart(2,'0')} 12:30</footer><aside>删除订单　　　　再来一单</aside></section>`;
  await source.setContent(`<html lang="zh"><style>body{margin:0;background:#f4f5f7;font:30px 'Microsoft YaHei';color:#222}h1{font-size:36px;text-align:center;background:white;margin:0;padding:30px}nav{padding:30px;display:flex;justify-content:space-between}section{background:white;margin:20px;padding:32px;border-radius:18px;height:320px}header{color:#168da1;font-weight:bold}header span{float:right;color:#333;font-size:26px;font-weight:normal}.goods{padding-top:65px;font-size:29px}strong{float:right;font-size:34px}p{text-align:right;color:#888;margin:12px 0}footer{color:#666;font-size:24px}aside{text-align:right;color:#a12c50;font-size:25px;margin-top:26px}</style><h1>订单列表 · 演示数据</h1><nav>全部 <span>待付款</span><span>待发货</span><span>待取货</span></nav>${Array.from({length:12},(_,i)=>card(i)).join('')}</html>`);
  const sample=path.join(root,'desktop/tests/samples/ocr-demo.png');
  await source.screenshot({path:sample,fullPage:true});await source.close();
  const p=await browser.newPage({viewport:{width:1280,height:850}});
  await p.goto(process.env.XUNJI_TEST_URL||'http://127.0.0.1:11649/');
  await p.waitForFunction(()=>typeof S!=='undefined'&&S);
  assert.match(await p.evaluate(()=>dbInfo().path),/ui-test/);
  await p.evaluate(()=>{S=initData(false);resetTxnOrder();desktopImports();});
  const manifests={};let mode,seq;
  async function start(name){mode=name;seq=0;manifests[name]=[];fs.mkdirSync(path.join(out,name),{recursive:true});}
  async function snap(text,duration=900){
   await p.evaluate(text=>{let el=document.getElementById('demo-caption');if(!el){el=document.createElement('div');el.id='demo-caption';el.style='position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;background:#253449ed;color:white;padding:12px 22px;border-radius:10px;font:15px Microsoft YaHei;box-shadow:0 3px 16px #0002;pointer-events:none';document.body.append(el);}el.textContent=text;},text);
   const name=`${String(seq++).padStart(3,'0')}.png`;await p.screenshot({path:path.join(out,mode,name)});manifests[mode].push({name,duration});
  }
  await start('ocr-import');await snap('将订单截图拖入「识别与导入」',1400);
  const bytes=fs.readFileSync(sample).toString('base64');
  await p.locator('[data-desktop-drop]').evaluate((el,bytes)=>{
   const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'演示订单.png',{type:'image/png'}));
   el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
  },bytes);
  for(let i=0;i<75;i++){
   await snap('本机离线识别 · 查看实际分段进度',150);
   if(await p.evaluate(()=>OC&&!OC.busy&&OC.imgs>0))break;
  }
  await p.waitForFunction(()=>OC&&!OC.busy&&OC.imgs===1,null,{timeout:90000});
  assert.equal(await p.evaluate(()=>OC.items.length),12);
  await p.evaluate(()=>document.querySelector('.oc-it')?.scrollIntoView({block:'center'}));
  await snap('识别结果保留金额、下单时间和件数，确认后再导入',2000);
  await p.locator('.oc-bar button').click();await snap('导入前确认账户、笔数和总金额',1600);
  await p.locator('#sheet .btn').filter({hasText:/^导入$/}).click();
  await p.locator('.desk-nav [data-page=list]').click();await snap('订单已成为账本中的支出记录',2000);

  await start('ocr-background');await p.evaluate(()=>{OC=null;desktopImports();});
  await snap('识别长截图时，可以继续操作其他页面',1300);
  await p.locator('[data-desktop-drop]').evaluate((el,bytes)=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'后台演示.png',{type:'image/png'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));},bytes);
  await p.waitForFunction(()=>OC?.busy,null,{timeout:15000});
  await p.locator('.desk-nav [data-page=home]').click();
  for(let i=0;i<65;i++){await snap('切换到总览后，右下角显示后台任务进度',150);if(await p.evaluate(()=>!OC.busy))break;}
  await p.waitForFunction(()=>!OC.busy,null,{timeout:90000});await snap('后台识别完成，结果不会因切换页面丢失',1600);
  await p.locator('#deskOcrDismiss').click();await snap('「稍后查看」收起提示，左侧仍保留结果入口',1600);
  await p.locator('#deskOcrResume').click();await snap('点击左侧入口，返回原来的识别结果',1800);

  await start('ocr-compare');
  await p.evaluate(()=>document.querySelector('.oc-compare-link')?.scrollIntoView({block:'center'}));
  await snap('发现可能已记过的订单，点击「对比」核对',1600);
  await p.locator('.oc-compare-link').first().click();
  await snap('本次识别与已有账目并排展示，差异字段标色',2200);
  await p.locator('#sheet .sh-bd').evaluate(el=>el.scrollTop=el.scrollHeight);
  await snap('核对金额、日期、账户、分类和完整备注',1800);
  await p.getByText('本条不导入',{exact:true}).click();await snap('选择不导入，已有账目保持原样',1500);
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifests));
  console.log('Recorded real OCR flows using synthetic demo orders');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
