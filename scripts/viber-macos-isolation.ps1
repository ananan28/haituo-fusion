$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$outDir = Join-Path $root 'audit-results'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir 'viber-macos-isolation.json'
$work = Join-Path $env:RUNNER_TEMP 'viber_macos_probe'
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Get-UtcStamp { (Get-Date).ToUniversalTime().ToString('o') }

function Get-PathStat([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p) -or -not (Test-Path $p)) { return [ordered]@{ files = 0; last_write = $null } }
    $f = @(Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue)
    $lw = $null
    if ($f.Count -gt 0) { $lw = ($f | Measure-Object LastWriteTime -Maximum).Maximum.ToString('o') }
    return [ordered]@{ files = $f.Count; last_write = $lw }
}

function Test-StatWrote($before, $after) {
    if ($null -eq $before -or $null -eq $after) { return $false }
    if ($after.files -gt $before.files) { return $true }
    if ($after.last_write -and (-not $before.last_write -or [string]$after.last_write -gt [string]$before.last_write)) { return $true }
    return $false
}

function Run-Native([string]$cmd, [string[]]$argList) {
    $out = & $cmd @argList 2>&1
    return [ordered]@{ code = $LASTEXITCODE; output = @($out | ForEach-Object { [string]$_ }) }
}

function Get-Pids([string]$pattern) {
    $o = & pgrep -f $pattern 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $o) { return @() }
    return @($o | ForEach-Object { [int]$_ })
}

function Get-ViberDataPaths {
    $res = @()
    $support = Join-Path $HOME 'Library/Application Support'
    if (Test-Path $support) { $res += @(Get-ChildItem $support -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'viber' } | ForEach-Object { $_.FullName }) }
    $prefs = Join-Path $HOME 'Library/Preferences'
    if (Test-Path $prefs) { $res += @(Get-ChildItem $prefs -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'viber' } | ForEach-Object { $_.FullName }) }
    return $res
}

function Stop-AllViber {
    & killall -9 Viber 2>$null | Out-Null
    Start-Sleep -Seconds 2
}

$ev = [ordered]@{
    schema = 'haituo-fusion/viber-macos-isolation/v1'
    generated_at_utc = (Get-UtcStamp)
    runner = [ordered]@{}
    baseline = [ordered]@{}
    download = [ordered]@{ attempts = @(); dmg_path = $null; dmg_url = $null }
    install = [ordered]@{}
    window_check = [ordered]@{}
    launch_tests = @()
    locks = [ordered]@{}
    scope_limitations = [ordered]@{
        host = 'GitHub Actions macos-latest runner (single GUI-session user)'
        account_verification = 'none: no real Viber accounts or credentials are used anywhere in this probe'
        verified_scope = 'process survival, per-PID windows (CGWindowList), profile-directory writes'
        not_verified = 'second macOS GUI user session (not available on CI), real dual-account messaging'
    }
    verdict = [ordered]@{}
}

function Save-Evidence {
    $ev.generated_at_utc = (Get-UtcStamp)
    $json = $ev | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText($outFile, $json)
}

# ---------- runner + baseline ----------
$ev.runner.os_name = (@(& sw_vers -productName 2>$null) -join '')
$ev.runner.os_version = (@(& sw_vers -productVersion 2>$null) -join '')
$ev.runner.arch = (@(& uname -m 2>$null) -join '')
$ev.runner.ps_version = $PSVersionTable.PSVersion.ToString()
$ev.runner.user = $env:USER
$ev.runner.windowserver = [bool](& pgrep -x WindowServer 2>$null)
$ev.baseline.viber_processes = @(Get-Pids 'Contents/MacOS/Viber').Count
$ev.baseline.viber_data_paths = @(Get-ViberDataPaths)
$ev.baseline.viber_data_stats = [ordered]@{}
foreach ($p in $ev.baseline.viber_data_paths) { $ev.baseline.viber_data_stats[$p] = Get-PathStat $p }
Save-Evidence
Write-Host ("runner: {0} {1} {2} user={3}" -f $ev.runner.os_name, $ev.runner.os_version, $ev.runner.arch, $ev.runner.user)

# ---------- download ----------
$candidates = @(
    'https://download.cdn.viber.com/desktop/mac_10_14/Viber.dmg',
    'https://download.cdn.viber.com/desktop/mac_10_13/Viber.dmg',
    'https://download.viber.com/desktop/mac/online/Viber.dmg'
)
$i = 0
foreach ($u in $candidates) {
    $att = [ordered]@{ url = $u; attempted_at_utc = (Get-UtcStamp) }
    try {
        $hostName = ([uri]$u).Host
        try {
            $dnsOut = @(& dscacheutil -q host -a name $hostName 2>$null)
            $att.dns_resolved = @($dnsOut | ForEach-Object { if ($_ -match 'ip_address:\s*(\S+)') { $matches[1] } } | Select-Object -Unique)
        } catch { $att.dns_resolved = @() }
        if (@($att.dns_resolved).Count -eq 0) { $att.dns_resolved = @() }
        $out = Join-Path $work ("viber_dl_{0}.dmg" -f $i)
        $r = Run-Native 'curl' @('-sS', '-L', '--retry', '3', '--retry-delay', '2', '--connect-timeout', '30', '--max-time', '600', '-o', $out, '-w', '%{http_code}', $u)
        $code = @($r.output)[-1]
        $att.http_status = if ("$code" -match '^\d{3}$') { [int]$code } else { $null }
        if (Test-Path $out) { $att.bytes = (Get-Item $out).Length }
        if ($att.http_status -ge 200 -and $att.http_status -lt 300 -and $att.bytes -gt 1024) {
            $att.result = 'ok'
            $ev.download.attempts += $att
            $ev.download.dmg_path = $out
            $ev.download.dmg_url = $u
            break
        }
        $att.result = 'failed'
        $att.error = "http status $($att.http_status)"
    } catch {
        $att.result = 'failed'
        $att.error = $_.Exception.Message
    }
    $ev.download.attempts += $att
    $i++
}
Save-Evidence
Write-Host ("dmg: {0}" -f $ev.download.dmg_url)

# ---------- mount / verify / stage two bundles ----------
$inst = [ordered]@{ mounted = $false; app_source = $null; codesign = $null; spctl = $null; exeA = $null; exeB = $null; appA = $null; appB = $null; errors = @() }
$mnt = Join-Path $work 'mnt'
New-Item -ItemType Directory -Force -Path $mnt | Out-Null
$mountedNow = $false
if ($ev.download.dmg_path) {
    $r = Run-Native 'hdiutil' @('attach', '-nobrowse', '-readonly', '-mountpoint', $mnt, $ev.download.dmg_path)
    $inst.mount_code = $r.code
    $inst.mount_output = @($r.output | Select-Object -First 20)
    $mountedNow = ($r.code -eq 0)
    $inst.mounted = $mountedNow
    if (-not $mountedNow) { $inst.errors += "hdiutil attach exit $($r.code)" }
}
if ($mountedNow) {
    $app = Get-ChildItem $mnt -Filter '*.app' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($app) { $inst.app_source = $app.FullName } else { $inst.errors += 'no .app found in mounted dmg' }
}
if ($inst.app_source) {
    $cs = Run-Native 'codesign' @('-dv', '--verbose=4', $inst.app_source)
    $inst.codesign = [ordered]@{
        code      = $cs.code
        authority = @($cs.output | Where-Object { $_ -match '^Authority=' } | ForEach-Object { $_ -replace '^Authority=', '' })
        team      = (@($cs.output | Where-Object { $_ -match '^TeamIdentifier=' }) -join '')
        raw       = @($cs.output | Select-Object -First 25)
    }
    $sp = Run-Native 'spctl' @('-a', '-t', 'exec', '-vv', $inst.app_source)
    $inst.spctl = [ordered]@{ code = $sp.code; output = @($sp.output | Select-Object -First 10) }
    $appA = Join-Path $work 'ViberA.app'
    $appB = Join-Path $work 'ViberB.app'
    $c1 = Run-Native 'cp' @('-R', $inst.app_source, $appA)
    $c2 = Run-Native 'cp' @('-R', $inst.app_source, $appB)
    $inst.stage_codes = @($c1.code, $c2.code)
    $exeName = (@(& plutil -extract CFBundleExecutable raw -o - (Join-Path $appA 'Contents/Info.plist') 2>$null) -join '').Trim()
    if (-not $exeName) { $exeName = 'Viber' }
    $inst.bundle_executable = $exeName
    $inst.appA = $appA
    $inst.appB = $appB
    $inst.exeA = Join-Path $appA "Contents/MacOS/$exeName"
    $inst.exeB = Join-Path $appB "Contents/MacOS/$exeName"
    $inst.exe_exists = (Test-Path $inst.exeA) -and (Test-Path $inst.exeB)
    $vs = Run-Native 'codesign' @('--verify', '--strict', $appA)
    $inst.copy_verify = [ordered]@{ code = $vs.code; output = @($vs.output | Select-Object -First 5) }
    $inst.bundle_size_bytes = (Get-ChildItem $appA -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
}
$ev.install = $inst
Save-Evidence
Write-Host ("install: mounted={0} app={1} exe_exists={2}" -f $inst.mounted, $inst.app_source, $inst.exe_exists)

# ---------- window counter (Swift -> CGWindowList) ----------
$winSrc = Join-Path $work 'winlist.swift'
@'
import Foundation
import CoreGraphics
let pids = CommandLine.arguments.dropFirst().compactMap { Int32($0) }
var counts = [Int32: Int]()
if let list = CGWindowListCopyWindowInfo(CGWindowListOption(rawValue: 0), 0) as? [[String: Any]] {
    for w in list {
        if let p = w[kCGWindowOwnerPID as String] as? Int32 { counts[p, default: 0] += 1 }
    }
}
for p in pids { print("\(p) \(counts[p] ?? 0)") }
'@ | Set-Content -Path $winSrc -Encoding utf8
$winExe = Join-Path $work 'winlist'
$x = Run-Native 'xcrun' @('swiftc', '-O', '-o', $winExe, $winSrc)
$script:winlistOk = ($x.code -eq 0) -and (Test-Path $winExe)
$ev.window_check = [ordered]@{
    method         = 'CGWindowListCopyWindowInfo (optionAll) via compiled Swift helper, counted per owner PID'
    compiled       = $script:winlistOk
    tool           = $winExe
    compile_exit   = $x.code
    compile_output = @($x.output | Select-Object -First 30)
}
Save-Evidence

function Get-WindowCounts([int[]]$pids) {
    $map = @{}
    if (-not $script:winlistOk -or $null -eq $pids -or $pids.Count -eq 0) { return $map }
    $out = & $winExe @($pids | ForEach-Object { [string]$_ }) 2>$null
    foreach ($line in @($out)) {
        if ($line -match '^(\d+)\s+(\d+)$') { $map[[int]$matches[1]] = [int]$matches[2] }
    }
    return $map
}

function New-FakeHome([string]$p) {
    foreach ($s in @('Library/Application Support', 'Library/Caches', 'Library/Preferences', 'Library/Logs', 'Library/Saved Application State')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $p $s) | Out-Null
    }
}

function Start-AppWithHome([string]$exe, [string]$home) {
    $oldH = $env:HOME
    $oldC = $env:CFFIXED_USER_HOME
    $env:HOME = $home
    $env:CFFIXED_USER_HOME = $home
    try {
        $p = Start-Process -FilePath $exe -WorkingDirectory $home -PassThru
    } finally {
        $env:HOME = $oldH
        $env:CFFIXED_USER_HOME = $oldC
    }
    return $p
}

# ---------- dual-instance tests ----------
$SurvivalSeconds = 45

function Invoke-DualLaunchTest([string]$name, [string]$exeA, [string]$exeB, [string]$mechanism) {
    $tdir = Join-Path $work ("test_" + $name)
    New-Item -ItemType Directory -Force -Path $tdir | Out-Null
    $homeA = Join-Path $tdir 'homeA'
    $homeB = Join-Path $tdir 'homeB'
    $homeC = Join-Path $tdir 'homeC'
    New-FakeHome $homeA
    New-FakeHome $homeB
    New-FakeHome $homeC
    Stop-AllViber
    $t = [ordered]@{
        name = $name
        mechanism = $mechanism
        started_at_utc = (Get-UtcStamp)
        homeA = $homeA
        homeB = $homeB
        profileA_before = (Get-PathStat (Join-Path $homeA 'Library/Application Support'))
        profileB_before = (Get-PathStat (Join-Path $homeB 'Library/Application Support'))
        real_viber_before = [ordered]@{}
        samples = @()
        procA_windows_max = 0
        procB_windows_max = 0
        errors = @()
    }
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_before[$p] = Get-PathStat $p }
    $pA = $null; $pB = $null; $pC = $null
    $tStart = Get-Date
    try {
        $pA = Start-AppWithHome $exeA $homeA
        $t.procA_pid = $pA.Id
        $t.procA_launched_at_utc = (Get-UtcStamp)
        Write-Host ("[{0}] A pid={1}" -f $name, $pA.Id)
        Start-Sleep -Seconds 12
        $pB = Start-AppWithHome $exeB $homeB
        $t.procB_pid = $pB.Id
        $t.procB_launched_at_utc = (Get-UtcStamp)
        Write-Host ("[{0}] B pid={1}" -f $name, $pB.Id)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $thirdDone = $false
        while ($sw.Elapsed.TotalSeconds -lt $SurvivalSeconds) {
            Start-Sleep -Seconds 5
            try { $pA.Refresh() } catch {}
            try { $pB.Refresh() } catch {}
            $aAlive = -not $pA.HasExited
            $bAlive = -not $pB.HasExited
            $aExit = if ($pA.HasExited) { $pA.ExitCode } else { $null }
            $bExit = if ($pB.HasExited) { $pB.ExitCode } else { $null }
            $pids = @()
            if ($aAlive) { $pids += [int]$pA.Id }
            if ($bAlive) { $pids += [int]$pB.Id }
            $wins = Get-WindowCounts $pids
            $sample = [ordered]@{
                at_utc = (Get-UtcStamp)
                elapsed_s = [math]::Round($sw.Elapsed.TotalSeconds, 1)
                procA_alive = $aAlive
                procB_alive = $bAlive
                procA_exit_code = $aExit
                procB_exit_code = $bExit
                procA_windows = $wins[[int]$pA.Id]
                procB_windows = $wins[[int]$pB.Id]
                viber_process_count = @(Get-Pids 'Contents/MacOS/Viber').Count
                profileA = (Get-PathStat (Join-Path $homeA 'Library/Application Support'))
                profileB = (Get-PathStat (Join-Path $homeB 'Library/Application Support'))
                profileA_prefs = (Get-PathStat (Join-Path $homeA 'Library/Preferences'))
                profileB_prefs = (Get-PathStat (Join-Path $homeB 'Library/Preferences'))
                real_viber = [ordered]@{}
            }
            foreach ($p in (Get-ViberDataPaths)) { $sample.real_viber[$p] = Get-PathStat $p }
            $t.samples += $sample
            if (-not $thirdDone -and $sw.Elapsed.TotalSeconds -ge 22) {
                $thirdDone = $true
                try {
                    $pC = Start-AppWithHome $exeB $homeC
                    $t.third_instance = [ordered]@{ started_pid = $pC.Id; started_at_utc = (Get-UtcStamp); launched_after_s = [math]::Round($sw.Elapsed.TotalSeconds, 1) }
                    Write-Host ("[{0}] third pid={1}" -f $name, $pC.Id)
                } catch { $t.errors += "third launch: $($_.Exception.Message)" }
            }
        }
        if ($pC) {
            try { $pC.Refresh() } catch {}
            $aliveC = -not $pC.HasExited
            $t.third_instance.alive_at_window_end = $aliveC
            $t.third_instance.exit_code = if ($pC.HasExited) { $pC.ExitCode } else { $null }
            $t.third_instance.seconds_observed = [math]::Floor(($SurvivalSeconds - [double]$t.third_instance.launched_after_s))
        }
    } catch {
        $t.errors += $_.Exception.Message
    } finally {
        foreach ($pp in @($pA, $pB, $pC)) {
            if ($pp) { try { if (-not $pp.HasExited) { Stop-Process -Id $pp.Id -Force } } catch {} }
        }
        Stop-AllViber
    }
    $t.profileA_after = Get-PathStat (Join-Path $homeA 'Library/Application Support')
    $t.profileB_after = Get-PathStat (Join-Path $homeB 'Library/Application Support')
    $t.profileA_written = Test-StatWrote $t.profileA_before $t.profileA_after
    $t.profileB_written = Test-StatWrote $t.profileB_before $t.profileB_after
    $t.redirect_effective = $t.profileA_written -or $t.profileB_written
    $realAfter = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $realAfter[$p] = Get-PathStat $p }
    $t.real_viber_after = $realAfter
    $realWritten = $false
    foreach ($k in $realAfter.Keys) {
        $b = $t.real_viber_before[$k]
        if (Test-StatWrote $b $realAfter[$k]) { $realWritten = $true }
    }
    $t.real_viber_written = $realWritten
    if ($t.samples.Count -gt 0) {
        $lastOne = $t.samples[-1]
        $t.procA_alive_after_window = $lastOne.procA_alive
        $t.procB_alive_after_window = $lastOne.procB_alive
        $t.procB_exit_code = $lastOne.procB_exit_code
        $t.both_alive_full_window = ($lastOne.procA_alive -and $lastOne.procB_alive -and $lastOne.elapsed_s -ge 30)
        $t.procA_windows_max = [int](@($t.samples | ForEach-Object { $_.procA_windows } | Where-Object { $null -ne $_ } | Measure-Object -Maximum).Maximum)
        $t.procB_windows_max = [int](@($t.samples | ForEach-Object { $_.procB_windows } | Where-Object { $null -ne $_ } | Measure-Object -Maximum).Maximum)
        $t.procA_had_window = $t.procA_windows_max -gt 0
        $t.procB_had_window = $t.procB_windows_max -gt 0
    } else {
        $t.both_alive_full_window = $false
        $t.procA_had_window = $false
        $t.procB_had_window = $false
    }
    $t.result = if ($t.both_alive_full_window -and $t.procA_had_window -and $t.procB_had_window -and $t.profileA_written -and $t.profileB_written) { 'observed' } else { 'not_observed' }
    Write-Host ("[{0}] result={1} both={2} winsA={3} winsB={4} profA={5} profB={6}" -f $name, $t.result, $t.both_alive_full_window, $t.procA_windows_max, $t.procB_windows_max, $t.profileA_written, $t.profileB_written)
    return $t
}

function Invoke-OpenNTest([string]$appPath) {
    Stop-AllViber
    $t = [ordered]@{ name = 'open-n-same-bundle'; mechanism = 'open -n (LaunchServices request for a new instance, same real HOME/profile)'; started_at_utc = (Get-UtcStamp); samples = @(); errors = @() }
    $t.real_viber_before = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_before[$p] = Get-PathStat $p }
    $r1 = Run-Native 'open' @('-n', $appPath)
    $t.open1 = [ordered]@{ code = $r1.code; output = @($r1.output) }
    Start-Sleep -Seconds 12
    $t.pids_after_first = @(Get-Pids 'Contents/MacOS/Viber')
    $r2 = Run-Native 'open' @('-n', $appPath)
    $t.open2 = [ordered]@{ code = $r2.code; output = @($r2.output) }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 30) {
        Start-Sleep -Seconds 5
        $pids = @(Get-Pids 'Contents/MacOS/Viber')
        $wins = Get-WindowCounts $pids
        $t.samples += [ordered]@{
            at_utc = (Get-UtcStamp)
            elapsed_s = [math]::Round($sw.Elapsed.TotalSeconds, 1)
            viber_process_count = $pids.Count
            windows = @($pids | ForEach-Object { [ordered]@{ pid = [int]$_; windows = $wins[[int]$_] } })
        }
    }
    $pidsEnd = @(Get-Pids 'Contents/MacOS/Viber')
    $t.viber_process_count_end = $pidsEnd.Count
    $t.second_instance_observed = $pidsEnd.Count -ge 2
    $t.real_viber_after = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_after[$p] = Get-PathStat $p }
    Stop-AllViber
    Write-Host ("[open-n] open1={0} open2={1} procs_end={2}" -f $r1.code, $r2.code, $pidsEnd.Count)
    return $t
}

if ($inst.exe_exists) {
    $ev.launch_tests += Invoke-DualLaunchTest 'copied-bundles-fresh-homes' $inst.exeA $inst.exeB 'each instance: separate copied .app bundle + redirected HOME/CFFIXED_USER_HOME'
    Save-Evidence
    $ev.launch_tests += Invoke-DualLaunchTest 'same-bundle-fresh-homes' $inst.exeA $inst.exeA 'both instances: same .app bundle path, distinct redirected HOME/CFFIXED_USER_HOME'
    Save-Evidence
    $ev.launch_tests += Invoke-OpenNTest $inst.appA
    Save-Evidence
} else {
    $ev.install.errors += 'skipping launch tests: staged executable missing'
}

# ---------- locks snapshot with one instance running ----------
$lockHome = Join-Path $work 'homeLocks'
if ($inst.exe_exists) {
    New-FakeHome $lockHome
    Stop-AllViber
    $pl = $null
    try {
        $pl = Start-AppWithHome $inst.exeA $lockHome
        Start-Sleep -Seconds 10
        $ev.locks = [ordered]@{ collected_at_utc = (Get-UtcStamp); alive = (-not $pl.HasExited); lsof_unix = @(); data_listing = @(); errors = @() }
        try {
            $r = Run-Native 'lsof' @('-U', '-c', 'Viber')
            $ev.locks.lsof_unix = @($r.output | Select-Object -First 60)
        } catch { $ev.locks.errors += "lsof: $($_.Exception.Message)" }
        try {
            $support = Join-Path $HOME 'Library/Application Support'
            if (Test-Path $support) { $ev.locks.data_listing = @(& ls -la $support 2>$null | Where-Object { $_ -match 'viber' } | ForEach-Object { [string]$_ }) }
        } catch { $ev.locks.errors += "data listing: $($_.Exception.Message)" }
    } finally {
        if ($pl) { try { if (-not $pl.HasExited) { Stop-Process -Id $pl.Id -Force } } catch {} }
        Stop-AllViber
    }
}

# ---------- verdict ----------
$observed = @($ev.launch_tests | Where-Object { $_.result -eq 'observed' })
$dualTests = @($ev.launch_tests | Where-Object { $_.name -ne 'open-n-same-bundle' })
$reasons = @()
foreach ($t in $dualTests) {
    $reasons += ("{0}: both_alive_full_window={1}, windows A/B={2}/{3}, redirected-profile writes A/B={4}/{5}, real ~/Library writes={6}, B exit={7}" -f $t.name, $t.both_alive_full_window, $t.procA_windows_max, $t.procB_windows_max, $t.profileA_written, $t.profileB_written, $t.real_viber_written, $t.procB_exit_code)
}
foreach ($t in @($ev.launch_tests | Where-Object { $_.name -eq 'open-n-same-bundle' })) {
    $reasons += ("open -n: open exit codes {0}/{1}, Viber processes alive at end={2} (second_instance_observed={3})" -f $t.open1.code, $t.open2.code, $t.viber_process_count_end, $t.second_instance_observed)
}
$ev.verdict = [ordered]@{
    conclusion = if ($observed.Count -gt 0) { 'feasible' } else { 'infeasible' }
    summary    = if ($observed.Count -gt 0) { 'At least one launch test met all criteria (dual survival >=30s, windows per process, redirected profile writes per dir).' } else { 'Isolation of a second Viber instance on the macOS runner could not be demonstrated with the evidence collected.' }
    reasons    = $reasons
    window_tool_available = $script:winlistOk
}
Save-Evidence

# ---------- cleanup ----------
if ($mountedNow) { Run-Native 'hdiutil' @('detach', $mnt, '-force') | Out-Null }
Write-Host ("verdict: {0}" -f $ev.verdict.conclusion)
Write-Host ("evidence written: {0}" -f $outFile)
