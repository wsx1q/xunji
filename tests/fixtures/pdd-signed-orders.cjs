// Synthetic card geometry: long signed status, refund, missing payment footer.
const lines=[];
const add=(text,x,y,w=200)=>lines.push({text,score:.99,box:[x,y,x+w,y+35]});
add('拼多多',20,10);add('全部',20,80);add('待付款',280,80);add('待收货',560,80);
for(const [i,status,amount] of [[0,'已签收，待确认收货',3.97],[1,'退款成功',38],[2,'已签收，待确认收货',26.34],[3,'待评价',null],[4,'退款成功',16.9]]){
 const y=200+i*450;
 add('演示商家'+i+'店 >',30,y,280);add(status,700,y,350);
 add('日常商品组合规格一份',280,y+60,550);add('¥49.90',940,y+70,110);add('×1',1000,y+130,50);
 if(amount!==null)add('实付: ¥'+amount.toFixed(2)+'(免运费)',700,y+240,350);
 else add('评价得0.3元微信打款',390,y+240,550);
 add('更多',280,y+330,100);add('售后详情',600,y+330,160);
}
module.exports={width:1080,height:2450,lines};
