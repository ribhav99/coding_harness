#!/usr/bin/env bash
# Prepare a Mac to expose live fmp/tmux panels to an iPhone or iPad over
# Tailscale and any ordinary SSH client (Termius is the documented example).
#
#   ./scripts/setup-remote-access.sh          install/configure what can be automated
#   ./scripts/setup-remote-access.sh --check  inspect without changing anything
#
# Account sign-in, the iOS apps, and macOS's Remote Login authorization remain
# visible user/OS actions. The script prints and opens the exact remaining step.

set -eu

REPO=$(cd "$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")" && pwd)
CHECK=0
case "${1:-}" in
  '') ;;
  --check) CHECK=1 ;;
  *) printf 'usage: %s [--check]\n' "$0" >&2; exit 2 ;;
esac

ok()   { printf '  ok    %s\n' "$*"; }
todo() { printf '  TODO  %s\n' "$*"; }
step() { printf '\n%s\n' "$*"; }

[ "$(uname -s)" = Darwin ] || {
  printf 'remote setup currently supports macOS only\n' >&2
  exit 1
}

install_formula() {
  local command_name=$1 formula=$2
  if command -v "$command_name" >/dev/null 2>&1; then
    ok "$command_name"
  elif [ "$CHECK" = 1 ]; then
    todo "brew install $formula"
  else
    brew install "$formula"
  fi
}

step 'Homebrew prerequisites:'
if ! command -v brew >/dev/null 2>&1; then
  todo 'Homebrew is required: https://brew.sh'
  exit 1
fi
install_formula tmux tmux

if [ -d /Applications/Tailscale.app ] || brew list --cask tailscale-app >/dev/null 2>&1; then
  ok 'Tailscale app'
elif [ "$CHECK" = 1 ]; then
  todo 'brew install --cask tailscale-app'
else
  brew install --cask tailscale-app
fi

step 'Harness commands and skills:'
if [ "$CHECK" = 1 ]; then
  "$REPO/install" --check
else
  "$REPO/install"
fi

step 'Automatic SSH session picker:'
PICKER_DIR="$HOME/.config/fm"
PICKER="$PICKER_DIR/remote-picker.zsh"
FOCUS="$PICKER_DIR/focus-pane.mjs"
ZSHRC="$HOME/.zshrc"
# The installed line must expand HOME when zsh loads it, not while this setup
# script is running.
# shellcheck disable=SC2016
SOURCE_LINE='[ -r "$HOME/.config/fm/remote-picker.zsh" ] && source "$HOME/.config/fm/remote-picker.zsh"'

if [ "$CHECK" = 1 ]; then
  if [ -f "$PICKER" ] && cmp -s "$REPO/fm2/remote-picker.zsh" "$PICKER"; then
    ok "$PICKER"
  else
    todo "$PICKER"
  fi
  if [ -f "$FOCUS" ] && cmp -s "$REPO/fm2/focus-pane.mjs" "$FOCUS"; then
    ok "$FOCUS"
  else
    todo "$FOCUS"
  fi
  if grep -Fq "$SOURCE_LINE" "$ZSHRC" 2>/dev/null ||
     grep -q 'FM_REMOTE_PICKER_SHOWN' "$ZSHRC" 2>/dev/null; then
    ok 'interactive SSH shells open the tmux picker'
  else
    todo "source the remote picker from $ZSHRC"
  fi
else
  mkdir -p "$PICKER_DIR"
  install -m 0644 "$REPO/fm2/remote-picker.zsh" "$PICKER"
  install -m 0644 "$REPO/fm2/focus-pane.mjs" "$FOCUS"
  ok "$PICKER"
  ok "$FOCUS"
  if grep -Fq "$SOURCE_LINE" "$ZSHRC" 2>/dev/null; then
    ok "$ZSHRC already sources it"
  elif grep -q 'FM_REMOTE_PICKER_SHOWN' "$ZSHRC" 2>/dev/null; then
    ok "$ZSHRC already contains an equivalent picker"
  else
    touch "$ZSHRC"
    {
      printf '\n# Firstmate remote tmux picker (installed by coding_harness)\n'
      printf '%s\n' "$SOURCE_LINE"
    } >> "$ZSHRC"
    ok "$ZSHRC now sources it"
  fi
fi

step 'macOS Remote Login (SSH):'
if nc -z 127.0.0.1 22 >/dev/null 2>&1; then
  ok 'SSH is listening on port 22'
else
  todo 'enable System Settings -> General -> Sharing -> Remote Login'
  if [ "$CHECK" = 0 ]; then
    open 'x-apple.systempreferences:com.apple.Sharing-Settings.extension' >/dev/null 2>&1 || true
  fi
fi

step 'Tailscale:'
if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
  TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -1 || true)
  if [ -n "$TAILSCALE_IP" ]; then
    ok "connected at $TAILSCALE_IP"
  else
    ok 'connected'
  fi
else
  todo 'open Tailscale on this Mac and sign in'
  if [ "$CHECK" = 0 ] && [ -d /Applications/Tailscale.app ]; then
    open -a Tailscale >/dev/null 2>&1 || true
  fi
fi

step 'Finish on the iPhone or iPad:'
printf '  1. Install Tailscale and sign in to the same tailnet.\n'
printf '  2. Install Termius (it is not needed on the Mac).\n'
printf '  3. Add one SSH host: this Mac\047s Tailscale IP, port 22, your macOS username.\n'
printf '  4. Leave Startup Command blank. Connect and choose an agent or the full panel tree.\n'
printf '\nFull instructions: %s/docs/remote-mobile-access.md\n' "$REPO"
