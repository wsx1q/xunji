# 打包离线版 + OCR 版，按 dist 里的命名复制过去；日志写到 build_apk.log
# 加 -Emu：只打 OCR 版，额外带 x86_64 运行库，给 MuMu 等 x86 模拟器原生运行（不加时模拟器要把 ARM 代码翻译执行，慢很多）
# 加 -Beta：只打不带 OCR 的本地 Beta，开启压力测试等原有开发工具
param([switch]$Emu, [switch]$Beta)
$ErrorActionPreference = 'Stop'
if ($Emu -and $Beta) { throw '-Emu 和 -Beta 不能同时使用' }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $root 'build_apk.log'
$dist = Join-Path (Split-Path -Parent $root) 'dist'
Start-Transcript -Path $log -Force | Out-Null
try {
  $env:JAVA_HOME = 'D:\dev\jdk17'
  $env:Path = "D:\dev\jdk17\bin;D:\dev\gradle-8.7\bin;$env:Path"
  Set-Location $root
  # 交给 cmd 跑：PowerShell 5.1 会把 javac 写到 stderr 的普通警告（"使用了已过时的 API"）当成错误中断
  $tasks = if ($Beta) { '-PliteBeta assembleLiteRelease' } elseif ($Emu) { '-Pemu assembleOcrRelease' } else { 'assembleLiteRelease assembleOcrRelease' }
  cmd /c "gradle.bat --no-daemon $tasks 2>&1" | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "gradle 失败，退出码 $LASTEXITCODE" }
  $out = Join-Path $root 'app\build\outputs\apk'
  $meta = if ($Emu) { 'ocr\release\output-metadata.json' } else { 'lite\release\output-metadata.json' }
  $ver = (Get-Content (Join-Path $out $meta) -Raw | ConvertFrom-Json).elements[0].versionName -replace '-ocr$', ''
  if ($Beta) {
    $betaApk = Join-Path $dist ("xunji-{0}.apk" -f $ver)
    Copy-Item (Join-Path $out 'lite\release\app-lite-release.apk') $betaApk -Force
    & (Join-Path $root 'prune_apk.ps1') -Keep 2
    Write-Host "BUILD_OK $ver (lite beta)"
    Get-Item $betaApk | ForEach-Object { Write-Host ("{0}  {1:N0} bytes" -f $_.Name, $_.Length) }
    return
  }
  if ($Emu) {
    $emuApk = Join-Path $dist ("xunji-ocr-{0}-emu.apk" -f $ver)
    Copy-Item (Join-Path $out 'ocr\release\app-ocr-release.apk') $emuApk -Force
    & (Join-Path $root 'prune_apk.ps1') -Keep 2
    Write-Host "BUILD_OK $ver (emu)"
    Get-Item $emuApk | ForEach-Object { Write-Host ("{0}  {1:N0} bytes" -f $_.Name, $_.Length) }
    return
  }
  $lite = Join-Path $dist ("xunji-{0}.apk" -f $ver)
  $ocr = Join-Path $dist ("xunji-ocr-{0}.apk" -f $ver)
  Copy-Item (Join-Path $out 'lite\release\app-lite-release.apk') $lite -Force
  Copy-Item (Join-Path $out 'lite\release\app-lite-release.apk') (Join-Path $dist '洵记_latest.apk') -Force
  Copy-Item (Join-Path $out 'ocr\release\app-ocr-release.apk') $ocr -Force
  & (Join-Path $root 'prune_apk.ps1') -Keep 2
  Write-Host "BUILD_OK $ver"
  Get-Item $lite, $ocr | ForEach-Object { Write-Host ("{0}  {1:N0} bytes" -f $_.Name, $_.Length) }
} catch {
  Write-Host "BUILD_FAIL $_"
} finally {
  Stop-Transcript | Out-Null
}
