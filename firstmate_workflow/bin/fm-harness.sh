#!/usr/bin/env bash
# Detect the agent harness this process tree runs on.
# Usage: fm-harness.sh                  print own harness: claude|unknown
#        fm-harness.sh crew             print the effective CREWMATE harness
#                                        (config/crew-harness; "default" resolves to own)
# claude is the only verified adapter. Detection exists so a session running on
# anything else reports unknown loudly instead of being mistaken for claude, and
# config/crew-harness is the captain's explicit override.
# Detection layers: the verified environment marker first, then process ancestry.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FM_ROOT="${FM_ROOT_OVERRIDE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
FM_HOME="${FM_HOME:-${FM_ROOT_OVERRIDE:-$FM_ROOT}}"
CONFIG="${FM_CONFIG_OVERRIDE:-$FM_HOME/config}"

detect_own() {
  # Layer 1: claude's verified environment marker.
  [ "${CLAUDECODE:-}" = "1" ] && { echo claude; return; }
  # Layer 2: walk the parent chain and match the command name.
  local pid=$$ comm args
  for _ in 1 2 3 4 5 6 7 8; do
    comm=$(ps -o comm= -p "$pid" 2>/dev/null) || break
    case "$(basename -- "$comm")" in
      *claude*) echo claude; return ;;
      node*|python*)
        # Bare interpreter: match the harness name in its script path.
        args=$(ps -o args= -p "$pid" 2>/dev/null)
        case "$args" in
          *claude*) echo claude; return ;;
        esac ;;
    esac
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -z "$pid" ] || [ "$pid" -le 1 ]; then
      break
    fi
  done
  echo unknown
}

# Resolve the effective crewmate harness: config/crew-harness (a bare adapter
# name) wins; absent or "default" mirrors firstmate's own harness.
resolve_crew() {
  local crew=
  [ -f "$CONFIG/crew-harness" ] && crew=$(tr -d '[:space:]' < "$CONFIG/crew-harness" || true)
  if [ -z "$crew" ] || [ "$crew" = "default" ]; then detect_own; else echo "$crew"; fi
}

case "${1:-}" in
  crew) resolve_crew ;;
  *) detect_own ;;
esac
