param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as Administrator and run this script again.'
}

$ruleName = 'Umeet-Phone-Test'
if ($Remove) {
    Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host 'Umeet phone test firewall rule removed.'
    exit
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$envText = Get-Content -LiteralPath (Join-Path $projectRoot '.env') -Raw
$apiHost = [regex]::Match($envText, '(?m)^HOST=([^\r\n]+)').Groups[1].Value.Trim()
$apiPort = [regex]::Match($envText, '(?m)^PORT=(\d+)').Groups[1].Value
$address = $null
if (-not [Net.IPAddress]::TryParse($apiHost, [ref]$address) -or $apiHost -in @('0.0.0.0', '127.0.0.1', '::')) {
    throw 'HOST must be a specific LAN IP address in the project .env file.'
}
if (-not $apiPort -or [int]$apiPort -lt 1024 -or [int]$apiPort -gt 65535) {
    throw 'PORT must be a development port between 1024 and 65535.'
}
$localAddresses = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object { $_.GetIPProperties().UnicastAddresses } | ForEach-Object { $_.Address.ToString() }
if ($apiHost -notin $localAddresses) {
    throw 'The configured address no longer belongs to this computer. Update HOST first.'
}

$remoteAddress = 'LocalSubnet'
$hostBytes = $address.GetAddressBytes()
if ($hostBytes.Length -eq 4 -and $hostBytes[0] -eq 100 -and $hostBytes[1] -ge 64 -and $hostBytes[1] -le 127) {
    $remoteAddress = [regex]::Match($envText, '(?m)^PHONE_TEST_REMOTE_IP=([^\r\n]+)').Groups[1].Value.Trim()
    $remoteIp = $null
    if (-not [Net.IPAddress]::TryParse($remoteAddress, [ref]$remoteIp)) {
        throw 'Set PHONE_TEST_REMOTE_IP to the Android device Tailscale IP first.'
    }
    $remoteBytes = $remoteIp.GetAddressBytes()
    if ($remoteBytes.Length -ne 4 -or $remoteBytes[0] -ne 100 -or $remoteBytes[1] -lt 64 -or $remoteBytes[1] -gt 127) {
        throw 'PHONE_TEST_REMOTE_IP must be a Tailscale IPv4 address.'
    }
}

Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name $ruleName -DisplayName 'Umeet phone verification (LAN only)' `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort $apiPort `
    -LocalAddress $apiHost -RemoteAddress $remoteAddress -Profile Any | Out-Null
Write-Host "Rule ready. On the phone, open http://${apiHost}:${apiPort}/api/v1/health"
