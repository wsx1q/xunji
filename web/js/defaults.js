'use strict';
/* 默认分类：个人记账分类方案·简洁高效版；新数据使用，既有分类不自动覆盖。 */
const DEFAULT_EXP = [
  ["餐饮", "🍽️", "#FF8A65"],
  ["居住与家用", "🏠", "#7986CB"],
  ["购物", "🛍️", "#F06292"],
  ["交通出行", "🚗", "#4FC3F7"],
  ["医疗健康", "🏥", "#EF5350"],
  ["家庭与人情", "👪", "#E57373"],
  ["休闲娱乐", "🎮", "#BA68C8"],
  ["学习与工作", "📚", "#64B5F6"],
  ["通讯与数字服务", "📱", "#4DB6AC"],
  ["金融与保障", "🏦", "#FFB74D"],
  ["其他支出", "🧾", "#90A4AE"]
];
const DEFAULT_INC = [
  ["工资与劳动收入", "💼", "#FFB300"],
  ["经营与副业收入", "🏪", "#26A69A"],
  ["投资与资产收入", "📈", "#EF5350"],
  ["亲友赠与", "🎁", "#E53935"],
  ["闲置变现", "♻️", "#66BB6A"],
  ["补偿与返还", "↩️", "#5C6BC0"],
  ["其他收入", "💰", "#BDBDBD"]
];
const subList = s => s.split(' ').map(x => { const m = x.match(/^(.+?)(\p{Extended_Pictographic}\uFE0F?)$/u); return m ? [m[1], m[2]] : [x, '']; });
const DEFAULT_SUBS = {
  expense: {
    "餐饮": [["买菜／食材", "🥬"], ["外卖／快餐", "🥡"], ["餐馆／聚餐", "🍲"], ["零食／饮料", "🥤"]],
    "居住与家用": [["房租／房贷利息", "🔑"], ["物业费", "🏢"], ["水电燃气", "💡"], ["家庭维修／装修", "🛠️"], ["家具／家电", "🛋️"], ["清洁／日用品", "🧹"], ["厨房用品", "🍳"], ["家庭杂项", "🧺"]],
    "购物": [["服装鞋帽", "👕"], ["箱包／配饰", "👜"], ["美妆护肤", "💄"], ["数码产品", "💻"], ["其他网购／商品", "📦"]],
    "交通出行": [["公交／地铁", "🚇"], ["打车／网约车", "🚕"], ["火车／飞机／长途交通", "✈️"], ["加油／充电", "⛽"], ["停车／过路费", "🅿️"], ["车辆保养／维修", "🔧"], ["车辆保险／税费", "🛡️"], ["共享单车", "🚲"]],
    "医疗健康": [["看病／检查", "🩺"], ["药品", "💊"], ["住院／治疗", "🛏️"], ["医疗器械", "🌡️"], ["护理／康复", "🩹"], ["体检／口腔／眼科", "🦷"], ["健身／运动", "💪"]],
    "家庭与人情": [["给父母／长辈", "👴"], ["家庭生活费", "🏡"], ["亲友红包／礼金", "🧧"], ["送礼", "🎁"], ["请客／人情聚餐", "🥂"], ["其他家庭支出", "👪"]],
    "休闲娱乐": [["旅游／度假", "🏖️"], ["酒店／住宿", "🏨"], ["电影／演出", "🎬"], ["游戏", "🎮"], ["兴趣爱好", "🎨"], ["运动／户外", "🏕️"], ["其他娱乐", "🎉"]],
    "学习与工作": [["书籍／课程", "📖"], ["培训／考试／证书", "📝"], ["文具／办公用品", "🖊️"], ["工作相关支出", "💼"], ["职业工具／软件", "🧰"]],
    "通讯与数字服务": [["手机话费／流量", "📞"], ["宽带／网络", "🌐"], ["软件／视频／音乐会员", "🎧"], ["云存储／应用服务", "☁️"], ["快递／邮寄", "📮"], ["打印／复印", "🖨️"], ["其他生活服务", "🛎️"]],
    "金融与保障": [["保险保费", "🛡️"], ["银行／支付手续费", "💳"], ["贷款利息", "🏦"], ["投资交易手续费", "📊"], ["税费", "🧾"], ["其他金融费用", "💱"]],
    "其他支出": [["无法归类的临时支出", "📌"], ["特殊支出", "⭐"]]
  },
  income: {
    "工资与劳动收入": [["工资", "💵"], ["加班费", "⏰"], ["奖金／绩效", "🏆"], ["津贴／补贴", "📋"], ["兼职／劳务", "🛠️"], ["其他劳动收入", "🧰"]],
    "经营与副业收入": [["生意／经营所得", "🏪"], ["自由职业", "🖋️"], ["线上业务", "🌐"], ["副业收入", "🚀"], ["其他经营收入", "💼"]],
    "投资与资产收入": [["银行利息", "🏦"], ["理财收益", "📈"], ["基金／股票收益", "📊"], ["房租收入", "🏠"], ["其他资产收益", "💹"]],
    "亲友赠与": [["礼金／红包", "🧧"], ["家庭补贴", "🏡"], ["亲友赠与", "🎁"], ["其他赠与", "💝"]],
    "闲置变现": [["二手物品出售", "📦"], ["卖废品", "♻️"], ["其他闲置变现", "🏷️"]],
    "补偿与返还": [["报销款", "🧾"], ["退款", "↩️"], ["押金退还", "🔐"], ["赔偿／补偿", "⚖️"], ["其他返还款", "🔄"]],
    "其他收入": [["意外收入", "🍀"], ["其他零星收入", "💰"]]
  }
};
const LEGACY_DEFAULT_SUBS = {
  expense: {
    餐饮: '早餐🥐 午餐🍱 晚餐🍲 外卖🛵 夜宵🍢', 交通: '地铁🚇 公交🚌 打车🚕 火车🚄 共享单车🚲', 购物: '网购📦 超市🛒 家电📺 家居🛋️',
    零食: '奶茶🧋 咖啡☕ 零食🍪', 日用: '日用品🧴 洗护🧼 纸品🧻', 住房: '房租🏠 水电燃气💡 物业🏢 房贷🏦', 通讯: '话费📱 宽带🌐',
    娱乐: '电影🎬 游戏🎮 KTV🎤 演出🎭', 服饰: '衣服👕 鞋包👟 配饰💍', 医疗: '药品💊 门诊🏥 体检🩺', 教育: '书籍📚 培训✏️ 学费🎓',
    旅行: '路费✈️ 住宿🏨 门票🎫', 汽车: '加油⛽ 停车🅿️ 保养🔧 保险🛡️ 过路费🛣️', 人情: '红包🧧 礼物🎁 请客🍻'
  },
  income: { 理财: '利息🏦 基金📈 股票💹', 兼职: '外包💻 稿费✍️' }
};
function addDefaultSubs(d, legacy=false) {
  for (const type of ['expense', 'income']) {
    const list = d.categories[type];
    list.forEach(c => { if (!c.pid) c.pid = ''; });
    for (const c of list.filter(x => !x.pid)) {
      const def = (legacy?LEGACY_DEFAULT_SUBS:DEFAULT_SUBS)[type][c.name];
      if (def && !list.some(x => x.pid === c.id)) (Array.isArray(def)?def:subList(def)).forEach(([name, icon]) => list.push({ id: uid(), pid: c.id, name, icon: icon || c.icon, color: c.color }));
    }
  }
}
const WIDGETS = {
  quick: ['🧭', '快捷入口'], periods: ['🗓️', '时间看板（今天 / 本月 / 自定义时间段…）'], budget: ['🎯', '预算进度'], catTop: ['🏷️', '本月支出排行'],
  trend: ['📊', '近 7 日支出'], assets: ['💳', '资产概览'], members: ['👥', '本月成员支出'], recent: ['🧾', '最近记录']
};
/* 识别导入只在 OCR 版里有：离线版（lite）的原生层报告本机 OCR 不可用，界面上就不出现任何识别入口 */
const HAS_OCR = (() => { try { return !!(window.Android && Android.ocrLocalAvailable && Android.ocrLocalAvailable()); } catch (e) { return false; } })();
/* 压力测试等开发用功能：OCR 版、本地 lite Beta 和电脑浏览器调试时显示，正式版不显示 */
const TEST_TOOLS = (() => { try { return !window.Android || !!(Android.testTools && Android.testTools()); } catch (e) { return false; } })();
const QUICK = {
  accounts: ['💳', '账户', "go('accounts')", '#FFF1EA'], budget: ['🎯', '预算', "go('budget')", '#FFF6E0'], report: ['📊', '报表', "tab('report')", '#EAF4FF'],
  list: ['🧾', '流水', "openList('month')", '#EAFBF3'], cats: ['🗂️', '分类', "go('cats')", '#F3EEFF'], books: ['📚', '账本', "go('books')", '#FFEFF4'],
  backup: ['💾', '备份', 'backupSheet()', '#EAF8F8'], transfer: ['🔁', '转账', "startAdd(null,{type:'transfer'})", '#EEF3FF'],
  members: ['👥', '成员', 'manageMembers()', '#FFF3E8'], merchants: ['🏪', '商家', "manageTags('merchant')", '#EEF8F6'], projects: ['📁', '项目', "manageTags('project')", '#FFF6E0'], csv: ['📤', '导出', 'exportCSV()', '#EAF6EE'],
  bill: ['📥', '账单导入', 'openBill()', '#EEF1F5'], ocr: ['📷', '识别导入', 'openOcr()', '#F5EEFF']
};
if (!HAS_OCR) delete QUICK.ocr;
const defaultHome = () => ({
  widgets: ['quick', 'periods', 'budget', 'catTop', 'trend', 'assets', 'members', 'recent'].map(id => ({ id, on: ['quick', 'periods', 'recent'].includes(id) })),
  quick: ['accounts', 'budget', 'report', 'list', 'cats', 'books', 'transfer', 'backup'], recentN: 6,
  boards: ['day', 'week', 'month', 'year'].map(id => ({ id }))
});
function normHome(h) {
  const def = defaultHome();
  if (!h || !Array.isArray(h.widgets)) return def;
  const widgets = h.widgets.filter(w => w && WIDGETS[w.id]);
  def.widgets.forEach(w => { if (!widgets.some(x => x.id === w.id)) widgets.push({ id: w.id, on: false }); });
  const quick = Array.isArray(h.quick) ? h.quick.filter(k => QUICK[k]) : def.quick;
  const boards = Array.isArray(h.boards) ? h.boards.filter(b => b && (BOARDS[b.id] || b.custom)).map(b => b.custom ? normBoard(b) : b) : def.boards;
  return { widgets, quick, recentN: +h.recentN || def.recentN, boards };
}
/* 时间看板：内置时间段 + 自定义看板（见 normBoard，数组类条件为空表示不限） */
const BOARDS = {
  day: { name: '今天', icon: () => new Date().getDate(), cls: 'day', range: () => periodRange('day'), open: "openList('day')" },
  yesterday: { name: '昨天', icon: '昨', cls: 'day', range: () => periodRange('day', Date.now() - 864e5), open: "openList('day');L.ref=Date.now()-864e5;render()" },
  week: { name: '本周', icon: '周', cls: 'week', range: () => periodRange('week'), open: "openList('week')" },
  month: { name: '本月', icon: () => new Date().getMonth() + 1, cls: 'month', range: () => periodRange('month'), open: "openList('month')" },
  lastMonth: { name: '上月', icon: '上', cls: 'month', range: () => periodRange('month', shiftRef('month', Date.now(), -1)), open: "openList('month');L.ref=shiftRef('month',Date.now(),-1);render()" },
  year: { name: '本年', icon: '年', cls: 'year', range: () => periodRange('year'), open: "openList('year')" },
  lastYear: { name: '去年', icon: '去', cls: 'year', range: () => periodRange('year', shiftRef('year', Date.now(), -1)), open: "openList('year');L.ref=shiftRef('year',Date.now(),-1);render()" },
  all: { name: '全部时间', icon: '全', cls: 'all', range: () => [0, Infinity], open: "openList('all')" }
};
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const cnDate = t => { const d = new Date(t); return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`; };
const matchTx = (t, member, note) => (!member || (t.member || '本人') === member) && (!note || hasText(t.note, note.toLowerCase()));
const TX_TYPES = { all: '全部', expense: '支出', income: '收入', transfer: '转账', adjust: '余额变更' };
const normBoard = b => ({
  id: b.id || '', custom: true, name: b.name || '', type: TX_TYPES[b.type] ? b.type : 'all', start: b.start || '', end: b.end || '',
  cats: Array.isArray(b.cats) ? b.cats : [], accs: Array.isArray(b.accs) ? b.accs : [],
  min: b.min === 0 || b.min ? b.min : '', max: b.max === 0 || b.max ? b.max : '',
  members: Array.isArray(b.members) ? b.members : b.member ? [b.member] : [], note: b.note || '', goal: +b.goal || 0,
  merchants: Array.isArray(b.merchants) ? b.merchants : [], projects: Array.isArray(b.projects) ? b.projects : []
});
const namesText = arr => !arr.length ? '全部' : arr.length <= 2 ? arr.join('、') : `${arr.slice(0, 2).join('、')} 等${arr.length}个`;
function boardRange(b) { return [b.start ? parseYmd(b.start) : 0, b.end ? parseYmd(b.end) + 864e5 : Infinity]; }
function whenText(b) {
  const [s, e] = boardRange(b);
  return b.start && b.end ? `${cnDate(s)} - ${cnDate(e - 864e5)}` : b.start ? `${cnDate(s)}以后` : b.end ? `${cnDate(e - 864e5)}以前` : '全部时间';
}
// 「小于 0」「大于 0」用 max = -0.01 / min = 0.01 表示（金额都是两位小数）
const amountText = b => b.min === '' && +b.max === -0.01 ? '< 0 元' : +b.min === 0.01 && b.max === '' ? '> 0 元'
  : b.min !== '' && b.max !== '' ? `${b.min} - ${b.max} 元` : b.min !== '' ? `≥ ${b.min} 元` : b.max !== '' ? `≤ ${b.max} 元` : '';
function boardMatch(b) {
  const min = b.min === '' ? -Infinity : +b.min, max = b.max === '' ? Infinity : +b.max;
  // 选了上级账户就包含它的子账户（钱一般都记在子账户里，如 微信 → 零钱 / 零钱通）
  const note = (b.note || '').toLowerCase(); // 备注关键词不分大小写
  const accs = new Set(b.accs.flatMap(id => [id, ...S.accounts.filter(a => a.pid === id).map(a => a.id)]));
  return t => (b.type === 'all' || t.type === b.type)
    && (!b.cats.length || (t.type !== 'transfer' && t.type !== 'adjust' && b.cats.some(id => inCat(t.catId, id))))
    && (!accs.size || accs.has(t.accountId) || accs.has(t.toAccountId))
    && t.amount >= min && t.amount <= max
    && (!b.members.length || b.members.includes(t.member || '本人'))
    && (!b.merchants.length || b.merchants.includes(t.merchant || ''))
    && (!b.projects.length || b.projects.includes(t.project || ''))
    && (!note || hasText(t.note, note));
}
function boardOf(b) {
  if (b.custom) {
    const [s, e] = boardRange(b);
    const sub = [whenText(b), b.type !== 'all' && TX_TYPES[b.type], b.cats.length && '🗂️' + namesText(b.cats.map(id => catById(id).name)),
      b.accs.length && '💳' + namesText(b.accs.map(accName)), amountText(b), b.merchants.length && '🏪' + namesText(b.merchants.map(m => m || '无商家')), b.projects.length && '📁' + namesText(b.projects.map(m => m || '无项目')),
      b.members.length && '👤' + namesText(b.members), b.note && `备注含“${b.note}”`].filter(Boolean).join(' · ');
    return { name: b.name, icon: b.projects.length ? '📁' : b.members.length ? '👤' : b.merchants.length ? '🏪' : b.note ? '📝' : '⏱', cls: 'custom', s, e, sub, open: `openBoard('${b.id}')`, match: boardMatch(b) };
  }
  const B = BOARDS[b.id], [s, e] = B.range(), y = new Date().getFullYear();
  const sub = b.id === 'all' ? '全部时间' : /year/i.test(b.id) ? `${new Date(s).getFullYear()}年`
    : /day|yesterday/.test(b.id) ? `${md(s)} 周${WEEK[new Date(s).getDay()]}`
    : `${new Date(s).getFullYear() === y ? '' : new Date(s).getFullYear() + '年'}${md(s)} - ${md(e - 864e5)}`;
  return { name: B.name, icon: typeof B.icon === 'function' ? B.icon() : B.icon, cls: B.cls, s, e, sub, open: B.open, match: () => true };
}
const ACC_TYPES = {
  cash:{name:'现金',icon:'💵'}, debit:{name:'银行卡',icon:'🏦'}, online:{name:'微信／支付宝',icon:'📲'},
  invest:{name:'投资理财',icon:'📈'}, receivable:{name:'应收款',icon:'🤝'}, payable:{name:'应付款',icon:'💳'}, other:{name:'其他资产／负债',icon:'📦'}
};
// Read compatibility for old backups/importers; new account choices use the seven groups above.
Object.defineProperties(ACC_TYPES,{credit:{value:{name:'信用卡',icon:'💳'}},debt:{value:{name:'应收应付（旧账户）',icon:'🤝'}}});
const EMOJIS = [...new Set('🍚🍜🍔🍕🍰🧋☕🍺🍎🥬🛒🛍️👕👟💄🧴🏠💡💧🔥📱💻🎮🎬🎤🎵📚✏️🎓🚇🚌🚕🚗⛽✈️🏨🏃⚽🏸💊🏥🐱🐶👶🎁🧧💰💼📈🏆🧾↩️💳🔧🧹🌹🚬🎂📦'.match(/\p{Extended_Pictographic}\uFE0F?/gu).concat(DEFAULT_EXP.map(c=>c[1]),DEFAULT_INC.map(c=>c[1]),Object.values(DEFAULT_SUBS.expense).flat().map(c=>c[1]),Object.values(DEFAULT_SUBS.income).flat().map(c=>c[1])))];
const COLORS = ['#FF8A65', '#FFB74D', '#FFCA28', '#9CCC65', '#4DB6AC', '#4FC3F7', '#64B5F6', '#7986CB', '#BA68C8', '#F06292', '#E57373', '#A1887F', '#90A4AE', '#BDBDBD'];
const BOOK_ICONS = ['📒', '🏠', '✈️', '💼', '🎓', '🚗', '👶', '🎉', '💒', '🏪'];

const DEFAULT_MERCHANTS = ['美团', '肯德基', '食堂', '淘宝', '京东', '拼多多', '超市', '菜市场'];
const DEFAULT_PROJECTS = ['装修', '旅行', '孩子教育'];
const SEED_MERCHANTS = { 餐饮: ['美团', '肯德基', '食堂', '', ''], 水果: ['超市', '菜市场'], 蔬菜: ['菜市场', '超市'], 日用: ['超市', '淘宝'] };
/* 成员 / 商家 / 项目：记账时可选的标签，名单存在 S[list] 中 */
const TAGS = {
  member: { list: 'members', name: '成员', icon: '👤', def: '本人' },
  merchant: { list: 'merchants', name: '商家', icon: '🏪', def: '' },
  project: { list: 'projects', name: '项目', icon: '📁', def: '' }
};
function initData(demo) {
  const bookId = uid();
  const mk = ([name, icon, color]) => ({ id: uid(), pid: '', name, icon, color });
  const acc = (name, type, init) => ({ id: uid(), name, type, init });
  const d = {
    v: 2,
    books: [{ id: bookId, name: '日常账本', icon: '📒' }],
    curBook: bookId,
    categories: { expense: DEFAULT_EXP.map(mk), income: DEFAULT_INC.map(mk) },
    // 新账本建立七类零余额账户；示例账户名称保留供 seed 使用。
    accounts: demo
      ? [acc('现金', 'cash', 1500), acc('招商银行', 'debit', 28000), acc('支付宝', 'online', 3000), acc('微信', 'online', 1200), acc('信用卡', 'credit', 0)]
      : Object.entries(ACC_TYPES).map(([type,v])=>acc(v.name,type,0)),
    txns: [],
    budgets: { [bookId]: { total: demo ? 8000 : 0, cats: {} } },
    members: ['本人', '配偶', '孩子', '父母'],
    merchants: [...DEFAULT_MERCHANTS], projects: [...DEFAULT_PROJECTS],
    settings: { pin: '', bio: false, swap: false, lastAcc: '', last: {}, recentCats: { expense: [], income: [] }, backupDays: 1, home: defaultHome() }
  };
  addDefaultSubs(d);
  if (demo) seed(d);
  return d;
}

function seed(d) {
  const B = d.curBook, E = d.categories.expense, I = d.categories.income;
  const names={交通:'交通出行',零食:'零食／饮料',水果:'买菜／食材',蔬菜:'买菜／食材',日用:'清洁／日用品',娱乐:'休闲娱乐',服饰:'服装鞋帽',医疗:'医疗健康',运动:'运动／户外',人情:'家庭与人情',住房:'居住与家用',通讯:'通讯与数字服务',兼职:'兼职／劳务',红包:'亲友赠与',理财:'投资与资产收入',报销:'报销款'};
  const cat = (n,type) => {const name=names[n]||n;return d.categories[type].find(c=>c.name===name);};
  const acc = n => d.accounts.find(a => a.name === n).id;
  const rnd = (a, b) => r2(a + Math.random() * (b - a));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const now = Date.now();
  const all = [...E, ...I];
  const add = (type, amount, catName, accName, t, note = '', to = '') => {
    if (t > now) return;
    let catId = '';
    if (catName) {
      const c = cat(catName,type), id=c.id, subs = c.pid?[]:all.filter(c => c.pid === id);
      const sub = subs.find(c => note&&c.name.includes(note)) || (subs.length ? pick(subs) : null);
      catId = sub ? sub.id : id;
      if (sub && sub.name === note) note = '';
    }
    let merchant = '', project = '';
    if (d.merchants.includes(note)) { merchant = note; note = ''; }
    else if (type === 'expense' && SEED_MERCHANTS[catName]) merchant = pick(SEED_MERCHANTS[catName]);
    if (type === 'expense' && catName !== '住房' && Math.random() < 0.06) project = '旅行';
    d.txns.push({ id: uid(), bookId: B, type, amount: r2(amount), catId, accountId: acc(accName), toAccountId: to ? acc(to) : '', time: t, note, merchant, project,
      member: type === 'expense' ? pick(['本人', '本人', '本人', '配偶', '孩子']) : '本人' });
  };
  const daily = [
    ['餐饮', 12, 48, ['早餐', '午餐', '晚餐', '外卖', '食堂', '火锅'], 10], ['交通', 3, 28, ['地铁', '公交', '打车', '共享单车'], 6],
    ['零食', 6, 32, ['奶茶', '咖啡', '零食'], 4], ['水果', 10, 45, ['水果'], 2], ['蔬菜', 8, 40, ['买菜'], 2],
    ['日用', 8, 90, ['日用品', '洗护'], 2], ['购物', 30, 420, ['淘宝', '京东', '拼多多'], 1.6], ['娱乐', 30, 220, ['电影', 'KTV', '游戏'], 0.8],
    ['服饰', 80, 500, ['衣服', '鞋包'], 0.4], ['医疗', 20, 260, ['药品'], 0.3], ['运动', 20, 150, ['健身', '羽毛球'], 0.5], ['人情', 200, 800, ['红包', '礼物'], 0.15]
  ];
  const wsum = daily.reduce((a, x) => a + x[4], 0);
  const wpick = () => { let r = Math.random() * wsum; for (const x of daily) { if ((r -= x[4]) < 0) return x; } return daily[0]; };
  const today = new Date();
  for (let i = 150; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const base = day.getTime();
    const n = 1 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const c = wpick();
      add('expense', rnd(c[1], c[2]), c[0], pick(['支付宝', '微信', '微信', '信用卡', '现金']), base + (7 + Math.random() * 15) * 36e5, pick(c[3]));
    }
    const dd = day.getDate();
    if (dd === 1) add('expense', 3500, '住房', '招商银行', base + 9 * 36e5, '房租');
    if (dd === 12) add('expense', 59, '通讯', '支付宝', base + 10 * 36e5, '话费');
    if (dd === 5) {
      add('income', 12000 + rnd(0, 800), '工资', '招商银行', base + 10 * 36e5, '月工资');
      add('transfer', 2000, null, '招商银行', base + 11 * 36e5, '转入零钱', '微信');
      add('transfer', 1500, null, '招商银行', base + 11.2 * 36e5, '转入余额', '支付宝');
    }
    if (dd === 20) add('transfer', 2500, null, '招商银行', base + 20 * 36e5, '信用卡还款', '信用卡');
    if (Math.random() < 0.05) add('income', rnd(50, 600), pick(['兼职', '红包', '理财', '报销']), '支付宝', base + 15 * 36e5, '');
  }
}
