param(
  [Parameter(Mandatory = $true)][string]$SignalCli,
  [string]$JreHome = '',
  [string]$WorkRoot = (Join-Path $env:TEMP "caisheng-signal-offline-smoke")
)

$ErrorActionPreference = 'Stop'
if ($JreHome) {
  $env:JAVA_HOME = (Resolve-Path $JreHome).Path
  $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
}

function Get-FreePort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

function Wait-Port([int]$Port, [Diagnostics.Process]$Process) {
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Process.HasExited) { throw "daemon 提前退出，退出码 $($Process.ExitCode)" }
    $client = [Net.Sockets.TcpClient]::new()
    try {
      $task = $client.ConnectAsync('127.0.0.1', $Port)
      if ($task.Wait(300)) { $client.Dispose(); return }
    } catch {} finally { $client.Dispose() }
    Start-Sleep -Milliseconds 250
  }
  throw "JSON-RPC 端口 $Port 未就绪"
}

function Invoke-Rpc([int]$Port, [string]$Id) {
  $client = [Net.Sockets.TcpClient]::new('127.0.0.1', $Port)
  try {
    $stream = $client.GetStream()
    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false), 4096, $true)
    $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false), $false, 4096, $true)
    $writer.AutoFlush = $true
    $writer.WriteLine((@{ jsonrpc = '2.0'; method = 'listAccounts'; id = $Id } | ConvertTo-Json -Compress))
    $line = $reader.ReadLine()
    if (-not $line) { throw "端口 $Port 未返回 JSON-RPC 数据" }
    $result = $line | ConvertFrom-Json
    if ($result.id -ne $Id -or $result.error) { throw "JSON-RPC 响应异常：$line" }
    return $result
  } finally { $client.Dispose() }
}

function Stop-Tree([Diagnostics.Process]$Process) {
  if ($null -ne $Process -and -not $Process.HasExited) {
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
  }
}

$SignalCli = (Resolve-Path $SignalCli).Path
if (Test-Path $WorkRoot) { Remove-Item -Recurse -Force $WorkRoot }
$configA = Join-Path $WorkRoot 'account-a'
$configB = Join-Path $WorkRoot 'account-b'
$logs = Join-Path $WorkRoot 'logs'
New-Item -ItemType Directory -Force $configA, $configB, $logs | Out-Null
Set-Content -Encoding UTF8 (Join-Path $configA 'a-only.sentinel') 'account-a'

$portA = Get-FreePort
do { $portB = Get-FreePort } while ($portB -eq $portA)
$processA = $null
$processB = $null
try {
  $processA = Start-Process -FilePath $SignalCli -ArgumentList @('--config', "`"$configA`"", 'daemon', '--tcp', "127.0.0.1:$portA") -RedirectStandardOutput (Join-Path $logs 'a.out.log') -RedirectStandardError (Join-Path $logs 'a.err.log') -PassThru
  $processB = Start-Process -FilePath $SignalCli -ArgumentList @('--config', "`"$configB`"", 'daemon', '--tcp', "127.0.0.1:$portB") -RedirectStandardOutput (Join-Path $logs 'b.out.log') -RedirectStandardError (Join-Path $logs 'b.err.log') -PassThru
  Wait-Port $portA $processA
  Wait-Port $portB $processB
  if ($processA.Id -eq $processB.Id) { throw '两个账号错误地复用了同一进程' }
  if (Test-Path (Join-Path $configB 'a-only.sentinel')) { throw '配置目录发生串写' }
  $rpcA = Invoke-Rpc $portA 'account-a'
  $rpcB = Invoke-Rpc $portB 'account-b'
  Write-Host "PASS 双实例隔离：PID $($processA.Id)/$($processB.Id)，端口 $portA/$portB"
  Write-Host "PASS JSON-RPC：$($rpcA | ConvertTo-Json -Compress) / $($rpcB | ConvertTo-Json -Compress)"
} finally {
  Stop-Tree $processA
  Stop-Tree $processB
}
