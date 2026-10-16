# Only versioned APKs directly inside dist are eligible for removal.
[CmdletBinding(SupportsShouldProcess=$true)]
param([ValidateRange(1,20)][int]$Keep=2, [string]$Dist='')
$ErrorActionPreference='Stop'
if(-not $Dist){$Dist=Join-Path $PSScriptRoot '..\dist'}
$base=(Resolve-Path -LiteralPath $Dist).Path
$packages=foreach($file in Get-ChildItem -LiteralPath $base -File){
    $family=$null
    if($file.Name -match '^xunji-(\d{8}\.\d{4})-beta\.apk$'){$family='beta'}
    elseif($file.Name -match '^(?:xunji-ocr-|洵记OCR版_)(\d{8}\.\d{4})(?:-ocr)?-emu\.apk$'){$family='emu'}
    elseif($file.Name -match '^(?:xunji-ocr-|洵记OCR版_)(\d{8}\.\d{4})(?:-ocr)?\.apk$'){$family='ocr'}
    elseif($file.Name -match '^(?:xunji-|洵记_)(\d{8}\.\d{4})\.apk$'){$family='lite'}
    if($family){[pscustomobject]@{File=$file;Family=$family;Version=$Matches[1]}}
}
foreach($group in ($packages|Group-Object Family)){
    $versions=@($group.Group.Version|Sort-Object -Descending -Unique|Select-Object -First $Keep)
    $seen=@{}
    foreach($package in ($group.Group|Sort-Object @{Expression={if($_.File.Name -like 'xunji-*'){0}else{1}}},@{Expression={$_.File.Name}})){
        $retain=$package.Version -in $versions -and -not $seen.ContainsKey($package.Version)
        $seen[$package.Version]=$true
        if($retain){continue}
        if($package.File.DirectoryName -ne $base){throw 'Invalid cleanup path'}
        if($PSCmdlet.ShouldProcess($package.File.FullName,'Remove expired APK')){Remove-Item -LiteralPath $package.File.FullName}
    }
}
