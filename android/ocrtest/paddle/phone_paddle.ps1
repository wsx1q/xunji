# 第 2 步（手机）：Paddle Lite 官方 benchmark_bin 测 FP32 / INT8 模型速度，再用 App 里的 ONNX Runtime 测同样形状，结果写 phone_paddle_result.txt
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot
$android = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$adb = 'D:\dev\android-sdk\platform-tools\adb.exe'
$work = Join-Path $PSScriptRoot 'work'
$logs = Join-Path $PSScriptRoot 'bench_logs'
New-Item -ItemType Directory -Force $work, $logs | Out-Null
$out = Join-Path $PSScriptRoot 'phone_paddle_result.txt'
$log = New-Object System.Collections.Generic.List[string]
function Say($s) { Write-Host $s; $log.Add([string]$s) }
function Save { [System.IO.File]::WriteAllLines($out, $log, (New-Object System.Text.UTF8Encoding($false))) }
function A($a) { $r = cmd /c "`"$adb`" $a 2>&1"; return @($r | ForEach-Object { "$_" }) }
$R = '/data/local/tmp/pl'

Say "=== 1. 手机  $(Get-Date -Format 'HH:mm:ss')"
$ok = $false
for ($i = 0; $i -lt 30; $i++) { if (((A 'get-state') -join '').Trim() -eq 'device') { $ok = $true; break }; Start-Sleep 2 }
if (-not $ok) { Say '  没找到手机：确认数据线已连、USB 调试已开并点了「允许」'; Save; exit 1 }
Say ("  {0} {1}，Android {2}" -f ((A 'shell getprop ro.product.manufacturer') -join ''), ((A 'shell getprop ro.product.model') -join ''), ((A 'shell getprop ro.build.version.release') -join ''))
Save

Say '=== 2. Paddle Lite 2.14-rc 官方测速程序 benchmark_bin（安卓 arm64，约 20MB）'
$bin = Join-Path $work 'benchmark_bin_armv8_clang'
if (-not ((Test-Path $bin) -and (Get-Item $bin).Length -gt 1MB)) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/PaddlePaddle/Paddle-Lite/releases/download/v2.14-rc/benchmark_bin_armv8_clang' -OutFile "$bin.part"
    Move-Item -Force "$bin.part" $bin
  } catch { Say "  下载失败：$($_.Exception.Message)" }
}
if (-not (Test-Path $bin)) { Say "  没有 benchmark_bin。可以用浏览器下载上面的地址，放到 $work 再运行"; Save; exit 1 }
A "shell mkdir -p $R" | Out-Null
A "push `"$bin`" $R/benchmark_bin" | Select-Object -Last 1 | ForEach-Object { Say "  $_" }
A "shell chmod 755 $R/benchmark_bin" | Out-Null
$help = (A "shell $R/benchmark_bin --help") -join "`n"
[System.IO.File]::WriteAllText((Join-Path $logs 'help.txt'), $help, (New-Object System.Text.UTF8Encoding($false)))
$hasThreads = $help -match '-threads'
$hasPower = $help -match '-power_mode'
Say "  支持 --threads: $hasThreads，--power_mode: $hasPower"
Save

Say '=== 3. 传模型'
$models = @(Get-ChildItem -Directory $work | Where-Object { $_.Name -like 'pd_*' -and (Test-Path (Join-Path $_.FullName 'inference.pdmodel')) } | Sort-Object Name)
if ($models.Count -eq 0) { Say '  work 里没有模型：先运行 run_paddle.bat'; Save; exit 1 }
foreach ($m in $models) {
  A "shell mkdir -p $R/$($m.Name)" | Out-Null
  foreach ($f in @('inference.pdmodel', 'inference.pdiparams')) { A "push `"$(Join-Path $m.FullName $f)`" $R/$($m.Name)/$f" | Out-Null }
  Say ("  {0,-22} {1:N1} MB" -f $m.Name, ((Get-Item (Join-Path $m.FullName 'inference.pdiparams')).Length / 1MB))
}
Save

function Bench($tag, $shape, $pm) {
  $opt = "--model_file=$tag/inference.pdmodel --param_file=$tag/inference.pdiparams --input_shape=$shape --warmup=5 --repeats=30 --backend=arm"
  if ($hasThreads) { $opt += ' --threads=4' }
  if ($hasPower -and $pm -ge 0) { $opt += " --power_mode=$pm" }
  $r = A "shell `"cd $R && ./benchmark_bin $opt`""
  $name = "{0}_{1}_pm{2}.txt" -f $tag, ($shape -replace ',', 'x'), $pm
  [System.IO.File]::WriteAllLines((Join-Path $logs $name), [string[]]$r, (New-Object System.Text.UTF8Encoding($false)))
  $avg = $r | Where-Object { $_ -match '^\s*avg\s*[=:]\s*([\d.]+)' } | Select-Object -First 1
  $init = $r | Where-Object { $_ -match '^\s*init\s*[=:]\s*([\d.]+)' } | Select-Object -First 1
  if ($avg -match '([\d.]+)\s*$') {
    $a = $matches[1]
    $i = if ($init -match '([\d.]+)\s*$') { $matches[1] } else { '?' }
    Say ("  RESULT paddle {0,-22} {1,-12} power_mode={2}  avg {3} ms   (首次加载+优化 {4} ms)" -f $tag, $shape, $pm, $a, $i)
  } else {
    Say ("  FAIL   paddle {0,-22} {1,-12} 没跑出来，日志 bench_logs\{2}" -f $tag, $shape, $name)
    $r | Where-Object { $_ -match 'rror|ail|heck|not supported|abort' } | Select-Object -First 4 | ForEach-Object { Say "         $_" }
  }
}

Say "=== 4. Paddle Lite 测速（4 线程；power_mode 0=绑大核，3=不绑核，和 ONNX Runtime 一样）  $(Get-Date -Format 'HH:mm:ss')"
foreach ($m in $models) {
  if ($m.Name -like '*det*') { Bench $m.Name '1,3,1632,736' 0; continue }
  foreach ($s in @('1,3,48,320', '6,3,48,320')) {
    Bench $m.Name $s 0
    if ($hasPower) { Bench $m.Name $s 3 }
  }
  Save
}
# benchmark_bin 加载 .pdmodel 时会顺手存一份优化好的 .nb，拉回来以后放进 App 用
$nb = A "shell `"cd $R && ls */*.nb *.nb 2>/dev/null`""
foreach ($f in $nb) { if ($f -match '\.nb$') { $dst = Join-Path $work ($f -replace '/', '_'); A "pull $R/$f `"$dst`"" | Out-Null; Say "  拉回 $f" } }
Save

Say "=== 5. 同样形状用 App 里的 ONNX Runtime 测（需要装了带测速入口的新 OCR 版）  $(Get-Date -Format 'HH:mm:ss')"
$apk = Get-ChildItem (Join-Path (Split-Path -Parent $android) 'dist') -Filter '*-ocr.apk' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($apk) {
  Say "  安装 $($apk.Name)"
  A "install -r `"$($apk.FullName)`"" | Select-Object -Last 1 | ForEach-Object { Say "  $_" }
}
Start-Sleep 10   # 让手机凉一下，减少降频影响
A 'logcat -c' | Out-Null
A 'shell am start -S -n com.xunji.app.ocr/com.xunji.app.MainActivity --es ocrbench v5,v5q,v6' | Out-Null
$got = @()
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep 2
  $got = @(A 'logcat -d -s OCRBENCH:I')
  if (($got -join "`n") -match 'BENCH DONE') { break }
}
$lines = @($got | Where-Object { $_ -match 'BENCH' })
if ($lines.Count -eq 0) { Say '  没收到结果：多半是手机上还是旧版 App，先运行 build_apk.bat 打包，再运行本脚本' }
foreach ($l in $lines) { Say ("  " + ($l -replace '^.*OCRBENCH\s*:\s*', '')) }
Say "=== DONE  $(Get-Date -Format 'HH:mm:ss')"
Save
