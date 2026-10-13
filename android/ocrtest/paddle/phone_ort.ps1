# 只做：装最新 OCR 版 APK -> 用 App 里的 ONNX Runtime 测速（和 Paddle Lite 同形状），结果追加写 phone_ort_result.txt
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot
$jizhang = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$adb = 'D:\dev\android-sdk\platform-tools\adb.exe'
$out = Join-Path $PSScriptRoot 'phone_ort_result.txt'
$log = New-Object System.Collections.Generic.List[string]
function Say($s) { Write-Host $s; $log.Add([string]$s) }
function Save { [System.IO.File]::WriteAllLines($out, $log, (New-Object System.Text.UTF8Encoding($false))) }
function A($a) { $r = cmd /c "`"$adb`" $a 2>&1"; return @($r | ForEach-Object { "$_" }) }

Say "=== 1. 手机  $(Get-Date -Format 'HH:mm:ss')"
$ok = $false
for ($i = 0; $i -lt 30; $i++) { if (((A 'get-state') -join '').Trim() -eq 'device') { $ok = $true; break }; Start-Sleep 2 }
if (-not $ok) { Say '  没找到手机：确认数据线已连、USB 调试已开并点了「允许」'; Save; exit 1 }

Say '=== 2. 安装最新 OCR 版'
$apk = Get-ChildItem (Join-Path $jizhang 'dist') -Filter '*-ocr.apk' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { Say "  $jizhang\dist 里没有 *-ocr.apk，先运行 build_apk.bat"; Save; exit 1 }
Say ("  {0}  {1:N1} MB  打包时间 {2}" -f $apk.Name, ($apk.Length / 1MB), $apk.LastWriteTime)
Write-Host ''
Write-Host '  >>> 请看手机屏幕：如果弹出「是否允许安装」或要输入 vivo 账号密码，点允许/继续安装 <<<' -ForegroundColor Yellow
Write-Host ''
$mark = Join-Path $PSScriptRoot 'installed_apk.txt'
$sig = "$($apk.Name)|$($apk.Length)|$($apk.LastWriteTime.Ticks)"
if ((Test-Path $mark) -and ((Get-Content $mark -Raw).Trim() -eq $sig)) {
  Say '  手机上已经是这个包，跳过安装'
} else {
  A 'shell input keyevent KEYCODE_WAKEUP' | Out-Null
  $r = A "install -r -t `"$($apk.FullName)`""
  $r | Select-Object -Last 2 | ForEach-Object { Say "  $_" }
  if (($r -join ' ') -notmatch 'Success') { Say '  安装没成功（上面是原因）。如果是手机上点了取消，重新运行本脚本即可'; Save; exit 1 }
  Set-Content $mark $sig
}
Save

Say "=== 3. ONNX Runtime 测速（PP-OCRv5 极速，2 线程：识别 1x3x48x160 / 1x3x48x320，检测 1x3x1440x640）  $(Get-Date -Format 'HH:mm:ss')"
$f = '/sdcard/Android/data/com.xunji.app.ocr/files/ocrbench.txt'
A "shell rm -f $f" | Out-Null
Start-Sleep 3
A 'shell am start -S -n com.xunji.app.ocr/com.xunji.app.MainActivity --es ocrbench v5f' | ForEach-Object { if ($_ -match 'Error|Warning') { Say "  $_" } }
$shown = 0; $done = $false
for ($i = 0; $i -lt 150 -and -not $done; $i++) {
  Start-Sleep 2
  $lines = @(A "shell cat $f" | Where-Object { $_ -match '^BENCH' })
  for ($k = $shown; $k -lt $lines.Count; $k++) { Say ("  [{0,3}s] {1}" -f (($i + 1) * 2), $lines[$k]); if ($lines[$k] -match 'BENCH DONE') { $done = $true } }
  $shown = $lines.Count
  if ($i -eq 15 -and $shown -eq 0) {
    Say '  30 秒还没开始：测速入口没触发。可能手机上还是旧版 App，或 App 被系统拦了后台启动'
    A 'logcat -d -s OCRBENCH:W AndroidRuntime:E' | Select-Object -Last 8 | ForEach-Object { Say "    $_" }
  }
  Save
}
if (-not $done) { Say '  超时没跑完（5 分钟）' }
Say "=== DONE  $(Get-Date -Format 'HH:mm:ss')"
Save
