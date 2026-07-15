$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$normalizedRoot = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd("\").ToLowerInvariant()
$processNames = @("node.exe", "python.exe", "pythonw.exe")
$stopped = 0

Get-CimInstance Win32_Process |
    Where-Object {
        $_.ProcessId -ne $PID -and
        $_.Name -in $processNames -and
        $_.CommandLine -and
        $_.CommandLine.ToLowerInvariant().Contains($normalizedRoot)
    } |
    ForEach-Object {
        $target = $_
        Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
        if ($?) {
            Write-Host "Stopped $($target.Name) (PID $($target.ProcessId))."
            $stopped++
        }
    }

if ($stopped -eq 0) {
    Write-Host "No Timetable Scheduler services are running."
}
else {
    Write-Host "Timetable Scheduler services have been stopped."
}
