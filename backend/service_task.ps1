# service_task.ps1 - creates the "PINJ Server" Windows task (called by PINJ_SERVICE.bat install).
# Runs PINJ_SERVICE.bat run as SYSTEM at every power-on, never times out, restarts if it fails.
param([Parameter(Mandatory = $true)][string]$App, [string]$TaskName = "PINJ Server", [int]$Port = 8080)
$ErrorActionPreference = "Stop"
$bat = Join-Path $App "PINJ_SERVICE.bat"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$bat`" run`"" -WorkingDirectory $App
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "PINJ server on port $Port - starts at power-on and restarts itself" -Force | Out-Null
Write-Host " Windows task '$TaskName' created."
