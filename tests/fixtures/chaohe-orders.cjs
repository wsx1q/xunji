const lines=[];
const add=(text,x,y,w=130)=>lines.push({text,score:.99,box:[x,y,x+w,y+30]});
add('订单列表',400,20);add('全部',80,140);add('待付款',300,140);add('待发货',550,140);add('待取货',800,140);
for(const [i,amount,qty,date] of [[0,'30.80',2,'2026-10-12 12:32'],[1,'14.90',1,'2026-10-06 12:24'],[2,'37.70',3,'2026-10-05 12:38'],[3,null,null,null]]){
 const y=250+i*500;add('超盒算 NB',60,y);add('交易完成',820,y);
 if(amount){add('¥'+amount,840,y+130);add('共'+qty+'件',860,y+185);add('下单时间:'+date,60,y+300,450);add('删除订单',540,y+400);add('再来一单',810,y+400);}
}
module.exports={width:1080,height:1830,lines};
