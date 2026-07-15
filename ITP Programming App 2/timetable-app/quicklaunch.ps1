$ErrorActionPreference = "Stop"

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

function Get-RuntimeVersion {
    param([string]$VersionText)

    if ($VersionText -match "(\d+)\.(\d+)(?:\.(\d+))?") {
        $patch = if ($Matches[3]) { $Matches[3] } else { "0" }
        return [version]"$($Matches[1]).$($Matches[2]).$patch"
    }
    return $null
}

function Test-SupportedPythonVersion {
    param([version]$Version)

    return $null -ne $Version -and $Version.Major -eq 3 -and $Version -ge [version]"3.10.0" -and $Version -lt [version]"3.15.0"
}

function Get-SystemPython {
    $candidates = @(
        @{ Name = "py"; PrefixArgs = @("-3.14") },
        @{ Name = "py"; PrefixArgs = @("-3.13") },
        @{ Name = "py"; PrefixArgs = @("-3.12") },
        @{ Name = "py"; PrefixArgs = @("-3.11") },
        @{ Name = "py"; PrefixArgs = @("-3.10") },
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

        $runtimeVersion = Get-RuntimeVersion ([string]$version)
        if (Test-SupportedPythonVersion $runtimeVersion) {
            return @{
                Exe = $command.Source
                PrefixArgs = $candidate.PrefixArgs
                Version = $runtimeVersion
            }
        }
    }

    throw "Supported Python was not found. Install Python 3.10-3.14 from https://www.python.org/downloads/ and enable 'Add python.exe to PATH'."
}

function Assert-NodeRuntime {
    $node = Get-Command "node" -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js was not found. Install Node.js 20.19+ or 22.12+ from https://nodejs.org/ and run this launcher again."
    }

    $version = & $node.Source --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js is installed but did not run correctly: $version"
    }

    $runtimeVersion = Get-RuntimeVersion ([string]$version)
    $supported = $null -ne $runtimeVersion -and (
        ($runtimeVersion.Major -eq 20 -and $runtimeVersion -ge [version]"20.19.0") -or
        $runtimeVersion -ge [version]"22.12.0"
    )
    if (-not $supported) {
        throw "Node.js 20.19+ or 22.12+ is required by Vite 8. Current version: $version"
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

function Wait-For {
    param(
        [scriptblock]$Check,
        [int]$Seconds,
        [string]$Name
    )

    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Check) {
            return
        }
        Start-Sleep -Milliseconds 500
    }

    throw "$Name did not become ready within $Seconds seconds."
}

function Ensure-BackendEnvironment {
    $venvDir = Join-Path $BackendDir "venv"
    $python = Join-Path $BackendDir "venv\Scripts\python.exe"

    if (Test-Path $python) {
        $venvVersion = $null
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $versionOutput = & $python --version 2>&1
            if ($LASTEXITCODE -eq 0) {
                $venvVersion = Get-RuntimeVersion ([string]$versionOutput)
            }
        }
        catch {
            $venvVersion = $null
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }

        if (-not (Test-SupportedPythonVersion $venvVersion)) {
            Write-Host "The existing backend virtual environment is invalid or uses unsupported Python. Recreating it..."
            Remove-Item -LiteralPath $venvDir -Recurse -Force
        }
    }

    if (-not (Test-Path $python)) {
        $systemPython = Get-SystemPython
        Write-Host "Creating backend virtual environment with Python $($systemPython.Version)..."
        Push-Location $BackendDir
        try {
            & $systemPython.Exe @($systemPython.PrefixArgs + @("-m", "venv", "venv"))
        }
        finally {
            Pop-Location
        }
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
<<<<<<< Updated upstream
    & $python -c "import fastapi, uvicorn, sqlalchemy, pandas, openpyxl, ortools" *> $null
=======
    & $python -c "import fastapi, uvicorn, sqlalchemy, pandas, openpyxl, ortools, multipart, reportlab" *> $null
>>>>>>> Stashed changes
    $dependencyProbeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference

    if ($dependencyProbeExitCode -ne 0) {
        Write-Host "Installing backend dependencies..."
        Push-Location $BackendDir
        try {
<<<<<<< Updated upstream
            & $python -m pip install -r requirements.txt | Out-Host
=======
            & $python -m pip install --require-hashes -r requirements.txt | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "Backend dependency installation failed (exit code $LASTEXITCODE). Check the pip error above."
            }
            Set-Content -LiteralPath $requirementsStamp -Value $requirementsHash -Encoding ASCII
>>>>>>> Stashed changes
        }
        finally {
            Pop-Location
        }
    }

    return $python
}

function Ensure-FrontendEnvironment {
    Assert-NodeRuntime
    $npm = Get-NpmCommand
    $nodeModules = Join-Path $FrontendDir "node_modules"
    $lockFile = Join-Path $FrontendDir "package-lock.json"
    $lockStamp = Join-Path $nodeModules ".package-lock.sha256"
    $lockHash = if (Test-Path $lockFile) {
        (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash
    }
    else {
        ""
    }
    $installedHash = if (Test-Path $lockStamp) {
        (Get-Content -LiteralPath $lockStamp -Raw).Trim()
    }
    else {
        ""
    }

    if (-not (Test-Path $nodeModules) -or $installedHash -ne $lockHash) {
        Write-Host "Synchronizing frontend dependencies..."
        Push-Location $FrontendDir
        try {
            if (Test-Path $lockFile) {
                & $npm ci | Out-Host
            }
            else {
                & $npm install | Out-Host
            }
            if ($LASTEXITCODE -ne 0) {
                throw "Frontend dependency installation failed (exit code $LASTEXITCODE). Check the npm error above."
            }
            if ($lockHash) {
                Set-Content -LiteralPath $lockStamp -Value $lockHash -Encoding ASCII
            }
        }
        finally {
            Pop-Location
        }
    }

    return $npm
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
    Start-Process `
        -FilePath $Python `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--host", $HostName, "--port", "$BackendPort") `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden

    Wait-For -Check { Test-Backend } -Seconds 45 -Name "Backend"
}

function Start-Frontend {
    param([string]$NpmCommand)

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
    $escapedNpmCommand = $NpmCommand.Replace("'", "''")
    $command = "`$env:VITE_PROXY_TARGET = '$BackendUrl'; & '$escapedNpmCommand' run dev -- --host $HostName --port $FrontendPort --strictPort"

    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden

    Wait-For -Check { Test-FrontendAt $FrontendUrl } -Seconds 45 -Name "Frontend"
}

$backendPython = Ensure-BackendEnvironment
<<<<<<< Updated upstream
Ensure-FrontendEnvironment
=======
Repair-CorruptBackendDatabases -Python $backendPython
$npmCommand = Ensure-FrontendEnvironment
>>>>>>> Stashed changes
$BackendPort = Get-BackendPort
$FrontendPort = Get-FrontendPort
$BackendUrl = "http://${HostName}:$BackendPort"
$FrontendUrl = "http://${HostName}:$FrontendPort"
Start-Backend -Python $backendPython
Start-Frontend -NpmCommand $npmCommand

Write-Host "Opening $FrontendUrl"
Start-Process $FrontendUrl
