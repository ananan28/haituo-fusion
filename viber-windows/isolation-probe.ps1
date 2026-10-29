param([string]$Executable)
$ErrorActionPreference='Stop'
$base=Join-Path $env:RUNNER_TEMP 'haituo-viber-windows-isolation'
New-Item -ItemType Directory -Force $base | Out-Null
$shared=Join-Path $env:APPDATA 'ViberPC'
$sharedBefore=@{};Get-ChildItem -LiteralPath $shared -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {$sharedBefore[$_.FullName]=$_.LastWriteTimeUtc.Ticks}
$report=[ordered]@{syntheticData=$true;loggedIn=$false;version=(Get-Item $Executable).VersionInfo.ProductVersion;profiles=@()}
# Scan only public vendor executable constants, never account files.
$bytes=[IO.File]::ReadAllBytes($Executable)
$ascii=[Text.Encoding]::ASCII.GetString($bytes)
$wide=[Text.Encoding]::Unicode.GetString($bytes)
$flags=@()
foreach($text in @($ascii,$wide)){
 foreach($match in [regex]::Matches($text,'[\x20-\x7e]{4,}')){
  $value=$match.Value
  if(($value -match '^[-/]{1,2}[A-Za-z][A-Za-z0-9_-]{2,55}$') -or ($value.Length -lt 180 -and $value -match '(?i)(data.?path|data.?dir|ViberPC|multi.?instance|user.?data)')){$flags+=$value}
 }
}
$report.vendorProfileHints=@($flags | Sort-Object -Unique | Select-Object -First 160)
Add-Type -AssemblyName System.Windows.Forms
$source=(Get-Item $Executable).Directory.FullName
foreach($slot in 1..2){
 $root=Join-Path $base "slot-$slot"
 $app=Join-Path $root 'client'
 New-Item -ItemType Directory -Force $app,(Join-Path $root 'Roaming'),(Join-Path $root 'Local'),(Join-Path $root 'User') | Out-Null
 Copy-Item -Path (Join-Path $source '*') -Destination $app -Recurse -Force
 $client=Join-Path $app 'Viber.exe'
 $signature=Get-AuthenticodeSignature $client
 if($signature.Status -ne 'Valid'){throw 'Copied official executable signature invalid'}
 $start=New-Object Diagnostics.ProcessStartInfo
 $start.FileName=$client;$start.WorkingDirectory=$app;$start.UseShellExecute=$false
 $start.EnvironmentVariables['APPDATA']=Join-Path $root 'Roaming'
 $start.EnvironmentVariables['LOCALAPPDATA']=Join-Path $root 'Local'
 $start.EnvironmentVariables['USERPROFILE']=Join-Path $root 'User'
 $process=[Diagnostics.Process]::Start($start)
 Start-Sleep -Seconds 15
 $slotProcesses=@(Get-CimInstance Win32_Process -Filter "Name='Viber.exe'" | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($app,[StringComparison]::OrdinalIgnoreCase)})
 $windows=@(foreach($item in $slotProcesses){$p=Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue;if($p -and $p.MainWindowHandle -ne 0){[ordered]@{pid=$p.Id;handle=$p.MainWindowHandle.ToInt64();responding=$p.Responding}}})
 $dataFiles=@(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.FullName -notlike ($app+'*') -and $_.FullName -match '(?i)[\\/](ViberPC|ViberData|UserData)[\\/]'})
 $report.profiles+=@([ordered]@{profileDataFiles=$dataFiles.Count;slot=$slot;processes=$slotProcesses.Count;windows=$windows;roamingFiles=@(Get-ChildItem -LiteralPath (Join-Path $root 'Roaming') -Recurse -File -ErrorAction SilentlyContinue).Count;localFiles=@(Get-ChildItem -LiteralPath (Join-Path $root 'Local') -Recurse -File -ErrorAction SilentlyContinue).Count;userFiles=@(Get-ChildItem -LiteralPath (Join-Path $root 'User') -Recurse -File -ErrorAction SilentlyContinue).Count})
}
$report.independentWindows=(@($report.profiles | Where-Object {$_.windows.Count -gt 0}).Count -eq 2)
$sharedTouched=@(Get-ChildItem -LiteralPath $shared -File -Recurse -ErrorAction SilentlyContinue | Where-Object {-not $sharedBefore.ContainsKey($_.FullName) -or $sharedBefore[$_.FullName] -ne $_.LastWriteTimeUtc.Ticks}).Count
$report.sharedDefaultProfileFilesChanged=$sharedTouched
$report.isolatedWriteObserved=(@($report.profiles | Where-Object {$_.profileDataFiles -gt 0}).Count -eq 2 -and $sharedTouched -eq 0)
New-Item -ItemType Directory -Force 'audit-results' | Out-Null
$report | ConvertTo-Json -Depth 10 | Set-Content audit-results/viber-windows-isolation.json -Encoding UTF8
$report | ConvertTo-Json -Depth 10 | Write-Host
Get-CimInstance Win32_Process -Filter "Name='Viber.exe'" | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}
if(-not $report.independentWindows -or -not $report.isolatedWriteObserved){throw 'Independent native Viber profile isolation is not proven; do not enable Windows multi-account'}
