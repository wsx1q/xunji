const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const context=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(path.join(root,'web/js/lib/bill_parser.js'),'utf8'),context);
const fixture=require('./fixtures/ocr-orders.cjs');
const chaohe=require('./fixtures/chaohe-orders.cjs');

test('Chaohe image-only order cards retain totals, dates, quantity and incomplete warning',()=>{
 const parse=f=>JSON.parse(JSON.stringify(context.window.parseBill(f.lines,f.width,f.height)));
 const parsed=parse(chaohe);
 assert.equal(parsed.platform.name,'超盒算');assert.equal(parsed.platform.key,'chaohe');
 assert.deepEqual(parsed.orders.map(o=>o.amount),[30.8,14.9,37.7]);
 assert.deepEqual(parsed.orders.map(o=>o.qty),[2,1,3]);
 assert.deepEqual(parsed.orders.map(o=>o.time),['2026-10-12 12:32','2026-10-06 12:24','2026-10-05 12:38']);
 assert.equal(parsed.summary.expense,83.4);assert.equal(parsed.incomplete.length,1);
 assert(parsed.orders.every(o=>o.shop==='超盒算'&&o.title===''&&o.items.length===0&&o.list_price===null&&o.amount_from==='订单总额'));
 const bottom={...chaohe,lines:chaohe.lines.filter(l=>l.box[1]>=1750)};
 assert.equal(parse(bottom).orders.length,0);assert.equal(parse(bottom).incomplete.length,1);
 const unpaid={...chaohe,lines:chaohe.lines.map(l=>l.text==='交易完成'?{...l,text:'待付款'}:l)};
 assert.equal(parse(unpaid).summary.expense,0);assert(parse(unpaid).orders.every(o=>o.kind==='skip'));
 const pickup={...chaohe,lines:chaohe.lines.map(l=>l.text==='交易完成'?{...l,text:'待取货'}:l)};
 assert.equal(parse(pickup).summary.expense,83.4);
});
test('combined discounted orders use paid totals, retain all goods, and remain distinct',()=>{
 const parsed=JSON.parse(JSON.stringify(context.window.parseBill(fixture.lines,fixture.width,fixture.height)));
 assert.equal(parsed.orders.length,2);assert.equal(parsed.incomplete.length,1);
 for(const order of parsed.orders){assert.equal(order.amount,3.2);assert.equal(order.items.length,2);assert.deepEqual(order.items.map(x=>x.qty),[1,1]);assert.deepEqual(order.items.map(x=>x.list_price),[11.5,5.8]);assert.match(order.title,/海天.*金龙鱼/);}
 assert.equal(parsed.summary.expense,6.4);
 assert.equal(parsed.incomplete[0].amount,null,'Cut off footer must not use a product price');
});
test('Python and JS parsers agree on combined orders and public OCR fixtures',()=>{
 const fixtures=[fixture,chaohe,...JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/parser-cases.json'),'utf8')).map(({lines,width,height})=>({lines,width,height}))];
 const python=process.env.XUNJI_PYTHON||path.join(root,'desktop/.venv/Scripts/python.exe');
 const script="import sys,json; sys.path.insert(0,'desktop'); from bill_parser import parse_bill; print(json.dumps([parse_bill(d['lines'],d['width'],d['height']) for d in json.load(sys.stdin)]))";
 const wanted=JSON.parse(execFileSync(python,['-X','utf8','-c',script],{cwd:root,input:JSON.stringify(fixtures),encoding:'utf8'}));
 const got=JSON.parse(JSON.stringify(fixtures.map(f=>context.window.parseBill(f.lines,f.width,f.height))));
 assert.deepEqual(got,wanted);
});
