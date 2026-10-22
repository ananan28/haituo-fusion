$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('haituo-cleanup-test-'+[guid]::NewGuid())
New-Item -ItemType Directory -Force $root | Out-Null
try {
 foreach($path in @('Roaming\Haituo\SignalProfiles\signal-old','Roaming\海拓\Cache','Local\haituo-updater','Roaming\Signal','Roaming\WhatsApp','Local\Programs\Haituo\resources','Local\Programs\Unrelated\resources','Temp')){New-Item -ItemType Directory -Force (Join-Path $root $path)|Out-Null}
 foreach($file in @('Roaming\Haituo\translation-settings.json','Roaming\Haituo\SignalProfiles\signal-old\db.sqlite','Roaming\Signal\keep.txt','Roaming\WhatsApp\keep.txt','Local\Programs\Haituo\Haituo.exe','Local\Programs\Haituo\resources\app.asar','Local\Programs\Unrelated\resources\app.asar','Temp\Haituo-Setup-1.4.1.exe','Temp\keep.exe')){Set-Content -LiteralPath (Join-Path $root $file) -Value 'fixture'}
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/installer/cleanup.ps1 -Mode cache -TestRoot $root
 if($LASTEXITCODE -ne 0 -or !(Test-Path (Join-Path $root 'Roaming\Haituo\translation-settings.json')) -or (Test-Path (Join-Path $root 'Temp\Haituo-Setup-1.4.1.exe'))){throw 'Upgrade/cache cleanup removed data or left installer cache'}
 & powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/installer/cleanup.ps1 -Mode purge -TestRoot $root
 if($LASTEXITCODE -ne 0 -or (Test-Path (Join-Path $root 'Roaming\Haituo')) -or (Test-Path (Join-Path $root 'Roaming\海拓')) -or (Test-Path (Join-Path $root 'Local\Programs\Haituo'))){throw 'Complete uninstall left historical data'}
 foreach($keep in @('Roaming\Signal\keep.txt','Roaming\WhatsApp\keep.txt','Temp\keep.exe','Local\Programs\Unrelated\resources\app.asar')){if(!(Test-Path (Join-Path $root $keep))){throw ('Unrelated file removed: '+$keep)}}
 Write-Output 'Uninstall cleanup fixture passed: upgrade preserves accounts; purge removes old Haituo data only.'
}finally{Remove-Item -LiteralPath $root -Recurse -Force}
