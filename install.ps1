# Agent-Descent Installer for Windows
#
# Installs Node.js (if missing or too old) and then installs agent-descent
# globally from GitHub via npm.
#
# If you already have Node.js >= 20.6.0:
#   npm install -g github:elefthei/agent-descent
#
# Usage:
#   irm https://raw.githubusercontent.com/elefthei/agent-descent/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO = "github:elefthei/agent-descent"
$MIN_NODE_MAJOR = 20
$MIN_NODE_MINOR = 6

# ── Rendering helpers ───────────────────────────────────────────────────────

$script:StepTotal = 0
$script:StepIndex = 0

if ($null -ne $env:NO_COLOR -and $env:NO_COLOR -ne "") {
    $script:C_RESET = ""; $script:C_DIM = ""; $script:C_BOLD = ""
    $script:C_RED = ""; $script:C_GREEN = ""; $script:C_YELLOW = ""
    $script:C_BLUE = ""; $script:C_CYAN = ""
} else {
    $script:C_RESET  = "`e[0m"
    $script:C_DIM    = "`e[2m"
    $script:C_BOLD   = "`e[1m"
    $script:C_RED    = "`e[31m"
    $script:C_GREEN  = "`e[32m"
    $script:C_YELLOW = "`e[33m"
    $script:C_BLUE   = "`e[34m"
    $script:C_CYAN   = "`e[36m"
}

function Write-Info { param($msg) Write-Host "  ${C_CYAN}info${C_RESET} $msg" }
function Write-Warn { param($msg) Write-Host "  ${C_YELLOW}warn${C_RESET} $msg" }
function Write-Err2 { param($msg) Write-Host "  ${C_RED}error${C_RESET} $msg" }

function Get-Bar {
    param(
        [int]$Completed,
        [int]$Total,
        [ValidateSet("progress", "success", "error")][string]$State = "progress"
    )
    $width = 18
    $filled = [Math]::Min($width, [int]($Completed * $width / [Math]::Max(1, $Total)))
    $empty  = $width - $filled
    $fill = switch ($State) {
        "success" { $script:C_GREEN }
        "error"   { $script:C_RED }
        default   { $script:C_BLUE }
    }
    return "${C_BOLD}${fill}$('█' * $filled)${C_RESET}${C_DIM}$('░' * $empty)${C_RESET}"
}

function Format-Line {
    param(
        [string]$Glyph,
        [int]$StepNo,
        [int]$Fill,
        [ValidateSet("progress", "success", "error")][string]$State = "progress",
        [string]$Label
    )
    $bar = Get-Bar -Completed $Fill -Total $script:StepTotal -State $State
    return "  $Glyph  $bar  ${C_DIM}$StepNo/$($script:StepTotal)${C_RESET}  $Label"
}

function Invoke-Step {
    param(
        [string]$Label,
        [ScriptBlock]$Action
    )

    $completed = $script:StepIndex
    $stepNo = $completed + 1
    $isTty = -not [Console]::IsOutputRedirected

    if (-not $isTty) {
        Write-Host -NoNewline "  [$stepNo/$($script:StepTotal)] $Label "
        $logFile = [System.IO.Path]::GetTempFileName()
        try {
            & $Action *>&1 | Out-File -FilePath $logFile -Encoding utf8
            if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
                Write-Host "${C_RED}failed${C_RESET}"
                Get-Content $logFile | ForEach-Object { Write-Host "      $_" }
                return $false
            }
            Write-Host "${C_GREEN}ok${C_RESET}"
            $script:StepIndex++
            return $true
        } finally {
            Remove-Item $logFile -ErrorAction SilentlyContinue
        }
    }

    $logFile = [System.IO.Path]::GetTempFileName()
    $job = Start-Job -ScriptBlock {
        param($actText, $log)
        try {
            & ([ScriptBlock]::Create($actText)) *>&1 | Out-File -FilePath $log -Encoding utf8
            if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        } catch {
            $_ | Out-File -FilePath $log -Encoding utf8 -Append
            exit 1
        }
    } -ArgumentList $Action.ToString(), $logFile

    $frames = @('⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏')
    $i = 0
    [Console]::Write("`e[?25l")
    try {
        while ($job.State -eq 'Running') {
            $f = $frames[$i % 10]
            $line = Format-Line -Glyph "${C_BLUE}$f${C_RESET}" -StepNo $stepNo -Fill $completed -State "progress" -Label $Label
            [Console]::Write("`r`e[2K$line")
            Start-Sleep -Milliseconds 80
            $i++
        }
        Receive-Job $job -ErrorAction SilentlyContinue | Out-Null
        $succeeded = ($job.State -eq 'Completed')
        [Console]::Write("`r`e[2K")
        if ($succeeded) {
            $script:StepIndex++
            $line = Format-Line -Glyph "${C_GREEN}✓${C_RESET}" -StepNo $stepNo -Fill $script:StepIndex -State "success" -Label "${C_DIM}$Label${C_RESET}"
            Write-Host $line
            return $true
        } else {
            $line = Format-Line -Glyph "${C_RED}✗${C_RESET}" -StepNo $stepNo -Fill $completed -State "error" -Label $Label
            Write-Host $line
            if (Test-Path $logFile) {
                Get-Content $logFile -Tail 15 | ForEach-Object {
                    Write-Host "    ${C_DIM}$_${C_RESET}"
                }
            }
            return $false
        }
    } finally {
        [Console]::Write("`e[?25h")
        Remove-Job $job -Force -ErrorAction SilentlyContinue
        Remove-Item $logFile -ErrorAction SilentlyContinue
    }
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'User') + ";" +
                [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
}

# ── Node.js version check ──────────────────────────────────────────────────

function Test-NodeVersion {
    $nodePath = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodePath) { return $false }
    $ver = (node --version 2>$null) -replace '^v', ''
    $parts = $ver -split '\.'
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    if ($major -gt $MIN_NODE_MAJOR) { return $true }
    if ($major -eq $MIN_NODE_MAJOR -and $minor -ge $MIN_NODE_MINOR) { return $true }
    return $false
}

# ── Node.js installer ──────────────────────────────────────────────────────

function Install-Node {
    if (Test-NodeVersion) {
        Write-Info "Node.js already installed ($(node --version 2>$null))"
        return $true
    }

    $currentVer = $null
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $currentVer = node --version 2>$null
        Write-Warn "Node.js $currentVer is too old (need >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR.0)"
    }

    # WinGet (preferred)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $ok = Invoke-Step -Label "Installing Node.js (winget)" -Action {
            winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        }
        Refresh-Path
        if ($ok -and (Test-NodeVersion)) { return $true }
        Write-Warn "winget install Node.js failed, trying fnm"
    }

    # fnm (Fast Node Manager)
    if (Get-Command fnm -ErrorAction SilentlyContinue) {
        $ok = Invoke-Step -Label "Installing Node.js (fnm)" -Action {
            fnm install 22
            fnm use 22
        }
        Refresh-Path
        if ($ok -and (Test-NodeVersion)) { return $true }
        Write-Warn "fnm install failed, trying scoop"
    }

    # Scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        $ok = Invoke-Step -Label "Installing Node.js (scoop)" -Action {
            scoop install nodejs-lts
        }
        Refresh-Path
        if ($ok -and (Test-NodeVersion)) { return $true }
        Write-Warn "scoop install failed"
    }

    Write-Err2 "Could not install Node.js >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR.0"
    Write-Err2 "Install it manually from https://nodejs.org and re-run this script."
    return $false
}

# ── Main ────────────────────────────────────────────────────────────────────

$script:StepTotal = 1  # agent-descent install
if (-not (Test-NodeVersion)) {
    $script:StepTotal++
}

Write-Host ""

if (-not (Install-Node)) { exit 1 }

$installAction = [ScriptBlock]::Create("npm install -g '$REPO'")
$ok = Invoke-Step -Label "Installing agent-descent" -Action $installAction
if (-not $ok) {
    Write-Err2 "Failed to install agent-descent"
    exit 1
}

Write-Host ""
Write-Host "  ${C_GREEN}✓${C_RESET} ${C_BOLD}agent-descent installed successfully${C_RESET}"
Write-Host ""
Write-Host "    Get started:"
Write-Host "      1. Write a ${C_CYAN}goal.md${C_RESET} describing what you want to build"
Write-Host "      2. Run ${C_CYAN}agent-descent goal.md${C_RESET}"
Write-Host ""
Write-Host "    ${C_DIM}Requires GitHub Copilot CLI auth: gh auth login${C_RESET}"
Write-Host "    ${C_DIM}To upgrade later: npm update -g agent-descent${C_RESET}"
Write-Host ""
