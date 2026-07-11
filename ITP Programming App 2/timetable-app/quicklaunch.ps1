param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"

$ProcessPath = [Environment]::GetEnvironmentVariable("Path", "Process")
if (-not $ProcessPath) {
    $ProcessPath = [Environment]::GetEnvironmentVariable("PATH", "Process")
}
if ($ProcessPath) {
    [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
    [Environment]::SetEnvironmentVariable("Path", $ProcessPath, "Process")
}

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $AppRoot "backend"
$FrontendDir = Join-Path $AppRoot "frontend"
$HostName = "127.0.0.1"
$BackendStartPort = 8001
$FrontendStartPort = 5174
$BackendPort = $null
$FrontendPort = $null
$BackendUrl = $null
$FrontendUrl = $null

function Test-Http {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

function Get-MajorVersion {
    param([string]$VersionText)

    if ($VersionText -match "(\d+)\.") {
        return [int]$Matches[1]
    }
    return $null
}

function Get-SystemPython {
    $candidates = @(
        @{ Name = "py"; PrefixArgs = @("-3") },
        @{ Name = "python"; PrefixArgs = @() },
        @{ Name = "python3"; PrefixArgs = @() }
    )

    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate.Name -ErrorAction SilentlyContinue
        if (-not $command) {
            continue
        }

        $version = & $command.Source @($candidate.PrefixArgs + @("--version")) 2>&1
        if ($LASTEXITCODE -ne 0) {
            continue
        }

        $major = Get-MajorVersion ([string]$version)
        if ($major -ge 3) {
            return @{
                Exe = $command.Source
                PrefixArgs = $candidate.PrefixArgs
            }
        }
    }

    throw "Python 3 was not found. Install Python 3.10+ from https://www.python.org/downloads/ and enable 'Add python.exe to PATH'."
}

function Assert-NodeRuntime {
    $node = Get-Command "node" -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js was not found. Install Node.js 20+ from https://nodejs.org/ and run this launcher again."
    }

    $version = & $node.Source --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js is installed but did not run correctly: $version"
    }

    $major = Get-MajorVersion ([string]$version)
    if ($major -lt 20) {
        throw "Node.js 20+ is required by the frontend tooling. Current version: $version"
    }
}

function Get-NpmCommand {
    $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command "npm" -ErrorAction SilentlyContinue
    }
    if (-not $npm) {
        throw "npm was not found. Reinstall Node.js 20+ with npm included, then run this launcher again."
    }
    return $npm.Source
}

function Normalize-Path {
    param([string]$Path)

    return [System.IO.Path]::GetFullPath($Path).TrimEnd("\").ToLowerInvariant()
}

function Test-AppHealth {
    param($Response)

    if ($null -eq $Response -or $null -eq $Response.status -or $null -eq $Response.app_root) {
        return $false
    }

    return (Normalize-Path $Response.app_root) -eq (Normalize-Path $BackendDir)
}

function Test-BackendAt {
    param([string]$Url)

    try {
        $response = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 3
        return Test-AppHealth $response
    }
    catch {
        return $false
    }
}

function Test-Backend {
    return Test-BackendAt $BackendUrl
}

function Test-FrontendAt {
    param([string]$Url)

    try {
        $response = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 3
        return Test-AppHealth $response
    }
    catch {
        return $false
    }
}

function Get-ListeningProcesses {
    param([int]$Port)

    try {
        return @(
            Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
                ForEach-Object {
                    Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)" |
                        Select-Object ProcessId, CommandLine
                }
        )
    }
    catch {
        return @()
    }
}

function Test-AppProcess {
    param($Process)

    $command = [string]$Process.CommandLine
    if (-not $command) {
        return $false
    }
    return $command.ToLowerInvariant().Contains($AppRoot.ToLowerInvariant())
}

function Test-PortOwnedByThisApp {
    param([int]$Port)

    $listeners = @(Get-ListeningProcesses $Port)
    if ($listeners.Count -eq 0) {
        return $false
    }
    foreach ($listener in $listeners) {
        if (-not (Test-AppProcess $listener)) {
            return $false
        }
    }
    return $true
}

function Test-PortInUse {
    param([int]$Port)

    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    }
    catch {
        return $false
    }
}

function Get-BackendPort {
    for ($port = $BackendStartPort; $port -le $BackendStartPort + 30; $port++) {
        $candidateUrl = "http://${HostName}:$port"
        if (-not (Test-PortInUse $port)) {
            return $port
        }
        if ((Test-PortOwnedByThisApp $port) -and (Test-BackendAt $candidateUrl)) {
            return $port
        }
        Write-Host "Backend port $port is already used by another process; trying $($port + 1)..."
    }

    throw "No available backend port found from $BackendStartPort to $($BackendStartPort + 30)."
}

function Get-FrontendPort {
    for ($port = $FrontendStartPort; $port -le $FrontendStartPort + 30; $port++) {
        $candidateUrl = "http://${HostName}:$port"
        if (-not (Test-PortInUse $port)) {
            return $port
        }
        if ((Test-PortOwnedByThisApp $port) -and (Test-FrontendAt $candidateUrl)) {
            return $port
        }
        Write-Host "Frontend port $port is already used by another process; trying $($port + 1)..."
    }

    throw "No available frontend port found from $FrontendStartPort to $($FrontendStartPort + 30)."
}

function Show-StartupLogs {
    param(
        [string]$Name,
        [string]$StdoutPath,
        [string]$StderrPath
    )

    $logsShown = $false
    foreach ($log in @(
        @{ Label = "error log"; Path = $StderrPath },
        @{ Label = "output log"; Path = $StdoutPath }
    )) {
        if ($log.Path -and (Test-Path $log.Path) -and (Get-Item $log.Path).Length -gt 0) {
            Write-Host ""
            Write-Host "Last lines from the $Name $($log.Label):" -ForegroundColor Yellow
            Get-Content -LiteralPath $log.Path -Tail 35 | ForEach-Object { Write-Host $_ }
            $logsShown = $true
        }
    }

    if (-not $logsShown) {
        Write-Host "No startup output was written. Verify that the runtime is not blocked by antivirus or OneDrive." -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Full logs:"
    Write-Host "  $StderrPath"
    Write-Host "  $StdoutPath"
}

function Wait-For {
    param(
        [scriptblock]$Check,
        [int]$Seconds,
        [string]$Name,
        [System.Diagnostics.Process]$Process,
        [string]$StdoutPath,
        [string]$StderrPath
    )

    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Check) {
            return
        }

        if ($Process) {
            $Process.Refresh()
            if ($Process.HasExited) {
                $Process.WaitForExit()
                $exitCode = if ($null -ne $Process.ExitCode) { $Process.ExitCode } else { "unknown" }
                Show-StartupLogs -Name $Name -StdoutPath $StdoutPath -StderrPath $StderrPath
                throw "$Name stopped during startup with exit code $exitCode."
            }
        }
        Start-Sleep -Milliseconds 500
    }

    Show-StartupLogs -Name $Name -StdoutPath $StdoutPath -StderrPath $StderrPath
    throw "$Name is still not ready after $Seconds seconds. Its process is still running; check the logs above for a slow or blocked startup."
}

function Ensure-BackendEnvironment {
    $python = Join-Path $BackendDir "venv\Scripts\python.exe"
    $requirements = Join-Path $BackendDir "requirements.txt"
    $requirementsStamp = Join-Path $BackendDir "venv\.requirements.sha256"

    if (-not (Test-Path $python)) {
        $systemPython = Get-SystemPython
        Write-Host "Creating backend virtual environment..."
        Push-Location $BackendDir
        try {
            & $systemPython.Exe @($systemPython.PrefixArgs + @("-m", "venv", "venv"))
            if ($LASTEXITCODE -ne 0) {
                throw "Python could not create the backend virtual environment (exit code $LASTEXITCODE)."
            }
        }
        finally {
            Pop-Location
        }
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $python -c "import fastapi, uvicorn, sqlalchemy, pandas, openpyxl, ortools, multipart, reportlab, httpx" *> $null
    $dependencyProbeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference

    $requirementsHash = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
    $installedHash = if (Test-Path $requirementsStamp) {
        (Get-Content -LiteralPath $requirementsStamp -Raw).Trim()
    }
    else {
        ""
    }

    if ($dependencyProbeExitCode -ne 0 -or $installedHash -ne $requirementsHash) {
        Write-Host "Synchronizing backend dependencies..."
        Push-Location $BackendDir
        try {
            & $python -m pip install -r requirements.txt | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "Backend dependency installation failed (exit code $LASTEXITCODE). Check the pip error above."
            }
            Set-Content -LiteralPath $requirementsStamp -Value $requirementsHash -Encoding ASCII
        }
        finally {
            Pop-Location
        }
    }

    return $python
}

function Repair-CorruptBackendDatabases {
    param([string]$Python)

    for ($port = $BackendStartPort; $port -le $BackendStartPort + 30; $port++) {
        if (Test-BackendAt "http://${HostName}:$port") {
            return
        }
    }

    $dataDir = Join-Path $BackendDir "data"
    $databaseFiles = @(Get-ChildItem -LiteralPath $dataDir -Filter "*.db" -File -ErrorAction SilentlyContinue)
    if ($databaseFiles.Count -eq 0) {
        return
    }

    $integrityProbe = @'
import sqlite3
import sys
from pathlib import Path

bad = []
for path in sorted(Path(sys.argv[2]).glob("*.db")):
    try:
        connection = sqlite3.connect(path)
        try:
            result = connection.execute("PRAGMA integrity_check").fetchone()
        finally:
            connection.close()
        if not result or result[0].lower() != "ok":
            bad.append(f"{path.name}: {result[0] if result else 'no result'}")
    except sqlite3.DatabaseError as exc:
        message = str(exc)
        if "malformed" in message.lower() or "not a database" in message.lower():
            bad.append(f"{path.name}: {message}")
    except OSError:
        # A running process, antivirus, or sync client may temporarily hold a
        # file. Access problems are not evidence that its contents are corrupt.
        continue

if bad:
    print("\n".join(bad))
    raise SystemExit(2)
'@
    $integrityProbeEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($integrityProbe))

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $probeOutput = @(& $Python -c "import base64,sys;exec(base64.b64decode(sys.argv[1]))" $integrityProbeEncoded $dataDir 2>&1)
    $probeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($probeExitCode -eq 0) {
        return
    }
    if ($probeExitCode -ne 2) {
        $details = ($probeOutput | Out-String).Trim()
        throw "Unable to verify the backend databases (exit code $probeExitCode). No data was changed.`n$details"
    }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = Join-Path $BackendDir "database-backups\corrupt-$timestamp"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

    $databaseArtifacts = @(Get-ChildItem -LiteralPath $dataDir -File | Where-Object {
        $_.Name -match "\.db($|-shm$|-wal$|-journal$)"
    })
    foreach ($artifact in $databaseArtifacts) {
        Move-Item -LiteralPath $artifact.FullName -Destination $backupDir
    }

    Write-Host "Corrupt SQLite data was detected:" -ForegroundColor Yellow
    $probeOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host "The complete database set was preserved at:" -ForegroundColor Yellow
    Write-Host "  $backupDir" -ForegroundColor Yellow
    Write-Host "Starting with a clean database set..." -ForegroundColor Yellow
}

function Ensure-FrontendEnvironment {
    Assert-NodeRuntime
    $npm = Get-NpmCommand
    $nodeModules = Join-Path $FrontendDir "node_modules"

    if (-not (Test-Path $nodeModules)) {
        Write-Host "Installing frontend dependencies..."
        Push-Location $FrontendDir
        try {
            if (Test-Path (Join-Path $FrontendDir "package-lock.json")) {
                & $npm ci | Out-Host
            }
            else {
                & $npm install | Out-Host
            }
        }
        finally {
            Pop-Location
        }
    }
}

function Start-Backend {
    param([string]$Python)

    if (Test-Backend) {
        Write-Host "Backend already running at $BackendUrl"
        return
    }

    if (Test-PortInUse $BackendPort) {
        throw "Port $BackendPort is already in use, but $BackendUrl/health is not responding."
    }

    Write-Host "Starting backend at $BackendUrl..."
    $stdout = Join-Path $BackendDir "quicklaunch-backend-$BackendPort.out.log"
    $stderr = Join-Path $BackendDir "quicklaunch-backend-$BackendPort.err.log"
    $process = Start-Process `
        -FilePath $Python `
        -ArgumentList @(
            "-m", "uvicorn", "app.main:app",
            "--host", $HostName,
            "--port", "$BackendPort"
        ) `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden `
        -PassThru

    Wait-For -Check { Test-Backend } -Seconds 120 -Name "Backend" -Process $process -StdoutPath $stdout -StderrPath $stderr
}

function Start-Frontend {
    if (Test-FrontendAt $FrontendUrl) {
        Write-Host "Frontend already running at $FrontendUrl"
        return
    }

    if (Test-PortInUse $FrontendPort) {
        throw "Port $FrontendPort is already in use, but $FrontendUrl is not responding."
    }

    Write-Host "Starting frontend at $FrontendUrl..."
    $stdout = Join-Path $FrontendDir "quicklaunch-frontend-$FrontendPort.out.log"
    $stderr = Join-Path $FrontendDir "quicklaunch-frontend-$FrontendPort.err.log"
    $command = "`$env:VITE_PROXY_TARGET = '$BackendUrl'; & npm.cmd run dev -- --host $HostName --port $FrontendPort --strictPort"

    $process = Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden `
        -PassThru

    Wait-For -Check { Test-FrontendAt $FrontendUrl } -Seconds 90 -Name "Frontend" -Process $process -StdoutPath $stdout -StderrPath $stderr
}

$backendPython = Ensure-BackendEnvironment
Repair-CorruptBackendDatabases -Python $backendPython
Ensure-FrontendEnvironment
$BackendPort = Get-BackendPort
$FrontendPort = Get-FrontendPort
$BackendUrl = "http://${HostName}:$BackendPort"
$FrontendUrl = "http://${HostName}:$FrontendPort"
Start-Backend -Python $backendPython
Start-Frontend

if (-not $NoBrowser) {
    Write-Host "Opening $FrontendUrl"
    Start-Process $FrontendUrl
}
else {
    Write-Host "Timetable app is ready at $FrontendUrl"
}
