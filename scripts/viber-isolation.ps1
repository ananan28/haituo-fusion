# Viber Windows isolation probe.
# Runs on a clean windows-latest GitHub Actions runner and produces
# structured JSON evidence: audit-results/viber-windows-isolation.json
param(
    [string]$OutDir = 'audit-results',
    [int]$SurvivalSeconds = 30
)

$ErrorActionPreference = 'Stop'
$workdir = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$jsonPath = Join-Path $OutDir 'viber-windows-isolation.json'

function Get-UtcStamp { return (Get-Date).ToUniversalTime().ToString('o') }

$ev = [ordered]@{
    schema            = 'haituo-fusion/viber-windows-isolation/v1'
    generated_at_utc  = (Get-UtcStamp)
    runner            = [ordered]@{
        os         = (Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption)
        ps_version = $PSVersionTable.PSVersion.ToString()
        is_admin   = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    baseline          = [ordered]@{}
    download          = [ordered]@{}
    install           = [ordered]@{}
    launch_tests      = @()
    lock_analysis     = [ordered]@{}
    scope_limitations = [ordered]@{
        account_verification = 'none: no real Viber accounts or credentials are used anywhere in this probe'
        verified_scope       = 'process survival, per-process windows, profile-directory writes, named locks'
        not_verified         = 'real dual-account messaging with authenticated identities'
    }
    verdict           = $null
}

function Save-Evidence {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $ev | ConvertTo-Json -Depth 30 | Out-File -FilePath $jsonPath -Encoding utf8
}

Write-Host '== Viber Windows isolation probe start =='

# ---------- P/Invoke helpers (user32 window enumeration) ----------
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace HaituoProbe {
  public static class Win32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    public static Dictionary<uint,int> WindowsByPid() {
      var map = new Dictionary<uint,int>();
      EnumWindows(delegate(IntPtr h, IntPtr l) {
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid == 0) return true;
        int c; map.TryGetValue(pid, out c); map[pid] = c + 1;
        return true;
      }, IntPtr.Zero);
      return map;
    }
  }
}
'@

# ---------- P/Invoke helpers (ntdll handle/mutex enumeration) ----------
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace HaituoProbe {
  public static class Nt {
    [StructLayout(LayoutKind.Sequential)]
    public struct UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)]
    public struct SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX {
      public IntPtr Object; public IntPtr UniqueProcessId; public IntPtr HandleValue;
      public uint GrantedAccess; public ushort CreatorBackTraceIndex; public ushort ObjectTypeIndex;
      public uint HandleAttributes; public uint Reserved;
    }
    [DllImport("ntdll.dll")] public static extern int NtQuerySystemInformation(int cls, IntPtr info, uint len, out uint retLen);
    [DllImport("ntdll.dll")] public static extern int NtQueryObject(IntPtr h, int cls, IntPtr info, uint len, out uint retLen);
    [DllImport("ntdll.dll")] public static extern int NtDuplicateObject(IntPtr srcProc, IntPtr srcHandle, IntPtr tgtProc, out IntPtr tgtHandle, uint access, uint attrs, uint options);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    public static string ReadUni(IntPtr buffer, ushort length) {
      if (buffer == IntPtr.Zero || length == 0 || length > 4096) return String.Empty;
      try { return Marshal.PtrToStringUni(buffer, length / 2); }
      catch { return String.Empty; }
    }
  }
}
'@

# ---------- directory stat helper ----------
function Get-DirStat([string]$d) {
    if ($d -and (Test-Path $d)) {
        $f = @(Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue)
        return [ordered]@{ files = $f.Count; last_write = if ($f.Count -gt 0) { ($f | Measure-Object LastWriteTime -Maximum).Maximum.ToString('o') } else { $null } }
    }
    return [ordered]@{ files = 0; last_write = $null }
}

function Get-ExeCandidates {
    $roots = @("$env:LOCALAPPDATA\Viber", "$env:ProgramFiles\Viber", "${env:ProgramFiles(x86)}\Viber")
    foreach ($r in $roots) {
        if (Test-Path (Join-Path $r 'Viber.exe')) { return Join-Path $r 'Viber.exe' }
    }
    foreach ($r in $roots) {
        if (Test-Path $r) {
            $f = Get-ChildItem $r -Recurse -Filter 'Viber.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($f) { return $f.FullName }
        }
    }
    return $null
}

# ---------- baseline ----------
$pre = @(Get-Process -Name Viber -ErrorAction SilentlyContinue)
$ev.baseline.viber_processes_before = $pre.Count
$ev.baseline.viber_exe_preinstalled = (Get-ExeCandidates)
Save-Evidence

# ---------- download ----------
$dl = [ordered]@{ attempts = @(); installer_path = $null; installer_url = $null; official_signature = $null; signature = $null }
$candidates = @(
    [ordered]@{ url = 'https://get.viber.com/download/ViberSetup.exe'; kind = 'get.viber.com direct ViberSetup.exe (spec URL)' },
    [ordered]@{ url = 'https://download.cdn.viber.com/desktop/windows/ViberSetup.exe'; kind = 'official Viber CDN unversioned bootstrapper' },
    [ordered]@{ url = 'https://download.cdn.viber.com/desktop/windows/29.1.0/ViberSetup.msi'; kind = 'official Viber CDN versioned MSI 29.1.0' }
)
$i = 0
foreach ($c in $candidates) {
    $att = [ordered]@{ url = $c.url; kind = $c.kind; attempted_at_utc = (Get-UtcStamp) }
    try {
        $hostName = ([uri]$c.url).Host
        try {
            $dns = Resolve-DnsName $hostName -ErrorAction Stop | Select-Object -First 1
            $att.dns_resolved = [string]$dns.IPAddress
        } catch {
            $att.dns_resolved = $null
            $att.dns_error = $_.Exception.Message
        }
        $out = Join-Path $workdir ("viber_dl_{0}.bin" -f $i)
        $code = (& curl.exe -sS -L --retry 3 --retry-delay 2 --connect-timeout 30 --max-time 300 -o $out -w '%{http_code}' $c.url 2>&1 | Select-Object -Last 1)
        $att.http_status = if ($code -match '^\d{3}$') { [int]$code } else { $null }
        if (Test-Path $out) { $att.bytes = (Get-Item $out).Length }
        if ($att.http_status -ge 200 -and $att.http_status -lt 300 -and (Test-Path $out) -and (Get-Item $out).Length -gt 1024) {
            $att.result = 'ok'
            $dl.attempts += $att
            $dl.installer_path = $out
            $dl.installer_url = $c.url
            break
        }
        $att.result = 'failed'
        $att.error = if ($att.http_status) { "http status $($att.http_status)" } else { 'curl connection/DNS failure (see dns_error)' }
    } catch {
        $att.result = 'failed'
        $att.error = $_.Exception.Message
    }
    $dl.attempts += $att
    $i++
}
$ev.download = $dl
if (-not $dl.installer_path) {
    Write-Host '!! no installer could be downloaded; continuing to lock-only fallback'
}
Save-Evidence

if ($dl.installer_path) {
    $sig = Get-AuthenticodeSignature $dl.installer_path
    $ev.download.signature = [ordered]@{
        status  = [string]$sig.Status
        subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }
        issuer  = if ($sig.SignerCertificate) { $sig.SignerCertificate.Issuer } else { $null }
    }
    $ev.download.official_signature = ($sig.Status -eq 'Valid' -and $sig.SignerCertificate -and $sig.SignerCertificate.Subject -match 'Viber')
    Write-Host ("installer signature: {0} official={1}" -f $sig.Status, $ev.download.official_signature)
    Save-Evidence
}

# ---------- install ----------
$exe = Get-ExeCandidates
$inst = [ordered]@{ attempts = @(); exe_path = $null; exe_signature = $null }
if (-not $exe -and $dl.installer_path -and $dl.official_signature) {
    $ext = [IO.Path]::GetExtension($dl.installer_path).ToLower()
    if ($ext -eq '.exe') {
        Write-Host 'installing bootstrapper with /S ...'
        $p = Start-Process -FilePath $dl.installer_path -ArgumentList '/S' -PassThru
        $waited = $p.WaitForExit(300000)
        if (-not $waited) { $p.Kill() }
        $inst.attempts += [ordered]@{ kind = 'exe-silent-/S'; exit_code = $p.ExitCode; timed_out = (-not $waited) }
        $exe = Get-ExeCandidates
        if (-not $exe) {
            $deadline = (Get-Date).AddSeconds(120)
            while ((Get-Date) -lt $deadline -and -not $exe) { Start-Sleep -Seconds 5; $exe = Get-ExeCandidates }
        }
    }
    if (-not $exe -and $ext -eq '.msi') {
        Write-Host 'installing MSI with msiexec /qn ...'
        $p = Start-Process msiexec.exe -ArgumentList @('/i', ('"{0}"' -f $dl.installer_path), '/qn', '/norestart') -Wait -PassThru
        $inst.attempts += [ordered]@{ kind = 'msi-/qn'; exit_code = $p.ExitCode }
        $exe = Get-ExeCandidates
    }
}
if (-not $exe -and $dl.installer_path -and $dl.official_signature) {
    # bootstrapper failed: retry with the versioned MSI
    Write-Host 'bootstrapper install produced no Viber.exe; trying versioned MSI ...'
    $msi = Join-Path $workdir 'ViberSetup-29.1.0.msi'
    $code = (& curl.exe -sS -L --retry 3 --retry-delay 2 --connect-timeout 30 --max-time 600 -o $msi -w '%{http_code}' 'https://download.cdn.viber.com/desktop/windows/29.1.0/ViberSetup.msi' 2>&1 | Select-Object -Last 1)
    $inst.msi_fallback = [ordered]@{ url = 'https://download.cdn.viber.com/desktop/windows/29.1.0/ViberSetup.msi'; http_status = if ($code -match '^\d{3}$') { [int]$code } else { $null }; bytes = if (Test-Path $msi) { (Get-Item $msi).Length } else { $null } }
    if (Test-Path $msi) {
        $msig = Get-AuthenticodeSignature $msi
        $inst.msi_fallback_signature = [ordered]@{ status = [string]$msig.Status; subject = if ($msig.SignerCertificate) { $msig.SignerCertificate.Subject } else { $null } }
        if ($msig.Status -eq 'Valid' -and $msig.SignerCertificate.Subject -match 'Viber') {
            $p = Start-Process msiexec.exe -ArgumentList @('/i', ('"{0}"' -f $msi), '/qn', '/norestart') -Wait -PassThru
            $inst.msi_fallback_exit_code = $p.ExitCode
            $exe = Get-ExeCandidates
        }
    }
}
$inst.exe_path = $exe
if ($exe) {
    $xsig = Get-AuthenticodeSignature $exe
    $inst.exe_signature = [ordered]@{ status = [string]$xsig.Status; subject = if ($xsig.SignerCertificate) { $xsig.SignerCertificate.Subject } else { $null } }
}
$ev.install = $inst
Write-Host ("installed Viber.exe: {0}" -f $exe)
Save-Evidence

# ---------- lock analysis (named pipes + named mutexes, live PIDs) ----------
function Get-LockAnalysis([int[]]$pids) {
    $lock = [ordered]@{ collected_at_utc = (Get-UtcStamp); methodology_self_check = $null; mutant_type_index = $null; viber_named_mutexes = @(); viber_named_pipes = @(); errors = @() }
    $filterPids = @($pids | Where-Object { $_ } | Select-Object -Unique)
    $filterPids += $PID
    try {
        # named pipes
        try {
            $lock.viber_named_pipes = @([System.IO.Directory]::GetFiles('\\.\pipe\') | Where-Object { $_ -match 'viber' })
        } catch { $lock.errors += "pipe enumeration: $($_.Exception.Message)" }

        # self-check marker: create BEFORE enumeration so it must appear in results
        $marker = New-Object System.Threading.Mutex($true, 'HaituoProbeTypeMarkerMutex')
        $markerHandle = $marker.SafeWaitHandle.DangerousGetHandle()

        $names = [System.Collections.Generic.List[string]]::new()
        $mutantIndex = $null
        $self = [HaituoProbe.Nt]::GetCurrentProcess()
        $len = [uint32]0
        [void][HaituoProbe.Nt]::NtQuerySystemInformation(64, [IntPtr]::Zero, 0, [ref]$len)
        if ($len -le 0) { throw "SystemExtendedHandleInformation returned length 0" }
        $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal([int]$len)
        try {
            $st = [HaituoProbe.Nt]::NtQuerySystemInformation(64, $buf, $len, [ref]$len)
            if ($st -ne 0) { throw "SystemExtendedHandleInformation status 0x{0:X8}" -f $st }
            $n = [Runtime.InteropServices.Marshal]::ReadInt32($buf)
            $cur = [IntPtr]::Add($buf, [IntPtr]::Size)
            $entrySize = [Runtime.InteropServices.Marshal]::SizeOf([type][HaituoProbe.Nt+SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX])
            for ($k = 0; $k -lt $n -and $names.Count -lt 300; $k++) {
                $e = [Runtime.InteropServices.Marshal]::PtrToStructure($cur, [type][HaituoProbe.Nt+SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX])
                $ePid = [uint32]$e.UniqueProcessId
                # discover Mutant type index by matching our own marker handle value
                if ($mutantIndex -eq $null -and $ePid -eq [uint32]$PID -and ([int64]$e.HandleValue) -eq ([int64]$markerHandle)) {
                    $mutantIndex = [uint16]$e.ObjectTypeIndex
                }
                if ($filterPids -contains $ePid -and $mutantIndex -ne $null -and $e.ObjectTypeIndex -eq $mutantIndex) {
                    $src = [HaituoProbe.Nt]::OpenProcess(0x0040, $false, $ePid)
                    if ($src -ne [IntPtr]::Zero) {
                        $dup = [IntPtr]::Zero
                        $dSt = [HaituoProbe.Nt]::NtDuplicateObject($src, $e.HandleValue, $self, [ref]$dup, 0x001F0001, 0, 0)
                        if ($dSt -eq 0 -and $dup -ne [IntPtr]::Zero) {
                            $len2 = [uint32]0
                            [void][HaituoProbe.Nt]::NtQueryObject($dup, 1, [IntPtr]::Zero, 0, [ref]$len2)
                            if ($len2 -gt 0 -and $len2 -lt 8192) {
                                $buf2 = [Runtime.InteropServices.Marshal]::AllocHGlobal([int]$len2)
                                $qSt = [HaituoProbe.Nt]::NtQueryObject($dup, 1, $buf2, $len2, [ref]$len2)
                                if ($qSt -eq 0) {
                                    $us = [Runtime.InteropServices.Marshal]::PtrToStructure($buf2, [type][HaituoProbe.Nt+UNICODE_STRING])
                                    $nm = [HaituoProbe.Nt]::ReadUni($us.Buffer, $us.Length)
                                    if ($nm) { $names.Add(("{0}:{1}" -f $ePid, $nm)) }
                                }
                                [Runtime.InteropServices.Marshal]::FreeHGlobal($buf2)
                            }
                            [void][HaituoProbe.Nt]::CloseHandle($dup)
                        }
                        [void][HaituoProbe.Nt]::CloseHandle($src)
                    }
                }
                $cur = [IntPtr]::Add($cur, $entrySize)
            }
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
        }
        $lock.mutant_type_index = $mutantIndex
        $lock.methodology_self_check = (@($names | Where-Object { $_ -match 'HaituoProbeTypeMarkerMutex' }).Count -gt 0)
        $marker.Close()

        $viberNames = @($names | Where-Object { $_ -match 'viber' })
        $lock.viber_named_mutexes = $viberNames
        $byPid = @{}
        foreach ($nm in $viberNames) {
            $parts = $nm -split ':', 2
            $pidPart = $parts[0]
            $rest = $parts[1]
            if (-not $byPid.ContainsKey($pidPart)) { $byPid[$pidPart] = [System.Collections.Generic.List[string]]::new() }
            $byPid[$pidPart].Add($rest)
        }
        $shared = $null
        if ($byPid.Count -ge 2) {
            $firstNames = @($byPid.Values | Select-Object -First 1)
            foreach ($nm2 in $firstNames) {
                $allHave = $true
                foreach ($l in $byPid.Values) { if ($l -notcontains $nm2) { $allHave = $false; break } }
                if ($allHave) { $shared = $nm2; break }
            }
        }
        $lock.interpretation = if ($viberNames.Count -eq 0) { 'no Viber-named mutexes found in probe process handle tables' }
            elseif ($shared) { "at least one shared mutex name across instances: '$shared' (shared locks do not prevent concurrent survival)" }
            else { 'only per-instance or unrelated Viber-named mutexes found' }
    } catch {
        $lock.errors += "lock analysis error: $($_.Exception.Message)"
    }
    return $lock
}

# ---------- survival window sampler ----------
function Invoke-SurvivalWindow($t, $p1, $p2, $dirs, $startDt) {
    $deadline = $startDt.AddSeconds($SurvivalSeconds + 15)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 5
        $p1.Refresh(); $p2.Refresh()
        $winMap = [HaituoProbe.Win32]::WindowsByPid()
        $p1Alive = (-not $p1.HasExited)
        $p2Alive = (-not $p2.HasExited)
        $sample = [ordered]@{
            at_utc              = (Get-UtcStamp)
            elapsed_s           = [math]::Round(((Get-Date) - $startDt).TotalSeconds, 1)
            viber_process_count = @(Get-Process -Name Viber -ErrorAction SilentlyContinue).Count
            procA_alive         = $p1Alive
            procB_alive         = $p2Alive
            procA_exit_code     = if ($p1.HasExited) { $p1.ExitCode } else { $null }
            procB_exit_code     = if ($p2.HasExited) { $p2.ExitCode } else { $null }
            procA_windows       = if ($winMap.ContainsKey([uint32]$p1.Id)) { $winMap[[uint32]$p1.Id] } else { 0 }
            procB_windows       = if ($winMap.ContainsKey([uint32]$p2.Id)) { $winMap[[uint32]$p2.Id] } else { 0 }
            profileA            = (Get-DirStat $dirs[0])
            profileB            = (Get-DirStat $dirs[1])
        }
        $t.samples += $sample
        if (-not $p1Alive -and -not $p2Alive) { break }
    }
    $t.procA_alive_after_window = (-not $p1.HasExited)
    $t.procB_alive_after_window = (-not $p2.HasExited)
    $t.both_alive_full_window   = ($t.procA_alive_after_window -and $t.procB_alive_after_window)
    $t.procA_had_window         = (@($t.samples | Where-Object { $_.procA_windows -gt 0 }).Count -gt 0)
    $t.procB_had_window         = (@($t.samples | Where-Object { $_.procB_windows -gt 0 }).Count -gt 0)
}

# ---------- dual launch test (env-redirected profiles) ----------
function Invoke-DualLaunchTest([string]$name, [string]$profileKind, [string]$copySourceHint, [bool]$collectLocks) {
    $t = [ordered]@{
        name           = $name
        profile_kind   = $profileKind
        mechanism      = 'per-process APPDATA+LOCALAPPDATA environment redirection to isolated dirs'
        started_at_utc = (Get-UtcStamp)
        samples        = @()
        profile_dirA   = $null
        profile_dirB   = $null
        lock_analysis  = $null
        result         = $null
    }
    $startDt = Get-Date
    $base = Join-Path $workdir ("viber_iso_{0}" -f $name)
    $dirA = Join-Path $base 'profileA'
    $dirB = Join-Path $base 'profileB'
    New-Item -ItemType Directory -Force -Path $dirA, $dirB | Out-Null
    $t.profile_dirA = $dirA
    $t.profile_dirB = $dirB

    if ($profileKind -eq 'copied-viberpc') {
        $src = Join-Path $env:APPDATA 'ViberPC'
        $copyFrom = $null
        if (Test-Path $src) { $copyFrom = $src } elseif ($copySourceHint -and (Test-Path $copySourceHint)) { $copyFrom = $copySourceHint }
        if ($copyFrom) {
            Copy-Item -Path (Join-Path $copyFrom '*') -Destination $dirA -Recurse -Force -ErrorAction SilentlyContinue
            Copy-Item -Path (Join-Path $copyFrom '*') -Destination $dirB -Recurse -Force -ErrorAction SilentlyContinue
            $t.profile_copied_from = $copyFrom
        } else {
            $t.profile_copied_from = $null
            $t.note = 'no ViberPC profile existed to copy (runner never logged in); launched with empty profile dirs'
        }
    }

    Get-Process -Name Viber -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    $realRoaming = Join-Path $env:APPDATA 'ViberPC'
    $beforeA = Get-DirStat $dirA
    $beforeB = Get-DirStat $dirB
    $beforeReal = Get-DirStat $realRoaming
    $t.profile_before = [ordered]@{ A = $beforeA; B = $beforeB; real_roaming = $beforeReal }

    $oldA = $env:APPDATA; $oldL = $env:LOCALAPPDATA
    try { $env:APPDATA = $dirA; $env:LOCALAPPDATA = $dirA; $p1 = Start-Process -FilePath $exe -PassThru }
    finally { $env:APPDATA = $oldA; $env:LOCALAPPDATA = $oldL }
    $t.procA_pid = $p1.Id
    $t.procA_launched_at_utc = (Get-UtcStamp)
    Start-Sleep -Seconds 10

    try { $env:APPDATA = $dirB; $env:LOCALAPPDATA = $dirB; $p2 = Start-Process -FilePath $exe -PassThru }
    finally { $env:APPDATA = $oldA; $env:LOCALAPPDATA = $oldL }
    $t.procB_pid = $p2.Id
    $t.procB_launched_at_utc = (Get-UtcStamp)

    Invoke-SurvivalWindow $t $p1 $p2 @($dirA, $dirB) $startDt

    $afterA = Get-DirStat $dirA; $afterB = Get-DirStat $dirB; $afterReal = Get-DirStat $realRoaming
    $t.profileA_written = ($afterA.files -gt $beforeA.files -or $afterA.last_write -ne $beforeA.last_write)
    $t.profileB_written = ($afterB.files -gt $beforeB.files -or $afterB.last_write -ne $beforeB.last_write)
    $t.real_roaming_written = ($afterReal.files -gt $beforeReal.files -or $afterReal.last_write -ne $beforeReal.last_write)
    $t.profile_after = [ordered]@{ A = $afterA; B = $afterB; real_roaming = $afterReal }
    $t.redirection_effective = ((Test-Path (Join-Path $dirA 'ViberPC')) -and (Test-Path (Join-Path $dirB 'ViberPC')))

    # lock analysis while both instances are still alive
    if ($collectLocks) {
        $t.lock_analysis = Get-LockAnalysis @([int]$p1.Id, [int]$p2.Id)
        $ev.lock_analysis = $t.lock_analysis
        Save-Evidence
    }

    # third-instance behavioral probe (single-instance guard detection)
    $p3 = $null
    $third = [ordered]@{}
    try {
        try { $env:APPDATA = $dirA; $env:LOCALAPPDATA = $dirA; $p3 = Start-Process -FilePath $exe -PassThru }
        finally { $env:APPDATA = $oldA; $env:LOCALAPPDATA = $oldL }
        $third.started_pid = $p3.Id
        Start-Sleep -Seconds 15
        $p3.Refresh()
        $third.alive_after_15s = (-not $p3.HasExited)
        $third.exit_code = if ($p3.HasExited) { $p3.ExitCode } else { $null }
        $third.interpretation = if ($p3.HasExited) { 'third process exited quickly while two instances ran: consistent with a single-instance guard' } else { 'third process stayed alive: consistent with multi-instance capability' }
    } catch {
        $third.error = $_.Exception.Message
    }
    $t.third_instance_probe = $third

    $ok = ($t.both_alive_full_window -and $t.procA_had_window -and $t.procB_had_window -and $t.profileA_written -and $t.profileB_written)
    $t.result = if ($ok) { 'isolated_dual_instance_observed' } else { 'not_observed' }

    Get-Process -Name Viber -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    return $t
}

# ---------- separate Windows user test ----------
function Invoke-SeparateUserTest {
    $t = [ordered]@{
        name           = 'separate-windows-user'
        profile_kind   = 'instance B under dedicated local Windows user'
        mechanism      = 'instance A: env-redirected profile; instance B: CreateProcessWithLogonW under a throwaway local user'
        started_at_utc = (Get-UtcStamp)
        samples        = @()
        result         = $null
    }
    $startDt = Get-Date
    $base = Join-Path $workdir 'viber_iso_sepuser'
    $dirA = Join-Path $base 'profileA'
    New-Item -ItemType Directory -Force -Path $dirA | Out-Null
    $t.profile_dirA = $dirA

    $uname = 'haituo_viber_b'
    $upass = 'Ht!ViberB2026x#9'
    $t.second_user = $uname
    $t.user_add_exit = $null
    $p2 = $null

    try {
        Get-Process -Name Viber -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        & net.exe user $uname $upass /add 2>&1 | Out-Null
        $t.user_add_exit = $LASTEXITCODE
        if ($LASTEXITCODE -ne 0) { throw "net user add failed exit $LASTEXITCODE" }
        & net.exe localgroup "Users" $uname /add 2>&1 | Out-Null

        $beforeA = Get-DirStat $dirA
        $userRoam = Join-Path "$env:SystemDrive\Users\$uname" 'AppData\Roaming'
        $bProfDir = Join-Path $userRoam 'ViberPC'
        $beforeB = Get-DirStat $bProfDir
        $t.profile_before = [ordered]@{ A = $beforeA; B_user = $beforeB }

        $oldA = $env:APPDATA; $oldL = $env:LOCALAPPDATA
        try { $env:APPDATA = $dirA; $env:LOCALAPPDATA = $dirA; $p1 = Start-Process -FilePath $exe -PassThru }
        finally { $env:APPDATA = $oldA; $env:LOCALAPPDATA = $oldL }
        $t.procA_pid = $p1.Id
        Start-Sleep -Seconds 10

        $sec = ConvertTo-SecureString $upass -AsPlainText -Force
        $cred = New-Object System.Management.Automation.PSCredential($uname, $sec)
        try {
            $p2 = Start-Process -FilePath $exe -Credential $cred -WorkingDirectory (Split-Path $exe) -PassThru
            $t.procB_pid = $p2.Id
            $t.procB_launch = 'ok'
        } catch {
            $t.procB_launch = 'failed'
            $t.procB_launch_error = $_.Exception.Message
        }

        if ($p2) {
            Invoke-SurvivalWindow $t $p1 $p2 @($dirA, $bProfDir) $startDt
            $afterA = Get-DirStat $dirA
            $afterB = Get-DirStat $bProfDir
            $t.profileA_written = ($afterA.files -gt $beforeA.files -or $afterA.last_write -ne $beforeA.last_write)
            $t.profileB_written = ($afterB.files -gt $beforeB.files -or $afterB.last_write -ne $beforeB.last_write)
            $t.profile_after = [ordered]@{ A = $afterA; B_user = $afterB }
        } else {
            $t.profileA_written = $false
            $t.profileB_written = $false
        }

        $ok = ($p2 -ne $null -and $t.both_alive_full_window -and $t.procA_had_window -and $t.procB_had_window -and $t.profileA_written -and $t.profileB_written)
        $t.result = if ($ok) { 'isolated_dual_instance_observed' } else { 'not_observed' }
    } catch {
        $t.error = $_.Exception.Message
        $t.result = 'not_observed'
    } finally {
        Get-Process -Name Viber -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        & net.exe user $uname /delete 2>&1 | Out-Null
        $t.user_delete_exit = $LASTEXITCODE
    }
    return $t
}

if ($exe) {
    $t1 = Invoke-DualLaunchTest 'fresh-profiles' 'fresh-appdata-redirect' $null $true
    $ev.launch_tests += $t1
    Save-Evidence
    $firstProfile = $t1.profile_dirA
    $srcHint = if ($firstProfile) { Join-Path $firstProfile 'ViberPC' } else { $null }
    if (-not (Test-Path $srcHint)) { $srcHint = $firstProfile }
    $ev.launch_tests += (Invoke-DualLaunchTest 'copied-viberpc' 'copied-viberpc' $srcHint $false)
    Save-Evidence
    $ev.launch_tests += (Invoke-SeparateUserTest)
    Save-Evidence
} else {
    Write-Host '!! no Viber.exe available; launch tests skipped (evidence: install section)'
    $ev.lock_analysis = Get-LockAnalysis @()
    Save-Evidence
}

# ---------- verdict ----------
$feasibleTest = $null
foreach ($tt in $ev.launch_tests) {
    if ($tt.result -eq 'isolated_dual_instance_observed') { $feasibleTest = $tt.name; break }
}
$reasons = @()
if (-not $dl.installer_path) {
    $reasons += 'no official Viber installer could be downloaded (see download.attempts evidence)'
} elseif (-not $dl.official_signature) {
    $reasons += 'downloaded installer failed Authenticode verification against Viber publisher'
} elseif (-not $exe) {
    $reasons += 'installation did not produce a Viber.exe (see install.attempts evidence)'
} elseif (-not $feasibleTest) {
    $reasons += 'no launch test met all criteria (dual survival >=30s, windows per process, profile writes per dir)'
}
if ($feasibleTest) {
    $ev.verdict = [ordered]@{
        conclusion = 'feasible'
        summary    = "Two Viber processes from a single verified-official install ran concurrently >=$SurvivalSeconds s with separate profiles, each with its own window and profile-directory writes (test: $feasibleTest)."
    }
} else {
    $ev.verdict = [ordered]@{
        conclusion = 'infeasible'
        summary    = 'Isolation of a second Viber instance on the windows-latest runner could not be demonstrated with the evidence collected.'
        reasons    = $reasons
    }
}
Save-Evidence

Write-Host ("evidence written: {0}" -f $jsonPath)
Write-Host ("VERDICT: {0}" -f $ev.verdict.conclusion)
Write-Host (Get-Content $jsonPath -Raw)
exit 0
