const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../web/js/lib/ocr_category.js');
function state(){return {curBook:'a',settings:{},categories:{expense:[{id:'food',name:'食材'},{id:'daily',name:'日用'},{id:'clean',name:'日用品',pid:'daily'},{id:'paper',name:'纸品',pid:'daily'},{id:'custom',name:'家庭采购'}]},txns:[]};}
const item=(...names)=>({title:names.join(' '),goods:names.map(title=>({title})),note:'不改变备注'});
const predict=(s,...names)=>C.suggest(item(...names),C.context(s));
test('keywords only choose existing categories, prefer specific category and preserve input',()=>{
 const s=state(),it=item('海天生抽','金龙鱼食用油'),before=JSON.stringify(it);
 assert.equal(C.suggest(it,C.context(s)).catId,'food');assert.equal(JSON.stringify(it),before);
 assert.equal(predict(s,'洗衣液').catId,'clean');assert.equal(predict(s,'抽纸').catId,'paper');
 s.categories.expense=s.categories.expense.filter(c=>c.id!=='paper');assert.equal(predict(s,'抽纸').catId,'clean');
 assert.equal(predict(s,'旗舰店优惠套餐').catId,'');assert.equal(predict(s,'充电器').catId,'');
});
test('cross-category orders and unresolved goods fall back; no arbitrary split',()=>{
 const s=state();assert.equal(predict(s,'生抽','洗衣液').catId,'');assert.equal(predict(s,'生抽','神秘套餐').catId,'');
 assert.equal(predict(s,'生抽洗衣液组合装').catId,'');
});
test('manual memory overrides history and keywords, persists, is scoped and pruned',()=>{
 let s=state();C.remember(s,item('海天生抽'),'custom');s=JSON.parse(JSON.stringify(s));
 s.txns=[{bookId:'a',type:'expense',amount:10,catId:'food',note:'海天生抽'}];
 assert.equal(predict(s,'海天生抽').catId,'custom');
 s.curBook='b';assert.equal(predict(s,'海天生抽').catId,'food');s.curBook='a';
 s.categories.expense=s.categories.expense.filter(c=>c.id!=='custom');assert.equal(predict(s,'海天生抽').catId,'food');
 for(let i=0;i<250;i++)C.remember(s,item('商品'+i),'food');assert.equal(s.settings.ocrCategoryMemory.length,200);
});
test('multi-item correction is order-specific and does not train each unrelated product',()=>{
 const s=state();C.remember(s,item('生抽','洗衣液'),'custom');
 assert.equal(predict(s,'洗衣液','生抽').catId,'custom');assert.equal(predict(s,'洗衣液').catId,'clean');
});
test('history respects book, valid expense categories and conflicts',()=>{
 const s=state();s.txns=[{bookId:'a',type:'expense',amount:5,catId:'custom',note:'海天生抽'}];
 assert.equal(predict(s,'海天生抽').catId,'custom');
 s.txns.push({...s.txns[0],catId:'food'});assert.equal(predict(s,'海天生抽').catId,'');
 s.txns=[{...s.txns[0],bookId:'b'}];assert.equal(predict(s,'海天生抽').catId,'food');
 s.txns=[{...s.txns[0],bookId:'a',type:'income'}];assert.equal(predict(s,'海天生抽').catId,'food');
 s.txns=[{...s.txns[0],type:'expense',catId:'deleted'}];assert.equal(predict(s,'海天生抽').catId,'food');
});
test('OCR notes match product names without prices and do not attribute mixed-order history to one product',()=>{
 const s=state();s.txns=[{bookId:'a',type:'expense',amount:5,catId:'custom',note:'商店\n1. 海天生抽 ×1（页面标价 ¥11.50）\n规格：500ml\n订单实付：¥5.00'}];
 assert.equal(predict(s,'海天生抽').catId,'custom');
 s.txns[0].note='商店\n1. 海天生抽\n2. 洗衣液\n订单实付：¥5.00';
 assert.equal(predict(s,'海天生抽').catId,'food');
});
test('near-identical history matches but unrelated branded goods do not',()=>{
 const s=state();s.txns=[{bookId:'a',type:'expense',amount:5,catId:'custom',note:'海天金标生抽酱油家庭装500ml'}];
 assert.equal(predict(s,'海天金标生抽酱油家庭装550ml').catId,'custom');
 assert.notEqual(predict(s,'海天旗舰店洗衣液').catId,'custom');
});
test('duplicate category names do not silently pick the first category',()=>{
 const s=state();s.categories.expense.push({id:'food2',name:'食材'});assert.equal(predict(s,'生抽').catId,'');
});
