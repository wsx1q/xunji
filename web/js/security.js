'use strict';
/* 密码、启动锁、指纹、加密数据库位置 */
let PIN = '', _pwdNext = null;
function bioInfo() {
  if (!NATIVE || !Android.bioAvailable) return { ok: false, reason: '仅 App 支持指纹' };
  try { return JSON.parse(Android.bioAvailable()); } catch (e) { return { ok: false, reason: '无法检测指纹' }; }
}
const hasPwd = () => (NATIVE ? Android.dbHasPassword() : !!S.settings.webPwd);
// settings.pin 是旧版 4 位密码锁，设置新密码后清除
const lockOn = () => !!S.settings.pin || (!!S.settings.lock && hasPwd());
const lockLen = () => (S.settings.pin ? 4 : S.settings.lockNum ? +S.settings.lockLen || 0 : 0);
const LOCK_KEYS = ['lock', 'lockNum', 'lockLen', 'bio', 'pin', 'webPwd'];
const lockSettings = () => Object.fromEntries(LOCK_KEYS.map(k => [k, S.settings[k]]));
function checkPwd(p) {
  if (S.settings.pin) return p === S.settings.pin;
  return NATIVE ? Android.dbCheckPassword(p) : p === S.settings.webPwd;
}
function pwdLabel() { return hasPwd() ? (lockOn() ? '已设置 · 启动时锁定' : '已设置') : S.settings.pin ? '旧版 4 位密码' : '未设置'; }
function pwdSheet() {
  if (!hasPwd()) return pwdForm(false);
  const custom = dbInfo().custom;
  openSheet('密码', `<div class="tip">同一个密码用于：打开 App 时解锁；换机、重装或在其他设备上打开数据库文件和加密备份。</div>
    <div class="kv" onclick="toggleLock()"><span>打开 App 时需要密码</span><b>${S.settings.lock ? '已开启' : '已关闭'} ›</b></div>
    <div class="kv" onclick="pwdForm(true)"><span>修改密码</span><b>›</b></div>
    <div class="kv" onclick="${custom ? "toast('数据库在自定义目录中，必须保留密码')" : 'pwdClear()'}"><span>取消密码</span><b>›</b></div>`);
}
function toggleLock() {
  S.settings.lock = !S.settings.lock;
  if (!S.settings.lock) S.settings.bio = false;
  save(); render(); pwdSheet();
}
function pwdForm(change, why = '', next = null) {
  _pwdNext = next;
  const legacy = !change && S.settings.pin;
  openSheet(change ? '修改密码' : '设置密码', `${why ? `<div class="tip">${why}</div>` : ''}
    ${change ? '<input id="dp0" class="field" type="password" placeholder="当前密码"><label></label>' : ''}
    <input id="dp1" class="field" type="password" placeholder="新密码（至少 6 位，数字或字母）"><label></label>
    <input id="dp2" class="field" type="password" placeholder="再次输入新密码">
    <div class="tip">${legacy ? '原来的 4 位密码锁将升级为这个密码。' : ''}这个密码同时用于打开 App 解锁，以及换机、重装后打开数据库和加密备份。纯数字密码解锁时可用数字键盘。<b>密码无法找回</b>，请务必牢记。</div>
    <button class="btn" onclick="pwdSave()">确定</button>
    ${legacy ? `<div class="ver"><a onclick="S.settings.pin='';S.settings.bio=false;save();closeSheet();render();toast('已关闭密码锁')">不设密码，关闭旧密码锁</a></div>` : ''}`);
}
function pwdSave() {
  const o = $('#dp0') ? $('#dp0').value : '', a = $('#dp1').value, b = $('#dp2').value;
  if (a.length < 6) return toast('密码至少 6 位');
  if (a !== b) return toast('两次输入不一致');
  const first = !hasPwd(), prev = lockSettings();
  Object.assign(S.settings, { lock: first || !!S.settings.lock, lockNum: /^\d+$/.test(a), lockLen: a.length, pin: '' });
  toast('正在加密…');
  setTimeout(() => {
    let err = '';
    if (NATIVE) err = Android.dbSetPassword(o, a, fullJson());
    else if (!first && o !== S.settings.webPwd) err = '当前密码错误';
    else S.settings.webPwd = a;
    if (err) { Object.assign(S.settings, prev); return toast(err); }
    save(); closeSheet(); render(); toast(first ? '密码已设置，打开 App 时需要输入' : '密码已修改');
    const f = _pwdNext; _pwdNext = null; f && f();
  }, 50);
}
function pwdClear() {
  openSheet('取消密码', `<input id="dp0" class="field" type="password" placeholder="当前密码">
    <div class="tip">取消后打开 App 不再需要密码；数据库文件和备份仍然加密，但<b>只能在本机打开</b>，换机或重装后将无法恢复。</div>
    <button class="btn" onclick="pwdClearOk()">确定取消</button>`);
}
function pwdClearOk() {
  const o = $('#dp0').value; if (!o) return toast('请输入当前密码');
  const prev = lockSettings();
  Object.assign(S.settings, { lock: false, bio: false, lockNum: false, lockLen: 0, pin: '' });
  setTimeout(() => {
    let err = '';
    if (NATIVE) err = Android.dbClearPassword(o, fullJson());
    else if (o !== S.settings.webPwd) err = '当前密码错误';
    else S.settings.webPwd = '';
    if (err) { Object.assign(S.settings, prev); return toast(err); }
    save(); closeSheet(); render(); toast('已取消密码');
  }, 50);
}
function toggleBio() {
  if (!NATIVE) return toast('指纹解锁仅在 App 中可用');
  if (!lockOn()) return hasPwd() ? askConfirm('指纹用于打开 App 时解锁，需要先开启「打开 App 时需要密码」。', toggleLock, '开启')
    : pwdForm(false, '指纹验证失败时仍需用密码解锁，请先设置密码。');
  if (S.settings.bio) {
    S.settings.bio = false; save(); render(); toast('已关闭指纹解锁');
    return;
  }
  const info = bioInfo();
  if (!info.ok) return toast(info.reason || '本机不支持指纹');
  window._bioEnable = true;
  Android.bioAuth('开启指纹解锁');
}
window.onBioResult = (ok, err) => {
  if (window._bioEnable) {
    window._bioEnable = false;
    if (!ok) return err && toast(err);
    S.settings.bio = true; save(); render(); toast('指纹解锁已开启');
    return;
  }
  if (ok) unlockOk();
  else if (err) toast(err);
};
function unlockOk() { $('#lock').classList.remove('on'); PIN = ''; _screenLocked = false; }
const bioUnlock = () => { if (S.settings.bio && NATIVE && bioInfo().ok) setTimeout(() => { try { Android.bioAuth('解锁洵记'); } catch (e) { } }, 280); };
function showLock(noBio) {
  if (!S || !lockOn() || $('#lock').classList.contains('on')) return;
  PIN = '';
  $('#lock').className = 'on';
  renderLock();
  if (!lockLen()) setTimeout(() => $('#lkIn') && $('#lkIn').focus(), 200);
  if (!noBio) bioUnlock();
}
// 手机锁屏（熄屏）时立即锁住；亮屏回到 App 后再弹指纹
let _screenLocked = false;
window.lockNow = () => { if (!S || !lockOn() || $('#lock').classList.contains('on')) return; showLock(true); _screenLocked = true; };
window.onScreenBack = () => { if (_screenLocked && $('#lock').classList.contains('on')) bioUnlock(); _screenLocked = false; };
function renderLock() {
  const bio = S.settings.bio && NATIVE && bioInfo().ok, n = lockLen();
  const bioLink = bio ? '<div class="lk-bio" onclick="Android.bioAuth(\'解锁洵记\')">使用指纹解锁</div>' : '';
  if (!n) {
    $('#lock').innerHTML = `<div class="lk-logo">🐷</div><div class="lk-t">请输入密码</div>
      <input id="lkIn" class="field lk-in" type="password" placeholder="密码" onkeydown="if(event.key==='Enter')lockTry(this.value)"><button class="btn lk-btn" onclick="lockTry($('#lkIn').value)">解锁</button>${bioLink}`;
    return;
  }
  $('#lock').innerHTML = `<div class="lk-logo">🐷</div><div class="lk-t">请输入密码</div><div class="lk-dots" id="lkd">${Array.from({ length: n }, (_, i) => `<i class="${i < PIN.length ? 'f' : ''}"></i>`).join('')}</div>
    <div class="lk-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', bio ? '👆' : '', '0', '⌫'].map(k => k ? `<button class="${k === '⌫' || k === '👆' ? 'no' : ''}" onclick="${k === '👆' ? "Android.bioAuth('解锁洵记')" : `lockKey('${k}')`}">${k}</button>` : '<span></span>').join('')}</div>
    ${bioLink}`;
}
function lockKey(k) {
  const n = lockLen();
  if (k === '⌫') PIN = PIN.slice(0, -1); else if (PIN.length < n) PIN += k;
  renderLock();
  if (PIN.length === n) setTimeout(() => lockTry(PIN), 30);
}
function lockTry(p) {
  if (!p) return;
  if (checkPwd(p)) return setTimeout(unlockOk, 80);
  if (!$('#lkd')) { $('#lkIn').value = ''; return toast('密码错误'); }
  $('#lkd').classList.add('shake');
  setTimeout(() => { PIN = ''; renderLock(); }, 420);
}

/* ================= 加密数据库 ================= */
function dbInfo() {
  if (!NATIVE) return { label: '浏览器 localStorage（未加密，仅供调试）', custom: false, hasPwd: false };
  return JSON.parse(Android.dbInfo());
}
function dbSheet() {
  const db = dbInfo();
  openSheet('数据库', `<div class="kv"><span>加密方式</span><b>${NATIVE ? 'AES-256-GCM' : '未加密'}</b></div>
    <div class="kv"><span>文件名</span><b>${NATIVE ? esc(db.file) : '—'}</b></div>
    <div class="kv"><span>存储位置</span><b>${esc(db.label)}</b></div>
    ${NATIVE ? `<label>文件位置</label>
    <div class="db-path"><small>当前数据库</small><code>${esc(db.path || '')}</code></div>
    ${db.custom ? `<div class="db-path"><small>默认位置（改回默认时使用）</small><code>${esc(db.defaultPath || '')}</code></div>` : ''}
    <div class="db-path"><small>自动备份（App 内，最多 5 份，卸载会删除）</small><code>${esc(db.backupPath || '')}</code></div>
    <div class="db-path"><small>导出的加密备份 / CSV</small><code>${esc(db.exportPath || '')}</code></div>
    ${db.custom ? '' : '<div class="tip">默认位置在 App 的私有目录里，文件管理器看不到，卸载 App 会一起删除。想自己管理文件，可以在下面选一个存放目录。</div>'}` : ''}
    <div class="kv" onclick="pwdSheet()"><span>密码</span><b>${pwdLabel()} ›</b></div>
    <div class="tip">数据库文件始终是加密的。可以把它放到 Documents、SD 卡或网盘同步目录：换机、重装后在这里选择同一个目录，输入密码就能继续使用。</div>
    <div class="btn-row">${db.custom ? `<button class="btn ghost" onclick="useDefaultDir()">改回默认位置</button>` : ''}<button class="btn" onclick="pickDbDir()">${db.custom ? '更换目录' : '选择存放目录'}</button></div>`);
}
function pickDbDir() {
  if (!NATIVE) return toast('仅在 App 中可用');
  if (S && !hasPwd()) return pwdForm(false, '放到自定义目录前需要先设置密码，否则重装或换机后无法打开该目录中的数据库。设置好后会直接打开目录选择。', pickDbDir);
  closeSheet();
  toast(S ? '选择一个文件夹，数据库会保存为其中的 xunji.db' : '选择存放 xunji.db 的文件夹');
  Android.dbPickDir();
}
window.onDbDirPicked = s => {
  const r = JSON.parse(s);
  if (!r.ok) return r.err && toast(r.err);
  if (!S) return r.exists ? finishDir('open') : toast('该目录中没有数据库文件 xunji.db');
  if (!r.exists) return finishDir('write');
  openSheet('该目录已有数据库', `<div class="confirm-msg">「${esc(r.label)}」中已经有 xunji.db，要怎么处理？</div>
    <div class="opt" onclick="finishDir('open')"><div class="ci">📂</div><span>改用该目录中的数据<small class="opt-sub">例如换机后继续使用网盘里的账本；当前数据留在原位置</small></span></div>
    <div class="opt" onclick="askConfirm('将用当前数据覆盖该目录中的数据库文件，原文件内容会丢失，确定吗？',()=>finishDir('write'),'覆盖')"><div class="ci">📝</div><span>用当前数据覆盖它<small class="opt-sub">该目录中原有的数据会被替换</small></span></div>
    <button class="btn ghost" onclick="closeSheet()">取消</button>`);
};
function finishDir(mode) {
  closeSheet();
  if (mode === 'write') saveCancel(); else saveNow();
  const r = JSON.parse(Android.dbUseDir(mode, mode === 'write' ? fullJson() : ''));
  if (!r.ok) return toast(r.err);
  if (mode === 'open') boot();
  else { render(); toast('已移动，以后的记账直接保存到 ' + r.label); }
}
function useDefaultDir() {
  closeSheet();
  saveCancel();
  const r = JSON.parse(Android.dbUseDefault(S ? fullJson() : ''));
  if (!r.ok) return toast(r.err);
  if (S) { render(); toast('数据库已移回 App 内部存储'); } else boot();
}
function dbScreen(icon, title, msg, body) {
  const el = $('#lock');
  el.innerHTML = `<div class="lk-logo">${icon}</div><div class="lk-t">${title}</div><div class="lk-msg">${msg}</div>${body}
    <div class="lk-links"><a onclick="pickDbDir()">选择其他目录</a><a onclick="useDefaultDir()">使用默认位置</a></div>`;
  el.className = 'on db';
}
function dbUnlockScreen() {
  dbScreen('🔐', '数据库已加密', '这个数据库来自其他设备或重装前的安装，请输入当时设置的密码',
    `<input id="dbPwd" class="field lk-in" type="password" placeholder="密码" onkeydown="if(event.key==='Enter')dbUnlock()"><button class="btn lk-btn" onclick="dbUnlock()">解锁</button>`);
}
function dbUnlock() {
  const p = $('#dbPwd').value; if (!p) return toast('请输入密码');
  toast('正在解密…');
  setTimeout(() => { const r = JSON.parse(Android.dbUnlock(p)); if (!r.ok) return toast(r.err); start(nativeData(r)); unlockOk(); }, 50);
}
function dbErrorScreen(err) {
  S = null;
  dbScreen('⚠️', '无法打开数据库', esc(err || '未知错误'),
    `<button class="btn lk-btn" onclick="boot()">重试</button>${NATIVE ? `<a class="lk-danger" onclick="askConfirm('将在当前位置新建一个空数据库，原数据库文件会被覆盖且无法恢复，确定吗？',()=>start(JSON.parse(Android.dbCreate()).data,false),'新建')">新建空数据库</a>` : ''}`);
}
