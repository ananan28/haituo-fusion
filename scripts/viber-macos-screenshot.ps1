$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$outDir = Join-Path $root 'audit-results'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir 'viber-macos-screenshot.json'
$work = Join-Path $env:RUNNER_TEMP 'viber_macos_shot'
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Get-UtcStamp { (Get-Date).ToUniversalTime().ToString('o') }

function Run-Native([string]$cmd, [string[]]$argList) {
    $out = & $cmd @argList 2>&1
    return [ordered]@{ code = $LASTEXITCODE; output = @($out | ForEach-Object { [string]$_ }) }
}

function Get-Pids([string]$pattern) {
    $o = & pgrep -f $pattern 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $o) { return @() }
    return @($o | ForEach-Object { [int]$_ })
}

function Stop-AllViber {
    & killall -9 Viber 2>$null | Out-Null
    Start-Sleep -Seconds 2
}

function New-FakeHome([string]$p) {
    foreach ($s in @('Library/Application Support', 'Library/Caches', 'Library/Preferences', 'Library/Logs', 'Library/Saved Application State')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $p $s) | Out-Null
    }
}

function Start-AppWithEnv([string]$exe, [hashtable]$Env, [string]$wd, [string]$logBase) {
    $saved = @{}
    foreach ($k in @($Env.Keys)) {
        $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
        [Environment]::SetEnvironmentVariable($k, [string]$Env[$k], 'Process')
    }
    try {
        return Start-Process -FilePath $exe -WorkingDirectory $wd -PassThru -RedirectStandardOutput "$logBase.out.log" -RedirectStandardError "$logBase.err.log"
    } finally {
        foreach ($k in @($saved.Keys)) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
    }
}

$ev = [ordered]@{
    schema = 'haituo-fusion/viber-macos-screenshot/v1'
    generated_at_utc = (Get-UtcStamp)
    runner = [ordered]@{}
    download = [ordered]@{}
    install = [ordered]@{}
    launch = [ordered]@{ a = $null; b = $null }
    windows = @()
    picked_windows = @()
    captures = @()
    files = @()
    errors = @()
}

function Save-Evidence {
    $json = $ev | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($outFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}

$ev.runner.os_version = (@(& sw_vers -productVersion 2>$null) -join '')
$ev.runner.arch = (@(& uname -m 2>$null) -join '')
$ev.runner.user = $env:USER
$ev.runner.windowserver = [bool](& pgrep -x WindowServer 2>$null)
$ev.runner.tcc_hint = 'screencapture requires Screen Recording permission; failure is recorded verbatim'
Save-Evidence

# ---------- download + stage ----------
$dmg = Join-Path $work 'Viber.dmg'
$candidates = @(
    'https://download.cdn.viber.com/desktop/mac_10_14/Viber.dmg',
    'https://download.cdn.viber.com/desktop/mac_10_13/Viber.dmg',
    'https://download.viber.com/desktop/mac/online/Viber.dmg'
)
foreach ($u in $candidates) {
    $r = Run-Native 'curl' @('-sS', '-L', '--retry', '3', '--retry-delay', '2', '--connect-timeout', '30', '--max-time', '600', '-o', $dmg, '-w', '%{http_code}', $u)
    $code = @($r.output)[-1]
    if ("$code" -match '^2\d\d$' -and (Test-Path $dmg) -and (Get-Item $dmg).Length -gt 1024) {
        $ev.download = [ordered]@{ url = $u; http_status = [int]$code; bytes = (Get-Item $dmg).Length }
        break
    }
}
Save-Evidence
if (-not $ev.download.url) { throw 'download failed' }

$mnt = Join-Path $work 'mnt'
New-Item -ItemType Directory -Force -Path $mnt | Out-Null
$r = Run-Native 'hdiutil' @('attach', '-nobrowse', '-readonly', '-mountpoint', $mnt, $dmg)
$ev.install.mount_code = $r.code
$src = $null
if ($r.code -eq 0) {
    $app = Get-ChildItem $mnt -Filter '*.app' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($app) { $src = $app.FullName }
}
if (-not $src) { throw 'no .app in dmg' }
$appA = Join-Path $work 'ViberA.app'
$appB = Join-Path $work 'ViberB.app'
Run-Native 'cp' @('-R', $src, $appA) | Out-Null
Run-Native 'cp' @('-R', $src, $appB) | Out-Null
Run-Native 'xattr' @('-dr', 'com.apple.quarantine', $appA) | Out-Null
Run-Native 'xattr' @('-dr', 'com.apple.quarantine', $appB) | Out-Null
$exeA = Join-Path $appA 'Contents/MacOS/Viber'
$exeB = Join-Path $appB 'Contents/MacOS/Viber'
$ev.install.apps = @($appA, $appB)
$ev.install.version = (@(& plutil -extract CFBundleShortVersionString raw -o - (Join-Path $appA 'Contents/Info.plist') 2>$null) -join '').Trim()
Save-Evidence
if (-not (Test-Path $exeA)) { throw 'staged executable missing' }

# ---------- window helper (pid, window id, layer, name) ----------
$winSrc = Join-Path $work 'winids.swift'
@'
import Foundation
import CoreGraphics
var screens: UInt32 = 0
CGGetActiveDisplayList(0, nil, &screens)
print("screens \(screens)")
if let list = CGWindowListCopyWindowInfo(CGWindowListOption(rawValue: 0), 0) as? [[String: Any]] {
    for w in list {
        let pid = w[kCGWindowOwnerPID as String] as? Int ?? -1
        let wid = w[kCGWindowNumber as String] as? Int ?? -1
        let layer = w[kCGWindowLayer as String] as? Int ?? -1
        let name = (w[kCGWindowName as String] as? String) ?? ""
        let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let wd = (b["Width"] as? Double) ?? 0
        let hd = (b["Height"] as? Double) ?? 0
        print("W \(pid) \(wid) \(layer) \(Int(wd))x\(Int(hd)) \(name)")
    }
}
'@ | Set-Content -Path $winSrc -Encoding utf8
$winExe = Join-Path $work 'winids'
$x = Run-Native 'xcrun' @('swiftc', '-O', '-o', $winExe, $winSrc)
$ev.install.window_tool_compiled = ($x.code -eq 0) -and (Test-Path $winExe)
Save-Evidence
if (-not $ev.install.window_tool_compiled) { throw "window tool failed: $($x.output -join ' | ')" }

function Get-WindowRecords {
    $res = @()
    $out = @(& $winExe 2>$null)
    foreach ($line in $out) {
        if ($line -match '^W (-?\d+) (\d+) (-?\d+) (\d+x\d+) ?(.*)$') {
            $res += [ordered]@{ pid = [int]$matches[1]; id = [int]$matches[2]; layer = [int]$matches[3]; size = $matches[4]; name = $matches[5] }
        }
    }
    return $res
}

function Wait-BothWindows([int]$PidA, [int]$PidB, [int]$TimeoutSec) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $lat = @{ $PidA = $null; $PidB = $null }
    $last = @{}
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        Start-Sleep -Seconds 3
        $all = @(Get-WindowRecords | Where-Object { $_.layer -eq 0 })
        foreach ($tp in @($PidA, $PidB)) {
            if ($tp -le 0) { continue }
            if ($null -eq $lat[$tp]) {
                $mine = @($all | Where-Object { $_.pid -eq $tp })
                if ($mine.Count -gt 0) { $lat[$tp] = [math]::Round($sw.Elapsed.TotalSeconds, 1); $last[$tp] = $mine }
            }
        }
        if (($null -ne $lat[$PidA] -or $PidA -le 0) -and ($null -ne $lat[$PidB] -or $PidB -le 0)) { break }
    }
    return $lat
}

# ---------- launch two isolated instances ----------
Stop-AllViber
$hA = Join-Path $work 'shot_home_a'; $tA = Join-Path $work 'shot_tmp_a'
$hB = Join-Path $work 'shot_home_b'; $tB = Join-Path $work 'shot_tmp_b'
foreach ($h in @($hA, $hB)) { New-FakeHome $h }
foreach ($d in @($tA, $tB)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

$pA = $null
$pB = $null
try {
    $pA = Start-AppWithEnv $exeA @{ HOME = $hA; CFFIXED_USER_HOME = $hA; TMPDIR = $tA } $hA (Join-Path $work 'A')
    Write-Host ("[A] pid={0}" -f $pA.Id)
    Start-Sleep -Seconds 3
    $pB = Start-AppWithEnv $exeB @{ HOME = $hB; CFFIXED_USER_HOME = $hB; TMPDIR = $tB } $hB (Join-Path $work 'B')
    Write-Host ("[B] pid={0}" -f $pB.Id)
} catch {
    $ev.errors += "launch: $($_.Exception.Message)"
    Write-Host ("[launch] failed: {0}" -f $_.Exception.Message)
}
$idA = if ($pA) { $pA.Id } else { 0 }
$idB = if ($pB) { $pB.Id } else { 0 }
$lat = @{}
try { $lat = Wait-BothWindows $idA $idB 420 } catch { $ev.errors += "wait: $($_.Exception.Message)" }
foreach ($pair in @(@{ tag = 'a'; pid = $idA }, @{ tag = 'b'; pid = $idB })) {
    $w = @()
    if ($pair.pid -gt 0) { $w = @(Get-WindowRecords | Where-Object { $_.pid -eq $pair.pid -and $_.layer -eq 0 } | Sort-Object { [int](($_.size -split 'x')[0]) } -Descending) }
    $l = $null
    if ($pair.pid -gt 0 -and $lat.ContainsKey($pair.pid)) { $l = $lat[$pair.pid] }
    $ev.launch[$pair.tag] = [ordered]@{ pid = $pair.pid; ready = [bool]($w.Count -gt 0); latency_s = $l; windows = $w }
    Write-Host ("[{0}] pid={1} ready={2} windows={3} latency={4}s" -f $pair.tag.ToUpper(), $pair.pid, ($w.Count -gt 0), $w.Count, $l)
}
Save-Evidence

Start-Sleep -Seconds 12
$all = @(Get-Pids 'Contents/MacOS/Viber')
$ev.windows = @(Get-WindowRecords | Where-Object { $all -contains $_.pid } | Sort-Object pid, id)
Save-Evidence

# ---------- capture ----------
function Save-Capture([string]$label, [string[]]$scArgs, [string]$file) {
    $r = Run-Native 'screencapture' @($scArgs + $file)
    $bytes = $null
    if (Test-Path $file) { $bytes = (Get-Item $file).Length }
    $rec = [ordered]@{ label = $label; args = @($scArgs + $file); exit_code = $r.code; bytes = $bytes; output = @($r.output | Select-Object -First 10) }
    $ev.captures += $rec
    Save-Evidence
    Write-Host ("[capture {0}] exit={1} bytes={2}" -f $label, $r.code, $bytes)
    return $rec
}

Save-Capture 'full-screen' @('-x', '-t', 'png') (Join-Path $outDir 'viber-two-instances-full.png')

$picks = @()
$pairs = @()
if ($pA) { $pairs += @{ tag = 'A'; pid = $pA.Id } }
if ($pB) { $pairs += @{ tag = 'B'; pid = $pB.Id } }
foreach ($pair in $pairs) {
    $w = @($ev.windows | Where-Object { $_.pid -eq $pair.pid -and $_.layer -eq 0 } | Sort-Object { [int](($_.size -split 'x')[0]) } -Descending)
    if ($w.Count -gt 0) { $picks += [ordered]@{ tag = $pair.tag; pid = $pair.pid; window = $w[0] } }
}
$ev.picked_windows = $picks
Save-Evidence
foreach ($p in $picks) {
    Save-Capture ("window-" + $p.tag) @('-x', '-o', '-l', "$($p.window.id)", '-t', 'png') (Join-Path $outDir ("viber-window-{0}.png" -f $p.tag)) | Out-Null
}

$ev.pid_alive_at_end = @(Get-Pids 'Contents/MacOS/Viber')
$ev.files = @(Get-ChildItem $outDir -Filter '*.png' -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ name = $_.Name; bytes = $_.Length; sha256_16 = $null } })
foreach ($f in $ev.files) {
    try { $f.sha256_16 = ([BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.IO.File]::ReadAllBytes((Join-Path $outDir $f.name)))) -replace '-', '').ToLower().Substring(0, 16) } catch {}
}
Save-Evidence

if ($pA) { Stop-Process -Id $pA.Id -Force -ErrorAction SilentlyContinue }
if ($pB) { Stop-Process -Id $pB.Id -Force -ErrorAction SilentlyContinue }
Stop-AllViber
try { Run-Native 'hdiutil' @('detach', $mnt, '-force') | Out-Null } catch {}
Write-Host ("captures: {0}" -f (($ev.captures | ForEach-Object { "$($_.label)=$($_.exit_code)/$($_.bytes)" }) -join ', '))
