param(
    [string]$InstallDir = "$env:LOCALAPPDATA\OverSeek\PrintAgent",
    [string]$TaskName = "OverSeek Print Agent",
    [switch]$RemoveData
)

$ErrorActionPreference = "Stop"

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

if ($RemoveData -and (Test-Path $InstallDir)) {
    Remove-Item $InstallDir -Recurse -Force
    Write-Host "Removed $InstallDir"
}

Write-Host "Uninstalled $TaskName"
