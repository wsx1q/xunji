# 抓手机上 App 的页面报错（WebView 控制台日志），写到 phone_log.txt
$adb = 'D:\dev\android-sdk\platform-tools\adb.exe'
Set-Location $PSScriptRoot
$out = Join-Path $PSScriptRoot 'phone_log.txt'
$lines = cmd /c "`"$adb`" logcat -d -v time 2>&1" | Where-Object { $_ -match 'chromium|Console|Uncaught|xunji|AndroidRuntime' } | Select-Object -Last 300
[System.IO.File]::WriteAllLines($out, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "已写入 $out（$($lines.Count) 行）"
