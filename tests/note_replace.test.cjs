const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function runtime(){const c=vm.createContext({console,performance});for(const f of ['util','merge'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/js',f+'.js'),'utf8'),c);return c;}
test('note replacement treats keywords and replacements literally and preserves whitespace and other fields',()=>{
 const c=runtime(),a={id:'a',note:'  欠款\n欠款待还  ',amount:3000,merchant:'欠款',src:'wx:1'},b={id:'b',note:'正常记录'},before=JSON.stringify([a,b]);
 const p=c.noteReplacePlan([a,b],'欠款','待付款');assert.equal(p.changes.size,1);assert.equal(p.occurrences,2);assert.equal(p.changes.get('a').note,'  待付款\n待付款待还  ');assert.equal(JSON.stringify([a,b]),before);
 assert.equal(c.noteReplacePlan([{id:'x',note:'[a].* + [a].*'}],'[a].*','$&').changes.get('x').note,'$& + $&');
 assert.equal(c.noteReplacePlan([{id:'x',note:'abc ABC'}],'ABC','').changes.get('x').note,'abc ');
 assert.equal(c.noteReplacePlan([a,b],'','待付款').changes.size,0);assert.equal(c.noteReplacePlan([a,b],'欠款','欠款').changes.size,0);
});
test('scopes restrict replacement and excessive length is reported without truncation',()=>{
 const c=runtime(),tx=[{id:'a',note:'欠款'},{id:'b',note:'欠款'},{id:'c'}];
 assert.equal(c.noteReplacePlan(tx,'欠款','待付款',new Set(['b'])).changes.size,1);assert.equal(c.noteReplacePlan(tx,'欠款','待付款',new Set()).changes.size,0);
 const p=c.noteReplacePlan([{id:'a',note:'x'.repeat(4000)}],'x','xx');assert.equal(p.tooLong,1);assert.equal(p.changes.get('a').note.length,8000);
});
test('all matching records in 200k are included independently of visible page size',()=>{
 const c=runtime(),tx=Array.from({length:200000},(_,i)=>({id:String(i),note:i%10?'普通备注':'欠款 欠款'}));
 const p=c.noteReplacePlan(tx,'欠款','待付款');assert.equal(p.changes.size,20000);assert.equal(p.occurrences,40000);assert.equal(p.changes.get('199990').note,'待付款 待付款');
});
