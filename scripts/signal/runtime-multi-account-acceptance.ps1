param(
  [Parameter(Mandatory = $true)][ValidateSet('Link', 'Verify')][string]$Phase,
  [Parameter(Mandatory = $true)][string]$SignalCli,
  [string]$JreHome = '',
  [string]$DataRoot = (Join-Path $env:LOCALAPPDATA 'Caisheng\SignalAcceptance')
)

$ErrorActionPreference = 'Stop'
if ($JreHome) {
  $env:JAVA_HOME = (Resolve-Path $JreHome).Path
  $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
}
$SignalCli = (Resolve-Path $SignalCli).Path
$configA = Join-Path $DataRoot 'account-a'
$configB = Join-Path $DataRoot 'account-b'
New-Item -ItemType Directory -Force $configA, $configB | Out-Null

if ($Phase -eq 'Link') {
  Write-Host '账号 A：终端将输出 sgnl:// 链接，请由财盛界面生成二维码并扫码。'
  & $SignalCli --config $configA link -n '财盛聚合聊天 A'
  if ($LASTEXITCODE -ne 0) { throw '账号 A 链接失败' }
  Write-Host '账号 B：请使用另一个 Signal 主账号扫码。'
  & $SignalCli --config $configB link -n '财盛聚合聊天 B'
  if ($LASTEXITCODE -ne 0) { throw '账号 B 链接失败' }
  Write-Host 'LINK PASS：两个配置目录均已完成链接。'
  exit 0
}

$accountsA = & $SignalCli --config $configA listAccounts
if ($LASTEXITCODE -ne 0) { throw '无法读取账号 A' }
$accountsB = & $SignalCli --config $configB listAccounts
if ($LASTEXITCODE -ne 0) { throw '无法读取账号 B' }
$normalizedA = @($accountsA | Where-Object { $_ -match '^\+' })
$normalizedB = @($accountsB | Where-Object { $_ -match '^\+' })
if ($normalizedA.Count -ne 1 -or $normalizedB.Count -ne 1) { throw "每目录必须恰好一个账号：A=$accountsA B=$accountsB" }
if ($normalizedA[0] -eq $normalizedB[0]) { throw '两个目录链接成了同一账号' }
Write-Host "VERIFY PASS：A=$($normalizedA[0])，B=$($normalizedB[0])"
Write-Host '下一步由应用的双 daemon 测试启动两端，分别发送消息并检查 JSON-RPC receive 事件；此脚本不伪造真实消息。'
