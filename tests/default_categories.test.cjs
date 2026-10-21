const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const expected=require('./fixtures/default-categories.json'),OcrCategory=require('../web/js/lib/ocr_category.js');
function runtime(){
 const c=vm.createContext({window:{},console,performance,setTimeout,clearTimeout,Pages:{},After:{}});
 for(const f of ['util','defaults','store','query','import/bill','pages/accounts'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/js',f+'.js'),'utf8'),c,{filename:f});
 const run=s=>vm.runInContext(s,c);run('S=initData(false)');return {run,json:s=>JSON.parse(JSON.stringify(run(s)))};
}
test('new defaults exactly match the provided hierarchy with icons and editable icon choices',()=>{
 const {json,run}=runtime();const cats=json('S.categories');
 for(const type of ['expense','income']){
  assert.deepEqual(cats[type].filter(c=>!c.pid).map(c=>c.name),Object.keys(expected[type]));
  for(const parent of cats[type].filter(c=>!c.pid))assert.deepEqual(cats[type].filter(c=>c.pid===parent.id).map(c=>c.name),expected[type][parent.name]);
  assert.equal(new Set(cats[type].filter(c=>!c.pid).map(c=>c.icon)).size,Object.keys(expected[type]).length);
  for(const c of cats[type]){assert.match(c.icon,/\p{Extended_Pictographic}/u);assert(run('EMOJIS').includes(c.icon));if(c.pid)assert.equal(c.color,cats[type].find(p=>p.id===c.pid).color);}
 }
 assert.equal(cats.expense.filter(c=>c.pid).length,65);assert.equal(cats.income.filter(c=>c.pid).length,30);
 assert.equal(new Set(cats.expense.concat(cats.income).map(c=>c.id)).size,113);
});
test('sample data works with renamed defaults and old categories survive migration',()=>{
 const {run,json}=runtime();run('S=initData(true)');
 assert(run('S.txns.length>0'));
 assert(run("S.txns.every(t=>t.type==='transfer'||S.categories[t.type].some(c=>c.id===t.catId))"));
 const old=json("({...initData(false),v:2,categories:{expense:[{id:'old',name:'自定义餐费',icon:'🍜',color:'#123456',pid:''}],income:[]}})");
 const migrated=run('migrate('+JSON.stringify(old)+')');assert.deepEqual(JSON.parse(JSON.stringify(migrated.categories)),old.categories);
 run("S={...initData(false),v:1,categories:{expense:[{id:'oldFood',name:'餐饮',icon:'🍚',color:'#aaa'}],income:[]}};S=migrate(S)");
 assert.equal(run('S.v'),2);assert.deepEqual(json("S.categories.expense.filter(c=>c.pid).map(c=>c.name)"),['早餐','午餐','晚餐','外卖','夜宵']);
});
test('OCR and bill categories map to the new exact leaf names',()=>{
 const {run,json}=runtime(),s=json('S'),ctx=OcrCategory.context(s);
 const cases={'海天生抽':'买菜／食材','洗衣液':'清洁／日用品','苹果水果':'买菜／食材','薯片':'零食／饮料','短袖':'服装鞋帽','手提包':'箱包／配饰','面霜':'美妆护肤','布洛芬':'药品','教科书':'书籍／课程','充电器':'数码产品','洗衣机':'家具／家电','哑铃':'健身／运动'};
 for(const [title,name]of Object.entries(cases)){const r=OcrCategory.suggest({title},ctx);assert.equal(s.categories.expense.find(c=>c.id===r.catId)?.name,name,title);}
 for(const [party,type,name] of [['水果店','expense','买菜／食材'],['药店','expense','药品'],['酒店','expense','酒店／住宿'],['银行手续费','expense','银行／支付手续费'],['贷款利息','expense','贷款利息'],['工资发放','income','工资'],['理财收益','income','理财收益']]){
  assert.equal(run(`catById(billGuessCat({party:${JSON.stringify(party)},type:'${type}',goods:'',cls:''})).name`),name,party);
 }
 assert.equal(run("catById(flowCategory('expense',false,'loan')).name"),'贷款利息');
 assert.equal(run("catById(flowCategory('expense',false,'fee')).name"),'投资交易手续费');
 assert.equal(run("catById(flowCategory('income')).name"),'理财收益');
});
