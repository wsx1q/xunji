'use strict';
/* 「我的」页 */
Pages.me = () => {
  const days = dayCount();
  const bal = balances(); const net = Object.values(bal).reduce((a, b) => a + b, 0);
  const menu = (items) => `<div class="card menu">${items.map(([ic, n, fn, ex = '']) => `<div class="mi" onclick="${fn}"><i>${ic}</i><span>${n}</span><em>${ex}</em></div>`).join('')}</div>`;
  const db = dbInfo();
  return `<div class="me-hd grad"><div class="avatar">🐷</div><div><b>洵记</b><small>${NATIVE ? '数据加密保存在本机，无需联网' : '浏览器调试模式 · 数据未加密'}</small></div></div>
  <div class="card me-stat"><div><b>${days}</b><small>记账天数</small></div><div><b>${S.txns.length}</b><small>记账笔数</small></div><div><b>${money(net, 0)}</b><small>净资产</small></div></div>
  ${menu([['💳', '账户管理', "go('accounts')", S.accounts.length + ' 个'], ['🎯', '预算管理', "go('budget')", budget().total ? money(budget().total, 0) : '未设置'],
    ['🗂️', '分类管理', "go('cats')"], ['📚', '账本管理', "go('books')", esc(curBook().name)], ['👥', '成员管理', 'manageMembers()', S.members.length + ' 人'],
    ['🏪', '商家管理', "manageTags('merchant')", S.merchants.length + ' 个'], ['📁', '项目管理', "manageTags('project')", S.projects.length + ' 个'],
    ['🧩', '首页看板', "go('dash')", S.settings.home.widgets.filter(w => w.on).length + ' 个模块'],
    canUndoMerge() && ['↩️', '撤销上一次合并 / 批量修改', "askConfirm('撤销「' + esc(_mergeUndo.label) + '」，恢复到之前的样子？',undoMerge,'撤销')", '']].filter(Boolean))}
  ${menu([['🔑', '密码', 'pwdSheet()', pwdLabel()], ['👆', '指纹解锁', 'toggleBio()', S.settings.bio && lockOn() ? '已开启' : '未开启'],
    ['🔐', '数据库位置', 'dbSheet()', db.custom ? esc(db.label) : 'App 内部存储']])}
  ${menu([['💾', '备份与恢复', 'backupSheet()', '自动 ' + backupDaysLabel()], ['📤', '导出 Excel (CSV)', 'exportCSV()'],
    ['📥', '导入支付宝 / 微信账单', 'openBill()', 'CSV / xlsx'], ['🗃️', '导入随手记备份', 'kbfPick()', '.kbf'], HAS_OCR && ['📷', '识别账单导入', 'openOcr()', '淘宝/京东/拼多多/抖音']].filter(Boolean))}
  ${menu([['📖', '使用说明', "go('help')"], ['🎨', '收支颜色', 'toggleSwap()', S.settings.swap ? '绿收红支' : '红收绿支'],
    TEST_TOOLS && ['🧪', '重新生成示例数据', "askConfirm('将清空现有数据并生成演示数据，确定吗？',()=>{resetData(true);toast('已生成');tab('home')})"],
    TEST_TOOLS && ['⚡', '压力测试（生成大量数据）', 'stressSheet()'],
    ['🗑️', '清空所有数据', "askConfirm('将删除所有账本、流水和账户，且无法恢复！建议先备份。',()=>{resetData(false);toast('已清空');tab('home')},'清空')"]].filter(Boolean))}
  <div class="ver">洵记 ${esc(appVersion())} · ${NATIVE ? 'AES-256 加密存储' : '本地存储'}</div>`;
};
/** 清空 / 重新生成示例数据。密码属于本机数据库，和恢复备份一样保留（否则库还有密码，界面却显示未设置） */
function resetData(demo) {
  const keep = lockSettings();
  S = initData(demo); Object.assign(S.settings, keep); resetTxnOrder(); save();
}
function toggleSwap() { S.settings.swap = !S.settings.swap; save(); render(); }
