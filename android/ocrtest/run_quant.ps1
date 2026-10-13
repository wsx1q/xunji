# v5 识别模型静态 INT8 量化 + 准确率对比，结果写到 quant_result.txt
$ErrorActionPreference = 'Continue'
$env:PYTHONIOENCODING = 'utf-8'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:Path = 'D:\dev\jdk17\bin;' + $env:Path
Set-Location $PSScriptRoot
$out = Join-Path $PSScriptRoot 'quant_result2.txt'
$log = New-Object System.Collections.Generic.List[string]
function Say($s) { Write-Host $s; $log.Add([string]$s) }
function Save { [System.IO.File]::WriteAllLines($out, $log, (New-Object System.Text.UTF8Encoding($false))) }
$py = (Join-Path $PSScriptRoot '..\..\ocr\.venv-rapid\Scripts\python.exe')
Say "python: $py"
Say '--- 1. 量化 + 逐行对比'
cmd /c "`"$py`" quant_static.py conv_minmax conv_pct 2>&1" | ForEach-Object { Say "$_" }
Save
# 2. 用 Java 引擎跑完整流程（v5 检测736 补白160 + 量化识别模型），和原 v5 结果比解析
$imgArgs = ((Get-Content imgs.txt) | ForEach-Object { "`"$_`"" }) -join ' '
$cp = 'out;lib\onnxruntime-1.20.0.jar'
foreach ($tag in @('conv_minmax', 'conv_pct')) {
  $dir = "bx_v5q_$tag"
  New-Item -ItemType Directory -Force $dir | Out-Null
  Say "--- 2. Java 全流程：$dir"
  $rec = "..\..\..\..\..\ocrtest\q_static\v5_rec_qdq_$tag"
  $lines = cmd /c "java -DdetShort=736 -DrecMinW=160 -DrecBatch=6 -DrecPar=2 -Drec=$rec -cp `"$cp`" OcrTest ..\app\src\ocr\assets\models v5 4 $dir $imgArgs 2>&1"
  $d = 0; $r = 0; $n = 0
  foreach ($l in $lines) {
    if ($l -match 'det (\d+) ms, rec (\d+)') { $d += [int]$matches[1]; $r += [int]$matches[2]; $n++ }
    elseif ($l -match '^load |Exception|Error') { Say "  $l" }
  }
  if ($n -gt 0) { Say ("  RESULT {0}: {1} 张，平均 检测 {2} ms + 识别 {3} ms" -f $dir, $n, [int]($d / $n), [int]($r / $n)) }
  $env:LOOSE = ''
  cmd /c "`"$py`" diff.py bx_v5_736 $dir 2>&1" | Select-Object -Last 1 | ForEach-Object { Say "  [严格，和原v5比] $_" }
  $env:LOOSE = '1'
  cmd /c "`"$py`" diff.py bx_v5_736 $dir 2>&1" | Select-Object -Last 1 | ForEach-Object { Say "  [只比金额，和原v5比] $_" }
  cmd /c "`"$py`" diff.py bx_ref $dir 2>&1" | Select-Object -Last 1 | ForEach-Object { Say "  [只比金额，和v6参考比] $_" }
  $env:LOOSE = ''
  Save
}
Say '=== DONE ==='
Save
