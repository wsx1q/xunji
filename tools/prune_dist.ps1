# Only recognized build packages directly inside dist are eligible for removal.
[CmdletBinding(SupportsShouldProcess=$true)]
param([ValidateRange(1,20)][int]$Keep = 2, [string]$Dist = '')
$ErrorActionPreference = 'Stop'
if (-not $Dist) { $Dist = Join-Path $PSScriptRoot '..\dist' }
$distPath = (Resolve-Path -LiteralPath $Dist).Path
$packages = foreach ($file in Get-ChildItem -LiteralPath $distPath -File) {
    $family = $null
    if ($file.Name -match '^(?:xunji-desktop-|洵记电脑版_)(\d{8}\.\d{4})\.exe$') { $family = 'desktop' }
    if ($family) { [pscustomobject]@{ File=$file; Family=$family; Version=$Matches[1] } }
}
foreach ($group in ($packages | Group-Object Family)) {
    $versions = @($group.Group.Version | Sort-Object -Descending -Unique | Select-Object -First $Keep)
    $seen = @{}
    foreach ($package in ($group.Group | Sort-Object @{Expression={if ($_.File.Name -like '洵记*') {0} else {1}}}, @{Expression={$_.File.Name}})) {
        $retain = $package.Version -in $versions -and -not $seen.ContainsKey($package.Version)
        $seen[$package.Version] = $true
        if ($retain) { continue }
        $target = $package.File.FullName
        if ((Split-Path -Parent $target) -ne $distPath) { throw "拒绝清理 dist 以外的文件: $target" }
        if ($PSCmdlet.ShouldProcess($target, '删除旧构建包')) { Remove-Item -LiteralPath $target -Force }
    }
}
# Remove checksums only when their associated versioned executable is gone.
foreach ($sidecar in Get-ChildItem -LiteralPath $distPath -Filter 'xunji-desktop-*.sha256.txt' -File) {
    $exe = Join-Path $distPath ($sidecar.Name -replace '\.sha256\.txt$', '.exe')
    if (-not (Test-Path -LiteralPath $exe) -and $PSCmdlet.ShouldProcess($sidecar.FullName, '删除旧包校验文件')) {
        Remove-Item -LiteralPath $sidecar.FullName -Force
    }
}
