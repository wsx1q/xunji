# 量化「已并入仿射」的 v5 识别模型，结果写 quant_fold_result.txt
$ErrorActionPreference = 'Continue'
$env:PYTHONIOENCODING = 'utf-8'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot
$py = (Join-Path $PSScriptRoot '..\..\ocr\.venv-rapid\Scripts\python.exe')
$out = Join-Path $PSScriptRoot 'quant_fold_result.txt'
Write-Host '量化中，大约 1~3 分钟...'
$r = @(cmd /c "`"$py`" -u quant_fold.py 2>&1" | ForEach-Object { $s = "$_"; if ($s -notmatch 'Warning|warn\(') { Write-Host "  $s" }; $s })
[System.IO.File]::WriteAllLines($out, [string[]]$r, (New-Object System.Text.UTF8Encoding($false)))
Write-Host '=== DONE ==='
