'use strict';
/* 识别账单截图导入（本机 / 电脑 OCR） */
const OCR_KIND = { expense: ['支出', ''], unknown: ['状态未识别', 'warn'], refund: ['退款·不计入', 'off'], refund_pending: ['退款中·不计入', 'off'], skip: ['已关闭·不计入', 'off'] };
let OC = null;
const ocrUrl = () => (S.settings.ocrUrl || '').trim().replace(/\/+$/, '');
const LOCAL_OCR = HAS_OCR;
const ocrMode = () => (LOCAL_OCR && S.settings.ocrEngine !== 'pc' ? 'local' : 'pc');
/* 本机识别固定用 PP-OCRv5 极速版：v5 检测 + 识别模型（常数乘加并入卷积、只量化卷积的 INT8、常用 7111 字表、直接输出字号）。
   参数按手机实测固定：2 线程、批量 1、不并行、检测短边 640、识别最小宽度 160。34 张账单截图金额全对 */
const OCR_OPTS = Object.freeze({ model: 'v5f', threads: 2, par: 1, batch: 1, det: 640, recW: 160 });
const OCR_NAME = 'PP-OCRv5 极速';
const ocrOpts = () => window.__DESKTOP_OCR_OPTS__ ? window.__DESKTOP_OCR_OPTS__() : OCR_OPTS;
const ocrName = () => window.__DESKTOP_OCR_NAME__ ? window.__DESKTOP_OCR_NAME__() : OCR_NAME;
const ocrCanImport = it => ['expense','unknown'].includes(it.kind);
const _ocrWait = {};
let _ocrSeq = 0;
window.onOcrLocal = (id, json) => { const r=JSON.parse(json),f = _ocrWait[id]; delete _ocrWait[id]; window.__DESKTOP_OCR_RESULT__?.(id,r); if (f) f(r); };
function ocrRefresh() {
  // Background OCR must not rebuild another page or erase its focused inputs.
  stack.filter(p => p.name === 'ocr').forEach(p => { p.node = null; });
  if (stack.at(-1).name === 'ocr') render();
  window.__DESKTOP_OCR_TASK_CHANGED__?.();
}
function ocrProgressMarkup(progress = OC?.progress, busy = OC?.busy) {
  if (!busy) return '';
  const names = {queued:'等待处理',initializing:'准备识别环境',loading:'加载模型',warming:'预热模型',ready:'模型已就绪',preparing:'读取图片',recognizing:'识别截图'};
  const total=progress?.total||0, completed=Math.min(total,progress?.completed||0),stage=progress?.stage||'queued';
  const count=total ? ` · ${completed}/${total}${stage==='recognizing'?' 段':''}` : '';
  return `<div class="ocr-progress-card" role="status"><b>${esc(busy)}</b><span>${names[stage]||'处理中'}${count}</span><progress ${total?`value="${completed}" max="${total}"`:''} aria-label="${names[stage]||'识别进度'}"></progress><small>可切换应用内页面，识别会继续；结果保留在识别页。</small></div>`;
}
function ocrProgressChanged() {
  const node=$('#ocrTaskProgress');
  if(node)node.innerHTML=ocrProgressMarkup();
  window.__DESKTOP_OCR_TASK_CHANGED__?.();
}
window.onOcrProgress = (id, json) => {
  const progress=JSON.parse(json);
  if(OC?.requestId===id){OC.progress=progress;ocrProgressChanged();}
  window.__DESKTOP_OCR_PROGRESS__?.(id,progress);
};
function blobToDataUrl(blob) {
  return new Promise((ok, fail) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.onerror = () => fail(new Error('无法读取图片')); rd.readAsDataURL(blob); });
}
async function localOcr(src, opts = ocrOpts()) {
  const id = 'o' + (++_ocrSeq), data = typeof src === 'string' ? src : await blobToDataUrl(src);
  if(OC){OC.requestId=id;OC.progress={stage:'queued',completed:0,total:0};ocrProgressChanged();}
  const r = await new Promise((ok, fail) => {
    const t = setTimeout(() => { delete _ocrWait[id]; fail(new Error('识别超时')); }, 180000);
    _ocrWait[id] = v => { clearTimeout(t); ok(v); };
    Android.ocrLocal(id, data, JSON.stringify(opts));
  });
  if (!r.ok) throw new Error('本机识别失败：' + (r.err || '未知错误'));
  return r;
}
async function pcOcr(blob) {
  const fd = new FormData(); fd.append('file', blob, 'bill.jpg');
  const t0 = performance.now();
  const res = await ocrFetch('/ocr', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('服务返回 ' + res.status);
  const r = await res.json();
  r.stat = { mode: 'pc', total: Math.round(performance.now() - t0), ocr: r.ocr_ms, lines: (r.lines || []).length };
  return r;
}
function setOcrMode(m) { if(OC?.busy)return toast('请等待当前识别完成'); S.settings.ocrEngine = m; save(); render(); ocrWarm(); }
/** 手机延迟释放；电脑版由原生层保留有上限的常驻缓存。 */
function releaseLocalOcr() { if (LOCAL_OCR && !OC?.busy) try { Android.ocrLocalRelease(); } catch (e) { } }
/** 预加载：进识别页 / 换模型时就在后台加载模型（空图片 = 只加载 + 预热），选完截图直接开始识别 */
function ocrWarm() {
  if (!LOCAL_OCR || ocrMode() !== 'local') return;
  try { Android.ocrLocal('warm' + (++_ocrSeq), '', JSON.stringify(ocrOpts())); } catch (e) { }
}
function openOcr() {
  if (!HAS_OCR) return;
  if (!S.accounts.length) return toast('请先添加账户');
  if (!OC) {
    const last = (S.settings.last || {}).expense || {};
    OC = {
      items: [], busy: '', err: '', imgs: 0, stats: [], incompleteByFile: {},
      accountId: (last.accountId && accById(last.accountId)) ? last.accountId : S.accounts[0].id,
      catId: ocrDefaultCat(), member: last.member || '本人', date: ymd(Date.now())
    };
  }
  if(stack.at(-1).name==='ocr')render();else go('ocr');
  ocrWarm();
}
function ocrDefaultCat() {
  const list = S.categories.expense, saved = S.settings.ocrCat;
  if (saved && list.some(c => c.id === saved)) return saved;
  const shop = list.find(c => c.pid && /网购|淘宝|电商/.test(c.name)) || list.find(c => !c.pid && /购物/.test(c.name));
  if (!shop) return defaultCatId('expense');
  return shop.pid ? shop.id : ((list.find(c => c.pid === shop.id) || shop).id);
}
function ocrFetch(path, opt = {}, ms = 60000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  return fetch(ocrUrl() + path, { ...opt, signal: ctl.signal }).finally(() => clearTimeout(t));
}
function setOcrUrl(v) {
  v = v.trim();
  if (v && !/^https?:\/\//i.test(v)) v = 'http://' + v;
  if (v && !/:\d+(\/|$)/.test(v.replace(/^https?:\/\//i, ''))) v = v.replace(/\/+$/, '') + ':8866';
  S.settings.ocrUrl = v; save(); render();
}
async function ocrTest() {
  if (!ocrUrl()) return toast('请先填写电脑上 OCR 服务的地址');
  toast('正在连接…');
  try {
    const r = await (await ocrFetch('/health', {}, 5000)).json();
    toast(r.ok ? '连接成功 ✓' : '服务未就绪');
  } catch (e) { toast('连不上：确认电脑已启动 OCR 服务、手机和电脑在同一 WiFi'); }
}
function ocrPick() {
  if (OC.busy) return;
  if (ocrMode() === 'pc' && !ocrUrl()) return toast('请先填写电脑上 OCR 服务的地址');
  $('#ocrFile').click();
}
function shrinkImage(file, maxSide = 2400) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      // 长截图（高 > 2.6 倍宽，如淘宝自带长截图）不能按最长边缩，否则字会糊：只限制宽度，交给识别端分段识别
      const tall = img.height > img.width * 2.6;
      const k = tall ? Math.min(1, 1440 / img.width) : Math.min(1, maxSide / Math.max(img.width, img.height));
      if (k === 1 && (tall || file.size < 1.5e6)) return ok(file);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { c.width = c.height = 0; img.src = ''; b ? ok(b) : fail(new Error('图片压缩失败')); }, 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('无法读取图片')); };
    img.src = url;
  });
}
function parseOcrTime(s) {
  const m = s && s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
  if (!m) return 0;
  const now = new Date();
  return new Date(+m[1], m[2] - 1, +m[3], m[4] != null ? +m[4] : now.getHours(), m[5] != null ? +m[5] : now.getMinutes()).getTime();
}
function ocrDupMatch(it, t) {
  return t.type === 'expense' && t.amount === it.amount && t.merchant === it.platform && t.note === it.note;
}
function ocrDup(it) { return S.txns.some(t => ocrDupMatch(it, t)); }
function ocrCompare(i, page = 0) {
  const it=OC?.items[i];if(!it)return;
  const matches=S.txns.filter(t=>ocrDupMatch(it,t)).sort((a,b)=>b.time-a.time);
  if(!matches.length){it.dup=false;closeSheet();render();return toast('没有找到匹配的已有账目');}
  page=Math.max(0,Math.min(matches.length-1,page));
  const existing=matches[page],bookName=id=>S.books.find(b=>b.id===id)?.name||'未知账本';
  const currentTime=it.ocrTime?`${ymd(it.ocrTime)} ${hm(it.ocrTime)}`:`${OC.date}（截图无时间，使用导入日期）`;
  const fields=[
    ['金额',money(it.amount),money(existing.amount)],
    ['日期',currentTime,`${ymd(existing.time)} ${hm(existing.time)}`],
    ['账本',bookName(S.curBook),bookName(existing.bookId)],
    ['账户',accName(OC.accountId),accName(existing.accountId)],
    ['分类',catLabel(it.catId||OC.catId),catLabel(existing.catId)],
    ['成员',OC.member,existing.member],
    ['商家 / 平台',it.platform,existing.merchant],
    ['备注 / 商品明细',it.note,existing.note],
  ];
  openSheet('与已有账目对比',`<div class="tip">金额、商家 / 平台和备注相同，因此提示可能已记过；请结合日期、账户核对。</div>
    <div class="oc-compare-page"><span>匹配账目 ${page+1} / ${matches.length}</span><button class="chip" onclick="ocrCompare(${i},${page-1})" ${page===0?'disabled':''}>上一笔</button><button class="chip" onclick="ocrCompare(${i},${page+1})" ${page===matches.length-1?'disabled':''}>下一笔</button></div>
    <table class="oc-compare"><thead><tr><th>字段</th><th>本次识别</th><th>已有账目</th></tr></thead><tbody>${fields.map(([name,a,b])=>`<tr class="${a===b?'':'different'}"><th scope="row">${name}</th><td>${esc(a||'未设置')}</td><td>${esc(b||'未设置')}</td></tr>`).join('')}</tbody></table>
    <div class="tip">有差异的字段已标色。这里只调整本次是否导入，已有账目不会被修改。</div>
    <div class="btn-row"><button class="btn ghost" onclick="ocrCompareSelect(${i},false)">本条不导入</button><button class="btn" onclick="ocrCompareSelect(${i},true)">仍选中待导入</button></div>`);
}
function ocrCompareSelect(i, selected) {
  const it=OC?.items[i];if(!it)return;
  it.sel=!!selected&&ocrCanImport(it);closeSheet();render();
}
function ocrOrderNote(order, platform = '') {
  const items = order.items || [];
  const lines = [order.shop || platform || '订单导入'];
  if (items.length) {
    items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}${item.qty ? ' ×' + item.qty : ''}${item.list_price != null ? '（页面标价 ¥' + money(item.list_price) + '）' : ''}`);
      if (item.spec) lines.push('规格：' + item.spec);
    });
  } else if (order.title) lines.push(order.title);
  else if(platform==='超盒算' && order.qty)lines.push(`共 ${order.qty} 件商品（截图未显示商品名称）`);
  if (order.amount != null) lines.push('订单实付：¥' + money(order.amount));
  return lines.join('\n');
}
async function ocrFiles(input) {
  const files = [...input.files]; input.value = '';
  if (!files.length) return;
  if(OC?.busy)return toast('当前识别尚未完成，请稍后追加图片');
  OC.err = '';
  const seen = new Set(OC.items.map(it => it.key));
  const categoryContext = OcrCategory.context(S);
  let added = 0, skipped = 0;
  const mode = ocrMode();
  for (let i = 0; i < files.length; i++) {
    const cfg = mode === 'local' ? ocrName() : 'pc';
    OC.busy = `正在识别第 ${i + 1}/${files.length} 张…`;
    OC.progress={stage:'preparing',completed:0,total:0};
    ocrRefresh();
    try {
      const desktopSource = window.__DESKTOP_OCR_FILE_KEY__ ? await window.__DESKTOP_OCR_FILE_KEY__(files[i]) : null;
      const sourceKey = desktopSource?.key || [files[i].name, files[i].size, files[i].lastModified].join(':');
      const blob = await shrinkImage(files[i]);
      let r;
      if (mode === 'local') {
        const t0 = performance.now();
        const raw = await localOcr(blob);
        r = parseBill(raw.lines, raw.width, raw.height);
        r.stat = {
          mode: 'local', cfg, model: raw.model, threads: raw.threads, total: Math.round(performance.now() - t0),
          ocr: raw.total_ms, det: raw.det_ms, rec: raw.rec_ms, load: raw.load_ms, cached: !!raw.cached, lines: raw.lines.length, size: `${raw.width}×${raw.height}`, mem: raw.mem
        };
      } else { OC.progress={stage:'recognizing',completed:0,total:0};ocrProgressChanged();r = await pcOcr(blob); r.stat.cfg = cfg; }
      // Rechecking a screenshot with the other desktop profile replaces its
      // previous preview, even when the two models read the title differently.
      if (desktopSource && r.orders?.length) {
        const previous = OC.items.filter(it => it._desktopOcrFile === desktopSource.key && it._desktopOcrProfile !== desktopSource.profile);
        if (previous.length) {
          const removed = new Set(previous);
          OC.items = OC.items.filter(it => !removed.has(it));
          previous.forEach(it => { if (!OC.items.some(other => other.key === it.key)) seen.delete(it.key); });
        }
      }
      OC.stats.push(r.stat);
      (OC.incompleteByFile || (OC.incompleteByFile = {}))[sourceKey] = (r.incomplete || []).length;
      OC.imgs++;
      const platform = r.platform && r.platform.key !== 'unknown' ? r.platform.name : '';
      for (const o of r.orders || []) {
        // Position distinguishes independent orders with identical goods/prices.
        const key = [sourceKey, o.y_range?.[0] ?? o.time ?? '', o.amount, o.kind].join('|');
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        const it = {
          ...(desktopSource ? {_desktopOcrFile: desktopSource.key, _desktopOcrProfile: desktopSource.profile} : {}),
          key, platform, shop: o.shop || '', title: o.title || '', status: o.status, kind: o.kind in OCR_KIND ? o.kind : 'unknown',
          amount: o.amount, conf: o.confidence, ocrTime: parseOcrTime(o.time), catId: '',
          goods: o.items || [],
          note: ocrOrderNote(o, platform)
        };
        const recommendation = OcrCategory.suggest(it, categoryContext);
        it.catId = recommendation.catId; it.catReason = recommendation.reason;
        it.dup = it.kind === 'expense' && ocrDup(it);
        it.sel = it.kind === 'expense' && !it.dup;
        OC.items.push(it);
        added++;
      }
    } catch (e) {
      OC.err = (e.name === 'AbortError' ? '识别超时' : (e.message === 'Failed to fetch' ? '连不上 OCR 服务' : e.message || String(e))) + `（第 ${i + 1} 张）`;
    } finally {
      files[i] = null; // Release each processed screenshot before the rest of the batch.
    }
  }
  OC.busy = '';
  OC.requestId='';OC.progress=null;
  ocrRefresh();
  if(stack.at(-1).name!=='ocr')releaseLocalOcr();
  toast(`识别出 ${added} 笔${skipped ? `，${skipped} 笔重复已合并` : ''}`);
}
Pages.ocr = () => {
  if (!OC) { setTimeout(back); return ''; }
  const items = OC.items, sel = items.filter(it => it.sel && ocrCanImport(it));
  const total = r2(sel.reduce((a, it) => a + it.amount, 0));
  const offN = items.filter(it => OCR_KIND[it.kind][1] === 'off').length;
  const a = accById(OC.accountId), c = catById(OC.catId);
  const row = (it, i) => {
    const [label, cls] = OCR_KIND[it.kind], can = ocrCanImport(it), checked = can ? it.sel : it.reviewSel;
    const cat = it.catId ? catById(it.catId) : null;
    return `<div class="oc-it ${cls} ${checked ? 'sel' : ''}">
      <i class="oc-ck" role="checkbox" aria-label="${can?'选择导入':'选择忽略'}第 ${i+1} 笔" aria-checked="${!!checked}" onclick="ocrToggle(${i})">${checked ? '✓' : ''}</i>
      <div class="oc-m" onclick="ocrEdit(${i})">
        <div class="oc-t">${esc(it.note)}</div>
        <div class="oc-s">${[it.platform && `<em>${esc(it.platform)}</em>`, it.shop && esc(it.shop), it.goods?.length > 1 && `合单 · ${it.goods.length} 项商品`, `<span class="oc-k">${esc(it.kindChanged ? label : (it.status || label))}${cls === 'off' ? ' · 不计入' : ''}</span>`, it.dup && `<button class="oc-k warn oc-compare-link" onclick="event.stopPropagation();ocrCompare(${i})">可能已记过 · 对比</button>`, `<span class="${it.catId?'':'warn'}">${esc(catLabel(it.catId || OC.catId))} · ${esc(it.catReason || '默认分类')}</span>`, it.ocrTime && ymd(it.ocrTime)].filter(Boolean).join(' · ')}</div>
      </div>
      <b class="oc-a">${money(it.amount)}${it.conf === 'low' ? '<small>?</small>' : ''}</b></div>`;
  };
  const mode = ocrMode(), sec = ms => (ms / 1000).toFixed(1) + 's';
  const pcCard = `<div class="card"><div class="card-hd"><b>电脑 OCR 服务</b><a onclick="ocrTest()">测试连接</a></div>
    <input class="field" value="${esc(S.settings.ocrUrl || '')}" placeholder="例如 192.168.1.10:8866" inputmode="url" onchange="setOcrUrl(this.value)">
    <div class="ver" style="text-align:left;padding:6px 0 12px">电脑运行 洵记OCR.exe，手机和电脑连同一个 WiFi</div></div>`;
  const localCard = `<div class="card"><div class="card-hd"><b>本机识别 · ${esc(ocrName())}</b><small>离线运行，不联网</small></div></div>`;
  const st = OC.stats, last = st[st.length - 1];
  const statHtml = last ? (() => {
    const same = st.filter(s => s.cfg === last.cfg && !s.load);
    const avg = same.length ? Math.round(same.reduce((a, s) => a + s.total, 0) / same.length) : 0;
    const detail = last.mode === 'local'
      ? `本机 ${esc(last.cfg)} · ${last.threads} 线程 · ${last.size}<br>检测 ${sec(last.det)} + 识别 ${sec(last.rec)}（${last.lines} 行）${last.load ? ` · 加载模型 ${sec(last.load)}${last.cached ? '（已缓存）' : '（首次，已缓存供下次）'}` : ''}${last.mem ? ` · 内存 ${last.mem}MB` : ''}`
      : `电脑识别 ${sec(last.ocr)} · 含传输共 ${sec(last.total)}（${last.lines} 行）`;
    return `<div class="tip">上一张耗时 <b style="color:var(--c)">${sec(last.total)}</b>${same.length > 1 ? ` · 同方式平均 ${sec(avg)}（${same.length} 张，不含加载）` : ''}<br>${detail}</div>`;
  })() : '';
  return `${hdr('识别账单导入')}
  ${LOCAL_OCR ? `<div class="card" style="padding:12px 14px"><div class="seg light oc-mode">${[['local', '📱 本机识别'], ['pc', '💻 电脑识别']].map(([k, n]) => `<i class="${mode === k ? 'on' : ''}" onclick="setOcrMode('${k}')">${n}</i>`).join('')}</div></div>` : ''}
  ${mode === 'local' ? localCard : pcCard}
  <div class="card" style="padding:14px">
    <button class="btn oc-pick ${OC.busy ? 'dim' : ''}" onclick="ocrPick()">${OC.busy ? '⏳ ' + OC.busy : '📷 选择账单截图（可多选）'}</button>
    <div class="ver" style="padding:8px 0 0">支持淘宝 / 京东 / 拼多多 / 抖音 / 超盒算的订单列表截图，默认只导入成功的支出；退款可编辑核对或批量忽略</div>
    <div id="ocrTaskProgress">${ocrProgressMarkup()}</div>
    ${statHtml}
    ${Object.values(OC.incompleteByFile || {}).some(Boolean) ? `<div class="tip">有 ${Object.values(OC.incompleteByFile).reduce((a,b)=>a+b,0)} 笔订单未显示完整实付款，暂不导入；请补充包含订单底部的截图。</div>` : ''}
    ${OC.err ? `<div class="tip"><b>${esc(OC.err)}</b></div>` : ''}</div>
  ${items.length ? `
  <div class="card"><div class="card-hd"><b>导入设置</b><small>对所有选中订单生效</small></div>
    <div class="kv" onclick="ocrPickAcc()"><span>账户</span><b>${a ? accIcon(a) + ' ' + esc(a.name) : '请选择'} ›</b></div>
    <div class="kv" onclick="ocrPickCat(-1)"><span>默认分类（未推荐时使用）</span><b>${c.icon} ${esc(catLabel(OC.catId))} ›</b></div>
    <div class="kv" onclick="ocrPickMember()"><span>成员</span><b>${esc(OC.member)} ›</b></div>
    <div class="kv" onclick="dateSheet('选择日期',OC.date,v=>{OC.date=v;render()},{max:ymd(Date.now())})"><span>日期</span><b>${OC.date} ›<small class="opt-sub">截图里没有时间的订单用这个日期</small></b></div></div>
  <div class="card"><div class="card-hd"><b>识别结果 · ${OC.imgs} 张图 ${items.length} 笔</b><a onclick="askConfirm('清空识别结果？',()=>{OC.items=[];OC.imgs=0;OC.err='';OC.incompleteByFile={};render()})">清空</a></div>
    <div class="tip">分类优先参考当前账本历史和已确认的手动分类，再匹配商品关键词。拿不准的使用默认分类；点击订单可修改，导入后记住手动选择。</div>
    ${offN ? `<div class="oc-review-actions"><span>${offN} 笔退款 / 关闭订单默认不导入，点击明细可修改。</span><button class="chip" onclick="ocrSelectExcluded()">${items.filter(it=>!ocrCanImport(it)).every(it=>it.reviewSel)?'取消全选':'全选不导入记录'}</button><button class="chip" onclick="ocrIgnoreExcluded()">忽略选中 ${items.filter(it=>!ocrCanImport(it)&&it.reviewSel).length} 笔</button></div>` : ''}
    ${items.map(row).join('')}</div>
  <div class="oc-bar"><span>已选 <b>${sel.length}</b> 笔 · 合计 <b>${money(total)}</b></span><button class="btn" onclick="ocrImport()">导入</button></div>` : ''}`;
};
function ocrToggle(i) {
  const it = OC.items[i];
  if(ocrCanImport(it))it.sel=!it.sel;else it.reviewSel=!it.reviewSel;
  render();
}
function ocrSelectExcluded() {
  const excluded=OC.items.filter(it=>!ocrCanImport(it)),select=!excluded.every(it=>it.reviewSel);
  excluded.forEach(it=>{it.reviewSel=select;it.sel=false;});render();
}
function ocrIgnoreExcluded() {
  const selected=OC.items.filter(it=>!ocrCanImport(it)&&it.reviewSel);
  if(!selected.length)return toast('请先选择要忽略的退款或关闭订单');
  askConfirm(`忽略选中的 ${selected.length} 笔不导入记录？不会修改已导入的账目。`,()=>{
    const removed=new Set(selected);OC.items=OC.items.filter(it=>!removed.has(it));
    ocrRefresh();toast(`已忽略 ${selected.length} 笔`);
  },'忽略');
}
function ocrEdit(i) {
  const it = OC.items[i];
  _sheetCb = i;
  openSheet('修改订单', `<label>识别状态 / 导入方式</label><select id="ocKind" class="field">${Object.entries(OCR_KIND).map(([kind,[label]])=>`<option value="${kind}" ${it.kind===kind?'selected':''}>${kind==='expense'?'正常支出 · 可导入':kind==='unknown'?'状态未识别 · 可导入':label+' · 可忽略'}</option>`).join('')}</select><label>金额</label><input id="ocA" class="field" type="number" inputmode="decimal" step="0.01" value="${it.amount}">
    <label>备注（商品明细）</label><textarea id="ocN" class="field ocr-note" rows="6" maxlength="${NOTE_MAX}">${esc(it.note)}</textarea>
    <div class="kv" onclick="ocrSaveEdit(${i},true)"><span>分类</span><b>${it.catId ? esc(catLabel(it.catId)) : '用默认分类'} ›</b></div>
    <div class="tip">${esc(it.catReason || '使用默认分类')}；分类可手动修改。</div>
    ${it.ocrTime ? `<div class="kv"><span>时间</span><b>${ymd(it.ocrTime)} ${hm(it.ocrTime)}</b></div>` : ''}
    <div class="tip">识别到：${esc([it.platform, it.shop, it.status].filter(Boolean).join(' · '))}<br>${esc(it.title)}</div>
    <button class="btn" onclick="ocrSaveEdit(${i})">确定</button>`);
}
function ocrSaveEdit(i, thenCat) {
  const it = OC.items[i], v = r2(parseFloat($('#ocA').value) || 0);
  const kind=$('#ocKind').value;
  if (!(kind in OCR_KIND))return;
  if ((ocrCanImport({kind}) && !(v > 0)) || v < 0) return toast('请输入有效金额');
  if(it.kind!==kind){it.kindChanged=true;it.kind=kind;it.reviewSel=false;}
  it.sel=ocrCanImport(it);
  it.amount = v; it.note = $('#ocN').value.trim() || it.note;
  it.dup = it.kind === 'expense' && ocrDup(it);
  if (thenCat) return ocrPickCat(i);
  closeSheet(); render();
}
function ocrPickAcc() { accSheet('选择账户', OC.accountId, id => { OC.accountId = id; }); }
function ocrPickMember() { memberSheet(OC.member, m => { OC.member = m; }); }
function ocrPickCat(i) {
  catSheet(i < 0 ? '默认分类' : '这笔的分类', 'expense', i < 0 ? OC.catId : (OC.items[i].catId || OC.catId), id => {
    if (i < 0) OC.catId = id;
    else { const it=OC.items[i];it.catId=id;it.catManual=true;it.catReason='手动选择（导入后记住）';it.sel=ocrCanImport(it); }
  });
}
function ocrImport() {
  const sel = OC.items.filter(it => it.sel && ocrCanImport(it));
  if (!sel.length) return toast('没有选中要导入的订单');
  if (!accById(OC.accountId)) return toast('请选择账户');
  if(!S.categories.expense.some(c=>c.id===OC.catId))OC.catId=ocrDefaultCat();
  const dupN = sel.filter(it => it.dup).length;
  const doIt = () => {
    const base = parseYmd(OC.date), now = new Date();
    const fallback = base + (now.getHours() * 60 + now.getMinutes()) * 6e4;
    sel.forEach((it, k) => {
      if(!S.categories.expense.some(c=>c.id===it.catId))it.catId='';
      if(it.catManual && it.catId)OcrCategory.remember(S,it,it.catId);
      if (it.platform && !S.merchants.includes(it.platform)) S.merchants.push(it.platform);
      insertTxn({
        id: uid(), bookId: S.curBook, type: 'expense', amount: it.amount, catId: it.catId || OC.catId,
        accountId: OC.accountId, toAccountId: '', time: it.ocrTime || fallback - k * 1000,
        note: it.note, member: OC.member, merchant: it.platform, project: ''
      });
    });
    S.settings.ocrCat = OC.catId;
    save();
    const imported=new Set(sel);
    OC.items = OC.items.filter(it => !imported.has(it));
    OC.items.forEach(it => { it.dup = it.kind === 'expense' && ocrDup(it); });
    toast(`已导入 ${sel.length} 笔支出 ✓`);
    render();
  };
  askConfirm(`导入 ${sel.length} 笔支出，合计 ${money(r2(sel.reduce((a, it) => a + it.amount, 0)))}，记到「${esc(accName(OC.accountId))}」？${dupN ? `<br><b>其中 ${dupN} 笔可能已经记过。</b>` : ''}`, doIt, '导入');
}
