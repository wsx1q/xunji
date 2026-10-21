const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const header=['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号'];
function csv(status='已退款(¥1856.53)',id='wx-test-order',amount='3000.00',cls='商户消费'){
 const rows=Array.isArray(status)?status:[[status,id,amount,cls]];
 return new TextEncoder().encode('微信支付账单\n'+header.join(',')+'\n'+rows.map(([s,i,a,c='商户消费'])=>['2026-02-04 09:50:49',c,'测试医院','住院预交','支出',a,'零钱通',s,i].map(x=>'"'+x.replaceAll('"','""')+'"').join(',')).join('\n'));
}
function runtime(){
 const c=vm.createContext({console,performance,TextDecoder,TextEncoder,Uint8Array,DataView,setTimeout,clearTimeout,Pages:{},After:{}});c.window=c;
 for(const f of ['util','defaults','store','query','lib/bill_file','import/bill'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/js',f+'.js'),'utf8'),c,{filename:f});
 const run=s=>vm.runInContext(s,c);run("S=initData(false);stack=[{name:'bill'}];render=()=>{};toast=m=>lastToast=m;save=()=>invalidateCache();askConfirm=(m,f)=>{confirmText=m;confirmAction=f};");
 return {c,run,json:s=>JSON.parse(JSON.stringify(run(s))),load:async buf=>{c.buf=buf;await run("billLoad('微信账单.csv',buf)");run("BI.acc['wechat|零钱通']=S.accounts[0].id");},commit:()=>run('billImport();confirmAction()')};
}
test('WeChat partial refund parses original amount and refund including currency/spacing/commas',async()=>{
 const {c}=runtime();
 for(const status of ['已退款(¥1856.53)','已退款（￥1856.53）','已退款 ( ¥1,856.53 )']){
  const {rows}=await c.parseBillFile('微信账单.csv',csv(status));assert.equal(rows.length,1);assert.equal(rows[0].amount,3000);assert.equal(rows[0].refund,1856.53);assert.equal(rows[0].skip,'');
 }
 const {rows}=await c.parseBillFile('微信账单.csv',csv('已退款(¥3000.00)'));assert.equal(rows[0].skip,'已全额退款');
});
test('fresh import produces one net expense and repeated import cannot be forced into a duplicate',async()=>{
 const r=runtime();await r.load(csv());assert.equal(r.run('BI.items[0].amount'),1143.47);r.commit();
 assert.equal(r.run('S.txns.length'),1);assert.equal(r.run('S.txns[0].amount'),1143.47);
 r.run('BI=null');await r.load(csv());assert.equal(r.run('BI.items[0].skip'),'已导入过');r.run('billToggle(0)');assert(!r.run('BI.items[0].sel'));assert.equal(r.run('S.txns.length'),1);
});
test('paid/refunded snapshots across files and rows consolidate by order id in either order',async()=>{
 for(const reversed of [false,true]){
  const r=runtime(),paid=csv('支付成功'),refunded=csv();
  await r.load(reversed?refunded:paid);await r.load(reversed?paid:refunded);
  assert.equal(r.run('BI.items.length'),1);assert.equal(r.run('BI.items[0].amount'),1143.47);r.commit();assert.equal(r.run('S.txns.length'),1);
  const q=runtime();await q.load(csv(reversed?[['已退款(¥1856.53)','same','3000'],['支付成功','same','3000']]:[['支付成功','same','3000'],['已退款(¥1856.53)','same','3000']]));
  assert.equal(q.run('BI.items.length'),1);assert.equal(q.run('BI.items[0].amount'),1143.47);
 }
});
test('refund reimport updates original expense in place, retains user fields and persists through compact codec',async()=>{
 const r=runtime();await r.load(csv('支付成功'));r.commit();
 r.run("S.txns[0]={...S.txns[0],note:'自定义备注',member:'家人',project:'医疗',merchant:'医院'};cachedBefore=fullJson();before=S.txns[0];BI=null");const original=r.json('S.txns[0]');
 await r.load(csv());assert.equal(r.run('BI.items[0].updateId'),original.id);r.commit();
 assert.equal(r.run('S.txns.length'),1);assert.equal(r.run('S.txns[0].amount'),1143.47);assert(r.run('before!==S.txns[0]'));
 for(const key of ['id','time','accountId','catId','note','member','project','merchant'])assert.equal(r.json('S.txns[0]')[key],original[key]);
 assert.equal(r.run('decodeDb(JSON.parse(fullJson())).txns[0].amount'),1143.47);
 r.run('BI=null');await r.load(csv('已退款(¥2000.00)'));r.commit();assert.equal(r.run('S.txns[0].amount'),1000);
 r.run('BI=null');await r.load(csv());assert.equal(r.run('BI.items[0].skip'),'已导入过');assert.equal(r.run('S.txns[0].amount'),1000);
});
test('legacy imported original updates; manually adjusted originals and ambiguous duplicate ids are preserved',async()=>{
 for(const kind of ['legacy','manual','ambiguous']){
  const r=runtime();await r.load(csv('支付成功'));r.commit();r.run('delete S.txns[0].billAmount;delete S.txns[0].billRefund;BI=null');
  if(kind==='manual')r.run('S.txns[0].amount=2500');
  if(kind==='ambiguous')r.run("S.txns.push({...S.txns[0],id:'duplicate'})");
  await r.load(csv());if(kind==='legacy'){assert(r.run('!!BI.items[0].updateId'));r.commit();assert.equal(r.run('S.txns[0].amount'),1143.47);}
  else {assert.equal(r.run('BI.items[0].skip'),'已导入过');assert(!r.run('BI.items[0].sel'));}
 }
});
test('confirmation revalidates source ids and ledger changes; manual original without source is flagged',async()=>{
 const r=runtime();await r.load(csv('支付成功'));r.run('billImport();firstConfirm=confirmAction;firstConfirm();firstConfirm()');assert.equal(r.run('S.txns.length'),1);
 r.run('BI=null');await r.load(csv());r.run('billImport();S.txns[0]={...S.txns[0],amount:2999};confirmAction()');assert.equal(r.run('S.txns[0].amount'),2999);
 const q=runtime();await q.load(csv('支付成功'));q.commit();q.run('delete S.txns[0].src;BI=null');await q.load(csv());assert(q.run('BI.items[0].dup'));assert(!q.run('BI.items[0].sel'));
});

test('full refund of an imported order updates its original expense to zero; a fresh full refund stays excluded',async()=>{
 const r=runtime();await r.load(csv('支付成功'));r.commit();r.run('BI=null');await r.load(csv('已全额退款'));assert.equal(r.run('BI.items[0].amount'),0);assert(r.run('!!BI.items[0].updateId'));r.commit();assert.equal(r.run('S.txns.length'),1);assert.equal(r.run('S.txns[0].amount'),0);
 const q=runtime();await q.load(csv('已全额退款'));assert.equal(q.run('BI.items[0].skip'),'已全额退款');assert(!q.run('BI.items[0].sel'));
});
