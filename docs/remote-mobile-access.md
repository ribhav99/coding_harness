# Use live Firstmate panels from an iPhone or iPad

This setup gives an iPhone or iPad secure SSH access to every live `fmp` panel
on a Mac. It uses Tailscale for private networking, macOS Remote Login for SSH,
Termius as the mobile terminal, and tmux as the shared terminal state.

There is no Firstmate mobile service and no project list to maintain in
Termius. One saved SSH host opens tmux's live tree of every session, window, and
pane currently running on that Mac.

The ownership behavior is intentional:

- The local iTerm pane that ran `fmp <project>` owns that panel.
- Termius is a secondary view. Disconnecting it leaves the panel alone.
- Closing the owning iTerm pane kills the panel and its processes, even if the
  phone is still connected.
- The phone does not resize the owner's terminal or change its selected pane.

## Give this to an agent on a new Mac

Clone or pull this repository, then ask the agent to run:

```sh
./scripts/setup-remote-access.sh
```

A complete instruction to paste to the agent is:

> Read `docs/remote-mobile-access.md`, run the setup script, complete every
> remaining macOS/Tailscale step through the available UI, and run the check.
> Do not kill or restart any existing tmux session, and report the Tailscale IP,
> macOS username, SSH host-key fingerprint, and any step that still needs me.

The script is idempotent. It installs tmux and the Tailscale Mac app through
Homebrew when needed, runs the normal harness installer, installs the automatic
SSH picker, checks whether SSH is listening, opens the relevant macOS and
Tailscale UI when human authorization is still required, and prints the
machine-specific values needed on the phone.

The agent should then run the read-only audit:

```sh
./scripts/setup-remote-access.sh --check
```

An agent must not copy shell startup files from another machine, print their
contents, enable Full Disk Access broadly, install Termius on the Mac, or kill
existing tmux sessions. macOS authorization and account sign-in may require the
user to click or authenticate; the agent should open the exact screen and
continue verification afterward.

## What the automated setup does

### 1. Installs the machine-side software

The equivalent commands are:

```sh
brew install tmux
brew install --cask tailscale-app
./install
```

`./install` points `fm`, `fmp`, and `surface` at the current checkout. Re-run it
after moving the checkout. Termius is needed only on the iPhone or iPad, not on
the Mac.

### 2. Installs the automatic SSH picker

The setup copies [`fm2/remote-picker.zsh`](../fm2/remote-picker.zsh) to
`~/.config/fm/remote-picker.zsh` and sources it from `~/.zshrc`. On an
interactive SSH login, it runs:

```sh
tmux attach-session -f ignore-size,active-pane \; choose-tree -s
```

It calls tmux directly instead of `fmp --choose`. A harness checkout under
Desktop may be readable locally while macOS denies the remote `sshd` process
permission to follow `/opt/homebrew/bin/fmp` into Desktop. The copied picker is
outside Desktop and needs no broad Full Disk Access exception.

`ignore-size` prevents the phone's smaller screen from shrinking the local
layout. `active-pane` lets the phone select a pane without changing which pane
is active in iTerm. Pane splits, resizing, and zoom are tmux window state, so
those layout changes are still visible to every attached client.

The picker runs only for an interactive SSH shell, only outside tmux, and only
once per login. Commands executed non-interactively over SSH and file transfers
are unaffected. Leave Termius's Startup Command blank.

### 3. Enables the two services that need user authorization

On the Mac:

1. Open **System Settings -> General -> Sharing**.
2. Enable **Remote Login** and allow the intended macOS user.
3. Open Tailscale and sign in.

The setup script opens these apps when they still need attention. Verify them
from Terminal with:

```sh
nc -z 127.0.0.1 22 && echo 'SSH ready'
tailscale status
tailscale ip -4
```

Do not expose port 22 on the router. Termius connects to the Mac's Tailscale
`100.x.y.z` address, so both devices only need internet access and membership in
the same tailnet.

## Configure the iPhone or iPad

1. Install Tailscale and Termius from the App Store.
2. Sign into Tailscale with the same account as the Mac and turn it on.
3. In Termius, create one Host with:
   - **Address:** the result of `tailscale ip -4` on the Mac
   - **Port:** `22`
   - **Username:** the result of `id -un` on the Mac
   - **Password:** the Mac login password, for the initial setup
   - **Startup Command:** blank
4. Connect. Accept the host key only after comparing it with this command on
   the Mac:

   ```sh
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   ```

5. After login, the tmux tree opens automatically. Select the project session,
   then its window and pane.

Password authentication is acceptable for the initial private-Tailscale setup.
An SSH key stored in Termius Keychain is preferable later: add only its public
key to `~/.ssh/authorized_keys`; never transfer the private key to the Mac or
commit credentials to this repository.

## Use the panels from the phone

An `fmp` project is one tmux session. Its `control`, `workers`, and `reviews`
pages are tmux windows, with individual agents in panes. Termius renders that
tmux layout; it cannot turn every existing pane into a native Termius page.
Multiple Termius tabs can connect to the same saved Host and select different
panes if separate full-screen views are useful.

Common tmux keys use the prefix `Ctrl-b`, followed by another key:

| Action | Keys |
| --- | --- |
| Open the session/window/pane tree | `Ctrl-b`, then `s` |
| Cycle to the next pane | `Ctrl-b`, then `o` |
| Select an adjacent pane | `Ctrl-b`, then an arrow |
| Zoom or unzoom the current pane | `Ctrl-b`, then `z` |
| Split left/right | `Ctrl-b`, then `%` |
| Split above/below | `Ctrl-b`, then `"` |
| Resize one cell | `Ctrl-b`, then `Ctrl-arrow` |
| Resize five cells | `Ctrl-b`, then `Option-arrow` |
| Detach the phone | `Ctrl-b`, then `d` |

On Termius for iOS, the regular keyboard and extra keyboard replace one another.
`Ctrl` is sticky, so they do not need to be visible together:

1. Open the extra keyboard with the four-square button.
2. Tap `ctrl` once.
3. Tap `ABC` to return to the regular keyboard.
4. Tap `b`; Termius sends `Ctrl-b` and releases `Ctrl`.
5. Tap the separate tmux command, such as `z` or `o`.

## Start and migrate panels

Start panels locally in iTerm as usual:

```sh
fmp <project>
```

That local attachment is the owner. Never use `tmux attach -d` from the phone:
`-d` detaches the owner. Never use `tmux new-session -A` remotely: it may create
a replacement after the owner deliberately closed the real panel.

To move an already-running panel onto the new ownership behavior without
restarting any session, window, pane, process, or agent:

1. Pull this repository and run `./install`.
2. Open a second local iTerm tab outside tmux.
3. Run `fmp <project> --owner` there. It attaches to the existing session.
4. Close the old iTerm tab. The second tab is now the owner.

Use `--owner` only for this deliberate local transfer. Closing any owning tab
kills the entire panel by design.

## Troubleshooting

### Login opens a blank shell

Run the setup again, then start a fresh SSH connection:

```sh
./scripts/setup-remote-access.sh
```

The picker does not enter a login already in progress. Confirm that at least one
local panel exists with `tmux list-sessions`.

### `fmp: Operation not permitted` over SSH

Do not grant broad Full Disk Access. Leave the Termius Startup Command blank and
use the installed direct-tmux picker. Re-running the setup refreshes it outside
the protected Desktop folder.

### The phone changes the Mac's pane or layout

Reconnect after running the current setup. The attach flags must include both
`ignore-size` and `active-pane`. Pane selection is independent; actual tmux
layout changes such as split, resize, and zoom remain shared.

### No sessions are listed

The phone never creates a project panel. Start it from its owning local iTerm
pane with `fmp <project>`, then reconnect or run `tmux attach-session -f
ignore-size,active-pane \; choose-tree -s` in the existing SSH shell.
