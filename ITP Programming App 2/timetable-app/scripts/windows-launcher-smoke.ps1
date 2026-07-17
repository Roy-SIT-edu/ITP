$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Launcher = Join-Path $AppRoot "Launch Timetable Scheduler.cmd"
$Stopper = Join-Path $AppRoot "Stop Timetable Scheduler.cmd"
$BackendUrl = "http://127.0.0.1:8002"
$FrontendUrl = "http://127.0.0.1:5175"
$BackendBlocker = $null
$FrontendBlocker = $null
$UnrelatedPython = $null
$UnrelatedNode = $null

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

function Assert-AppHealth {
    param([string]$Url)

    $health = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 5
    $expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $AppRoot "backend")).TrimEnd("\")
    $actualRoot = [System.IO.Path]::GetFullPath([string]$health.app_root).TrimEnd("\")
    if ($health.status -ne "ok" -or $actualRoot -ne $expectedRoot) {
        throw "Unexpected health response from $Url."
    }
}

function Invoke-Launcher {
    Push-Location ([System.IO.Path]::GetTempPath())
    try {
        $previousNodeEnv = $env:NODE_ENV
        $env:NODE_ENV = "production"
        & $Launcher -NoBrowser
        if ($LASTEXITCODE -ne 0) {
            throw "Launcher failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        $env:NODE_ENV = $previousNodeEnv
        Pop-Location
    }
}

function Assert-FrontendHealth {
    param([string]$Url)

    $health = Invoke-RestMethod -Uri "$Url/frontend-health" -TimeoutSec 5
    $expectedRoot = [System.IO.Path]::GetFullPath((Join-Path $AppRoot "frontend")).TrimEnd("\")
    $actualRoot = [System.IO.Path]::GetFullPath([string]$health.app_root).TrimEnd("\")
    if ($health.status -ne "ok" -or $health.node_env -ne "development" -or $actualRoot -ne $expectedRoot) {
        throw "Unexpected frontend health response from $Url."
    }
}

try {
    & $Stopper

    $BackendBlocker = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 8001)
    $FrontendBlocker = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 5174)
    $BackendBlocker.Start()
    $FrontendBlocker.Start()

    $python = (Get-Command python).Source
    $node = (Get-Command node).Source
    $UnrelatedPython = Start-Process -FilePath $python -ArgumentList @("-c", '"import time; time.sleep(300)"') -WindowStyle Hidden -PassThru
    $UnrelatedNode = Start-Process -FilePath $node -ArgumentList @("-e", '"setTimeout(() => {}, 300000)"') -WindowStyle Hidden -PassThru

    Invoke-Launcher
    Assert-AppHealth $BackendUrl
    Assert-FrontendHealth $FrontendUrl

    Invoke-Launcher
    Assert-AppHealth $BackendUrl
    Assert-FrontendHealth $FrontendUrl

    & $Stopper
    Start-Sleep -Seconds 2

    if (Test-Http "$BackendUrl/health" -or Test-Http "$FrontendUrl/health") {
        throw "Timetable services are still responding after scoped shutdown."
    }
    if (-not $BackendBlocker.Server.IsBound -or -not $FrontendBlocker.Server.IsBound) {
        throw "The launcher or stopper disturbed an unrelated port listener."
    }

    $UnrelatedPython.Refresh()
    $UnrelatedNode.Refresh()
    if ($UnrelatedPython.HasExited -or $UnrelatedNode.HasExited) {
        throw "Scoped shutdown stopped an unrelated Python or Node process."
    }
}
finally {
    try {
        & $Stopper
    }
    catch {
        Write-Warning $_
    }
    if ($BackendBlocker) {
        $BackendBlocker.Stop()
    }
    if ($FrontendBlocker) {
        $FrontendBlocker.Stop()
    }
    foreach ($process in @($UnrelatedPython, $UnrelatedNode)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
