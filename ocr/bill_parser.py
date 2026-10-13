"""把 OCR 文字行（带坐标）解析成：平台 + 订单列表。

思路：
1. 平台：按各平台特有词加权打分（拼多多的「拼单/拼过N次」、淘宝的「天猫/淘金币」、京东的「京东自营/京豆」）。
2. 拆单：订单卡片的状态（交易成功 / 退款成功…）都在卡片标题行的右侧，用它们当锚点把整屏切成若干卡片。
3. 每张卡片里找「实付」后面的金额、标题行、店铺名、数量、时间。
"""
import re

PLATFORMS = {
    'pdd': ('拼多多', {
        '拼多多': 6, '再次拼单': 5, '拼单': 3, '待分享': 4, '拼过': 3, '百亿补贴': 2, '钱款去向': 3,
        '先用后付': 2, '多多': 1, '免运费': 1, '砍价': 2, '打包中': 2,
    }),
    'taobao': ('淘宝', {
        '淘宝': 6, '天猫': 4, '淘金币': 4, '88VIP': 3, '旺旺': 3, '确认收货': 2, '延长收货': 3,
        '再买一单': 1, '卖了换钱': 4, '闲鱼': 2, '猫超': 2, '淘宝特价': 3, '支付宝': 2, '搜索订单': 1,
    }),
    # 抖音的平台标志是图标，截图里往往没有「抖音」二字，主要靠页面用语区分
    'douyin': ('抖音', {
        '抖音': 6, '抖音商城': 4, '抖音月付': 4, '抖音支付': 4, '抖店': 3, '再来一单': 2, '精选联盟': 3,
        '交易完成': 4, '待收货/使用': 5, '待支付': 3, '商品名/订单号/快递单号': 5, '直播': 2,
        '商品好不好': 3, '去评价': 1, '包裹': 1, '小时达': 2,
    }),
    'jd': ('京东', {
        '京东': 6, '京东自营': 3, '京豆': 4, 'PLUS': 2, '应付总额': 2, '再次购买': 2, '京东物流': 3,
        '京东快递': 3, '京喜': 3, '白条': 3, '评价晒单': 2, '自营': 1, 'JD': 2,
    }),
}

# 顺序有讲究：先判退款，避免「退款完成」被当成「完成」
STATUS_RULES = [
    ('refund', ['退款成功', '退款完成', '已退款', '退款已到账', '退货退款成功', '已全额退款']),
    ('refund_pending', ['退款中', '退款处理中', '退款待处理', '退货中']),
    ('closed', ['交易关闭', '已取消', '订单已取消', '待付款', '未付款', '已关闭']),
    ('paid', ['交易成功', '交易完成', '订单完成', '已完成', '已签收', '已使用', '待使用', '待收货', '待发货', '已发货', '待评价', '拼单成功',
              '待分享', '打包中', '运输中', '派送中', '买家已付款', '卖家已发货']),
]
STATUS_EXACT = {'完成': 'paid', '成功': 'paid'}
PIN_RE = re.compile(r'拼过\s*\d+\s*次')

TAB_WORDS = {'全部', '待付款', '待支付', '待分享', '打包中', '待收货', '待收货/使用', '待使用', '评价', '待发货',
             '待评价', '退款/售后', '售后', '已完成'}
SHOP_PREFIXES = ('淘宝', '天猫', 'JD', '京东 ')
STATUS_PRIORITY = ['refund', 'refund_pending', 'paid', 'closed']
BUTTON_WORDS = ('更多', '申请退款', '追加评价', '再次拼单', '删除订单', '售后详情', '钱款去向', '发票详情',
                '查看物流', '确认收货', '延长收货', '再买一单', '卖了换钱', '再次购买', '评价晒单', '申请售后',
                '联系卖家', '加入购物车', '顶部', '拼过', '好评', '仅剩')
PAY_KEYS = ('实付款', '实付', '应付总额', '需付款', '合计', '付款金额', '总价')

NUM_RE = re.compile(r'(\d+(?:\.\d{1,2})?)')
MONEY_RE = re.compile(r'[¥￥]\s*(\d+(?:\.\d{1,2})?)')
QTY_RE = re.compile(r'^[×xX*]\s*(\d{1,3})$')
DT_RE = re.compile(r'(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?')


def _yc(l):
    return (l['box'][1] + l['box'][3]) / 2


def _h(l):
    return max(1, l['box'][3] - l['box'][1])


def detect_platform(lines):
    text = ''.join(l['text'] for l in lines)
    up = text.upper()
    scores = {}
    for key, (_, kws) in PLATFORMS.items():
        s = 0
        for kw, w in kws.items():
            n = up.count(kw.upper()) if kw.isascii() else text.count(kw)
            s += w * min(n, 3)
        scores[key] = s
    if PIN_RE.search(text):
        scores['pdd'] += 4
    best = max(scores, key=scores.get)
    if scores[best] < 3:
        return {'key': 'unknown', 'name': '未知', 'scores': scores}
    return {'key': best, 'name': PLATFORMS[best][0], 'scores': scores}


def classify_status(text):
    t = text.strip()
    for kind, words in STATUS_RULES:
        for w in words:
            if w in t:
                return kind, w
    if t in STATUS_EXACT:
        return STATUS_EXACT[t], t
    m = PIN_RE.search(t)
    if m:
        return 'paid', m.group(0)
    return None, None


def _same_row(a, b):
    return abs(_yc(a) - _yc(b)) < max(_h(a), _h(b)) * 0.7


TAB_SORTED = sorted(TAB_WORDS, key=len, reverse=True)
TAB_SEP_RE = re.compile(r'[\s,，、.。>|]')


def _tab_count(text):
    """一行里有几个标签页词。检测框可能把相邻的「全部」「待付款」合成一行，所以按词切分来数。"""
    t = TAB_SEP_RE.sub('', text)
    n = i = miss = 0
    while i < len(t):
        w = next((w for w in TAB_SORTED if t.startswith(w, i)), None)
        if w:
            n += 1
            i += len(w)
        else:
            miss += 1
            i += 1
    return n if miss <= 1 else 0


def _is_tab_row(line, lines):
    row = [l for l in lines if _same_row(l, line)]
    return sum(_tab_count(l['text']) for l in row) >= 3


def _status_with_amount(text):
    """状态词和后面的金额被合成一行，如「退款成功 退款金额¥11.80」。"""
    t = text.strip()
    for _, words in STATUS_RULES:
        for w in words:
            if t.startswith(w):
                rest = t[len(w):]
                return bool(MONEY_RE.search(rest) or '金额' in rest)
    return False


def _find_amount(card, width=0):
    for l in card:
        t = l['text'].replace(' ', '')
        key = next((k for k in PAY_KEYS if k in t), None)
        if not key:
            continue
        tail = t[t.index(key) + len(key):]
        m = MONEY_RE.search(tail) or NUM_RE.search(tail)
        if m:
            return float(m.group(1)), key, 'high'
        right = sorted((r for r in card if r is not l and _same_row(r, l) and r['box'][0] >= l['box'][0]),
                       key=lambda r: r['box'][0])
        for r in right:
            rt = r['text'].replace(' ', '')
            m = MONEY_RE.search(rt) or NUM_RE.search(rt)
            if m:
                return float(m.group(1)), key, 'high'
    monies = [(float(m.group(1)), l) for l in card for m in [MONEY_RE.search(l['text'].replace(' ', ''))] if m]
    if width:
        right = [x for x in monies if x[1]['box'][0] > width * 0.7]
        if right:
            return right[0][0], '商品价', 'medium'
    if monies:
        return monies[-1][0], '¥', 'low'
    return None, None, None


def _is_button(t):
    return any(w in t for w in BUTTON_WORDS)


def _parse_card(card, group, width):
    anchor = group[0]
    found = [classify_status(a['text']) for a in group]
    found = [f for f in found if f[0]]
    status_kind = min((f[0] for f in found), key=STATUS_PRIORITY.index) if found else None
    status_text = '·'.join(dict.fromkeys(f[1] for f in found)) or anchor['text']
    amount, amount_key, conf = _find_amount(card, width)

    header = [l for l in card if _same_row(l, anchor) and l is not anchor and l['box'][2] <= anchor['box'][0] + 5]
    shop = ''
    if header:
        shop = max(header, key=lambda l: len(l['text']))['text']
        shop = re.sub(r'[>〉›）\s]+$', '', shop).strip()
        for p in SHOP_PREFIXES:
            if shop.startswith(p) and len(shop) > len(p) + 1:
                shop = shop[len(p):].strip()
                break

    body = [l for l in card if _yc(l) > anchor['box'][3] and l not in header]
    title_lines = []
    for l in sorted(body, key=_yc):
        t = l['text'].strip()
        if l['box'][0] < width * 0.2:
            continue
        if len(t) < 6 or _is_button(t) or MONEY_RE.search(t) or any(k in t for k in PAY_KEYS):
            continue
        if not title_lines:
            title_lines.append(l)
        elif abs(l['box'][0] - title_lines[0]['box'][0]) < width * 0.04 and _yc(l) - _yc(title_lines[-1]) < _h(l) * 2.2:
            title_lines.append(l)
            if len(title_lines) >= 2:
                break
        else:
            break
    title = ''.join(l['text'].strip() for l in title_lines)

    list_price, qty = None, None
    for l in body:
        t = l['text'].replace(' ', '')
        if list_price is None and not any(k in t for k in PAY_KEYS):
            m = MONEY_RE.fullmatch(t)
            if not m and l['box'][0] > width * 0.7:
                m = re.fullmatch(r'[¥￥]?(\d+(?:\.\d{1,2})?)', t)
            if m:
                list_price = float(m.group(1))
        mq = QTY_RE.match(t)
        if mq and qty is None:
            qty = int(mq.group(1))

    when = None
    for l in card:
        m = DT_RE.search(l['text'])
        if m:
            y, mo, d, hh, mm, ss = m.groups()
            when = f'{y}-{int(mo):02d}-{int(d):02d}' + (f' {int(hh):02d}:{mm}' if hh else '')
            break

    if amount is None:
        conf = 'none'
    record = {
        'kind': {'paid': 'expense', 'refund': 'refund', 'refund_pending': 'refund_pending', 'closed': 'skip'}.get(status_kind, 'unknown'),
        'status': status_text,
        'shop': shop,
        'title': title,
        'amount': amount,
        'amount_from': amount_key,
        'list_price': list_price,
        'qty': qty,
        'time': when,
        'confidence': conf,
        'y_range': [int(min(l['box'][1] for l in card)), int(max(l['box'][3] for l in card))],
    }
    return record


def _split_by_pay_lines(lines, width):
    """没有找到状态词时的兜底：每个「实付/合计」行视为一单的结尾。"""
    pays = sorted((l for l in lines if any(k in l['text'].replace(' ', '') for k in PAY_KEYS)), key=_yc)
    orders, prev_bottom = [], -1
    for p in pays:
        card = [l for l in lines if prev_bottom < _yc(l) <= p['box'][3] + _h(p)]
        prev_bottom = p['box'][3] + _h(p)
        amount, key, conf = _find_amount(card)
        if amount is None:
            continue
        status_kind, status_text = None, ''
        for l in card:
            k, w = classify_status(l['text'])
            if k:
                status_kind, status_text = k, w
        texts = sorted((l for l in card if l['box'][0] >= width * 0.2 and len(l['text'].strip()) >= 6
                        and not _is_button(l['text']) and not MONEY_RE.search(l['text'])
                        and not any(k in l['text'] for k in PAY_KEYS)), key=_yc)
        orders.append({
            'kind': {'paid': 'expense', 'refund': 'refund', 'refund_pending': 'refund_pending', 'closed': 'skip'}.get(status_kind, 'unknown'),
            'status': status_text or '未识别状态',
            'shop': '',
            'title': texts[0]['text'].strip() if texts else '',
            'amount': amount, 'amount_from': key, 'list_price': None, 'qty': None, 'time': None,
            'confidence': 'low' if not status_kind else conf,
            'y_range': [int(min(l['box'][1] for l in card)), int(max(l['box'][3] for l in card))],
            'complete': True,
        })
    return orders


_STATUS_WORDS = sorted((w for _, ws in STATUS_RULES for w in ws), key=len, reverse=True)


def _cw(ch):
    return 0.55 if ord(ch) < 128 else 1.0


def _split_merged_status(lines, width):
    """检测框有时把右侧的状态词和左边的文字合成一行，如「不支持7天无理由公益捐赠0.02元 退款成功」。
    行尾是状态词、且按字宽估算它落在屏幕右侧 40% 时，拆成单独一行（与 web/js/lib/bill_parser.js 一致）。"""
    out = []
    for l in lines:
        t = l['text'].strip()
        w = next((w for w in _STATUS_WORDS if t.endswith(w)), None)
        pre = t[:len(t) - len(w)].rstrip() if w else ''
        if w and len(pre) >= 2:
            total = sum(_cw(c) for c in t)
            sw = sum(_cw(c) for c in w)
            x1, y1, x2, y2 = l['box']
            sx = x2 - (x2 - x1) * sw / total
            if sx >= width * 0.6:
                out.append({**l, 'text': pre, 'box': [x1, y1, max(x1 + 1, sx - 4), y2]})
                out.append({**l, 'text': w, 'box': [sx, y1, x2, y2]})
                continue
        out.append(l)
    return out


def parse_bill(lines, width, height):
    lines = _split_merged_status([l for l in lines if l['text'].strip()], width)
    platform = detect_platform(lines)

    anchors = []
    for l in lines:
        kind, _ = classify_status(l['text'])
        if not kind:
            continue
        if l['box'][0] < width * 0.45:
            continue
        if len(l['text'].strip()) > 8 and not _status_with_amount(l['text']):
            continue
        if _is_tab_row(l, lines):
            continue
        anchors.append(l)
    anchors.sort(key=_yc)

    # 页面有「实付」行时，每张卡片恰好一行实付；两个状态词之间没有实付行，说明后者是同一卡片里的小标签（如「交易关闭」卡片里的「退款成功」）
    pay_ys = [_yc(l) for l in lines if any(k in l['text'].replace(' ', '') for k in PAY_KEYS)]
    groups = []
    for a in anchors:
        if groups and pay_ys and not any(_yc(groups[-1][0]) < y < _yc(a) for y in pay_ys):
            groups[-1].append(a)
        else:
            groups.append([a])

    orders = []
    for i, g in enumerate(groups):
        a = g[0]
        top = a['box'][1] - _h(a) * 0.5
        nxt = groups[i + 1][0] if i + 1 < len(groups) else None
        bottom = nxt['box'][1] - _h(nxt) * 0.5 if nxt else height + 1
        card = [l for l in lines if top <= _yc(l) < bottom]
        rec = _parse_card(card, g, width)
        if pay_ys and rec['amount_from'] not in PAY_KEYS:
            rec['amount'], rec['confidence'] = None, 'none'
        rec['complete'] = rec['amount'] is not None
        orders.append(rec)

    if not any(o['complete'] for o in orders):
        orders = _split_by_pay_lines(lines, width)

    usable = [o for o in orders if o['complete']]
    return {
        'platform': platform,
        'orders': usable,
        'incomplete': [o for o in orders if not o['complete']],
        'summary': {
            'expense': round(sum(o['amount'] for o in usable if o['kind'] == 'expense'), 2),
            'refund': round(sum(o['amount'] for o in usable if o['kind'] == 'refund'), 2),
            'count': len(usable),
        },
    }
