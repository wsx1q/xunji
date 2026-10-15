/* Local, bounded category suggestions. No network, model, or persistent history index. */
(function(root) {
  'use strict';
  const rules = [
    ['生抽|老抽|酱油|蚝油|料酒|食用油|花生油|菜籽油|大米|面粉|鸡蛋|猪肉|牛肉|鸡肉|调味', ['调味品','粮油','食材','买菜','餐饮']],
    ['洗衣液|洗衣粉|洗洁精|清洁剂|垃圾袋|保鲜袋|保鲜膜|拖把', ['清洁用品','家清','日用品','日用']],
    ['抽纸|卷纸|卫生纸|纸巾|厨房纸', ['纸品','日用品','日用']],
    ['洗发水|洗发露|沐浴露|牙膏|牙刷|护发素|洗手液', ['洗护','日用品','日用']],
    ['饼干|薯片|巧克力|糖果|坚果|辣条|蛋糕|零食', ['零食']],
    ['咖啡豆|挂耳咖啡|速溶咖啡', ['咖啡','零食']],
    ['苹果鲜果|苹果水果|香蕉|橙子|橘子|草莓|葡萄|猕猴桃|榴莲|芒果|蓝莓', ['水果']],
    ['白菜|西兰花|菠菜|生菜|土豆|番茄|黄瓜|蔬菜', ['蔬菜','买菜','食材']],
    ['短袖|衬衫|羽绒服|卫衣|连衣裙|内裤|袜子|牛仔裤|外套|睡衣', ['衣服','服装','服饰']],
    ['运动鞋|皮鞋|凉鞋|拖鞋|背包|手提包', ['鞋包','服饰']],
    ['面霜|精华液|防晒霜|口红|粉底|洗面奶|面膜', ['护肤','化妆品','美容']],
    ['布洛芬|感冒药|创可贴|碘伏|药片|胶囊', ['药品','医疗']],
    ['教科书|练习册|绘本|小说|词典|图书', ['书籍','图书','教育']],
    ['猫粮|狗粮|猫砂|宠物', ['宠物用品','宠物']],
    ['充电器|充电线|数据线|耳机|键盘|鼠标|移动硬盘|内存条|手机壳', ['数码配件','数码']],
    ['电饭煲|电磁炉|洗衣机|冰箱|空调|吸尘器', ['家电']],
    ['瑜伽垫|哑铃|羽毛球拍|网球拍|健身', ['运动','健身']],
  ].map(([words,cats])=>({test:new RegExp(words),cats}));
  const norm = value => String(value||'').normalize('NFKC').toLowerCase()
    .replace(/（页面标价[^）]*）|\(页面标价[^)]*\)/g,'').replace(/[×x]\s*\d+\s*$/g,'')
    .replace(/[^\p{L}\p{N}]/gu,'').slice(0,160);
  const titles = item => (item.goods?.length ? item.goods.map(g=>g.title) : [item.title])
    .map(norm).filter(Boolean).slice(0,20);
  const key = names => [...names].sort().join('|');
  function noteTitles(note) {
    const lines=String(note||'').split('\n');
    const numbered=lines.filter(s=>/^\d+\.\s/.test(s));
    if(numbered.length)return numbered.map(s=>norm(s.replace(/^\d+\.\s*/,'')));
    if(lines.some(s=>s.startsWith('订单实付：')))return lines.slice(1).filter(s=>!s.startsWith('订单实付：')&&!s.startsWith('规格：')).map(norm).filter(Boolean);
    return [norm(note)].filter(Boolean);
  }
  function context(state) {
    const categories=state.categories.expense,valid=new Set(categories.map(c=>c.id));
    const history=new Map();let count=0;
    // Transactions are already kept newest first. Bound both scanning and stored rows.
    for(let i=0;i<Math.min(state.txns.length,10000)&&count<1000;i++) {
      const t=state.txns[i];
      if(t.bookId!==state.curBook||t.type!=='expense'||t.amount<=0||!valid.has(t.catId))continue;
      const names=noteTitles(t.note),k=key(names);if(!k)continue;
      count++;
      if(!history.has(k))history.set(k,new Set());
      history.get(k).add(t.catId);
    }
    const memories=(Array.isArray(state.settings.ocrCategoryMemory)?state.settings.ocrCategoryMemory:[])
      .filter(m=>m.bookId===state.curBook&&valid.has(m.catId)&&typeof m.key==='string').slice(-200);
    return {categories,valid,history,memories};
  }
  function similarity(a,b) {
    if(a.length<6||b.length<6)return 0;
    const grams=s=>new Set(Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2)));
    const x=grams(a),y=grams(b);let overlap=0;for(const g of x)if(y.has(g))overlap++;
    return 2*overlap/(x.size+y.size);
  }
  function lookup(k,ctx) {
    const learned=ctx.memories.findLast(m=>m.key===k);
    if(learned)return {catId:learned.catId,reason:'沿用手动分类'};
    const exact=ctx.history.get(k);
    if(exact)return exact.size===1?{catId:[...exact][0],reason:'参考历史记录'}:{catId:'',reason:'历史分类不一致，请核对'};
    // Near matches require both a high overlap and no competing category nearby.
    if(!k.includes('|')) {
      let best=0;const hits=[];
      for(const [name,ids] of ctx.history) {
        if(name.includes('|'))continue;
        const score=similarity(k,name);if(score>=.84){best=Math.max(best,score);hits.push({score,ids});}
      }
      const ids=new Set(hits.filter(h=>h.score>=best-.04).flatMap(h=>[...h.ids]));
      if(ids.size===1)return {catId:[...ids][0],reason:'参考相似商品历史'};
      if(ids.size>1)return {catId:'',reason:'相似商品分类不一致，请核对'};
    }
    return null;
  }
  function keyword(name,ctx) {
    const ids=new Set();
    for(const rule of rules)if(rule.test.test(name)) {
      for(const alias of rule.cats) {
        const matches=ctx.categories.filter(c=>norm(c.name)===norm(alias));
        if(matches.length){matches.forEach(c=>ids.add(c.id));break;}
      }
    }
    return ids.size===1?{catId:[...ids][0],reason:'商品关键词推荐'}:
      {catId:'',reason:ids.size>1?'商品可能跨类别，请核对':'信息不足，使用默认分类，请核对'};
  }
  function suggest(item,ctx) {
    const names=titles(item);if(!names.length)return {catId:'',reason:'未识别商品名称，请核对'};
    const existing=lookup(key(names),ctx);if(existing)return existing;
    const results=names.map(n=>lookup(n,ctx)||keyword(n,ctx));
    const ids=new Set(results.map(r=>r.catId).filter(Boolean));
    if(names.length>1&&(ids.size!==1||results.some(r=>!r.catId)))return {catId:'',reason:'合单商品分类不确定或跨类别，请核对'};
    return results[0];
  }
  function remember(state,item,catId) {
    if(!state.categories.expense.some(c=>c.id===catId))return;
    const k=key(titles(item));if(!k)return;
    const memory=Array.isArray(state.settings.ocrCategoryMemory)?state.settings.ocrCategoryMemory:[];
    const valid=new Set(state.categories.expense.map(c=>c.id));
    state.settings.ocrCategoryMemory=memory.filter(m=>valid.has(m.catId)&&!(m.bookId===state.curBook&&m.key===k))
      .concat({bookId:state.curBook,key:k,catId}).slice(-200);
  }
  const api={context,suggest,remember};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.OcrCategory=api;
})(typeof window==='object'?window:globalThis);
