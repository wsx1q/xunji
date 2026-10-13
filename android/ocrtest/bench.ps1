# Speed/accuracy experiment: .\bench.ps1 <outdir> <v6|v5> [det model] [rec model] [det short side] [threads]
# Extra JVM options via $env:JOPTS, e.g. "-DrecMinW=96 -DrecBatch=12"
param([string]$Out, [string]$Ver = 'v6', [string]$Det = '', [string]$Rec = '', [int]$DetShort = 0, [int]$Threads = 4)
$ErrorActionPreference = 'Stop'
$env:Path = 'D:\dev\jdk17\bin;' + $env:Path
Set-Location $PSScriptRoot
$imgs = Get-Content imgs.txt
New-Item -ItemType Directory -Force $Out | Out-Null
$props = @("-DdetShort=$DetShort")
if ($Det) { $props += "-Ddet=$Det" }
if ($Rec) { $props += "-Drec=$Rec" }
if ($env:JOPTS) { $props += $env:JOPTS -split ' ' }
$log = & java @props -cp "out;lib\onnxruntime-1.20.0.jar" OcrTest ..\app\src\ocr\assets\models $Ver $Threads $Out @imgs 2>&1 | ForEach-Object { "$_" }
$d = 0; $r = 0; $n = 0
foreach ($l in $log) { if ($l -match 'det (\d+) ms, rec (\d+)') { $d += [int]$matches[1]; $r += [int]$matches[2]; $n++ } }
$log | Where-Object { $_ -notmatch 'boxes' }
"$Out : $n images, avg det $([int]($d / $n)) ms, rec $([int]($r / $n)) ms, total $([int](($d + $r) / $n)) ms"
