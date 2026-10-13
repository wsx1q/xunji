# OCR 速度 / 准确率对比测试。双击 run_ocr_bench.bat 运行，结果写到 ocr_bench_result.txt
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'
$env:JAVA_HOME = 'D:\dev\jdk17'
$env:Path = 'D:\dev\jdk17\bin;' + $env:Path
Set-Location $PSScriptRoot
$py = (Join-Path $PSScriptRoot '..\..\ocr\.venv-rapid\Scripts\python.exe')
$models = '..\app\src\ocr\assets\models'
$cp = 'out;lib\onnxruntime-1.20.0.jar'
$result = Join-Path $PSScriptRoot 'ocr_bench_result.txt'
$log = New-Object System.Collections.Generic.List[string]
function Say($s) { Write-Host $s; $log.Add([string]$s) }
function Save { [System.IO.File]::WriteAllLines($result, $log, (New-Object System.Text.UTF8Encoding($false))) }
# 用 cmd 跑外部程序，避免 PowerShell 5.1 把 stderr 的普通警告当错误
function Run($cmdline) { $out = cmd /c "$cmdline 2>&1"; return @($out | ForEach-Object { "$_" }) }

Say "=== OCR bench $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Say "CPU: $((Get-CimInstance Win32_Processor | Select-Object -First 1).Name)"

# 1. 编译（用当前的 OcrEngine.java）
Say '--- 编译'
$o = Run "javac -encoding UTF-8 -cp lib\onnxruntime-1.20.0.jar -d out ..\app\src\ocr\java\com\xunji\app\OcrEngine.java OcrTest.java LoadTest.java"
$o | ForEach-Object { Say $_ }
if ($LASTEXITCODE -ne 0) { Say 'COMPILE_FAIL'; Save; exit 1 }

# 2. 模型加载 / 缓存测试
Say '--- 模型加载'
$img0 = (Get-Content imgs.txt)[0]
Run "java -cp `"$cp`" LoadTest $models `"$img0`"" | Where-Object { $_ -match '^LOAD|^  ' } | ForEach-Object { Say $_ }
Save

# 3. 各组合
$imgs = (Get-Content imgs.txt) | ForEach-Object { "`"$_`"" }
$imgArgs = $imgs -join ' '
$configs = @(
  @{ n = 'bx_ref';      v = 'v6'; det = 0;   recW = 320; batch = 6;  par = 1; note = '参考：v6 原图 补白320（最准、最慢）' },
  @{ n = 'bx_v6_736';   v = 'v6'; det = 736; recW = 160; batch = 6;  par = 2; note = 'v6 检测736 补白160' },
  @{ n = 'bx_v6_640';   v = 'v6'; det = 640; recW = 160; batch = 6;  par = 2; note = 'v6 检测640 补白160' },
  @{ n = 'bx_v5_full';  v = 'v5'; det = 0;   recW = 320; batch = 6;  par = 1; note = 'v5 原图 补白320' },
  @{ n = 'bx_v5_736';   v = 'v5'; det = 736; recW = 160; batch = 6;  par = 2; note = 'v5 检测736 补白160（你手机现在的设置）' },
  @{ n = 'bx_v5_640';   v = 'v5'; det = 640; recW = 160; batch = 6;  par = 2; note = 'v5 检测640 补白160' },
  @{ n = 'bx_v5_544';   v = 'v5'; det = 544; recW = 160; batch = 6;  par = 2; note = 'v5 检测544 补白160' },
  @{ n = 'bx_v5_736w96';v = 'v5'; det = 736; recW = 96;  batch = 6;  par = 2; note = 'v5 检测736 补白96' },
  @{ n = 'bx_v5_736b12';v = 'v5'; det = 736; recW = 160; batch = 12; par = 2; note = 'v5 检测736 补白160 批量12' }
)
foreach ($c in $configs) {
  New-Item -ItemType Directory -Force $c.n | Out-Null
  Say "--- $($c.n)：$($c.note)"
  $props = "-DdetShort=$($c.det) -DrecMinW=$($c.recW) -DrecBatch=$($c.batch) -DrecPar=$($c.par)"
  $lines = Run "java $props -cp `"$cp`" OcrTest $models $($c.v) 4 $($c.n) $imgArgs"
  $d = 0; $r = 0; $n = 0
  foreach ($l in $lines) {
    if ($l -match 'det (\d+) ms, rec (\d+)') { $d += [int]$matches[1]; $r += [int]$matches[2]; $n++ }
    elseif ($l -match '^load ') { Say "  $l" }
    elseif ($l -match 'Exception|Error') { Say "  $l" }
  }
  if ($n -gt 0) { Say ("  RESULT {0}: {1} 张，平均 检测 {2} ms + 识别 {3} ms = {4} ms" -f $c.n, $n, [int]($d / $n), [int]($r / $n), [int](($d + $r) / $n)) }
  if ($c.n -ne 'bx_ref') {
    $env:LOOSE = ''
    Run "`"$py`" diff.py bx_ref $($c.n)" | ForEach-Object { Say "  [严格] $_" }
    $env:LOOSE = '1'
    Run "`"$py`" diff.py bx_ref $($c.n)" | Select-Object -Last 1 | ForEach-Object { Say "  [只比金额] $_" }
    $env:LOOSE = ''
  }
  Save
}
Say '=== DONE ==='
Save
