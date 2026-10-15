/* 支付宝 / 微信账单文件解析：parseBillFile(name, Uint8Array) -> Promise<{ platform, rows }>
 * 支付宝：CSV（GBK 或 UTF-8），前面有一段说明文字，从「交易时间」那一行开始是表头。
 * 微信：xlsx（新版）或 CSV（旧版），时间在 xlsx 里是 Excel 日期序列号。
 * rows: { id, time, type:'expense'|'income'|'', amount, refund, party, goods, method, cls, status, skip }，skip 非空表示不导入及原因。
 */
(function () {
  const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** 极简 zip 读取：按中央目录取出指定文件 */
  async function unzip(buf, want) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('xlsx 文件已损坏');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {}, dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true), name = dec.decode(buf.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (!want.includes(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const raw = buf.subarray(start, start + csize);
      files[name] = dec.decode(method === 0 ? raw : await inflateRaw(raw));
    }
    return files;
  }

  const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  async function readXlsx(buf) {
    const f = await unzip(buf, ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = f['xl/worksheets/sheet1.xml'];
    if (!sheet) throw new Error('xlsx 里没有找到工作表');
    const ss = [...(f['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map(m => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
    const rows = [];
    for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attr = cm[2], body = cm[3] || '';
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (/t="s"/.test(attr)) val = ss[+v] || '';
        else if (/t="inlineStr"/.test(attr)) val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (v != null) val = unxml(v);
        row[colIdx(cm[1])] = val;
      }
      rows.push(Array.from(row, x => x == null ? '' : x));
    }
    return rows;
  }

  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('gbk').decode(buf); }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  const clean = s => String(s == null ? '' : s).replace(/^\uFEFF/, '').trim();
  const num = s => { const v = parseFloat(clean(s).replace(/[¥￥,\s]/g, '')); return isFinite(v) ? Math.round(v * 100) / 100 : 0; };

  function parseTime(v) {
    const s = clean(v);
    if (/^\d+(\.\d+)?$/.test(s)) {
      // Excel 日期序列号，账单时间是北京时间，按本地时间解释
      const d = new Date(Math.round((parseFloat(s) - 25569) * 864e5));
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
    }
    const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*(\d{1,2})?:?(\d{2})?:?(\d{2})?/);
    if (!m) return 0;
    return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }

  const HEAD = {
    time: ['交易时间', '交易创建时间', '付款时间'], cls: ['交易分类', '交易类型', '类型'], party: ['交易对方'],
    goods: ['商品说明', '商品', '商品名称'], dir: ['收/支'], amount: ['金额', '金额(元)', '金额（元）'],
    method: ['收/付款方式', '支付方式'], status: ['交易状态', '当前状态'], id: ['交易订单号', '交易单号', '交易号'],
    refund: ['成功退款（元）', '成功退款(元)'], memo: ['备注']
  };

  function toTable(rows) {
    const hi = rows.findIndex(r => r.some(c => clean(c) === '收/支') && r.some(c => /交易时间|交易创建时间|付款时间/.test(clean(c))));
    if (hi < 0) return null;
    const head = rows[hi].map(clean), col = {};
    for (const [k, names] of Object.entries(HEAD)) {
      const i = head.findIndex(h => names.includes(h));
      if (i >= 0) col[k] = i;
    }
    const data = [];
    for (const r of rows.slice(hi + 1)) {
      const get = k => col[k] == null ? '' : clean(r[col[k]]);
      const time = parseTime(get('time'));
      if (!time) continue;
      data.push({ time, cls: get('cls'), party: get('party'), goods: get('goods'), dir: get('dir'), amount: num(get('amount')),
        method: get('method'), status: get('status'), id: get('id'), refundCol: num(get('refund')), memo: get('memo') });
    }
    return data;
  }

  const BAD = /关闭|失败|撤销|已取消|已退还|已全额退款/;

  function alipayRows(data) {
    const rows = data.map(d => ({ ...d, type: d.dir === '支出' ? 'expense' : d.dir === '收入' ? 'income' : '', refund: 0, skip: '' }));
    const byId = new Map(rows.filter(r => r.id).map(r => [r.id, r]));
    for (const r of rows) {
      const isRefund = r.cls === '退款' || /退款/.test(r.status) && r.dir !== '支出';
      if (isRefund) {
        r.skip = '退款';
        const orig = byId.get(r.id.split('_')[0]);
        if (orig && orig !== r && orig.type === 'expense' && !BAD.test(orig.status)) orig.refund = Math.round((orig.refund + r.amount) * 100) / 100;
        continue;
      }
      if (!r.type) { r.skip = '不计收支'; continue; }
      if (BAD.test(r.status)) { r.skip = '交易关闭'; continue; }
    }
    for (const r of rows) {
      if (r.skip) continue;
      r.refund = Math.max(r.refund, r.refundCol || 0);
      if (r.refund && r.amount - r.refund <= 0.001) r.skip = '已全额退款';
    }
    return rows;
  }

  function wechatRows(data) {
    return data.map(d => {
      const r = { ...d, type: d.dir === '支出' ? 'expense' : d.dir === '收入' ? 'income' : '', refund: 0, skip: '' };
      const part = d.status.match(/已退款[(（]?[¥￥]?\s*([\d.]+)/);
      if (/退款/.test(d.cls)) r.skip = '退款';
      else if (!r.type) r.skip = '中性交易';
      else if (BAD.test(d.status)) r.skip = /退款/.test(d.status) ? '已全额退款' : '交易关闭';
      else if (part) {
        r.refund = Math.round(parseFloat(part[1]) * 100) / 100;
        if (r.amount - r.refund <= 0.001) r.skip = '已全额退款';
      }
      return r;
    });
  }

  window.parseBillFile = async function (name, buf) {
    const isZip = ZIP_SIG.every((b, i) => buf[i] === b);
    const rows = isZip ? await readXlsx(buf) : parseCsv(decodeText(buf));
    const text = rows.slice(0, 30).map(r => r.join(',')).join('\n');
    const platform = /微信/.test(text) || /微信/.test(name) ? 'wechat' : /支付宝/.test(text) || /支付宝|alipay/i.test(name) ? 'alipay' : '';
    if (!platform) throw new Error('不是支付宝或微信导出的账单文件');
    const data = toTable(rows);
    if (!data) throw new Error('没有找到账单明细表头');
    const out = platform === 'alipay' ? alipayRows(data) : wechatRows(data);
    out.forEach(r => { r.goods = /^[/\s]*$/.test(r.goods) ? '' : r.goods; r.party = r.party === '/' ? '' : r.party; r.method = r.method === '/' ? '' : r.method; delete r.refundCol; });
    return { platform, rows: out };
  };
})();
