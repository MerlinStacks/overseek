param(
    [ValidateSet("status", "start", "stop", "restart", "logs")]
    [string]$Command = "status",
    [string]$InstallDir = "$env:LOCALAPPDATA\OverSeek\PrintAgent",
    [string]$TaskName = "OverSeek Print Agent"
)

$ErrorActionPreference = "Stop"

switch ($Command) {
    "status" {
        Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
        Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime, LastTaskResult, NextRunTime
    }
    "start" {
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "Started $TaskName"
    }
    "stop" {
        Stop-ScheduledTask -TaskName $TaskName
        Write-Host "Stopped $TaskName"
    }
    "restart" {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "Restarted $TaskName"
    }
    "logs" {
        $logPath = Join-Path $InstallDir "agent.log"
        if (-not (Test-Path $logPath)) {
            Write-Host "No log file found at $logPath"
            exit 0
        }
        Get-Content $logPath -Tail 100 -Wait
    }
}
