# 真手机测试准备：读手机信息、装最新 ARM 版 OCR 包、传测试截图、打开 App。结果写到 phone_test.txt
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$adb = 'D:\dev\android-sdk\platform-tools\adb.exe'
$out = Join-Path $PSScriptRoot 'phone_test.txt'
$log = New-Object System.Collections.Generic.List[string]
function Say($s) { Write-Host $s; $log.Add([string]$s) }
function Save { [System.IO.File]::WriteAllLines($out, $log, (New-Object System.Text.UTF8Encoding($false))) }
function A($a) { $r = cmd /c "`"$adb`" $a 2>&1"; return @($r | ForEach-Object { "$_" }) }

Say '=== 1. 设备'
A 'devices -l' | ForEach-Object { Say "  $_" }
$serial = (A 'get-state') -join ''
if ($serial -notmatch 'device') { Say '  没找到手机：确认数据线已连、手机上已打开 USB 调试并点了「允许」'; Save; exit 1 }
foreach ($p in @('ro.product.manufacturer', 'ro.product.model', 'ro.soc.manufacturer', 'ro.soc.model', 'ro.board.platform', 'ro.build.version.release', 'ro.product.cpu.abilist')) {
  Say ("  {0} = {1}" -f $p, ((A "shell getprop $p") -join ''))
}
Say ("  CPU 核数 = {0}" -f ((A 'shell nproc') -join ''))
$feat = (A 'shell cat /proc/cpuinfo') | Where-Object { $_ -match '^Features' } | Select-Object -First 1
Say "  $feat"
Say ("  int8 加速指令 dotprod(asimddp) = {0}" -f $(if ($feat -match 'asimddp') { '支持' } else { '不支持' }))
$freqs = (A 'shell "for f in /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq; do cat $f; done"') -join ' '
Say "  各核最高频率(kHz) = $freqs"
Save

Say '=== 2. 安装最新 ARM 版 OCR 包'
$apk = Get-ChildItem (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist') -Filter '*-ocr.apk' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Say "  $($apk.Name)  $([math]::Round($apk.Length / 1MB, 1)) MB"
A "install -r `"$($apk.FullName)`"" | Select-Object -Last 3 | ForEach-Object { Say "  $_" }
Save

Say '=== 3. 传测试截图到手机相册 Pictures/ocrtest'
A 'shell mkdir -p /sdcard/Pictures/ocrtest' | Out-Null
foreach ($f in @('douyin_orders.jpg', 'jd_orders.jpg', 'pdd_orders.jpg', 'taobao_orders.jpg')) {
  $src = Join-Path (Split-Path -Parent $PSScriptRoot) "ocr\samples\$f"
  A "push `"$src`" /sdcard/Pictures/ocrtest/$f" | Select-Object -Last 1 | ForEach-Object { Say "  $f : $_" }
  A "shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/ocrtest/$f" | Out-Null
}
Save

Say '=== 4. 打开 App'
A 'shell monkey -p com.xunji.app.ocr -c android.intent.category.LAUNCHER 1' | Select-Object -Last 1 | ForEach-Object { Say "  $_" }
Say '=== DONE ==='
Save
