param([switch]$Alias)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$buildArgs = @("$PSScriptRoot\build.py")
if ($Alias) { $buildArgs += '--alias' }
& "$PSScriptRoot\.venv\Scripts\python.exe" @buildArgs
if ($LASTEXITCODE -ne 0) { throw '桌面版打包失败' }
