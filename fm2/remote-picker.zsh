# Loaded only by interactive SSH zsh sessions. Keep this file outside the
# Desktop checkout when installed: macOS may deny sshd access to Desktop even
# though the local user can run the same symlinked command from iTerm.
if [[ -o interactive && -n ${SSH_CONNECTION:-} && -z ${TMUX:-} && -z ${FM_REMOTE_PICKER_SHOWN:-} ]]; then
  export FM_REMOTE_PICKER_SHOWN=1
  if tmux list-sessions >/dev/null 2>&1; then
    if [[ -r "$HOME/.config/fm/focus-pane.mjs" ]] && command -v node >/dev/null 2>&1; then
      node "$HOME/.config/fm/focus-pane.mjs" --choose
    else
      tmux attach-session -f ignore-size,active-pane \; choose-tree -s
    fi
  else
    print 'No live tmux sessions. Start the project locally with: fmp <project>'
  fi
fi
