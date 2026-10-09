# Native Codex quota reset countdown

The stock Codex 0.160.1 footer renders limit percentages without reset times.
`native-limit-countdown.patch` extends the native TUI's existing limit items to
include `(resets in 3d 4h 12m)`. It uses the server's Unix timestamp, refreshes
while idle, omits missing or invalid timestamps, and shows `reset due` after
expiry while waiting for fresh server data. It never assumes the quota refilled.

This changes the native Codex footer below the composer. It does not use a tmux
status bar or terminal overlay. The existing `five-hour-limit` and `weekly-limit`
settings continue to control which windows appear.

The patch targets OpenAI's `rust-v0.160.1` tag,
`c3e23d4c4385619ecec78408766e46b7fa7dd9ad`. For a separately authorized future
native build, use the source repository's Rust toolchain and keep its companion
binaries from the same installed release:

```sh
git clone --depth 1 --branch rust-v0.160.1 https://github.com/openai/codex.git /tmp/codex-native-footer
git -C /tmp/codex-native-footer apply /absolute/path/to/coding_harness/codex/native-footer/native-limit-countdown.patch
cd /tmp/codex-native-footer/codex-rs
CARGO_BUILD_JOBS=3 CARGO_PROFILE_DEV_SMALL_INCREMENTAL=false cargo build --profile dev-small -p codex-cli --bin codex
just test --cargo-profile dev-small -p codex-tui
```

This harness integration preserves the binary already installed on this Mac.
Do not run the build/install commands during selective harness adoption or as a
provider update. The commands below document the prior procedure.

Install only after separate authorization and verification, passing the actual
native executable inside the installed npm package, not its JavaScript launcher:

```sh
node codex/native-footer/install.mjs /tmp/codex-native-footer/codex-rs/target/dev-small/codex /absolute/path/to/installed/vendor/aarch64-apple-darwin/bin/codex
```

The installer rejects different CLI versions, verifies a backup, then replaces
the binary atomically. Existing conversations continue using their original
executable until their TUI is restarted. Resume by exact conversation ID and
preserve model, effort, working directory, and hooks.

A normal Codex package update replaces this custom build. Rebase and test the
patch against the new official release before reinstalling; do not force an old
binary over newer companion tools. The adjacent `.native-footer.json` records
the installed and original hashes and the backup path for restoration.

On this Mac, `/opt/homebrew/bin/codex` routes to the patched npm installation.
Its previous launcher symlink is saved as
`/opt/homebrew/bin/codex.before-native-footer`.

Historical verification from the primary checkout (not rerun by this
integration): the CLI build and all four added footer checks passed. The full
TUI suite ran 5,615 tests: 5,573 passed, 42 failed, and eight were skipped. The
same 42 failures reproduced against the unmodified release tag; the patch
introduced no additional failures. The failures include development-version
and terminal-color snapshots. Live verification confirmed the countdown
advances and that reconnecting only the TUI preserves the active conversation,
model, effort, and Fast mode.
