# Subprocess Runtime

## Capability Summary

The subprocess runtime is the orchestrator-side machinery for spawning, monitoring, and recovering `claude -p` subprocesses. It owns the spawn argument construction (skill, allowed tools, session id, hooks via `.claude/settings.json`), the in-session enforcement layer (Stop hook for verdict trailer, PreToolUse hook for reviewer write path-guard), and the post-exit recovery layers (rate-limit doubling backoff and protocol-retry for malformed verdicts). Every loop subcommand reaches Claude Code through this component; it is the only place that knows about CLI arguments and exit-code semantics.

## Core Components

### Spawn

```component
name: SubprocessSpawner
container: Python Orchestrator
responsibilities:
	- Builds `claude -p` command line: prompt argument, optional `--session-id <uuid>` (attempt 1) or `--resume <uuid>` (attempts 2+) per #SessionContinuity, optional `--append-system-prompt <skill-body>`, `--disallowedTools <list>` per subprocess class
	- Sets `HARNESS_STOP_HOOK_COUNTER`, `HARNESS_MAX_AGENT_RETRIES`, and (for upstream-loop reviewers) `HARNESS_REVIEWER_NAME` environment variables for the hooks to read
	- Spawns via `subprocess.run` with timeout `max_wall_minutes`; captures stdout/stderr/exit_code
	- Detects rate-limit failures via #RateLimitClassifier and re-spawns with doubling backoff per #RateLimitRetryStrategy
	- On clean exit, returns `(stdout, stderr, exit_code)` to the caller (typically #LoopDriver inside @Blueprint(loop-driver))
```

```component
name: SessionContinuity
container: Python Orchestrator
responsibilities:
	- Maintains a per-invocation map `sessions: { generator: <uuid>, reviewers: { <name>: <uuid> } }` in the loop state file
	- On attempt 1 (or any spawn with no stored id), generates a UUID and passes `--session-id <uuid>`; on success stores the id
	- On attempts 2+, passes `--resume <uuid>` and a short follow-up message naming failing reviewers and listing working-tree changes since the previous attempt
	- Resets the map at the start of each `begin_invocation`; never persists across `python -m orchestrator …` runs
	- Honours `--memoryless` CLI flag by skipping `--session-id` / `--resume` entirely so every spawn is a fresh session
```

The #SubprocessSpawner is the orchestrator-side counterpart to a single Claude Code subprocess; the spawned process itself runs inside the @Blueprint(claude-code-subprocess) container with its hooks active.

---

### Recovery layers

```component
name: RateLimitClassifier
container: Python Orchestrator
responsibilities:
	- Inspects subprocess stderr for known rate-limit signatures (`Rate limited`, `429`, `Server is temporarily limiting requests`)
	- Returns a classification: `rate_limited` (recoverable transient) or `failed` (loop-level fail or generic crash)
```

```component
name: RateLimitRetryStrategy
container: Python Orchestrator
responsibilities:
	- On rate-limit classification, pauses the configured backoff (30s, 60s, 120s, …) up to `max_agent_retries` (default 3) and re-spawns with the identical prompt
	- After exhausting retries, records the incident in `harness/state/<loop>.json` under `rate_limit_failures[]` (subprocess kind, reviewer name if applicable, attempt number, retry count, captured stderr) and exits the loop with verdict `exhausted`
	- Does not consume the loop-level `max_attempts` budget; rate-limit retries are independent of loop attempts
	- Continues to count against the per-subprocess wall-clock cap (`max_wall_minutes`); backoff time can push a subprocess past wall-clock and trigger `exhausted` for that reason
```

```component
name: ProtocolRetryStrategy
container: Python Orchestrator
responsibilities:
	- Detects malformed reviewer stdout (no trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`) post-exit
	- Re-spawns the reviewer with a fresh `claude -p` subprocess (new chat, not multi-turn) up to 2 protocol-retries per reviewer per loop attempt; the corrective prompt prepends a note quoting the malformed trailing 200 chars and asking the reviewer to re-emit a clean trailer
	- Appends a `## Review — attempt N (protocol-retry M)` block to the reviewer's communication file like any other review pass
	- After exhausting retries, records the incident in `harness/state/<loop>.json` under `protocol_failures[]` and treats the verdict as `fail` for aggregation; the loop continues to the next reviewer / next loop attempt
	- Does not consume the loop-level `max_attempts` budget or the rate-limit-retry budget
```

The two recovery layers are independent: rate-limit retries fire when a subprocess exits non-zero with a known stderr signature (model never ran); protocol retries fire when a subprocess exits cleanly with bad stdout (model ran but did not emit the expected trailer). Both are bounded by `max_agent_retries` (default 3) and neither consumes the loop's `max_attempts` budget.

---

### In-session hooks

```component
name: StopHookGenerator
container: Claude Code Subprocess
responsibilities:
	- On `Stop` lifecycle event, reads the agent's final chat message and validates it ends with a recognised generator `VERDICT:` line (`VERDICT: ready_for_review` for upstream loops; `VERDICT: awaiting_clarification` with `open_questions: <N>` and `questions_file: <path>` lines; for coding-loop generators, additionally each gate result)
	- Returns block (non-zero exit) on missing or malformed trailer, prompting the model to add it before the turn ends
	- Reads `HARNESS_STOP_HOOK_COUNTER` and increments it per block; once it exceeds `HARNESS_MAX_AGENT_RETRIES` the hook returns 0 (allow stop) instead of blocking, so a stubbornly-malformed model can't ping-pong with the hook indefinitely
	- Logs every block to `harness/logs/<wo-slug-or-loop-name>/hooks.log`
```

```component
name: StopHookReviewer
container: Claude Code Subprocess
responsibilities:
	- On `Stop` lifecycle event, reads the agent's final chat message and validates it ends with a single trailing line matching exactly `VERDICT: pass` or `VERDICT: fail`
	- Returns block on missing or malformed trailer; self-caps at `HARNESS_MAX_AGENT_RETRIES` blocks per spawn the same way as #StopHookGenerator
	- Logs every block to `harness/logs/<loop-name>/hooks.log`
```

```component
name: ReviewerPathGuardHook
container: Claude Code Subprocess
responsibilities:
	- On every `PreToolUse` event for a `Write` or `Edit` tool call inside an upstream-loop reviewer subprocess, inspects the proposed target path
	- Blocks the call (returns non-zero) unless the path is exactly `<requirements_communication|blueprints_communication|work-orders_communication>/<HARNESS_REVIEWER_NAME>.md`
	- Reads `HARNESS_REVIEWER_NAME` from the environment (set by #SubprocessSpawner)
	- Logs blocked calls to `harness/logs/<loop-name>/hooks.log`
	- Active only on upstream-loop reviewer subprocesses; for coding-loop reviewers (which run with `Write,Edit,NotebookEdit,Bash` disallowed) this hook does not need to fire
```

The three hooks are configured in `.claude/settings.json` shipped with the kit; they run inside @Blueprint(claude-code-subprocess) and are invoked at well-defined Claude Code lifecycle moments. They have no view of orchestrator state — they read env vars set by #SubprocessSpawner and the agent's in-session buffer.

## System Contracts

### Key Contracts

- **Stop-hook caps.** The Stop hook self-caps at `max_agent_retries` blocks per spawn so a stubbornly-malformed model cannot loop forever. After cap, the hook allows the stop and the post-exit #ProtocolRetryStrategy takes over.
- **Path-guard is allowlist by exact path.** Not a regex, not a directory prefix — exact path match. Even adversarial instructions in artifacts a reviewer reads cannot get the reviewer to mutate anything outside its own communication file.
- **Rate-limit retries do not consume `max_attempts`.** Loop-level attempts only tick when the model produced output; infrastructure throttling is an out-of-band concern.
- **Protocol retries do not consume `max_attempts` or rate-limit budget.** Two protocol retries per reviewer per loop attempt; after that, the verdict is `fail` and the loop continues.
- **Doubling backoff.** 30s, 60s, 120s, …, capped by `max_agent_retries` total retries. Anthropic API rate-limit recovery is server-side throttling; doubling covers common-case windows and longer outages without re-flooding.
- **No `Bash` for upstream-loop reviewers.** `Bash` is in the disallowed-tools list for every reviewer; reviewers cannot run `git`, `gh`, or arbitrary commands. Coding-loop per-WO reviewers also disallow `Write`/`Edit`/`NotebookEdit` since they don't need a communication-folder file.

### Integration Contracts

- **Spawn signature.** `spawn_claude(prompt: str, wall_clock_cap_seconds: int, *, disallowed_tools: list[str] = [], pre_tool_use_hook: str | None = None, session_id: str | None = None, resume_id: str | None = None, env: dict[str, str] = {}) -> SubprocessResult`. The caller (#LoopDriver, #CodingLoopDriver) passes the right combination per spawn class.
- **`SubprocessResult` shape.** `(stdout: str, stderr: str, exit_code: int, retry_count: int, classification: Literal["clean", "rate_limit_exhausted", "wall_clock_exhausted"])`.
- **Hook configuration file.** `.claude/settings.json` declares the three hooks and binds them to `Stop` and `PreToolUse` lifecycle events. The kit ships the canonical version; project-template/ initialises a copy.
- **Hook env vars.** `HARNESS_STOP_HOOK_COUNTER` (path to a counter file unique per spawn), `HARNESS_MAX_AGENT_RETRIES` (integer), `HARNESS_REVIEWER_NAME` (only for upstream-loop reviewers).

## Architecture Decision Records

### ADR-001: Two independent recovery layers (rate-limit and protocol)

**Context.** A subprocess can fail in two distinct ways: (a) the model never ran (rate limit, network blip, transient infrastructure error), and (b) the model ran but emitted malformed output (verdict trailer missing, truncated). Conflating them would either skip recovery for one mode or apply the wrong recovery to the other.

**Decision.** Two recovery strategies, each with its own counter and classification: #RateLimitRetryStrategy (stderr-based detection, doubling backoff) and #ProtocolRetryStrategy (stdout-based detection, fresh chat). Both are bounded by `max_agent_retries` and neither consumes loop-level attempts.

**Consequences.** Rate-limit storms recover gracefully; malformed verdicts get a corrective re-prompt rather than wasting a loop attempt. Each strategy is independently testable. Trade-off: `max_agent_retries` is a shared knob; in practice the two scenarios rarely co-occur, so the shared budget is fine.

### ADR-002: Stop hook for in-session enforcement, post-exit retry as fallback

**Context.** Verdict-trailer validation could happen entirely post-exit (orchestrator parses stdout, re-spawns on bad). But that wastes a full subprocess invocation per malformed trailer, and the model has already lost the in-session context it would need to fix the issue cheaply.

**Decision.** The `Stop` hook validates the trailer before the session ends, blocking completion until the model emits a clean trailer (capped at `max_agent_retries` in-session blocks). The post-exit #ProtocolRetryStrategy is the fallback for hook bypass / crash / truncation.

**Consequences.** Most malformed-trailer cases are caught and corrected in-session at zero cost beyond model tokens. Fallback handles the genuinely-broken cases without an infinite loop. Trade-off: the kit must keep `.claude/settings.json` in sync with the orchestrator's expectations; canonical settings ship with the kit.

### ADR-003: Path-guard hook enforced at PreToolUse, not subprocess-level allowlist

**Context.** The orchestrator could enforce write isolation by parsing every artifact for adversarial instructions, or by running each reviewer in a sandbox with read-only filesystem access. Both are heavy-handed.

**Decision.** A `PreToolUse` hook intercepts every `Write`/`Edit` call inside an upstream-loop reviewer subprocess and blocks anything other than the reviewer's own communication file. The hook is small (parses target path, exact-matches against env-provided allowed path) and self-contained.

**Consequences.** Single-writer-per-file is enforced even against adversarial instructions in artifacts the reviewer reads. The hook does not interfere with `Read` or any other tool. Trade-off: `HARNESS_REVIEWER_NAME` must be set on every reviewer spawn; missing it would break the hook. Mitigated by #SubprocessSpawner being the only spawn site.
