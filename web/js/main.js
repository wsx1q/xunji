'use strict';
/* 启动 */
fsInit();
txSwipeInit();
lpInit();
// 先画出「正在加载」再去读库：读 20 万条要一两秒，期间不要白屏
$('#view').innerHTML = '<div class="boot-ld"><i></i><span>正在加载账本…</span></div>';
let _booted = false;
const bootOnce = () => { if (_booted) return; _booted = true; boot(); };
requestAnimationFrame(() => setTimeout(bootOnce, 0));
setTimeout(bootOnce, 150); // 后台启动时 requestAnimationFrame 可能不触发
