param(
    [string]$ApiBase = "http://localhost:3000",
    [string]$StationId = "",
    [string]$StationToken = "",
    [string]$StationName = $env:COMPUTERNAME,
    [string]$DefaultPrinterName = "",
    [int]$UiPort = 8787,
    [string]$InstallDir = "$env:LOCALAPPDATA\OverSeek\PrintAgent",
    [string]$TaskName = "OverSeek Print Agent"
)

$ErrorActionPreference = "Stop"

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js is required. Install Node.js 22+ before installing the print agent."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Split-Path -Parent $scriptRoot
$agentSource = Join-Path $agentRoot "agent.js"

if (-not (Test-Path $agentSource)) {
    throw "Could not find agent.js at $agentSource"
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $InstallDir "downloads") -Force | Out-Null

Copy-Item $agentSource (Join-Path $InstallDir "agent.js") -Force

@"
OVERSEEK_API_BASE=$ApiBase
PRINT_STATION_ID=$StationId
PRINT_STATION_TOKEN=$StationToken
PRINT_STATION_NAME=$StationName
PRINT_AGENT_VERSION=0.1.0
POLL_INTERVAL_MS=5000
DOWNLOAD_DIR=./downloads
DEFAULT_PRINTER_NAME=$DefaultPrinterName
PRINT_AGENT_UI_PORT=$UiPort
"@ | Set-Content -Path (Join-Path $InstallDir ".env") -Encoding ASCII

$runnerPath = Join-Path $InstallDir "run-agent.ps1"
$logPath = Join-Path $InstallDir "agent.log"
$nodePath = $node.Source

@"
Set-Location '$InstallDir'
& '$nodePath' '$InstallDir\agent.js' *>> '$logPath'
"@ | Set-Content -Path $runnerPath -Encoding ASCII

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel LeastPrivilege
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 0)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed $TaskName to $InstallDir"
Write-Host "Use .\manage-windows.ps1 status to check it. Logs: $logPath"
Write-Host "Opening setup UI: http://localhost:$UiPort"
Start-Process "http://localhost:$UiPort"
