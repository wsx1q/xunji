'use strict';
window.XUNJI_DESKTOP = true;
(() => {
  const token = window.__DESKTOP_CONFIG__.token;
  const invoke = (method, args) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-Xunji-Token', token);
    xhr.send(JSON.stringify({ method, args }));
    let reply;
    try { reply = JSON.parse(xhr.responseText); } catch (_) { throw new Error('无法连接本机账本服务'); }
    if (xhr.status !== 200 || reply.error) throw new Error(reply.error || '桌面操作失败');
    return reply.result;
  };
  const methods = ['appVersion', 'testTools', 'dbOpen', 'dbUnlock', 'dbCreate', 'dbInfo', 'dbUseDir',
    'dbUseDefault', 'dbSaveStatus', 'startupInfo', 'listBackups', 'restoreBackup', 'decryptBackup',
    'forceBackup', 'autoBackup', 'bioAvailable', 'readKbf', 'dbSave', 'dbCommit', 'dbSetPassword',
    'dbClearPassword', 'dbChunk', 'dbChunkDrop', 'dbPart', 'dbWait', 'dbHasPassword', 'dbCheckPassword',
    'dbPickDir', 'bioAuth', 'saveFile', 'exportBackup', 'takeSharedFile', 'ocrLocalAvailable', 'ocrLocal',
    'ocrLocalRelease', 'openDataFolder'];
  window.Android = Object.fromEntries(methods.map(name => [name, (...args) => invoke(name, args)]));
  // The headless development host has no native WebView callback channel.
  if (window.__DESKTOP_CONFIG__.eventPolling) {
    let polling = false;
    setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch('/api', { method: 'POST', headers: {'Content-Type':'application/json','X-Xunji-Token':token},
          body: JSON.stringify({method:'pollEvents',args:[]}) });
        const reply = await response.json();
        for (const event of reply.result || []) if (typeof window[event.name] === 'function') window[event.name](...event.args);
      } finally { polling = false; }
    }, 100);
  }
})();
