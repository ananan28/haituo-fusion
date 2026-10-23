param([ValidateSet('cache','purge')][string]$Mode='cache',[string]$InstallDirectory='',[string]$TestRoot='')
$ErrorActionPreference='Stop'
# Only known Haituo-owned roots are considered. Never scan/delete Signal or WhatsApp roots.
$roaming=if($TestRoot){Join-Path $TestRoot 'Roaming'}else{[Environment]::GetFolderPath('ApplicationData')}
$local=if($TestRoot){Join-Path $TestRoot 'Local'}else{[Environment]::GetFolderPath('LocalApplicationData')}
$temp=if($TestRoot){Join-Path $TestRoot 'Temp'}else{[IO.Path]::GetTempPath()}
$failures=[System.Collections.Generic.List[string]]::new()
# Items that need admin rights (or a manual step) to remove. They are reported
# to the user explicitly instead of being silently swallowed — a partial
# cleanup must never present itself as a complete one — but they do NOT abort
# a per-user uninstall, which must keep working without elevation.
$leftovers=[System.Collections.Generic.List[string]]::new()
function Remove-Owned([string]$Path){if(Test-Path -LiteralPath $Path){try{Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop}catch{$failures.Add($Path)}}}
function Add-Leftover([string]$Item,[string]$Reason){$leftovers.Add($Reason+'：'+$Item);Write-Warning ($Reason+'：'+$Item)}
foreach($name in @('haituo-updater','海拓-updater')){Remove-Owned (Join-Path $local $name)}
if(Test-Path -LiteralPath $temp){Get-ChildItem -LiteralPath $temp -File -Filter 'Haituo-Setup-*.exe' | ForEach-Object {Remove-Owned $_.FullName}}
if($Mode -eq 'purge'){
 foreach($root in @($roaming,$local)){foreach($name in @('Haituo','海拓')){Remove-Owned (Join-Path $root $name)}}
 # Remove previous default installations only when the executable and app archive both identify an app install.
 foreach($name in @('Haituo','海拓')){
  $path=Join-Path (Join-Path $local 'Programs') $name
  $same=$InstallDirectory -and ([IO.Path]::GetFullPath($path).TrimEnd('\') -eq [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\'))
  if(!$same -and (Test-Path -LiteralPath (Join-Path $path 'resources\app.asar')) -and ((Test-Path -LiteralPath (Join-Path $path '海拓.exe')) -or (Test-Path -LiteralPath (Join-Path $path 'Haituo.exe')))){Remove-Owned $path}
 }
}
if($Mode -eq 'purge' -and !$TestRoot){
 $registryRoots=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
 foreach($root in $registryRoots){
  if(!(Test-Path $root)){continue}
  foreach($entry in Get-ChildItem $root -ErrorAction SilentlyContinue){
   $info=Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
   if($info.DisplayName -notmatch '^(海拓|Haituo)(?:\s*\d[\d. -]*)?$'){continue}
   $location=[string]$info.InstallLocation
   if($location -and (Test-Path -LiteralPath (Join-Path $location 'resources\app.asar')) -and ((Test-Path -LiteralPath (Join-Path $location '海拓.exe')) -or (Test-Path -LiteralPath (Join-Path $location 'Haituo.exe')))){
    $same=$InstallDirectory -and ([IO.Path]::GetFullPath($location).TrimEnd('\') -eq [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\'))
    # Machine-wide leftovers need admin rights; a per-user uninstall must never abort on them.
    if(!$same){try{Remove-Item -LiteralPath $location -Recurse -Force -ErrorAction Stop}catch{Add-Leftover $location '需要管理员权限才能删除旧安装目录'}}
   }
   try{Remove-Item -LiteralPath $entry.PSPath -Recurse -Force -ErrorAction Stop}catch{Add-Leftover $entry.PSPath '需要管理员权限才能删除注册表项'}
  }
 }
 foreach($name in @('Haituo','海拓')){try{Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $name -ErrorAction SilentlyContinue}catch{Add-Leftover ('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run\'+$name) '无法删除自启动项（可能被占用）'}}
 foreach($scheme in @('sgnl','signalcaptcha')){
  $key='HKCU:\Software\Classes\'+$scheme
  $command=(Get-ItemProperty -LiteralPath ($key+'\shell\open\command') -ErrorAction SilentlyContinue).'(default)'
  if($command -match '(Haituo|海拓)\.exe'){try{Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction Stop}catch{Add-Leftover $key '需要管理员权限才能删除协议注册'}}
 }
 $shell=New-Object -ComObject WScript.Shell
 $shortcutRoots=@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('StartMenu'))
 foreach($root in $shortcutRoots){if(!(Test-Path $root)){continue};foreach($link in Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -File -ErrorAction SilentlyContinue){try{$target=$shell.CreateShortcut($link.FullName).TargetPath;if([IO.Path]::GetFileName($target) -match '^(海拓|Haituo)\.exe$'){Remove-Owned $link.FullName}}catch{}}}
}
if($Mode -eq 'purge' -and $leftovers.Count -and !$TestRoot){
 # List every uncleaned item for the user and give an explicit admin path, so
 # a partial purge is visible instead of being described as complete.
 $report=Join-Path ([Environment]::GetFolderPath('Desktop')) '海拓卸载残留.txt'
 $lines=@(
  '海拓卸载时以下项目未能自动清除（多为系统级或其他用户数据，需要管理员权限）：',
  ''
 )+$leftovers+@(
  '',
  '清理方法：在开始菜单找到“卸载海拓”，右键选择“以管理员身份运行”，再次选择“彻底卸载”。',
  '以上路径均已核实属于海拓；卸载过程没有改动 Signal、WhatsApp 及其他程序的数据。'
 )
 Set-Content -LiteralPath $report -Value $lines -Encoding UTF8
 Write-Output ('以下项目未能自动清理，已写入 ' + $report)
 $leftovers | ForEach-Object {Write-Output ('  [未清理] ' + $_)}
}
if($failures.Count){$failures | ForEach-Object {Write-Error ('Unable to remove Haituo path: '+$_) -ErrorAction Continue};exit 1}
exit 0
