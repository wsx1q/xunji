const lines=[];
const add=(text,x,y,w=180)=>lines.push({text,score:.99,box:[x,y,x+w,y+35]});
add('京东',20,20);add('全部',20,90);add('待付款',280,90);add('待收货',560,90);
for(const [i,shop,status,amount,title] of [
 [0,'日用自营旗舰店','完成',47.65,'家用日常商品组合一份'],
 [1,'话费充值','充值成功',5,'移动手机话费充值10元24小时'],
 [2,'厨房自营旗舰店','完成',6.9,'厨房清洁用品商品组合'],
 [3,'话费充值','充值失败',10,'手机话费充值20元'],
]){
 const y=220+i*450;add(shop,30,y,400);add(status,880,y,160);
 add(title,280,y+85,590);add('¥'+amount.toFixed(2),920,y+110,130);
 add('×1',1000,y+170,50);add('删除订单',500,y+340,160);add('再次购买',830,y+340,210);
}
module.exports={width:1080,height:2070,lines};
