'use strict';
/* 备份与恢复、导入导出、退到后台时自动备份 */
function backupDaysLabel() {
  const d = +S.settings.backupDays;
  return d === 0 ? '每次退出' : d === 1 ? '每天' : `每 ${d} 天`;
}
function backupSheet() {
  const days = +S.settings.backupDays;
  const opts = [[0, '每次退出（有改动就备份）'], [1, '每天最多一次'], [3, '每 3 天'], [7, '每 7 天']];
  let listHtml = '';
  if (NATIVE) {
    try {
      const r = JSON.parse(Android.listBackups());
      if (r.ok && r.items && r.items.length) {
        listHtml = `<label>本地自动备份（最多保留 5 份）</label>` + r.items.map(it => {
          const t = new Date(it.time);
          const label = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
          return `<div class="opt"><div class="ci">💾</div><span>${esc(it.name)}<small class="opt-sub">${label} · ${(it.size / 1024).toFixed(1)} KB</small></span><em style="color:var(--c)" onclick="restoreAutoBackup('${esc(it.name)}')">恢复</em></div>`;
        }).join('');
      } else listHtml = `<div class="tip">还没有自动备份。数据有变化并退出 App 后会按上面的频率自动备份。</div>`;
    } catch (e) { listHtml = `<div class="tip">无法读取备份列表</div>`; }
  } else {
    listHtml = `<div class="tip">浏览器调试模式：退出页签时会把当前数据备份到 localStorage（最多 5 份）。正式自动备份请在 App 中使用。</div>`;
  }
  openSheet('备份与恢复', `<div class="btn-row"><button class="btn" onclick="exportBackup()">导出加密备份</button><button class="btn ghost" style="color:#555" onclick="closeSheet();$('#importFile').click()">从文件恢复</button></div>
    <div class="tip">加密备份保存到「Download/XunJi」，和数据库文件一样用 AES-256 加密，换机或重装后选「从文件恢复」并输入密码即可。也能恢复旧版的 JSON 备份。</div>
    <label>自动备份频率（存在 App 内，保留最近 5 份，卸载 App 会一起删除）</label><div class="chips" style="flex-wrap:wrap;margin-bottom:12px">${opts.map(([v, n]) => `<i class="chip ${days === v ? 'on' : ''}" onclick="S.settings.backupDays=${v};save();backupSheet()">${n}</i>`).join('')}</div>
    ${listHtml}
    <button class="btn ghost" style="color:#555" onclick="doForceBackup()">立即自动备份一份</button>
    <div class="ver"><a onclick="exportJSON()">导出明文 JSON（不加密，仅用于迁移到其他软件）</a></div>`);
}
function doForceBackup() {
  if (!NATIVE) {
    webForceBackup();
    toast('已备份到浏览器本地');
    return backupSheet();
  }
  flushSave();
  const r = JSON.parse(Android.forceBackup());
  if (!r.ok) return toast(r.err || '备份失败');
  toast('已备份 ' + r.name);
  backupSheet();
}
function restoreAutoBackup(name) {
  askConfirm(`用备份「${name}」覆盖当前数据？建议先导出一份加密备份。`, () => {
    saveCancel();
    const r = JSON.parse(Android.restoreBackup(name));
    if (!r.ok) {
      if (r.need === 'password') return dbUnlockScreen();
      return toast(r.err || '恢复失败');
    }
    start(nativeData(r), false); unlockOk();
    toast('已从自动备份恢复');
  }, '恢复');
}
function webForceBackup() {
  const key = 'xj_auto_baks';
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { }
  arr.unshift({ t: Date.now(), data: fullJson() });
  localStorage.setItem(key, JSON.stringify(arr.slice(0, 5)));
  window._dbDirty = false;
}
function onAppPause() {
  if (!S) return;
  flushSave();
  const days = +S.settings.backupDays;
  if (NATIVE) {
    try { Android.autoBackup(days); } catch (e) { }
    return;
  }
  if (!window._dbDirty) return;
  const key = 'xj_bak_at';
  const last = +localStorage.getItem(key) || 0;
  if (days > 0 && Date.now() - last < days * 864e5) return;
  webForceBackup();
  localStorage.setItem(key, String(Date.now()));
}
window.onAppPause = onAppPause;
// 选文件、指纹弹窗等也会触发切到后台，离开超过 1 分钟才重新锁定
let _hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { _hiddenAt = Date.now(); onAppPause(); }
  if (document.visibilityState === 'visible' && Date.now() - _hiddenAt > 60e3) showLock();
});
/* ================= 导入导出 ================= */
function saveFile(name, text, mime) {
  if (window.Android && Android.saveFile) { toast(Android.saveFile(name, text)); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  toast('已导出 ' + name);
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; };
function exportJSON() {
  askConfirm('明文 JSON 不加密，任何拿到文件的人都能看到全部账目。日常备份请用「导出加密备份」。确定导出吗？',
    () => saveFile(`xunji_plain_${stamp()}.json`, plainJson(), 'application/json'), '导出');
}
function exportBackup() {
  if (!NATIVE) return toast('浏览器调试模式不支持加密备份');
  if (!hasPwd()) return pwdForm(false, '加密备份需要先设置密码，换机或重装后用它打开备份。', exportBackup);
  toast(Android.exportBackup(`xunji_backup_${stamp()}.db`, fullJson()));
}
function exportCSV() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['日期', '时间', '账本', '类型', '分类', '二级分类', '金额', '账户', '转入账户', '成员', '商家', '项目', '备注']];
  [...S.txns].sort((a, b) => a.time - b.time).forEach(t => rows.push([ymd(t.time), hm(t.time), (S.books.find(b => b.id === t.bookId) || {}).name, { expense: '支出', income: '收入', transfer: '转账', adjust: '余额变更' }[t.type],
  t.type === 'transfer' || t.type === 'adjust' ? '' : topOf(t.catId).name, t.type !== 'transfer' && t.type !== 'adjust' && catById(t.catId).pid ? catById(t.catId).name : '', t.amount, accName(t.accountId), t.toAccountId ? accName(t.toAccountId) : '', t.member, t.merchant, t.project, t.note]));
  saveFile(`xunji_txns_${stamp()}.csv`, '\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
}
function doImport(input) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => importText(rd.result);
  rd.readAsText(f);
}
let _impText = '';
function importText(text, pwd = '') {
  let d;
  try { d = JSON.parse(text); } catch (e) { return toast('文件格式不正确'); }
  if (d && d.fmt === 'xjdb') {
    if (!NATIVE) return toast('加密备份只能在 App 中恢复');
    const r = JSON.parse(Android.decryptBackup(text, pwd));
    if (r.need === 'password') {
      _impText = text;
      openSheet('输入备份密码', `<div class="tip">这个备份来自其他设备或重装前的安装，请输入当时设置的密码。</div>
        <input id="impPwd" class="field" type="password" placeholder="密码" onkeydown="if(event.key==='Enter')importPwd()"><button class="btn" onclick="importPwd()">解密</button>`);
      return setTimeout(() => $('#impPwd') && $('#impPwd').focus(), 150);
    }
    if (!r.ok) return toast(r.err);
    try { d = JSON.parse(nativeData(r)); } catch (e) { return toast('备份内容已损坏'); }
  }
  decodeDb(d);
  if (!d || !d.v || !Array.isArray(d.txns) || !Array.isArray(d.accounts) || !Array.isArray(d.books)) return toast('文件格式不正确');
  _impText = '';
  askConfirm(`备份包含 ${d.books.length} 个账本、${d.txns.length} 条记录。恢复将覆盖当前所有数据，确定吗？`, () => {
    // 密码属于本机数据库，不随备份内容变化
    const keep = lockSettings();
    S = migrate(d); Object.assign(S.settings, keep); resetTxnOrder(); save(); tab('home'); toast('恢复成功');
  }, '恢复');
}
function importPwd() {
  const p = $('#impPwd').value; if (!p) return toast('请输入密码');
  toast('正在解密…');
  setTimeout(() => importText(_impText, p), 50);
}
