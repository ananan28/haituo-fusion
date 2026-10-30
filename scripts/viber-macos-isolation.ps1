$ErrorActionPreference = 'Stop'

$root = (Get-Location).Path
$outDir = Join-Path $root 'audit-results'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir 'viber-macos-isolation.json'
$work = Join-Path $env:RUNNER_TEMP 'viber_macos_probe'
New-Item -ItemType Directory -Force -Path $work | Out-Null

$InitTimeout = 150
$SecondWindow = 90
$ShortWindow = 60

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
    foreach ($rel in @('Library/Application Support', 'Library/Preferences', 'Library/Caches', 'Library/Containers', 'Library/Group Containers', 'Library/WebKit', 'Library/HTTPStorages', 'Library/Saved Application State')) {
        $base = Join-Path $HOME $rel
        if (Test-Path $base) {
            $res += @(Get-ChildItem $base -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'viber' } | ForEach-Object { $_.FullName })
        }
    }
    return @($res | Select-Object -Unique)
}

function Stop-AllViber {
    & killall -9 Viber 2>$null | Out-Null
    Start-Sleep -Seconds 2
}

$ev = [ordered]@{
    schema = 'haituo-fusion/viber-macos-isolation/v4'
    generated_at_utc = (Get-UtcStamp)
    runner = [ordered]@{}
    baseline = [ordered]@{}
    download = [ordered]@{ attempts = @(); dmg_path = $null; dmg_url = $null }
    install = [ordered]@{}
    window_check = [ordered]@{}
    launch_tests = @()
    locks = [ordered]@{}
    guard_object = [ordered]@{}
    errors = @()
    scope_limitations = [ordered]@{
        host = 'GitHub Actions macos-latest runner (one GUI session, one user)'
        account_verification = 'none: no real Viber accounts or credentials are used anywhere in this probe'
        verified_scope = 'process survival, per-PID windows (CGWindowList), per-PID unix sockets and TCP endpoints, profile-directory writes, /private/tmp and DARWIN_USER_TEMP_DIR contents'
        not_verified = 'separate macOS user account (no second GUI login session on CI); LSEnvironment HOME redirect through LaunchServices; per-instance network egress; real dual-account messaging'
    }
    verdict = [ordered]@{}
}

function Save-Evidence {
    try {
        $json = $ev | ConvertTo-Json -Depth 12
        [System.IO.File]::WriteAllText($outFile, $json, (New-Object System.Text.UTF8Encoding($false)))
    } catch {
        Write-Host ("!! evidence save failed: {0}" -f $_.Exception.Message)
    }
}
Save-Evidence

# ---------- runner + baseline ----------
$ev.runner.os_name = (@(& sw_vers -productName 2>$null) -join '')
$ev.runner.os_version = (@(& sw_vers -productVersion 2>$null) -join '')
$ev.runner.arch = (@(& uname -m 2>$null) -join '')
$ev.runner.ps_version = $PSVersionTable.PSVersion.ToString()
$ev.runner.user = $env:USER
$ev.runner.home = $HOME
$ev.runner.windowserver = [bool](& pgrep -x WindowServer 2>$null)
try { $ev.runner.rosetta_available = ((Run-Native 'arch' @('-x86_64', '/usr/bin/true')).code -eq 0) } catch { $ev.runner.rosetta_available = $null }
$ev.baseline.viber_processes = @(Get-Pids 'Contents/MacOS/Viber').Count
$ev.baseline.viber_data_paths = @(Get-ViberDataPaths)
$ev.baseline.viber_data_stats = [ordered]@{}
foreach ($p in $ev.baseline.viber_data_paths) { $ev.baseline.viber_data_stats[$p] = Get-PathStat $p }
Save-Evidence
Write-Host ("runner: {0} {1} {2} user={3} rosetta={4}" -f $ev.runner.os_name, $ev.runner.os_version, $ev.runner.arch, $ev.runner.user, $ev.runner.rosetta_available)

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
    $q1 = Run-Native 'xattr' @('-dr', 'com.apple.quarantine', $appA)
    $q2 = Run-Native 'xattr' @('-dr', 'com.apple.quarantine', $appB)
    $inst.quarantine_strip_codes = @($q1.code, $q2.code)
    $inst.quarantine_remaining = @(& xattr -r $appA 2>$null | Where-Object { $_ -match 'quarantine' } | Select-Object -First 5)
    $plist = Join-Path $appA 'Contents/Info.plist'
    $exeName = (@(& plutil -extract CFBundleExecutable raw -o - $plist 2>$null) -join '').Trim()
    if (-not $exeName) { $exeName = 'Viber' }
    $inst.bundle_executable = $exeName
    $inst.app_version = (@(& plutil -extract CFBundleShortVersionString raw -o - $plist 2>$null) -join '').Trim()
    $inst.app_build = (@(& plutil -extract CFBundleVersion raw -o - $plist 2>$null) -join '').Trim()
    $inst.min_macos = (@(& plutil -extract LSMinimumSystemVersion raw -o - $plist 2>$null) -join '').Trim()
    $inst.bundle_id = (@(& plutil -extract CFBundleIdentifier raw -o - $plist 2>$null) -join '').Trim()
    $inst.plist_flags = @(& plutil -p $plist 2>$null | Where-Object { $_ -match 'MultipleInstances|LSEnvironment|LSUIElement|LSBackgroundOnly|CFBundleIdentifier' })
    $inst.appA = $appA
    $inst.appB = $appB
    $inst.exeA = Join-Path $appA "Contents/MacOS/$exeName"
    $inst.exeB = Join-Path $appB "Contents/MacOS/$exeName"
    $inst.exe_exists = (Test-Path $inst.exeA) -and (Test-Path $inst.exeB)
    $vs = Run-Native 'codesign' @('--verify', '--strict', $appA)
    $inst.copy_verify = [ordered]@{ code = $vs.code; output = @($vs.output | Select-Object -First 5) }
    $lipo = Run-Native 'lipo' @('-info', $inst.exeA)
    $inst.arch_info = @($lipo.output | Select-Object -First 5)
    $inst.bundle_size_bytes = (Get-ChildItem $appA -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    try {
        $inst.cli_profile_flags = @(& grep -a -o -E -- '--(user-data-dir|profile|data-dir|userdir)[A-Za-z0-9=-]*' $inst.exeA 2>$null | Select-Object -Unique -First 20)
    } catch { $inst.cli_profile_flags = @() }
    try {
        $inst.socket_name_strings = @(& grep -a -o -E 'Viber-[0-9]+-[0-9]+|Viber-[0-9]+' $inst.exeA 2>$null | Select-Object -Unique -First 10)
    } catch { $inst.socket_name_strings = @() }
    try {
        $inst.qlocalserver_symbol = [int](@(& grep -a -c 'QLocalServer' $inst.exeA 2>$null) | Select-Object -First 1)
    } catch { $inst.qlocalserver_symbol = $null }
}
$ev.install = $inst
Save-Evidence
Write-Host ("install: mounted={0} exe_exists={1} version={2} arch={3}" -f $inst.mounted, $inst.exe_exists, $inst.app_version, ($inst.arch_info -join ' '))

# ---------- window counter (Swift -> CGWindowList) ----------
$winSrc = Join-Path $work 'winlist.swift'
@'
import Foundation
import CoreGraphics
var screens: UInt32 = 0
CGGetActiveDisplayList(0, nil, &screens)
print("screens \(screens)")
var total = 0
var owners = [Int32: Int]()
if let list = CGWindowListCopyWindowInfo(CGWindowListOption(rawValue: 0), 0) as? [[String: Any]] {
    total = list.count
    for w in list {
        if let p = w[kCGWindowOwnerPID as String] as? Int32 { owners[p, default: 0] += 1 }
    }
}
print("total \(total)")
for p in CommandLine.arguments.dropFirst().compactMap({ Int32($0) }) { print("\(p) \(owners[p] ?? 0)") }
'@ | Set-Content -Path $winSrc -Encoding utf8
$winExe = Join-Path $work 'winlist'
$x = Run-Native 'xcrun' @('swiftc', '-O', '-o', $winExe, $winSrc)
$script:winlistOk = ($x.code -eq 0) -and (Test-Path $winExe)
$script:winScreens = $null
$script:winTotal = $null
if ($script:winlistOk) {
    try {
        $diag = @(& $winExe 2>$null)
        foreach ($line in $diag) {
            if ($line -match '^screens (\d+)$') { $script:winScreens = [int]$matches[1] }
            if ($line -match '^total (\d+)$') { $script:winTotal = [int]$matches[1] }
        }
    } catch {}
}
$ev.window_check = [ordered]@{
    method         = 'CGWindowListCopyWindowInfo (optionAll) via compiled Swift helper, counted per owner PID'
    compiled       = $script:winlistOk
    tool           = $winExe
    compile_exit   = $x.code
    compile_output = @($x.output | Select-Object -First 30)
    screens        = $script:winScreens
    total_windows_system = $script:winTotal
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

function Start-App([string]$exe, [string]$wd, [string]$logBase) {
    if ($logBase) {
        return Start-Process -FilePath $exe -WorkingDirectory $wd -PassThru -RedirectStandardOutput "$logBase.out.log" -RedirectStandardError "$logBase.err.log"
    }
    return Start-Process -FilePath $exe -WorkingDirectory $wd -PassThru
}

function Start-AppWithHome([string]$exe, [string]$fakeHome, [string]$logBase) {
    $oldH = $env:HOME
    $oldC = $env:CFFIXED_USER_HOME
    $env:HOME = $fakeHome
    $env:CFFIXED_USER_HOME = $fakeHome
    try {
        $p = Start-App $exe $fakeHome $logBase
    } finally {
        $env:HOME = $oldH
        $env:CFFIXED_USER_HOME = $oldC
    }
    return $p
}

function Start-AppWithEnv([string]$exe, [hashtable]$Env, [string]$wd, [string]$logBase) {
    $saved = @{}
    if ($Env) {
        foreach ($k in @($Env.Keys)) {
            $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
            [Environment]::SetEnvironmentVariable($k, [string]$Env[$k], 'Process')
        }
    }
    try {
        return Start-App $exe $wd $logBase
    } finally {
        foreach ($k in @($saved.Keys)) {
            [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process')
        }
    }
}

function Get-DarwinTempDir {
    $d = $null
    try { $d = (@(& getconf DARWIN_USER_TEMP_DIR 2>$null) -join '').Trim() } catch {}
    if (-not $d) { $d = $env:TMPDIR }
    return $d
}

function Get-ViberSocketInventory([int]$TargetPid) {
    $res = [ordered]@{ pid = $TargetPid; unix = @(); net = @(); sensitive_files = @(); errors = @() }
    if ($TargetPid -le 0) { return $res }
    try {
        $r = Run-Native 'lsof' @('-a', '-p', "$TargetPid", '-Fn')
        $res.sensitive_files = @($r.output | Where-Object { $_ -like 'n*' } | ForEach-Object { $_.Substring(1) } | Where-Object { $_ -match '(?i)keychain|Group Containers|Containers/com\.viber|Preferences/com\.viber|Saved Application State' } | Select-Object -Unique)
    } catch { $res.errors += "lsof -F: $($_.Exception.Message)" }
    try {
        $r = Run-Native 'lsof' @('-a', '-p', "$TargetPid", '-U', '-Fn')
        $res.unix = @($r.output | Where-Object { $_ -like 'n*' } | ForEach-Object { $_.Substring(1) } | Select-Object -Unique)
    } catch { $res.errors += "lsof -U: $($_.Exception.Message)" }
    try {
        $r = Run-Native 'lsof' @('-a', '-p', "$TargetPid", '-i', '-Fn')
        $res.net = @($r.output | Where-Object { $_ -like 'n*' } | ForEach-Object { $_.Substring(1) } | Select-Object -Unique)
    } catch { $res.errors += "lsof -i: $($_.Exception.Message)" }
    return $res
}

function Get-TempViberItems {
    $res = [ordered]@{ dirs = @(); user_temp = @(); private_tmp = @(); errors = @() }
    $dirs = @('/private/tmp', (Get-DarwinTempDir)) | Where-Object { $_ } | Select-Object -Unique
    $res.dirs = @($dirs)
    foreach ($d in $dirs) {
        try {
            if (-not (Test-Path $d)) { continue }
            $items = @(Get-ChildItem $d -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)viber' } | Select-Object -First 30 | ForEach-Object {
                [ordered]@{ path = $_.FullName; kind = $(if ($_.PSIsContainer) { 'dir' } else { 'file' }); bytes = $_.Length; mtime_utc = $_.LastWriteTimeUtc.ToString('o') }
            })
            if ($d -eq '/private/tmp') { $res.private_tmp = $items } else { $res.user_temp = @($items) }
        } catch { $res.errors += "scan ${d}: $($_.Exception.Message)" }
    }
    return $res
}

function Get-ViberLockFiles {
    $res = @()
    foreach ($rel in @('Library/Application Support/ViberPC', 'Library/Application Support/com.viber.osx', 'Library/Caches/com.viber.osx')) {
        $base = Join-Path $HOME $rel
        if (-not (Test-Path $base)) { continue }
        try {
            $res += @(Get-ChildItem $base -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)(\.lock$|\.sock$|\.pid$|socket|singleton)' } | Select-Object -First 25 | ForEach-Object { $_.FullName })
        } catch {}
    }
    return @($res | Select-Object -Unique)
}

function Get-RealDomainPaths {
    $c = @(
        'Library/Preferences/com.viber.osx.plist',
        'Library/Keychains/login.keychain-db',
        'Library/Containers/com.viber.osx.macvibershare',
        'Library/Containers/com.viber.osx',
        'Library/Saved Application State/com.viber.osx.savedState',
        'Library/HTTPStorages/com.viber.osx',
        'Library/Caches/com.viber.osx',
        'Library/Application Support/com.viber.osx',
        'Library/Application Support/ViberPC'
    )
    $paths = @($c | ForEach-Object { Join-Path $HOME $_ } | Where-Object { Test-Path $_ })
    $gc = Join-Path $HOME 'Library/Group Containers'
    if (Test-Path $gc) {
        $paths += @(Get-ChildItem $gc -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)viber' } | ForEach-Object { $_.FullName })
    }
    return @($paths)
}

function Get-IsolationAudit {
    $res = [ordered]@{ at_utc = (Get-UtcStamp); paths = @() }
    foreach ($p in (Get-RealDomainPaths)) {
        $res.paths += [ordered]@{ path = $p; stat = (Get-PathStat $p) }
    }
    return $res
}

function Compare-IsolationAudit($Before, $After) {
    $changed = @()
    if (-not $Before -or -not $After) { return $changed }
    foreach ($b in $Before.paths) {
        $a = @($After.paths | Where-Object { $_.path -eq $b.path })
        if ($a.Count -eq 0) { continue }
        if (Test-StatWrote $b.stat $a[0].stat) { $changed += $b.path }
    }
    return @($changed)
}

function Get-PrefsPlistKeys {
    $p = Join-Path $HOME 'Library/Preferences/com.viber.osx.plist'
    if (-not (Test-Path $p)) { return $null }
    $keys = @()
    try {
        $r = Run-Native 'plutil' @('-convert', 'xml1', '-o', '-', $p)
        $keys = @($r.output | Where-Object { $_ -match '<key>' } | ForEach-Object { ($_ -replace '.*<key>', '' -replace '</key>.*', '') } | Select-Object -Unique)
    } catch {}
    $bytes = $null
    try { $bytes = (Get-Item $p).Length } catch {}
    return [ordered]@{ path = $p; key_count = $keys.Count; keys = @($keys | Select-Object -First 80); bytes = $bytes }
}

function Get-ProfileManifest([string]$homeRoot) {
    $root = Join-Path $homeRoot 'Library/Application Support/ViberPC'
    if (-not (Test-Path $root)) { return [ordered]@{ root = $root; exists = $false; files = 0; digest = $null; content_digest = $null; top = @() } }
    $sha = $null
    try { $sha = [System.Security.Cryptography.SHA256]::Create() } catch {}
    $entries = @()
    foreach ($f in @(Get-ChildItem $root -Recurse -Force -File -ErrorAction SilentlyContinue)) {
        $rel = $f.FullName.Substring($root.Length + 1)
        $ch = $null
        try { if ($sha) { $ch = ([BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes($f.FullName))) -replace '-', '').ToLower().Substring(0, 16) } } catch {}
        $entries += ('{0}|{1}|{2}' -f $rel, $f.Length, $ch)
    }
    $entries = @($entries | Sort-Object)
    $digest = $null; $contentDigest = $null
    try {
        if ($sha) {
            $digest = ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes(($entries -join "`n")))) -replace '-', '').ToLower()
            $contentDigest = ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes((@($entries | ForEach-Object { ($_ -split '\|')[2] }) -join "`n")))) -replace '-', '').ToLower()
        }
    } catch {}
    $db = Join-Path $root 'config.db'
    $inode = $null
    if (Test-Path $db) {
        try {
            $r = Run-Native 'stat' @('-f', '%i:%d', $db)
            if ($r.output -and $r.output.Count -gt 0) { $inode = [string]$r.output[0] }
        } catch {}
    }
    return [ordered]@{ root = $root; exists = $true; files = $entries.Count; digest = $digest; content_digest = $contentDigest; config_db_inode = $inode; top = @($entries | Select-Object -First 15) }
}

function Read-LogTail([string]$path, [int]$lines) {
    if (-not (Test-Path $path)) { return $null }
    return @(Get-Content $path -Tail $lines -ErrorAction SilentlyContinue)
}

function Get-Snapshot([string]$FakeHome, [bool]$TrackReal, [double]$Elapsed) {
    $pids = @(Get-Pids 'Contents/MacOS/Viber')
    $wins = Get-WindowCounts $pids
    $s = [ordered]@{
        at_utc = (Get-UtcStamp)
        elapsed_s = $Elapsed
        pids = @($pids)
        windows = @($pids | ForEach-Object { [ordered]@{ pid = [int]$_; windows = $wins[[int]$_] } })
        viber_process_count = $pids.Count
    }
    if ($FakeHome) { $s.fake_home = Get-PathStat $FakeHome }
    if ($TrackReal) {
        $s.real_viber = [ordered]@{}
        foreach ($p in (Get-ViberDataPaths)) { $s.real_viber[$p] = Get-PathStat $p }
    }
    return $s
}

function Wait-ForWindow {
    param(
        [int]$TimeoutSec,
        [int]$WaitPid = 0,
        [int]$MinPidCount = 0,
        [string]$FakeHome = $null,
        [bool]$TrackReal = $false
    )
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $samples = @()
    $ready = $false
    $latency = $null
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        Start-Sleep -Seconds 5
        $s = Get-Snapshot $FakeHome $TrackReal ([math]::Round($sw.Elapsed.TotalSeconds, 1))
        $samples += $s
        if ($WaitPid -gt 0) {
            foreach ($w in $s.windows) { if ($w.pid -eq $WaitPid -and $null -ne $w.windows -and $w.windows -gt 0) { $ready = $true } }
        } elseif ($MinPidCount -gt 0) {
            if ($s.viber_process_count -ge $MinPidCount) { $ready = $true }
        } else {
            foreach ($w in $s.windows) { if ($null -ne $w.windows -and $w.windows -gt 0) { $ready = $true } }
        }
        if ($ready) { $latency = $s.elapsed_s; break }
    }
    return [ordered]@{ samples = $samples; ready = $ready; latency_s = $latency }
}

function Get-WindowsMax($Samples) {
    $m = 0
    foreach ($s in $Samples) {
        foreach ($w in $s.windows) { if ($null -ne $w.windows -and $w.windows -gt $m) { $m = [int]$w.windows } }
    }
    return $m
}

function Get-PidWindowsMax($Samples, [int]$TargetPid) {
    $m = 0
    foreach ($s in $Samples) {
        foreach ($w in $s.windows) { if ($w.pid -eq $TargetPid -and $null -ne $w.windows -and $w.windows -gt $m) { $m = [int]$w.windows } }
    }
    return $m
}

function Test-RealWrites($Before, $After) {
    foreach ($k in @($After.Keys)) {
        if (Test-StatWrote $Before[$k] $After[$k]) { return $true }
    }
    return $false
}

function Stop-ProcQuiet($p) {
    if ($p) { try { $p.Refresh(); if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } } catch {} }
}

function Invoke-SingleBaseline([string]$appPath) {
    Stop-AllViber
    $t = [ordered]@{ name = 'single-baseline-open-a'; mechanism = 'open -a ViberA.app, single instance, real HOME'; started_at_utc = (Get-UtcStamp); errors = @() }
    $t.real_viber_before = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_before[$p] = Get-PathStat $p }
    $r = Run-Native 'open' @($appPath)
    $t.open = [ordered]@{ code = $r.code; output = @($r.output) }
    $w = Wait-ForWindow -TimeoutSec $InitTimeout -TrackReal $true
    $t.samples = $w.samples
    $t.app_functional = $w.ready
    $t.latency_s = $w.latency_s
    if ($w.ready) {
        Start-Sleep -Seconds 10
        $settle = Get-Snapshot $null $true 0
        $t.settle_sample = $settle
        $t.samples = @($t.samples + $settle)
    }
    $t.windows_max = Get-WindowsMax $t.samples
    $pidsEnd = @(Get-Pids 'Contents/MacOS/Viber')
    $t.viber_process_count_end = $pidsEnd.Count
    if ($pidsEnd.Count -gt 0) {
        $psr = Run-Native 'ps' @('-o', 'pid=,ppid=,stat=,etime=,command=', '-p', ($pidsEnd -join ','))
        $t.ps = @($psr.output | Select-Object -First 10)
    }
    $t.real_viber_after = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_after[$p] = Get-PathStat $p }
    $t.real_viber_written = Test-RealWrites $t.real_viber_before $t.real_viber_after
    Stop-AllViber
    Write-Host ("[single-baseline] functional={0} latency={1}s wins_max={2} real_writes={3}" -f $t.app_functional, $t.latency_s, $t.windows_max, $t.real_viber_written)
    return $t
}

function Invoke-SingleDirectExec([string]$exe, [string]$FakeHome, [string]$name) {
    Stop-AllViber
    $tdir = Join-Path $work ("test_" + $name)
    New-Item -ItemType Directory -Force -Path $tdir | Out-Null
    $mode = if ($FakeHome) { 'redirected HOME/CFFIXED_USER_HOME' } else { 'real HOME' }
    $t = [ordered]@{ name = $name; mechanism = "Contents/MacOS/Viber executed directly (Start-Process), $mode"; started_at_utc = (Get-UtcStamp); errors = @() }
    $t.real_viber_before = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_before[$p] = Get-PathStat $p }
    if ($FakeHome) {
        New-FakeHome $FakeHome
        $t.fake_home = $FakeHome
        $t.fake_home_before = Get-PathStat $FakeHome
        $p = Start-AppWithHome $exe $FakeHome (Join-Path $tdir 'single')
    } else {
        $p = Start-App $exe $tdir (Join-Path $tdir 'single')
    }
    $t.proc_pid = $p.Id
    $w = Wait-ForWindow -TimeoutSec $InitTimeout -FakeHome $FakeHome -TrackReal $true
    $t.samples = $w.samples
    $t.app_functional = $w.ready
    $t.latency_s = $w.latency_s
    $t.windows_max = Get-WindowsMax $w.samples
    $t.stderr_tail = Read-LogTail (Join-Path $tdir 'single.err.log') 20
    $t.stdout_tail = Read-LogTail (Join-Path $tdir 'single.out.log') 10
    if ($FakeHome) {
        $t.fake_home_after = Get-PathStat $FakeHome
        $t.fake_home_written = Test-StatWrote $t.fake_home_before $t.fake_home_after
    }
    $t.real_viber_after = [ordered]@{}
    foreach ($p2 in (Get-ViberDataPaths)) { $t.real_viber_after[$p2] = Get-PathStat $p2 }
    $t.real_viber_written = Test-RealWrites $t.real_viber_before $t.real_viber_after
    try { $p.Refresh(); $t.alive_at_end = -not $p.HasExited } catch {}
    Stop-ProcQuiet $p
    Stop-AllViber
    Write-Host ("[{0}] functional={1} latency={2}s wins_max={3} fake_writes={4}" -f $name, $t.app_functional, $t.latency_s, $t.windows_max, $t.fake_home_written)
    return $t
}

function Invoke-DualDirectExec([string]$exeA, [string]$exeB) {
    Stop-AllViber
    $tdir = Join-Path $work 'test_dual_direct'
    New-Item -ItemType Directory -Force -Path $tdir | Out-Null
    $homeB = Join-Path $tdir 'homeB'
    New-FakeHome $homeB
    $t = [ordered]@{
        name = 'dual-direct-exec-fake-home'
        mechanism = 'A: direct exec real HOME; B: second copied bundle direct exec with HOME/CFFIXED_USER_HOME redirected'
        started_at_utc = (Get-UtcStamp)
        homeB = $homeB
        fake_home_before = (Get-PathStat $homeB)
        real_viber_before = [ordered]@{}
        errors = @()
    }
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_before[$p] = Get-PathStat $p }
    $pA = $null; $pB = $null
    try {
        $pA = Start-App $exeA $tdir (Join-Path $tdir 'A')
        $t.procA_pid = $pA.Id
        Write-Host ("[dual-direct] A pid={0}" -f $pA.Id)
        $wa = Wait-ForWindow -TimeoutSec $InitTimeout -TrackReal $true
        $t.first_instance_functional = $wa.ready
        $t.first_latency_s = $wa.latency_s
        $t.a_samples = $wa.samples
        $t.a_windows_max = Get-WindowsMax $wa.samples
        if ($wa.ready) {
            $pB = Start-AppWithHome $exeB $homeB (Join-Path $tdir 'B')
            $t.procB_pid = $pB.Id
            Write-Host ("[dual-direct] B pid={0}" -f $pB.Id)
            $wb = Wait-ForWindow -TimeoutSec $SecondWindow -WaitPid $pB.Id -FakeHome $homeB -TrackReal $true
            $t.b_samples = $wb.samples
            $t.b_window = $wb.ready
            $t.b_latency_s = $wb.latency_s
            $t.b_windows_max = Get-PidWindowsMax $wb.samples $pB.Id
            $t.b_stderr_tail = Read-LogTail (Join-Path $tdir 'B.err.log') 20
            $t.b_stdout_tail = Read-LogTail (Join-Path $tdir 'B.out.log') 10
        } else {
            $t.b_window = $false
            $t.b_samples = @()
        }
    } catch {
        $t.errors += $_.Exception.Message
    } finally {
        $t.fake_home_after = Get-PathStat $homeB
        $t.fake_home_written = Test-StatWrote $t.fake_home_before $t.fake_home_after
        if ($pA) { try { $pA.Refresh(); $t.a_alive_end = -not $pA.HasExited } catch { $t.a_alive_end = $false } }
        if ($pB) {
            try { $pB.Refresh(); $t.b_alive_end = -not $pB.HasExited; if ($pB.HasExited) { $t.b_exit_code = $pB.ExitCode } } catch {}
        }
        $t.real_viber_after = [ordered]@{}
        foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_after[$p] = Get-PathStat $p }
        $t.real_viber_written = Test-RealWrites $t.real_viber_before $t.real_viber_after
        Stop-ProcQuiet $pA
        Stop-ProcQuiet $pB
        Stop-AllViber
    }
    $t.second_instance_usable = ($t.first_instance_functional -eq $true) -and ($t.b_window -eq $true) -and ($t.fake_home_written -eq $true) -and ($t.a_alive_end -eq $true)
    Write-Host ("[dual-direct] first={0} b_window={1} fake_writes={2} usable={3}" -f $t.first_instance_functional, $t.b_window, $t.fake_home_written, $t.second_instance_usable)
    return $t
}

function Invoke-DualOpenCopies([string]$appA, [string]$appB) {
    Stop-AllViber
    $tdir = Join-Path $work 'test_dual_open'
    New-Item -ItemType Directory -Force -Path $tdir | Out-Null
    $t = [ordered]@{ name = 'dual-open-a-copied-bundle'; mechanism = 'A then B both launched through LaunchServices (open -a), two copied bundles, real HOME'; started_at_utc = (Get-UtcStamp); errors = @() }
    $t.real_viber_before = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_before[$p] = Get-PathStat $p }
    $r1 = Run-Native 'open' @($appA)
    $t.open1 = [ordered]@{ code = $r1.code; output = @($r1.output) }
    $wa = Wait-ForWindow -TimeoutSec $InitTimeout -TrackReal $true
    $t.first_instance_functional = $wa.ready
    $t.first_latency_s = $wa.latency_s
    $t.a_samples = $wa.samples
    $before = @(Get-Pids 'Contents/MacOS/Viber')
    $t.pids_before_second = $before
    $r2 = Run-Native 'open' @($appB)
    $t.open2 = [ordered]@{ code = $r2.code; output = @($r2.output) }
    $spawn = Wait-ForWindow -TimeoutSec 30 -MinPidCount ($before.Count + 1) -TrackReal $true
    $t.spawn_samples = $spawn.samples
    $t.second_process_spawned = $spawn.ready
    $afterSpawn = @(Get-Pids 'Contents/MacOS/Viber')
    $t.new_pids = @($afterSpawn | Where-Object { $before -notcontains $_ })
    $t.new_window = 0
    $t.new_window_ready = $false
    if ($t.new_pids.Count -gt 0) {
        $target = [int]$t.new_pids[0]
        $wo = Wait-ForWindow -TimeoutSec $SecondWindow -WaitPid $target -TrackReal $true
        $t.b_samples = $wo.samples
        $t.new_window_ready = $wo.ready
        $t.new_window_latency_s = $wo.latency_s
        $t.new_window = Get-PidWindowsMax $wo.samples $target
        $t.new_pid_alive_end = (@(Get-Pids 'Contents/MacOS/Viber') -contains $target)
    } else {
        $t.b_samples = @()
    }
    $t.samples = @($t.spawn_samples + $t.b_samples)
    $after = @(Get-Pids 'Contents/MacOS/Viber')
    $t.pids_at_end = $after
    $t.viber_process_count_end = $after.Count
    $t.real_viber_after = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_after[$p] = Get-PathStat $p }
    $t.real_viber_written = Test-RealWrites $t.real_viber_before $t.real_viber_after
    $t.isolated_profile_written = $false
    $t.second_instance_usable = ($t.first_instance_functional -eq $true) -and ($t.new_window_ready -eq $true) -and ($t.isolated_profile_written -eq $true)
    Stop-AllViber
    Write-Host ("[dual-open] first={0} spawned={1} new_pids={2} new_window={3}" -f $t.first_instance_functional, $t.second_process_spawned, (($t.new_pids) -join ','), $t.new_window)
    return $t
}

function Invoke-OpenNTest([string]$appPath) {
    Stop-AllViber
    $t = [ordered]@{ name = 'open-n-same-bundle'; mechanism = 'A via open -a; second instance requested with open -n (same bundle, real HOME)'; started_at_utc = (Get-UtcStamp); errors = @() }
    $t.real_viber_before = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_before[$p] = Get-PathStat $p }
    $r1 = Run-Native 'open' @($appPath)
    $t.open1 = [ordered]@{ code = $r1.code; output = @($r1.output) }
    $wa = Wait-ForWindow -TimeoutSec $InitTimeout
    $t.first_functional = $wa.ready
    $t.first_latency_s = $wa.latency_s
    $first = @(Get-Pids 'Contents/MacOS/Viber')
    $t.pids_before_open_n = $first
    $r2 = Run-Native 'open' @('-n', $appPath)
    $t.open2 = [ordered]@{ code = $r2.code; output = @($r2.output) }
    Start-Sleep -Seconds 2
    $t.pids_after_open2 = @(Get-Pids 'Contents/MacOS/Viber')
    $spawn = Wait-ForWindow -TimeoutSec 30 -MinPidCount ($first.Count + 1)
    $t.spawn_samples = $spawn.samples
    $afterSpawn = @(Get-Pids 'Contents/MacOS/Viber')
    $t.new_pids = @($afterSpawn | Where-Object { $first -notcontains $_ })
    $t.second_instance_observed = $t.new_pids.Count -gt 0
    $t.new_window = 0
    $t.new_window_ready = $false
    if ($t.new_pids.Count -gt 0) {
        $target = [int]$t.new_pids[0]
        $wo = Wait-ForWindow -TimeoutSec $ShortWindow -WaitPid $target
        $t.b_samples = $wo.samples
        $t.new_window_ready = $wo.ready
        $t.new_window_latency_s = $wo.latency_s
        $t.new_window = Get-PidWindowsMax $wo.samples $target
        $t.new_pid_alive_end = (@(Get-Pids 'Contents/MacOS/Viber') -contains $target)
    } else {
        $t.b_samples = @()
    }
    $t.samples = @($t.spawn_samples + $t.b_samples)
    $pidsEnd = @(Get-Pids 'Contents/MacOS/Viber')
    $t.viber_process_count_end = $pidsEnd.Count
    if ($pidsEnd.Count -gt 0) {
        $psr = Run-Native 'ps' @('-o', 'pid=,ppid=,stat=,etime=,command=', '-p', ($pidsEnd -join ','))
        $t.ps = @($psr.output | Select-Object -First 10)
    }
    $t.real_viber_after = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_after[$p] = Get-PathStat $p }
    Stop-AllViber
    Write-Host ("[open-n] open1={0} open2={1} first_ready={2} procs_end={3}" -f $t.open1.code, $t.open2.code, $t.first_functional, $pidsEnd.Count)
    return $t
}

function Invoke-DualEnvTest {
    param(
        [string]$exeA,
        [string]$exeB,
        [string]$name,
        [string]$mechanism,
        [hashtable]$envA = $null,
        [hashtable]$envB = $null,
        [string]$homeA = $null,
        [string]$homeB = $null,
        [string]$tmpA = $null,
        [string]$tmpB = $null,
        [int]$bTimeout = 150
    )
    Stop-AllViber
    $tdir = Join-Path $work ("test_" + $name)
    New-Item -ItemType Directory -Force -Path $tdir | Out-Null
    $t = [ordered]@{
        name = $name; mechanism = $mechanism; started_at_utc = (Get-UtcStamp)
        envA = $envA; envB = $envB; homeA = $homeA; homeB = $homeB; tmpA = $tmpA; tmpB = $tmpB
        errors = @()
    }
    foreach ($h in @($homeA, $homeB)) { if ($h) { New-FakeHome $h } }
    foreach ($d in @($tmpA, $tmpB)) { if ($d) { New-Item -ItemType Directory -Force -Path $d | Out-Null } }
    $t.fake_home_before = [ordered]@{}
    foreach ($h in @($homeA, $homeB)) { if ($h) { $t.fake_home_before[$h] = Get-PathStat $h } }
    $t.temp_before = Get-TempViberItems
    $t.real_viber_before = [ordered]@{}
    foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_before[$p] = Get-PathStat $p }
    $t.isolation_before = Get-IsolationAudit
    $pA = $null; $pB = $null
    try {
        $wdA = if ($homeA) { $homeA } else { $tdir }
        $pA = Start-AppWithEnv $exeA $envA $wdA (Join-Path $tdir 'A')
        $t.procA_pid = $pA.Id
        Write-Host ("[{0}] A pid={1}" -f $name, $pA.Id)
        $wa = Wait-ForWindow -TimeoutSec $InitTimeout -TrackReal $true
        $t.a_window = $wa.ready
        $t.a_latency_s = $wa.latency_s
        $t.a_samples = $wa.samples
        $t.a_windows_max = Get-PidWindowsMax $wa.samples $pA.Id
        $t.sockets_a = Get-ViberSocketInventory $pA.Id
        $t.temp_after_a = Get-TempViberItems
        if ($wa.ready) {
            $wdB = if ($homeB) { $homeB } else { $tdir }
            $pB = Start-AppWithEnv $exeB $envB $wdB (Join-Path $tdir 'B')
            $t.procB_pid = $pB.Id
            Write-Host ("[{0}] B pid={1}" -f $name, $pB.Id)
            Start-Sleep -Seconds 3
            $t.sockets_b_initial = Get-ViberSocketInventory $pB.Id
            $wb = Wait-ForWindow -TimeoutSec $bTimeout -WaitPid $pB.Id -TrackReal $true
            $t.b_samples = $wb.samples
            $t.b_window = $wb.ready
            $t.b_latency_s = $wb.latency_s
            $t.b_windows_max = Get-PidWindowsMax $wb.samples $pB.Id
            $t.b_stderr_tail = Read-LogTail (Join-Path $tdir 'B.err.log') 20
            $t.b_stdout_tail = Read-LogTail (Join-Path $tdir 'B.out.log') 10
            $t.sockets_b = Get-ViberSocketInventory $pB.Id
        } else {
            $t.b_window = $false
            $t.b_samples = @()
        }
        $t.temp_after_b = Get-TempViberItems
        $t.lock_files_after = Get-ViberLockFiles
    } catch {
        $t.errors += $_.Exception.Message
    } finally {
        $t.fake_home_after = [ordered]@{}
        $t.fake_home_written = [ordered]@{}
        foreach ($h in @($homeA, $homeB)) {
            if (-not $h) { continue }
            $t.fake_home_after[$h] = Get-PathStat $h
            $t.fake_home_written[$h] = Test-StatWrote $t.fake_home_before[$h] $t.fake_home_after[$h]
        }
        if ($pA) { try { $pA.Refresh(); $t.a_alive_end = -not $pA.HasExited } catch { $t.a_alive_end = $false } }
        if ($pB) { try { $pB.Refresh(); $t.b_alive_end = -not $pB.HasExited; if ($pB.HasExited) { $t.b_exit_code = $pB.ExitCode } } catch {} }
        $t.real_viber_after = [ordered]@{}
        foreach ($p in (Get-ViberDataPaths)) { $t.real_viber_after[$p] = Get-PathStat $p }
        $t.real_viber_written = Test-RealWrites $t.real_viber_before $t.real_viber_after
        $t.isolation_after = Get-IsolationAudit
        $t.real_domain_changed = @(Compare-IsolationAudit $t.isolation_before $t.isolation_after)
        $t.prefs_plist = Get-PrefsPlistKeys
        if ($homeA) { $t.manifest_a = Get-ProfileManifest $homeA }
        if ($homeB) { $t.manifest_b = Get-ProfileManifest $homeB }
        $sharedInode = [bool]($t.manifest_a -and $t.manifest_b -and $t.manifest_a.config_db_inode -and $t.manifest_b.config_db_inode -and ($t.manifest_a.config_db_inode -eq $t.manifest_b.config_db_inode))
        $t.profiles_separate_roots = [bool]($t.manifest_a -and $t.manifest_b -and $t.manifest_a.exists -and $t.manifest_b.exists -and ($t.manifest_a.root -ne $t.manifest_b.root) -and (-not $sharedInode))
        $t.profile_content_identical = [bool]($t.manifest_a -and $t.manifest_b -and $t.manifest_a.content_digest -and $t.manifest_b.content_digest -and ($t.manifest_a.content_digest -eq $t.manifest_b.content_digest))
        $t.profiles_distinct = $t.profiles_separate_roots
        Stop-ProcQuiet $pA
        Stop-ProcQuiet $pB
        Stop-AllViber
    }
    $ownB = $false
    if ($homeB -and $t.fake_home_written.Contains($homeB)) { $ownB = [bool]$t.fake_home_written[$homeB] }
    $t.b_primary = ($t.b_window -eq $true) -and ($t.b_alive_end -eq $true) -and ($t.a_alive_end -eq $true)
    $t.b_own_profile_written = $ownB
    $t.second_instance_usable = ($t.a_window -eq $true) -and ($t.b_window -eq $true) -and $ownB -and ($t.a_alive_end -eq $true)
    Write-Host ("[{0}] a_window={1} b_window={2} b_primary={3} own_profile_b={4} usable={5}" -f $name, $t.a_window, $t.b_window, $t.b_primary, $ownB, $t.second_instance_usable)
    return $t
}

function Get-SystemMemoryInfo {
    $res = [ordered]@{}
    try { $res.total_bytes = [int64]((@(& sysctl -n hw.memsize 2>$null) -join '').Trim()) } catch {}
    try { $res.ncpu = [int](@(& sysctl -n hw.ncpu 2>$null) | Select-Object -First 1) } catch {}
    try { $res.swap = (@(& sysctl -n vm.swapusage 2>$null) -join '') } catch {}
    try { $res.vm_stat = @(& vm_stat 2>$null | Select-Object -First 8) } catch {}
    return $res
}

function Get-RssMap([int[]]$Pids) {
    $map = @{}
    if (-not $Pids -or $Pids.Count -eq 0) { return $map }
    $r = Run-Native 'ps' @('-o', 'pid=,rss=,%cpu=,etime=', '-p', ($Pids -join ','))
    foreach ($line in @($r.output)) {
        $parts = @([string]$line -split '\s+' | Where-Object { $_ -ne '' })
        if ($parts.Count -ge 2) {
            $tp = [int]$parts[0]
            $map[$tp] = [ordered]@{
                rss_kb = [int]$parts[1]
                cpu    = $(if ($parts.Count -ge 3) { $parts[2] } else { $null })
                etime  = $(if ($parts.Count -ge 4) { $parts[3] } else { $null })
            }
        }
    }
    return $map
}

function Invoke-CapacityTest([string]$exe, [int]$MaxInstances = 8) {
    Stop-AllViber
    $t = [ordered]@{
        name = 'capacity-sweep'
        mechanism = 'N instances added one at a time, each direct exec with its own HOME + CFFIXED_USER_HOME + TMPDIR'
        started_at_utc = (Get-UtcStamp)
        system = (Get-SystemMemoryInfo)
        steps = @()
        errors = @()
    }
    $procs = @()
    for ($n = 1; $n -le $MaxInstances; $n++) {
        $step = [ordered]@{ n = $n; started_at_utc = (Get-UtcStamp); errors = @() }
        $capHome = Join-Path $work ("cap_home_{0}" -f $n)
        $capTmp = Join-Path $work ("cap_tmp_{0}" -f $n)
        New-FakeHome $capHome
        New-Item -ItemType Directory -Force -Path $capTmp | Out-Null
        try {
            $p = Start-AppWithEnv $exe @{ HOME = $capHome; CFFIXED_USER_HOME = $capHome; TMPDIR = $capTmp } $capHome (Join-Path $work ("cap_{0}" -f $n))
            $procs += $p
            $step.pid = $p.Id
            $w = Wait-ForWindow -TimeoutSec 120 -WaitPid $p.Id
            $step.window = $w.ready
            $step.window_latency_s = $w.latency_s
            $step.window_max = Get-PidWindowsMax $w.samples $p.Id
            Start-Sleep -Seconds 5
            $allPids = @(Get-Pids 'Contents/MacOS/Viber')
            $win = Get-WindowCounts $allPids
            $rss = Get-RssMap $allPids
            $step.processes = @($allPids | ForEach-Object {
                $x = $rss[[int]$_]
                [ordered]@{
                    pid = [int]$_
                    windows = $win[[int]$_]
                    rss_kb = $(if ($x) { $x.rss_kb } else { $null })
                    cpu = $(if ($x) { $x.cpu } else { $null })
                    etime = $(if ($x) { $x.etime } else { $null })
                }
            })
            $sum = 0
            foreach ($pr in $step.processes) { if ($pr.rss_kb) { $sum += [int]$pr.rss_kb } }
            $step.total_rss_kb = $sum
            $step.process_count = $step.processes.Count
            $step.system = Get-SystemMemoryInfo
        } catch { $step.errors += $_.Exception.Message }
        $t.steps += $step
        Save-Evidence
        Write-Host ("[capacity n={0}] window={1} procs={2} total_rss_mb={3}" -f $n, $step.window, $step.process_count, [math]::Round($step.total_rss_kb / 1024, 1))
        if ($step.window -ne $true) { break }
        if ($step.total_rss_kb -gt 5 * 1024 * 1024) { break }
    }
    $t.max_instances_with_window = @($t.steps | Where-Object { $_.window -eq $true }).Count
    if ($t.steps.Count -gt 0) {
        $last = $t.steps[-1]
        if ($last.total_rss_kb -gt 0 -and $last.process_count -gt 0) {
            $t.rss_per_instance_mb = [math]::Round(($last.total_rss_kb / 1024) / $last.process_count, 1)
        }
    }
    foreach ($p in $procs) { Stop-ProcQuiet $p }
    Stop-AllViber
    Write-Host ("[capacity] max_with_window={0} rss_per_instance_mb={1}" -f $t.max_instances_with_window, $t.rss_per_instance_mb)
    return $t
}

# ---------- run tests ----------
if ($inst.exe_exists) {
    try { $r = Invoke-SingleBaseline $inst.appA; if ($r) { $ev.launch_tests += $r } } catch { $ev.errors += "baseline: $($_.Exception.Message)" }
    Save-Evidence
    try { $r = Invoke-SingleDirectExec $inst.exeA $null 'single-direct-exec-real-home'; if ($r) { $ev.launch_tests += $r } } catch { $ev.errors += "single-direct-real: $($_.Exception.Message)" }
    Save-Evidence
    try { $r = Invoke-SingleDirectExec $inst.exeA (Join-Path $work 'home_single_fake') 'single-direct-exec-fake-home'; if ($r) { $ev.launch_tests += $r } } catch { $ev.errors += "single-direct-fake: $($_.Exception.Message)" }
    Save-Evidence
    try { $r = Invoke-DualDirectExec $inst.exeA $inst.exeB; if ($r) { $ev.launch_tests += $r } } catch { $ev.errors += "dual-direct: $($_.Exception.Message)" }
    Save-Evidence
    try { $r = Invoke-DualOpenCopies $inst.appA $inst.appB; if ($r) { $ev.launch_tests += $r } } catch { $ev.errors += "dual-open: $($_.Exception.Message)" }
    Save-Evidence
    try { $r = Invoke-OpenNTest $inst.appA; if ($r) { $ev.launch_tests += $r } } catch { $ev.errors += "open-n: $($_.Exception.Message)" }
    Save-Evidence
    $tmpdirOnlyB = Join-Path $work 'tmpdir_only_b'
    try {
        $r = Invoke-DualEnvTest -exeA $inst.exeA -exeB $inst.exeB -name 'dual-tmpdir-only' -mechanism 'A: direct exec, real HOME+TMPDIR; B: direct exec, real HOME, TMPDIR redirected' -envB @{ TMPDIR = $tmpdirOnlyB } -tmpB $tmpdirOnlyB
        if ($r) { $ev.launch_tests += $r }
    } catch { $ev.errors += "dual-tmpdir-only: $($_.Exception.Message)" }
    Save-Evidence
    $tmpHomeB = Join-Path $work 'home_tmp_home_b'
    $tmpHomeBTmp = Join-Path $work 'tmp_home_b'
    try {
        $r = Invoke-DualEnvTest -exeA $inst.exeA -exeB $inst.exeB -name 'dual-tmpdir-plus-home' -mechanism 'A: direct exec, real HOME+TMPDIR; B: direct exec with TMPDIR + HOME + CFFIXED_USER_HOME redirected' -envB @{ TMPDIR = $tmpHomeBTmp; HOME = $tmpHomeB; CFFIXED_USER_HOME = $tmpHomeB } -homeB $tmpHomeB -tmpB $tmpHomeBTmp
        if ($r) { $ev.launch_tests += $r }
    } catch { $ev.errors += "dual-tmpdir-plus-home: $($_.Exception.Message)" }
    Save-Evidence
    $fullHomeA = Join-Path $work 'home_full_a'
    $fullTmpA = Join-Path $work 'tmp_full_a'
    $fullHomeB = Join-Path $work 'home_full_b'
    $fullTmpB = Join-Path $work 'tmp_full_b'
    try {
        $r = Invoke-DualEnvTest -exeA $inst.exeA -exeB $inst.exeB -name 'dual-full-isolation' -mechanism 'both instances direct exec with separate HOME + CFFIXED_USER_HOME + TMPDIR' -envA @{ HOME = $fullHomeA; CFFIXED_USER_HOME = $fullHomeA; TMPDIR = $fullTmpA } -envB @{ HOME = $fullHomeB; CFFIXED_USER_HOME = $fullHomeB; TMPDIR = $fullTmpB } -homeA $fullHomeA -homeB $fullHomeB -tmpA $fullTmpA -tmpB $fullTmpB
        if ($r) { $ev.launch_tests += $r }
    } catch { $ev.errors += "dual-full-isolation: $($_.Exception.Message)" }
    Save-Evidence
    try {
        $npHomeA = Join-Path $work 'home_np_a'; $npTmpA = Join-Path $work 'tmp_np_a'
        $npHomeB = Join-Path $work 'home_np_b'; $npTmpB = Join-Path $work 'tmp_np_b'
        $r = Invoke-DualEnvTest -exeA $inst.exeA -exeB $inst.exeB -name 'dual-full-isolation-noprefs-daemon' -mechanism 'both instances direct exec with separate HOME + CFFIXED_USER_HOME + TMPDIR + CFPREFERENCES_AVOID_DAEMON=1' -envA @{ HOME = $npHomeA; CFFIXED_USER_HOME = $npHomeA; TMPDIR = $npTmpA; CFPREFERENCES_AVOID_DAEMON = '1' } -envB @{ HOME = $npHomeB; CFFIXED_USER_HOME = $npHomeB; TMPDIR = $npTmpB; CFPREFERENCES_AVOID_DAEMON = '1' } -homeA $npHomeA -homeB $npHomeB -tmpA $npTmpA -tmpB $npTmpB
        if ($r) { $ev.launch_tests += $r }
    } catch { $ev.errors += "dual-full-isolation-noprefs-daemon: $($_.Exception.Message)" }
    Save-Evidence
    try { $r = Invoke-CapacityTest $inst.exeA 16; if ($r) { $ev.launch_tests += $r } } catch { $ev.errors += "capacity: $($_.Exception.Message)" }
    Save-Evidence
} else {
    $ev.install.errors += 'skipping launch tests: staged executable missing'
}

# ---------- locks / profile snapshot with one instance running ----------
try {
    if ($inst.exe_exists) {
        $lockHome = Join-Path $work 'homeLocks'
        New-FakeHome $lockHome
        Stop-AllViber
        $pl = $null
        try {
            $pl = Start-AppWithHome $inst.exeA $lockHome (Join-Path $work 'locks')
            Start-Sleep -Seconds 10
            $ev.locks = [ordered]@{ collected_at_utc = (Get-UtcStamp); alive = (-not $pl.HasExited); lsof_unix = @(); home_scan = @(); errors = @() }
            try {
                $r = Run-Native 'lsof' @('-U', '-c', 'Viber')
                $ev.locks.lsof_unix = @($r.output | Select-Object -First 60)
            } catch { $ev.locks.errors += "lsof: $($_.Exception.Message)" }
            try {
                $ev.locks.home_scan = @(Get-ChildItem $HOME -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'viber' } | Select-Object -First 50 | ForEach-Object { $_.FullName })
            } catch { $ev.locks.errors += "home scan: $($_.Exception.Message)" }
            $pl.Refresh()
            if ($pl.HasExited) { $ev.locks.exit_code = $pl.ExitCode }
        } finally {
            Stop-ProcQuiet $pl
            Stop-AllViber
        }
    }
} catch {
    $ev.errors += "locks: $($_.Exception.Message)"
}

# ---------- guard object discovery (one functional instance, fake HOME) ----------
try {
    if ($inst.exe_exists) {
        $gd = [ordered]@{
            collected_at_utc = (Get-UtcStamp)
            method = 'per-PID lsof (-U and -i) on a lone functional instance + /private/tmp and DARWIN_USER_TEMP_DIR inventory + direct probe of candidate socket names'
            candidates = @('Viber-0-2', 'Viber-0-1', 'Viber-0-0', 'Viber', 'viber', 'Viber-0-2.lock', 'Viber.lock')
            search_dirs = @('/private/tmp', (Get-DarwinTempDir))
            present = @()
            errors = @()
        }
        Stop-AllViber
        $guardHome = Join-Path $work 'home_guard'
        New-FakeHome $guardHome
        $pg = $null
        try {
            $pg = Start-AppWithHome $inst.exeA $guardHome (Join-Path $work 'guard')
            $wg = Wait-ForWindow -TimeoutSec $InitTimeout
            $gd.instance_window = $wg.ready
            $gd.instance_latency_s = $wg.latency_s
            $gd.instance_pid = $pg.Id
            if ($wg.ready) {
                $gd.sockets = Get-ViberSocketInventory $pg.Id
                $gd.temp = Get-TempViberItems
                $gd.lock_files = Get-ViberLockFiles
                foreach ($d in $gd.search_dirs) {
                    if (-not $d -or -not (Test-Path $d)) { continue }
                    foreach ($c in $gd.candidates) {
                        $cand = Join-Path $d $c
                        if (Test-Path $cand) {
                            $st = Get-Item $cand -Force -ErrorAction SilentlyContinue
                            $isDir = $false; $bytes = $null; $mt = $null
                            if ($st) { $isDir = [bool]$st.PSIsContainer; $bytes = $st.Length; $mt = $st.LastWriteTimeUtc.ToString('o') }
                            $gd.present += [ordered]@{ path = $cand; kind = $(if ($isDir) { 'dir' } else { 'node' }); bytes = $bytes; mtime_utc = $mt }
                        }
                    }
                }
                $lsofAll = Run-Native 'lsof' @('-a', '-p', "$($pg.Id)", '-Fn')
                $gd.open_files_sample = @($lsofAll.output | Where-Object { $_ -like 'n*' } | ForEach-Object { $_.Substring(1) } | Where-Object { $_ -match '(?i)viber|\.lock$|\.sock' } | Select-Object -First 40)
            }
        } finally {
            Stop-ProcQuiet $pg
            Stop-AllViber
        }
        $ev.guard_object = $gd
    }
} catch {
    $ev.errors += "guard_object: $($_.Exception.Message)"
    $ev.guard_object = [ordered]@{ errors = @($_.Exception.Message) }
}
Save-Evidence

# ---------- verdict ----------
try {
    $get = { param($n) $x = @($ev.launch_tests | Where-Object { $_.name -eq $n }); if ($x.Count -gt 0) { $x[0] } else { $null } }
    $baseTest = & $get 'single-baseline-open-a'
    $directTest = & $get 'single-direct-exec-real-home'
    $fakeTest = & $get 'single-direct-exec-fake-home'
    $dual1 = & $get 'dual-direct-exec-fake-home'
    $dual2 = & $get 'dual-open-a-copied-bundle'
    $openN = & $get 'open-n-same-bundle'
    $tmpOnly = & $get 'dual-tmpdir-only'
    $tmpHome = & $get 'dual-tmpdir-plus-home'
    $fullSep = & $get 'dual-full-isolation'
    $fullSepNoPrefs = & $get 'dual-full-isolation-noprefs-daemon'
    $toolBlind = (-not $script:winlistOk) -or ($null -eq $script:winTotal) -or ($script:winTotal -le 0)
    $baseOk = $false
    if ($baseTest) { $baseOk = [bool]$baseTest.app_functional }
    $directOk = $false
    if ($directTest) { $directOk = [bool]$directTest.app_functional }
    $singleOk = $baseOk -or $directOk
    $fakeOk = $false
    if ($fakeTest) { $fakeOk = [bool]$fakeTest.app_functional }
    $usable = @($ev.launch_tests | Where-Object { $_.second_instance_usable -eq $true })
    $prim = @($ev.launch_tests | Where-Object { $_.b_primary -eq $true })
    $dualValid = @($ev.launch_tests | Where-Object {
        (($_.name -eq 'dual-direct-exec-fake-home' -or $_.name -eq 'dual-open-a-copied-bundle') -and $_.first_instance_functional -eq $true) -or
        (([string]$_.name) -like 'dual-*' -and $_.a_window -eq $true)
    })
    $reasons = @()
    if ($baseTest) { $reasons += ("single baseline (open -a, real HOME): window={0} after {1}s, windows_max={2}, real profile writes={3}" -f $baseTest.app_functional, $baseTest.latency_s, $baseTest.windows_max, $baseTest.real_viber_written) }
    if ($directTest) { $reasons += ("single direct-exec (real HOME): window={0} after {1}s, windows_max={2}, stderr={3}" -f $directTest.app_functional, $directTest.latency_s, $directTest.windows_max, (($directTest.stderr_tail -join ' | '))) }
    if ($fakeTest) { $reasons += ("single direct-exec (redirected HOME): window={0} after {1}s, windows_max={2}, fake-home writes={3}, alive_at_end={4}, stderr={5}" -f $fakeTest.app_functional, $fakeTest.latency_s, $fakeTest.windows_max, $fakeTest.fake_home_written, $fakeTest.alive_at_end, (($fakeTest.stderr_tail -join ' | '))) }
    if ($dual1) { $reasons += ("dual direct-exec: A functional={0} ({1}s), B pid {2} window={3} after {4}s, B fake-home writes={5}, A alive at end={6}, B alive at end={7}, B exit={8}" -f $dual1.first_instance_functional, $dual1.first_latency_s, $dual1.procB_pid, $dual1.b_window, $dual1.b_latency_s, $dual1.fake_home_written, $dual1.a_alive_end, $dual1.b_alive_end, $dual1.b_exit_code) }
    if ($dual2) { $reasons += ("dual open -a copies: A functional={0} ({1}s), second process spawned={2} (new pids {3}), new-process window ready={4} after {5}s (max {6}), isolated-profile writes={7}" -f $dual2.first_instance_functional, $dual2.first_latency_s, $dual2.second_process_spawned, (($dual2.new_pids) -join ','), $dual2.new_window_ready, $dual2.new_window_latency_s, $dual2.new_window, $dual2.isolated_profile_written) }
    if ($openN) { $reasons += ("open -n twice: first functional={0} ({1}s), pids 2s after open -n={2}, extra pids={3}, new-process window ready={4}, processes end={5}" -f $openN.first_functional, $openN.first_latency_s, (($openN.pids_after_open2) -join ','), (($openN.new_pids) -join ','), $openN.new_window_ready, $openN.viber_process_count_end) }
    if ($fullSep) { $reasons += ("dual full isolation (separate HOME+CFFIXED_USER_HOME+TMPDIR both sides): A window={0} ({1}s), B window={2} after {3}s (max {4}), B alive at end={5}, own-profile writes per instance={6}, real profile written={7}" -f $fullSep.a_window, $fullSep.a_latency_s, $fullSep.b_window, $fullSep.b_latency_s, $fullSep.b_windows_max, $fullSep.b_alive_end, (($fullSep.fake_home_written.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join '; '), $fullSep.real_viber_written) }
    if ($tmpHome) { $reasons += ("dual TMPDIR+HOME on B only: A window={0} ({1}s), B window={2} after {3}s (max {4}), B own profile written={5}, B alive at end={6}, real profile written={7}" -f $tmpHome.a_window, $tmpHome.a_latency_s, $tmpHome.b_window, $tmpHome.b_latency_s, $tmpHome.b_windows_max, $tmpHome.b_own_profile_written, $tmpHome.b_alive_end, $tmpHome.real_viber_written) }
    if ($tmpOnly) { $reasons += ("dual TMPDIR only on B (real HOME kept): A window={0} ({1}s), B window={2} after {3}s (max {4}), B alive at end={5}, B exit={6}" -f $tmpOnly.a_window, $tmpOnly.a_latency_s, $tmpOnly.b_window, $tmpOnly.b_latency_s, $tmpOnly.b_windows_max, $tmpOnly.b_alive_end, $tmpOnly.b_exit_code) }
    if ($ev.guard_object -and $ev.guard_object.sockets) {
        $reasons += ("guard inventory: unix sockets={0} | tcp endpoints={1} | candidate guard files present={2}" -f ((@($ev.guard_object.sockets.unix)) -join ', '), ((@($ev.guard_object.sockets.net)) -join ', '), ((@($ev.guard_object.present | ForEach-Object { $_.path })) -join ', '))
    }
    if ($fullSep -and $fullSep.isolation_before) {
        $da = 'n/a'; $db = 'n/a'
        if ($fullSep.manifest_a -and $fullSep.manifest_a.digest) { $da = $fullSep.manifest_a.digest.ToString().Substring(0, 12) }
        if ($fullSep.manifest_b -and $fullSep.manifest_b.digest) { $db = $fullSep.manifest_b.digest.ToString().Substring(0, 12) }
        $sfA = 0; $sfB = 0
        if ($fullSep.sockets_a -and $fullSep.sockets_a.sensitive_files) { $sfA = @($fullSep.sockets_a.sensitive_files).Count }
        if ($fullSep.sockets_b -and $fullSep.sockets_b.sensitive_files) { $sfB = @($fullSep.sockets_b.sensitive_files).Count }
        $reasons += ("isolation audit (full separation): real-domain paths changed={0} | A files={1} B files={2} | separate roots={3} (inodes {4} vs {5}) | profile content identical={6} | sensitive files opened A={7} B={8}" -f ((@($fullSep.real_domain_changed)) -join ', '), $fullSep.manifest_a.files, $fullSep.manifest_b.files, $fullSep.profiles_separate_roots, $fullSep.manifest_a.config_db_inode, $fullSep.manifest_b.config_db_inode, $fullSep.profile_content_identical, $sfA, $sfB)
    }
    if ($fullSepNoPrefs) {
        $reasons += ("isolation audit (full separation + CFPREFERENCES_AVOID_DAEMON=1): A window={0} B window={1} | real-domain paths changed={2} | separate roots={3} | sensitive files opened A={4} B={5}" -f $fullSepNoPrefs.a_window, $fullSepNoPrefs.b_window, ((@($fullSepNoPrefs.real_domain_changed)) -join ', '), $fullSepNoPrefs.profiles_separate_roots, (@($fullSepNoPrefs.sockets_a.sensitive_files)).Count, (@($fullSepNoPrefs.sockets_b.sensitive_files)).Count)
    }
    if ($fullSep -and $fullSep.prefs_plist) {
        $reasons += ("shared prefs plist: {0} bytes, {1} keys: {2}" -f $fullSep.prefs_plist.bytes, $fullSep.prefs_plist.key_count, ((@($fullSep.prefs_plist.keys)) -join ', '))
    }
    $cap = & $get 'capacity-sweep'
    if ($cap) {
        $reasons += ("capacity sweep: max instances with window={0} of {1} attempted; rss per instance≈{2} MB; runner RAM={3} bytes, cpus={4}; steps={5}" -f $cap.max_instances_with_window, $cap.steps.Count, $cap.rss_per_instance_mb, $cap.system.total_bytes, $cap.system.ncpu, ((@($cap.steps | ForEach-Object { "n=$($_.n):win=$($_.window),procs=$($_.process_count),rss_mb=$([math]::Round($_.total_rss_kb/1024,1))" })) -join '; '))
    }
    $conclusion = 'inconclusive'
    $summary = ''
    if (-not $inst.exe_exists) {
        $summary = 'Setup failed before launch tests (installer/mount/staging); no isolation verdict is possible.'
    } elseif ($toolBlind) {
        $summary = 'Window evidence unavailable on this runner (CGWindowList returned no windows system-wide), so per-instance window criteria cannot be verified.'
    } elseif (-not $singleOk) {
        $summary = 'No single Viber instance produced a window within the wait budget, so dual-instance results are not attributable to single-instance protection.'
    } elseif ($usable.Count -gt 0) {
        $conclusion = 'feasible'
        $summary = 'Environment isolation (per-instance TMPDIR with per-instance HOME/CFFIXED_USER_HOME) produced a second instance with its own window and its own profile writes.'
    } elseif ($prim.Count -gt 0) {
        $conclusion = 'feasible_partial'
        $summary = 'A second instance becomes primary when TMPDIR is redirected, but profile isolation was incomplete in that variant (shared HOME or missing per-instance writes).'
    } elseif ($dual2 -and $dual2.new_window_ready -eq $true) {
        $conclusion = 'infeasible'
        $summary = 'A second LaunchServices instance can reach a window, but the LaunchServices path always uses the real HOME, so its profile is not isolated and dual accounts are not separate.'
    } elseif ($dualValid.Count -eq 0) {
        $summary = 'No dual mechanism could even bring a first instance to a functional window, so the single-instance guard could not be exercised.'
    } elseif ($fakeTest -and -not $fakeOk) {
        $conclusion = 'infeasible'
        $summary = 'A lone Viber copy with redirected HOME never initialized (process stayed alive without a window), so HOME redirection is not a usable isolation mechanism on macOS.'
    } else {
        $conclusion = 'infeasible'
        $summary = 'With a functional single instance, no tested dual mechanism produced a second usable instance (window + isolated profile) on one macOS user session.'
    }
    $ev.verdict = [ordered]@{
        conclusion = $conclusion
        summary    = $summary
        reasons    = $reasons
        window_tool_available = $script:winlistOk
        windows_system_total = $script:winTotal
        single_instance_functional = $singleOk
        single_with_redirected_home_functional = $fakeOk
        dual_mechanisms_with_functional_first = $dualValid.Count
        usable_second_instances = $usable.Count
        primary_second_instances = $prim.Count
        guard_inventory_collected = [bool]($ev.guard_object -and $ev.guard_object.Contains('sockets'))
        isolation_profiles_distinct = $(if ($fullSep) { $fullSep.profiles_distinct } else { $null })
        isolation_profiles_separate_roots = $(if ($fullSep) { $fullSep.profiles_separate_roots } else { $null })
        isolation_profile_content_identical = $(if ($fullSep) { $fullSep.profile_content_identical } else { $null })
        isolation_real_domain_changed = $(if ($fullSep) { @($fullSep.real_domain_changed) } else { @() })
        isolation_real_domain_changed_noprefs = $(if ($fullSepNoPrefs) { @($fullSepNoPrefs.real_domain_changed) } else { $null })
        capacity_max_instances_with_window = $(if ($cap) { $cap.max_instances_with_window } else { $null })
        capacity_rss_per_instance_mb = $(if ($cap) { $cap.rss_per_instance_mb } else { $null })
    }
} catch {
    $ev.errors += "verdict: $($_.Exception.Message)"
    $ev.verdict = [ordered]@{ conclusion = 'inconclusive'; summary = 'verdict stage error'; reasons = @($_.Exception.Message) }
}
Save-Evidence

# ---------- cleanup ----------
try { if ($mountedNow) { Run-Native 'hdiutil' @('detach', $mnt, '-force') | Out-Null } } catch {}
Write-Host ("verdict: {0}" -f $ev.verdict.conclusion)
Write-Host ("evidence written: {0}" -f $outFile)
