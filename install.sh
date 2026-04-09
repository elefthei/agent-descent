#!/usr/bin/env bash
# Agent-Descent Installer
#
# Installs Node.js (if missing or too old) and then installs agent-descent
# globally from GitHub via npm.
#
# If you already have Node.js >= 20.6.0:
#   npm install -g github:elefthei/agent-descent
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/elefthei/agent-descent/main/install.sh | bash

set -euo pipefail

MIN_NODE_MAJOR=20
MIN_NODE_MINOR=6

# ── Rendering helpers ───────────────────────────────────────────────────────

IS_TTY=0
if [[ -t 1 ]]; then IS_TTY=1; fi

if [[ -z "${NO_COLOR:-}" ]] && [[ "$IS_TTY" == "1" ]]; then
    C_RESET=$'\033[0m'
    C_DIM=$'\033[2m'
    C_BOLD=$'\033[1m'
    C_RED=$'\033[31m'
    C_GREEN=$'\033[32m'
    C_YELLOW=$'\033[33m'
    C_BLUE=$'\033[34m'
    C_CYAN=$'\033[36m'
else
    C_RESET=""; C_DIM=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""
fi

STEP_TOTAL=0
STEP_INDEX=0

info()  { printf '  %sinfo%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
warn()  { printf '  %swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
error() { printf '  %serror%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }

render_bar() {
    local completed=$1 total=$2 state=${3:-progress}
    local width=18
    local filled=$(( completed * width / total ))
    (( filled > width )) && filled=$width
    local empty=$(( width - filled ))
    local fill_color
    case "$state" in
        success) fill_color="$C_GREEN" ;;
        error)   fill_color="$C_RED"   ;;
        *)       fill_color="$C_BLUE"  ;;
    esac
    local bar="" i
    for ((i=0; i<filled; i++)); do bar+="█"; done
    local rest=""
    for ((i=0; i<empty; i++)); do rest+="░"; done
    printf '%s%s%s%s%s%s%s' "$C_BOLD" "$fill_color" "$bar" "$C_RESET" "$C_DIM" "$rest" "$C_RESET"
}

render_line() {
    local glyph=$1 stepno=$2 fill=$3 state=$4 label=$5
    local bar
    bar=$(render_bar "$fill" "$STEP_TOTAL" "$state")
    printf '  %s  %s  %s%d/%d%s  %s' \
        "$glyph" "$bar" "$C_DIM" "$stepno" "$STEP_TOTAL" "$C_RESET" "$label"
}

run_step() {
    local label=$1; shift
    local completed=$STEP_INDEX
    local stepno=$((completed + 1))

    if [[ "$IS_TTY" != "1" ]]; then
        printf '  [%d/%d] %s ' "$stepno" "$STEP_TOTAL" "$label"
        local log; log=$(mktemp)
        if "$@" >"$log" 2>&1; then
            printf '%sok%s\n' "$C_GREEN" "$C_RESET"
            rm -f "$log"
            STEP_INDEX=$((STEP_INDEX + 1))
            return 0
        else
            printf '%sfailed%s\n' "$C_RED" "$C_RESET"
            sed 's/^/      /' "$log" >&2
            rm -f "$log"
            return 1
        fi
    fi

    local log; log=$(mktemp)
    "$@" >"$log" 2>&1 &
    local pid=$!

    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local i=0
    printf '\033[?25l'
    while kill -0 "$pid" 2>/dev/null; do
        local f="${frames[i % 10]}"
        printf '\r\033[2K'
        render_line "${C_BLUE}${f}${C_RESET}" "$stepno" "$completed" "progress" "$label"
        i=$((i + 1))
        sleep 0.08
    done
    local rc=0
    wait "$pid" || rc=$?
    printf '\r\033[2K'
    if [[ "$rc" == "0" ]]; then
        STEP_INDEX=$((STEP_INDEX + 1))
        render_line "${C_GREEN}✓${C_RESET}" "$stepno" "$STEP_INDEX" "success" "${C_DIM}${label}${C_RESET}"
        printf '\n\033[?25h'
        rm -f "$log"
        return 0
    else
        render_line "${C_RED}✗${C_RESET}" "$stepno" "$completed" "error" "$label"
        printf '\n\033[?25h'
        if [[ -s "$log" ]]; then
            tail -n 15 "$log" | sed "s/^/    ${C_DIM}/" | sed "s/$/${C_RESET}/" >&2
        fi
        rm -f "$log"
        return $rc
    fi
}

# ── Node.js version check ──────────────────────────────────────────────────

node_version_ok() {
    if ! command -v node >/dev/null 2>&1; then
        return 1
    fi
    local ver
    ver=$(node --version 2>/dev/null | sed 's/^v//')
    local major minor
    major=$(echo "$ver" | cut -d. -f1)
    minor=$(echo "$ver" | cut -d. -f2)
    if (( major > MIN_NODE_MAJOR )); then return 0; fi
    if (( major == MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR )); then return 0; fi
    return 1
}

# ── Node.js installer ──────────────────────────────────────────────────────

install_node() {
    if node_version_ok; then
        info "Node.js already installed ($(node --version 2>/dev/null))"
        return 0
    fi

    local current_ver=""
    if command -v node >/dev/null 2>&1; then
        current_ver=$(node --version 2>/dev/null)
        warn "Node.js $current_ver is too old (need >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR.0)"
    fi

    # macOS: Homebrew
    if [[ "$OSTYPE" == darwin* ]] && command -v brew >/dev/null 2>&1; then
        if run_step "Installing Node.js (brew)" brew install node; then
            if node_version_ok; then return 0; fi
        fi
        warn "brew install node didn't provide a new enough version, trying nvm"
    fi

    # nvm (cross-platform fallback)
    if command -v nvm >/dev/null 2>&1 || [[ -s "$HOME/.nvm/nvm.sh" ]]; then
        [[ -s "$HOME/.nvm/nvm.sh" ]] && source "$HOME/.nvm/nvm.sh"
        if run_step "Installing Node.js (nvm)" nvm install 22; then
            nvm use 22
            if node_version_ok; then return 0; fi
        fi
        warn "nvm install failed, trying curl installer"
    fi

    # Install nvm + Node.js from scratch
    if command -v curl >/dev/null 2>&1; then
        if run_step "Installing nvm + Node.js" bash -c '
            curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
            export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
            [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
            nvm install 22
        '; then
            export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
            [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
            nvm use 22 2>/dev/null || true
            if node_version_ok; then return 0; fi
        fi
    fi

    # Linux: apt/dnf fallback (for systems without brew/nvm)
    if [[ "$OSTYPE" == linux* ]]; then
        if command -v apt-get >/dev/null 2>&1; then
            if run_step "Installing Node.js (apt)" bash -c '
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                sudo apt-get install -y nodejs
            '; then
                if node_version_ok; then return 0; fi
            fi
        elif command -v dnf >/dev/null 2>&1; then
            if run_step "Installing Node.js (dnf)" sudo dnf install -y nodejs; then
                if node_version_ok; then return 0; fi
            fi
        fi
    fi

    error "Could not install Node.js >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR.0"
    error "Install it manually from https://nodejs.org and re-run this script."
    return 1
}

# ── agent-descent installer ─────────────────────────────────────────────────

install_agent_descent() {
    local tmpdir
    tmpdir=$(mktemp -d)
    run_step "Installing agent-descent" bash -c "
        git clone --depth 1 https://github.com/elefthei/agent-descent.git '$tmpdir/agent-descent' &&
        cd '$tmpdir/agent-descent' &&
        npm install --ignore-scripts &&
        tgz=\$(npm pack 2>/dev/null | tail -1) &&
        npm install -g \"\$tgz\"
    "
    local rc=$?
    rm -rf "$tmpdir"
    return $rc
}

# ── Main ────────────────────────────────────────────────────────────────────

main() {
    STEP_TOTAL=1  # agent-descent install
    if ! node_version_ok; then
        STEP_TOTAL=$((STEP_TOTAL + 1))
    fi

    printf '\n'

    if ! install_node; then
        error "Node.js installation failed"
        exit 1
    fi

    if ! install_agent_descent; then
        error "agent-descent installation failed"
        exit 1
    fi

    printf '\n  %s✓%s %sagent-descent installed successfully%s\n\n' \
        "$C_GREEN" "$C_RESET" "$C_BOLD" "$C_RESET"
    printf '    Get started:\n'
    printf '      1. Write a %sgoal.md%s describing what you want to build\n' "$C_CYAN" "$C_RESET"
    printf '      2. Run %sagent-descent goal.md%s\n\n' "$C_CYAN" "$C_RESET"
    printf '    %sRequires GitHub Copilot CLI auth: gh auth login%s\n' \
        "$C_DIM" "$C_RESET"
    printf '    %sTo upgrade later: npm update -g agent-descent%s\n\n' \
        "$C_DIM" "$C_RESET"
}

main
