# 只测模型加载 / 缓存，把完整输出（含报错）写到 load_test_result.txt
$ErrorActionPreference = 'Continue'
$env:Path = 'D:\dev\jdk17\bin;' + $env:Path
Set-Location $PSScriptRoot
$out = Join-Path $PSScriptRoot 'load_test_result.txt'
$img = (Get-Content imgs.txt)[0]
$c1 = cmd /c "javac -encoding UTF-8 -cp lib\onnxruntime-1.20.0.jar -d out ..\app\src\ocr\java\com\xunji\app\OcrEngine.java OcrTest.java LoadTest.java 2>&1"
$c2 = cmd /c "java -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -cp out;lib\onnxruntime-1.20.0.jar LoadTest ..\app\src\ocr\assets\models `"$img`" 2>&1"
$all = @('=== javac ===') + @($c1) + @("exit $LASTEXITCODE", '=== LoadTest ===') + @($c2) + @('=== DONE ===')
[System.IO.File]::WriteAllLines($out, [string[]]$all, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ($all -join "`n")
