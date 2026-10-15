/* 账单截图解析规则（与 ocr/bill_parser.py 保持一致，本机识别时使用）
 * 输入：OCR 文字行 [{text, score, box:[x1,y1,x2,y2]}]、图片宽高
 * 输出：{platform:{key,name,scores}, orders:[...], incomplete:[...], summary}
 */
(function (root) {
  const PLATFORMS = {
    chaohe: ['超盒算', {'超盒算':20}],
    pdd: ['拼多多', {
      '拼多多': 6, '再次拼单': 5, '拼单': 3, '待分享': 4, '拼过': 3, '百亿补贴': 2, '钱款去向': 3,
      '先用后付': 2, '多多': 1, '免运费': 1, '砍价': 2, '打包中': 2,
    }],
    taobao: ['淘宝', {
      '淘宝': 6, '天猫': 4, '淘金币': 4, '88VIP': 3, '旺旺': 3, '确认收货': 2, '延长收货': 3,
      '再买一单': 1, '卖了换钱': 4, '闲鱼': 2, '猫超': 2, '淘宝特价': 3, '支付宝': 2, '搜索订单': 1,
    }],
    douyin: ['抖音', {
      '抖音': 6, '抖音商城': 4, '抖音月付': 4, '抖音支付': 4, '抖店': 3, '再来一单': 2, '精选联盟': 3,
      '交易完成': 4, '待收货/使用': 5, '待支付': 3, '商品名/订单号/快递单号': 5, '直播': 2,
      '商品好不好': 3, '去评价': 1, '包裹': 1, '小时达': 2,
    }],
    jd: ['京东', {
      '京东': 6, '京东自营': 3, '京豆': 4, 'PLUS': 2, '应付总额': 2, '再次购买': 2, '京东物流': 3,
      '京东快递': 3, '京喜': 3, '白条': 3, '评价晒单': 2, '自营': 1, 'JD': 2,
    }],
  };
  const STATUS_RULES = [
    ['refund', ['退款成功', '退款完成', '已退款', '退款已到账', '退货退款成功', '已全额退款']],
    ['refund_pending', ['退款中', '退款处理中', '退款待处理', '退货中']],
    ['closed', ['交易关闭', '已取消', '订单已取消', '待付款', '未付款', '已关闭']],
    ['paid', ['交易成功', '交易完成', '订单完成', '已完成', '已签收', '已使用', '待使用', '待收货', '待发货', '已发货', '待评价', '拼单成功',
      '待取货', '待分享', '打包中', '运输中', '派送中', '买家已付款', '卖家已发货']],
  ];
  const STATUS_EXACT = { '完成': 'paid', '成功': 'paid' };
  const SIGNED_PENDING_RE = /^已签收[，,、·\s]*待确认收货$/;
  const PIN_RE = /拼过\s*\d+\s*次/;
  const TAB_WORDS = new Set(['全部', '待付款', '待支付', '待分享', '打包中', '待收货', '待收货/使用', '待使用', '评价', '待发货',
    '待取货', '待评价', '退款/售后', '售后', '已完成']);
  const SHOP_PREFIXES = ['淘宝', '天猫', 'JD', '京东 '];
  const STATUS_PRIORITY = ['refund', 'refund_pending', 'paid', 'closed'];
  const BUTTON_WORDS = ['更多', '申请退款', '追加评价', '再次拼单', '删除订单', '售后详情', '钱款去向', '发票详情',
    '查看物流', '确认收货', '延长收货', '再买一单', '卖了换钱', '再次购买', '评价晒单', '申请售后',
    '联系卖家', '加入购物车', '顶部', '拼过', '好评', '仅剩'];
  const PAY_KEYS = ['实付款', '实付', '应付总额', '需付款', '合计', '付款金额', '总价'];
  const KIND = { paid: 'expense', refund: 'refund', refund_pending: 'refund_pending', closed: 'skip' };

  const NUM_RE = /(\d+(?:\.\d{1,2})?)/;
  const MONEY_RE = /[¥￥]\s*(\d+(?:\.\d{1,2})?)/;
  const MONEY_FULL = /^[¥￥]\s*(\d+(?:\.\d{1,2})?)$/;
  const PRICE_FULL = /^[¥￥]?(\d+(?:\.\d{1,2})?)$/;
  const QTY_RE = /^[×xX*]\s*(\d{1,3})$/;
  const DT_RE = /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

  const yc = l => (l.box[1] + l.box[3]) / 2;
  const hh = l => Math.max(1, l.box[3] - l.box[1]);
  const nos = s => s.replace(/ /g, '');
  const clen = s => [...s].length;
  const count = (s, k) => s.split(k).length - 1;
  const isAscii = s => /^[\x00-\x7f]*$/.test(s);
  const hasPay = t => PAY_KEYS.some(k => t.includes(k));
  const isButton = t => BUTTON_WORDS.some(w => t.includes(w));
  const byY = (a, b) => yc(a) - yc(b);
  const r2 = n => Math.round(n * 100) / 100;

  function detectPlatform(lines) {
    const text = lines.map(l => l.text).join(''), up = text.toUpperCase();
    const scores = {};
    let best = null;
    for (const [key, [, kws]] of Object.entries(PLATFORMS)) {
      let s = 0;
      for (const [kw, w] of Object.entries(kws)) {
        const n = isAscii(kw) ? count(up, kw.toUpperCase()) : count(text, kw);
        s += w * Math.min(n, 3);
      }
      scores[key] = s;
    }
    if (PIN_RE.test(text)) scores.pdd += 4;
    for (const k of Object.keys(scores)) if (best === null || scores[k] > scores[best]) best = k;
    if (scores[best] < 3) return { key: 'unknown', name: '未知', scores };
    return { key: best, name: PLATFORMS[best][0], scores };
  }

  function classifyStatus(text) {
    const t = text.trim();
    if(SIGNED_PENDING_RE.test(t))return ['paid',t];
    for (const [kind, words] of STATUS_RULES) for (const w of words) if (t.includes(w)) return [kind, w];
    if (STATUS_EXACT[t]) return [STATUS_EXACT[t], t];
    const m = t.match(PIN_RE);
    if (m) return ['paid', m[0]];
    return [null, null];
  }

  const sameRow = (a, b) => Math.abs(yc(a) - yc(b)) < Math.max(hh(a), hh(b)) * 0.7;
  const TAB_SORTED = [...TAB_WORDS].sort((a, b) => b.length - a.length);
  // 检测框可能把相邻的「全部」「待付款」合成一行，所以按词切分来数
  function tabCount(text) {
    const t = [...text.replace(/[\s,，、.。>|]/g, '')];
    let n = 0, i = 0, miss = 0;
    while (i < t.length) {
      const rest = t.slice(i).join('');
      const w = TAB_SORTED.find(w => rest.startsWith(w));
      if (w) { n++; i += [...w].length; } else { miss++; i++; }
    }
    return miss <= 1 ? n : 0;
  }
  const isTabRow = (line, lines) => lines.filter(l => sameRow(l, line)).reduce((a, l) => a + tabCount(l.text), 0) >= 3;
  // 状态词和后面的金额被合成一行，如「退款成功 退款金额¥11.80」
  function statusWithAmount(text) {
    const t = text.trim();
    for (const [, words] of STATUS_RULES) for (const w of words) {
      if (t.startsWith(w)) { const rest = t.slice(w.length); return MONEY_RE.test(rest) || rest.includes('金额'); }
    }
    return false;
  }

  function findAmount(card, width = 0) {
    for (const l of card) {
      const t = nos(l.text);
      const key = PAY_KEYS.find(k => t.includes(k));
      if (!key) continue;
      const tail = t.slice(t.indexOf(key) + key.length);
      const m = tail.match(MONEY_RE) || tail.match(NUM_RE);
      if (m) return [parseFloat(m[1]), key, 'high'];
      const right = card.filter(r => r !== l && sameRow(r, l) && r.box[0] >= l.box[0]).sort((a, b) => a.box[0] - b.box[0]);
      for (const r of right) {
        const rt = nos(r.text), mm = rt.match(MONEY_RE) || rt.match(NUM_RE);
        if (mm) return [parseFloat(mm[1]), key, 'high'];
      }
    }
    const monies = [];
    for (const l of card) { const m = nos(l.text).match(MONEY_RE); if (m) monies.push([parseFloat(m[1]), l]); }
    if (width) {
      const right = monies.filter(x => x[1].box[0] > width * 0.7);
      if (right.length) return [right[0][0], '商品价', 'medium'];
    }
    if (monies.length) return [monies[monies.length - 1][0], '¥', 'low'];
    return [null, null, null];
  }

  const yRange = card => [Math.trunc(Math.min(...card.map(l => l.box[1]))), Math.trunc(Math.max(...card.map(l => l.box[3])))];
  const SERVICE_RE = /无理由|价保|退货宝|退货运费|运费险|公益捐赠|发货清单|申请开票|正品保障|超值换购/;
  function goodsDetails(card, width) {
    const rows=[...card].sort(byY),pays=rows.filter(l=>hasPay(nos(l.text))).map(yc),bottom=pays.length?Math.min(...pays):Infinity;
    const body=rows.filter(l=>yc(l)<bottom),anchors=[];
    for(const line of body) {
      const text=line.text.trim();let price=text.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)\s*$/);
      if(!price&&line.box[0]>=width*.7)price=text.match(/^(\d+(?:\.\d{1,2})?)$/);
      if(!price||line.box[2]<width*.8)continue;
      let title=text.slice(0,price.index).trim(),titleLine=line;
      if(!title) {
        const candidates=body.filter(l=>l.box[0]>=width*.26&&l.box[0]<width*.72&&Math.abs(yc(l)-yc(line))<=Math.max(hh(l),hh(line))*1.2
          &&clen(l.text.trim())>=2&&!isButton(l.text)&&!SERVICE_RE.test(l.text)&&!MONEY_RE.test(l.text)&&!QTY_RE.test(l.text.trim()));
        if(!candidates.length)continue;
        titleLine=candidates.sort((a,b)=>Math.abs(yc(a)-yc(line))-Math.abs(yc(b)-yc(line)))[0];title=titleLine.text.trim();
      }
      if(titleLine.box[0]<width*.26||isButton(title)||SERVICE_RE.test(title))continue;
      if(anchors.length&&Math.abs(yc(titleLine)-anchors[anchors.length-1].y)<hh(titleLine)*.7)continue;
      anchors.push({y:yc(titleLine),line:titleLine,title,price:parseFloat(price[1])});
    }
    return anchors.map((a,i)=>{
      const end=anchors[i+1]?.y??bottom,within=body.filter(l=>yc(l)>a.y+hh(a.line)*.5&&yc(l)<end-hh(a.line)*.5);
      const q=within.filter(l=>l.box[0]>=width*.7).map(l=>nos(l.text).match(QTY_RE)).find(Boolean),specs=[];
      for(const l of within){const text=l.text.trim();if(Math.abs(l.box[0]-a.line.box[0])>width*.06||isButton(text)||SERVICE_RE.test(text)||MONEY_RE.test(text)||QTY_RE.test(nos(text))||DT_RE.test(text)||classifyStatus(text)[0])continue;if(text&&!specs.includes(text))specs.push(text);}
      return {title:a.title,spec:specs.join('；'),qty:q?parseInt(q[1],10):null,list_price:a.price};
    });
  }

  function parseCard(card, group, width) {
    const anchor = group[0];
    const found = group.map(a => classifyStatus(a.text)).filter(f => f[0]);
    const statusKind = found.length ? found.map(f => f[0]).sort((a, b) => STATUS_PRIORITY.indexOf(a) - STATUS_PRIORITY.indexOf(b))[0] : null;
    const statusText = [...new Set(found.map(f => f[1]))].join('·') || anchor.text;
    let [amount, amountKey, conf] = findAmount(card, width);

    const header = card.filter(l => sameRow(l, anchor) && l !== anchor && l.box[2] <= anchor.box[0] + 5);
    let shop = '';
    if (header.length) {
      shop = header.reduce((a, b) => (clen(b.text) > clen(a.text) ? b : a)).text;
      shop = shop.replace(/[>〉›）\s]+$/, '').trim();
      for (const p of SHOP_PREFIXES) {
        if (shop.startsWith(p) && clen(shop) > clen(p) + 1) { shop = shop.slice(p.length).trim(); break; }
      }
    }

    const body = card.filter(l => yc(l) > anchor.box[3] && !header.includes(l));
    const titleLines = [];
    for (const l of [...body].sort(byY)) {
      const t = l.text.trim();
      if (l.box[0] < width * 0.2) continue;
      if (clen(t) < 6 || isButton(t) || MONEY_RE.test(t) || hasPay(t)) continue;
      if (!titleLines.length) titleLines.push(l);
      else if (Math.abs(l.box[0] - titleLines[0].box[0]) < width * 0.04 && yc(l) - yc(titleLines[titleLines.length - 1]) < hh(l) * 2.2) {
        titleLines.push(l);
        if (titleLines.length >= 2) break;
      } else break;
    }
    const items=goodsDetails(body,width);
    const title = items.length ? items.map(it=>it.title).join(' / ') : titleLines.map(l => l.text.trim()).join('');

    let listPrice = null, qty = null;
    for (const l of body) {
      const t = nos(l.text);
      if (listPrice === null && !hasPay(t)) {
        let m = t.match(MONEY_FULL);
        if (!m && l.box[0] > width * 0.7) m = t.match(PRICE_FULL);
        if (m) listPrice = parseFloat(m[1]);
      }
      const mq = t.match(QTY_RE);
      if (mq && qty === null) qty = parseInt(mq[1], 10);
    }

    let when = null;
    for (const l of card) {
      const m = l.text.match(DT_RE);
      if (m) {
        const p2 = v => String(parseInt(v, 10)).padStart(2, '0');
        when = `${m[1]}-${p2(m[2])}-${p2(m[3])}` + (m[4] ? ` ${p2(m[4])}:${m[5]}` : '');
        break;
      }
    }
    if (amount === null) conf = 'none';
    return {
      kind: KIND[statusKind] || 'unknown', status: statusText, shop, title, items, amount,
      amount_from: amountKey, list_price: listPrice, qty, time: when, confidence: conf, y_range: yRange(card),
    };
  }

  function parseChaoheCard(card, record, width) {
    const prices=card.filter(l=>l.box[0]>width*.7).map(l=>nos(l.text).match(MONEY_FULL)).filter(Boolean);
    const qty=card.map(l=>l.text.match(/共\s*(\d{1,3})\s*件/)).find(Boolean);
    return {...record,shop:'超盒算',title:'',items:[],list_price:null,qty:qty?parseInt(qty[1],10):null,
      amount:prices.length===1?parseFloat(prices[0][1]):null,amount_from:prices.length===1?'订单总额':null,
      confidence:prices.length===1?(qty&&record.time?'high':'low'):'none'};
  }

  function splitByPayLines(lines, width) {
    const pays = lines.filter(l => hasPay(nos(l.text))).sort(byY);
    const orders = [];
    let prevBottom = -1;
    for (const p of pays) {
      const card = lines.filter(l => prevBottom < yc(l) && yc(l) <= p.box[3] + hh(p));
      prevBottom = p.box[3] + hh(p);
      const [amount, key, conf] = findAmount(card);
      if (amount === null) continue;
      let statusKind = null, statusText = '';
      for (const l of card) { const [k, w] = classifyStatus(l.text); if (k) { statusKind = k; statusText = w; } }
      const texts = card.filter(l => l.box[0] >= width * 0.2 && clen(l.text.trim()) >= 6 && !isButton(l.text)
        && !MONEY_RE.test(l.text) && !hasPay(l.text)).sort(byY);
      orders.push({
        kind: KIND[statusKind] || 'unknown', status: statusText || '未识别状态', shop: '',
        title: texts.length ? texts[0].text.trim() : '', items:goodsDetails(card,width), amount, amount_from: key, list_price: null, qty: null, time: null,
        confidence: statusKind ? conf : 'low', y_range: yRange(card), complete: true,
      });
    }
    return orders;
  }

  /* 检测框有时把右侧的状态词和左边的文字合成一行，如「不支持7天无理由公益捐赠0.02元 退款成功」，
     状态词就当不了订单锚点。行尾是状态词、且按字宽估算它落在屏幕右侧 40% 时，把它拆成单独一行。 */
  const STATUS_WORDS = STATUS_RULES.flatMap(([, ws]) => ws).sort((a, b) => b.length - a.length);
  const cw = ch => (/[\x00-\x7f]/.test(ch) ? 0.55 : 1);
  function splitMergedStatus(lines, width) {
    const out = [];
    for (const l of lines) {
      const t = l.text.trim(), w = STATUS_WORDS.find(w => t.endsWith(w));
      const pre = w ? t.slice(0, t.length - w.length).trimEnd() : '';
      if (w && clen(pre) >= 2) {
        const total = [...t].reduce((a, c) => a + cw(c), 0), sw = [...w].reduce((a, c) => a + cw(c), 0);
        const bw = l.box[2] - l.box[0], sx = l.box[2] - bw * sw / total;
        if (sx >= width * 0.6) {
          out.push({ ...l, text: pre, box: [l.box[0], l.box[1], Math.max(l.box[0] + 1, sx - 4), l.box[3]] });
          out.push({ ...l, text: w, box: [sx, l.box[1], l.box[2], l.box[3]] });
          continue;
        }
      }
      out.push(l);
    }
    return out;
  }

  function parseBill(lines, width, height) {
    lines = splitMergedStatus(lines.filter(l => l.text.trim()), width);
    const platform = detectPlatform(lines);
    const anchors = lines.filter(l => classifyStatus(l.text)[0] && l.box[0] >= width * 0.45
      && (clen(l.text.trim()) <= 8 || SIGNED_PENDING_RE.test(l.text.trim()) || statusWithAmount(l.text)) && !isTabRow(l, lines)).sort(byY);

    const payYs = lines.filter(l => hasPay(nos(l.text))).map(yc);
    const groups = [];
    for (const a of anchors) {
      const last = groups[groups.length - 1];
      const newShop=lines.some(l=>l!==a&&l.box[0]<width*.45&&l.box[2]<=a.box[0]+5&&sameRow(l,a)
        &&!classifyStatus(l.text)[0]&&!isButton(l.text)&&!MONEY_RE.test(l.text)&&/[>〉›]$|店$|鞋业$|鞋柜$/.test(l.text.trim()));
      if (last && payYs.length && !newShop && !payYs.some(y => yc(last[0]) < y && y < yc(a))) last.push(a);
      else groups.push([a]);
    }

    let orders = groups.map((g, i) => {
      const a = g[0], nxt = groups[i + 1] ? groups[i + 1][0] : null;
      const top = a.box[1] - hh(a) * 0.5, bottom = nxt ? nxt.box[1] - hh(nxt) * 0.5 : height + 1;
      const card = lines.filter(l => top <= yc(l) && yc(l) < bottom);
      let rec = parseCard(card, g, width);
      if(platform.key==='chaohe')rec=parseChaoheCard(card,rec,width);
      if (platform.key!=='chaohe' && payYs.length && !PAY_KEYS.includes(rec.amount_from)) { rec.amount = null; rec.confidence = 'none'; }
      rec.complete = rec.amount !== null;
      return rec;
    });
    if (platform.key!=='chaohe' && !orders.some(o => o.complete)) orders = splitByPayLines(lines, width);

    const usable = orders.filter(o => o.complete);
    return {
      platform, orders: usable, incomplete: orders.filter(o => !o.complete),
      summary: {
        expense: r2(usable.filter(o => o.kind === 'expense').reduce((s, o) => s + o.amount, 0)),
        refund: r2(usable.filter(o => o.kind === 'refund').reduce((s, o) => s + o.amount, 0)),
        count: usable.length,
      },
    };
  }

  root.parseBill = parseBill;
})(window);
