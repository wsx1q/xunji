'use strict';
/* 基础工具：选择器、转义、金额 / 日期格式化、时间段计算 */
const KEY = 'xj_offline_v1';
const $ = (s, el = document) => el.querySelector(s);
let _n = 0;
const uid = () => Date.now().toString(36) + (_n++).toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, dec = 2) => {
  n = Number(n) || 0;
  const s = Math.abs(n).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + s;
};
const r2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const WEEK = '日一二三四五六';
const sod = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const md = t => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日`; };

function periodRange(kind, ref = Date.now()) {
  const d = new Date(ref), y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
  let s, e;
  if (kind === 'day') { s = new Date(y, m, dd); e = new Date(y, m, dd + 1); }
  else if (kind === 'week') { const w = (d.getDay() + 6) % 7; s = new Date(y, m, dd - w); e = new Date(y, m, dd - w + 7); }
  else if (kind === 'month') { s = new Date(y, m, 1); e = new Date(y, m + 1, 1); }
  else if (kind === 'year') { s = new Date(y, 0, 1); e = new Date(y + 1, 0, 1); }
  else return [0, Infinity];
  return [s.getTime(), e.getTime()];
}
function shiftRef(kind, ref, dir) {
  const d = new Date(ref);
  if (kind === 'day') d.setDate(d.getDate() + dir);
  else if (kind === 'week') d.setDate(d.getDate() + 7 * dir);
  else if (kind === 'month') { d.setDate(1); d.setMonth(d.getMonth() + dir); }
  else if (kind === 'year') d.setFullYear(d.getFullYear() + dir);
  return d.getTime();
}
function periodLabel(kind, ref) {
  const d = new Date(ref);
  if (kind === 'day') return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`;
  if (kind === 'week') { const [s, e] = periodRange('week', ref); const e1 = e - 864e5; return `${md(s)} - ${md(e1)}`; }
  if (kind === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  if (kind === 'year') return `${d.getFullYear()}年`;
  return '全部时间';
}
const isFuture = (kind, ref) => kind !== 'all' && periodRange(kind, shiftRef(kind, ref, 1))[0] > Date.now();
