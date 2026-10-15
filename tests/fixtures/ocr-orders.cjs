const line=(text,x,y,w=200)=>({text,score:1,box:[x,y,x+w,y+30]});
function card(y){return [line('天猫超市',30,y),line('交易成功',600,y,120),
 line('海天生抽500ml ¥11.50',230,y+70,490),line('500ml装',230,y+120),line('×1',685,y+120,35),
 line('金龙鱼原酿料酒1L',230,y+250,360),line('¥5.80',640,y+250,80),line('原酿料酒1L',230,y+300),line('×1',685,y+300,35),
 line('2025.01.16 实付款 ¥3.20',430,y+450,290)];}
module.exports={lines:[...card(40),...card(640),line('天猫超市',30,1240),line('交易成功',600,1240,120),line('洗衣液组合装 ¥5.99',230,1310,490)],width:747,height:1390};
