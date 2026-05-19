$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $AppRoot "backend"
$FrontendDir = Join-Path $AppRoot "frontend"
$BackendPort = 8001
$FrontendPort = 5174
$BackendUrl = "http://localhost:$BackendPort"
$FrontendUrl = "http://localhost:$FrontendPort"

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

function Test-Backend {
    try {
        $response = Invoke-RestMethod -Uri "$BackendUrl/health" -TimeoutSec 3
        return $null -ne $response.status
    }
    catch {
        return $false
    }
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
    $python = Join-Path $BackendDir "venv\Scripts\python.exe"

    if (-not (Test-Path $python)) {
        Write-Host "Creating backend virtual environment..."
        Push-Location $BackendDir
        try {
            python -m venv venv
        }
        finally {
            Pop-Location
        }
    }

    $probe = & $python -c "import fastapi, uvicorn, sqlalchemy, pandas, openpyxl, ortools" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing backend dependencies..."
        Push-Location $BackendDir
        try {
            & $python -m pip install -r requirements.txt
        }
        finally {
            Pop-Location
        }
    }

    return $python
}

function Ensure-FrontendEnvironment {
    $nodeModules = Join-Path $FrontendDir "node_modules"

    if (-not (Test-Path $nodeModules)) {
        Write-Host "Installing frontend dependencies..."
        Push-Location $FrontendDir
        try {
            npm install
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
    Start-Process `
        -FilePath $Python `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "$BackendPort") `
        -WorkingDirectory $BackendDir `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden

    Wait-For -Check { Test-Backend } -Seconds 45 -Name "Backend"
}

function Start-Frontend {
    if (Test-Http $FrontendUrl) {
        Write-Host "Frontend already running at $FrontendUrl"
        return
    }

    if (Test-PortInUse $FrontendPort) {
        throw "Port $FrontendPort is already in use, but $FrontendUrl is not responding."
    }

    Write-Host "Starting frontend at $FrontendUrl..."
    $stdout = Join-Path $FrontendDir "quicklaunch-frontend-$FrontendPort.out.log"
    $stderr = Join-Path $FrontendDir "quicklaunch-frontend-$FrontendPort.err.log"
    $command = "`$env:VITE_PROXY_TARGET = '$BackendUrl'; & npm.cmd run dev -- --host 0.0.0.0 --port $FrontendPort"

    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden

    Wait-For -Check { Test-Http $FrontendUrl } -Seconds 45 -Name "Frontend"
}

$backendPython = Ensure-BackendEnvironment
Ensure-FrontendEnvironment
Start-Backend -Python $backendPython
Start-Frontend

Write-Host "Opening $FrontendUrl"
Start-Process $FrontendUrl
