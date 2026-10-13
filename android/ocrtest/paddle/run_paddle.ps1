# 第 1 步（电脑）：导出 PP-OCRv5_mobile 的 FP32 .pdmodel -> Paddle PTQ 量化成 INT8 -> 在电脑上对比准确率
# 结果写到 paddle_result.txt；第 2 步手机测速用 phone_paddle.bat
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot
$ocrtest = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent (Split-Path -Parent $ocrtest)      # 仓库根目录
$work = Join-Path $PSScriptRoot 'work'
$venv = Join-Path $root 'ocr\.venv-paddle'
$py = Join-Path $venv 'Scripts\python.exe'
$src = Join-Path $root 'ocr\PaddleOCR-3.0.0'
New-Item -ItemType Directory -Force $work | Out-Null

$out = Join-Path $PSScriptRoot 'paddle_result.txt'
$log = New-Object System.Collections.Generic.List[string]
function Say($s) { Write-Host $s; $log.Add([string]$s) }
function Save { [System.IO.File]::WriteAllLines($out, $log, (New-Object System.Text.UTF8Encoding($false))) }
function Run($cmd, [int]$tail = 0) {
  $r = @(cmd /c "$cmd 2>&1" | ForEach-Object { "$_" })
  if ($tail -gt 0) { $r | Select-Object -Last $tail | ForEach-Object { Say "    $_" } }
  return $r
}
# 边跑边显示（过滤掉 Paddle 的警告和日志），同时收集全部输出写日志
function Live($cmd) {
  $all = New-Object System.Collections.Generic.List[string]
  cmd /c "$cmd 2>&1" | ForEach-Object {
    $s = "$_"; $all.Add($s)
    if ($s -notmatch 'Warning|warn\(|^\s*$|^[IWE]\d{4} |ccache|Could not find files') { Write-Host "    $s" }
  }
  return $all.ToArray()
}
function Get($url, $dst) {
  if ((Test-Path $dst) -and (Get-Item $dst).Length -gt 0) { return $true }
  Say "  下载 $url"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile "$dst.part"
    Move-Item -Force "$dst.part" $dst
    return $true
  } catch { Say "  下载失败：$($_.Exception.Message)"; return $false }
}

Say "=== 0. Python 环境（单独的 .venv-paddle，不动原来的 .venv）  $(Get-Date -Format 'HH:mm:ss')"
if (-not (Test-Path $py)) {
  $base = $null
  $cfg = Join-Path $root 'ocr\.venv\pyvenv.cfg'
  if (Test-Path $cfg) {
    $h = (Get-Content $cfg | Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1) -replace '^\s*home\s*=\s*', ''
    if ($h -and (Test-Path (Join-Path $h 'python.exe'))) { $base = Join-Path $h 'python.exe' }
  }
  if (-not $base) { $base = 'python' }
  Say "  用 $base 新建虚拟环境"
  Run "`"$base`" -m venv `"$venv`"" 3 | Out-Null
}
if (-not (Test-Path $py)) { Say '  建虚拟环境失败'; Save; exit 1 }
Run "`"$py`" --version" 1 | Out-Null

Say '=== 1. PaddleOCR 3.0.0 源码（导出 .pdmodel 要用）'
if (-not (Test-Path (Join-Path $src 'tools\export_model.py'))) {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) { Run "git clone --depth 1 -b v3.0.0 https://github.com/PaddlePaddle/PaddleOCR.git `"$src`"" 2 | Out-Null }
  if (-not (Test-Path (Join-Path $src 'tools\export_model.py'))) {
    $zip = Join-Path $work 'PaddleOCR-3.0.0.zip'
    if (Get 'https://codeload.github.com/PaddlePaddle/PaddleOCR/zip/refs/tags/v3.0.0' $zip) {
      Expand-Archive -Force $zip (Join-Path $root 'ocr')
    }
  }
}
if (-not (Test-Path (Join-Path $src 'tools\export_model.py'))) { Say "  没拿到源码，请手动下载 PaddleOCR v3.0.0 解压到 $src"; Save; exit 1 }
Say "  $src"
Save

Say "=== 2. 安装依赖（第一次要几分钟）  $(Get-Date -Format 'HH:mm:ss')"
$flag = Join-Path $venv 'deps_ok.txt'
if (-not (Test-Path $flag)) {
  Run "`"$py`" -m pip install --disable-pip-version-check -U pip" 1 | Out-Null
  Run "`"$py`" -m pip install --disable-pip-version-check paddlepaddle==3.0.0" 2 | Out-Null
  Run "`"$py`" -m pip install --disable-pip-version-check -r `"$src\requirements.txt`"" 2 | Out-Null
  Run "`"$py`" -m pip install --disable-pip-version-check onnxruntime==1.20.1 opencv-python" 2 | Out-Null
  $chk = (Run "`"$py`" -c `"import paddle, onnxruntime, cv2, yaml; print('OK', paddle.__version__)`"") -join ' '
  Say "  $chk"
  if ($chk -match 'OK 3') { Set-Content $flag 'ok' }
}
Save

Say "=== 3. 导出 FP32 静态图模型（旧格式 .pdmodel，Paddle Lite 和 PTQ 都只认这个）  $(Get-Date -Format 'HH:mm:ss')"
$pre = Join-Path $work 'pretrained'
New-Item -ItemType Directory -Force $pre | Out-Null
$base = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_pretrained_model'
foreach ($m in @(@('rec', 'pd_fp32'), @('det', 'pd_det_fp32'))) {
  $kind = $m[0]; $dst = Join-Path $work $m[1]
  if (Test-Path (Join-Path $dst 'inference.pdmodel')) { Say "  $($m[1]) 已存在"; continue }
  $w = Join-Path $pre "PP-OCRv5_mobile_${kind}_pretrained.pdparams"
  if (-not (Get "$base/PP-OCRv5_mobile_${kind}_pretrained.pdparams" $w)) { continue }
  Push-Location $src
  $cfgFile = "configs/$kind/PP-OCRv5/PP-OCRv5_mobile_$kind.yml"
  Run "`"$py`" tools/export_model.py -c $cfgFile -o Global.pretrained_model=`"$w`" Global.save_inference_dir=`"$dst`" Global.export_with_pir=False" 6 | Out-Null
  Pop-Location
  if (Test-Path (Join-Path $dst 'inference.pdmodel')) {
    Say ("  导出 {0}: inference.pdiparams {1:N1} MB" -f $m[1], ((Get-Item (Join-Path $dst 'inference.pdiparams')).Length / 1MB))
  } else { Say "  导出 $($m[1]) 失败（上面是最后几行报错）" }
}
Save
if (-not (Test-Path (Join-Path $work 'pd_fp32\inference.pdmodel'))) { Say '  识别模型没导出来，后面没法做'; Save; exit 1 }

Say "=== 4. PTQ 离线量化（5 种配置，每种 1~3 分钟）  $(Get-Date -Format 'HH:mm:ss')"
$env:TQDM_DISABLE = '1'
$r = Live "`"$py`" -u paddle_ptq.py quant `"$work\pd_fp32`" `"$work`""
[System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot 'quant_log.txt'), [string[]]$r, (New-Object System.Text.UTF8Encoding($false)))
$r | Where-Object { $_ -match '^量化|张不重复' } | ForEach-Object { $log.Add("  $_") }
Save

Say "=== 5. 准确率：同一批文字行，ONNX(App 现在用的) / Paddle FP32 / Paddle INT8 逐行对比  $(Get-Date -Format 'HH:mm:ss')"
$r = Live "`"$py`" -u paddle_ptq.py eval `"$work`""
[System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot 'eval_log.txt'), [string[]]$r, (New-Object System.Text.UTF8Encoding($false)))
$r | Where-Object { $_ -match '^RESULT|^\s+(原|量):|行，电脑|失败' } | ForEach-Object { $log.Add("  $_") }
Save

Say '=== 6. 账单解析（34 张，只比类型+金额）'
Push-Location $ocrtest
$env:LOOSE = '1'
foreach ($d in (Get-ChildItem -Directory -Filter 'bx_py_*' | Sort-Object Name)) {
  $a = (Run "`"$py`" diff.py bx_py_onnx_fp32 $($d.Name)" | Select-Object -Last 1)
  $b = (Run "`"$py`" diff.py bx_ref $($d.Name)" | Select-Object -Last 1)
  Say ("  {0,-26} 和ONNX FP32比: {1}" -f $d.Name, $a)
  Say ("  {0,-26} 和v6参考比:    {1}" -f '', $b)
}
$env:LOOSE = ''
Pop-Location
Say "=== DONE  $(Get-Date -Format 'HH:mm:ss')"
Save
