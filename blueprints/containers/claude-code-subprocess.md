# Claude Code Subprocess

## Container Summary

A Claude Code Subprocess is a single `claude -p` invocation spawned by the @Blueprint(python-orchestrator) container. Each spawn is a separate operating-system process running an LLM agent (a generator or a reviewer) inside the Claude Code runtime. The subprocess loads a skill, reads inputs from disk, edits artifacts and/or appends to a communication file, emits a final chat message ending with a `VERDICT:` line, and exits. Stack: Claude Code CLI plus the skill body, agents, and hooks installed under `.claude/`.

## Infrastructure

The Claude Code CLI executes locally on the operator's workstation as a subprocess of the orchestrator. Each spawn is short-lived (minutes), backed by Anthropic's API for model inference. There is no shared state between subprocesses except what they read from and write to the project-repo filesystem and the communication folder.

Key platform dependencies:
- The `claude` CLI installed and authenticated against the operator's Claude account.
- The Anthropic API as the model backend (the subscription model is Claude Max; the harness does not buy per-token capacity).
- The project-repo filesystem (consumed via @Blueprint(project-repo)) for inputs (PRD, FRDs, blueprints, work orders, communication files) and outputs (artifact files, communication files for upstream loops).
- The `.claude/` configuration tree at the project repo root: skills under `.claude/skills/`, agents under `.claude/agents/`, hooks declared in `.claude/settings.json`.

Deployment model: the kit ships `.claude/` content; the operator clones the kit into the project repo (or copies the relevant pieces). Hooks are configured in `.claude/settings.json` and execute inside the subprocess at well-defined lifecycle moments.

## Entry Points and Boundaries

A subprocess is invoked exactly once per spawn by the orchestrator. There are four classes of subprocess:

- **Upstream-loop generator** — `claude -p "<prompt>"` with a system prompt loading one of `prd-to-frds`, `frd-to-blueprint`, or `blueprint-to-work-orders`. Owned by the corresponding @Blueprint(requirements-loop), @Blueprint(blueprint-loop), or @Blueprint(work-orders-loop). Generator subprocesses have full `Read`/`Write`/`Edit` access (no disallowed tools beyond Claude Code defaults). The #StopHookGenerator hook validates the trailing `VERDICT:` line and blocks completion if it is missing or malformed; the in-session retry budget is `max_agent_retries`.
- **Upstream-loop reviewer** — `claude -p "<prompt>" --disallowedTools Bash,NotebookEdit`. `Write`/`Edit` are allowed so the reviewer can append to its own communication file. The #ReviewerPathGuardHook (a `PreToolUse` hook) blocks any `Write`/`Edit` whose target is not exactly `<loop>_communication/<this-reviewer>.md`. The #StopHookReviewer hook validates the trailing `VERDICT: pass` or `VERDICT: fail` line.
- **Coding-loop per-work-order generator** — `claude -p "<prompt>"` with the scoped-task body (`work-orders/wo-<slug>.md`) injected inline as context. Has full filesystem access plus `git` and `gh` access (via Bash) so it can branch, commit, push, and open the PR. Owned by @Blueprint(coding-loop).
- **Coding-loop per-work-order reviewer** — `claude -p "<prompt>" --disallowedTools Write,Edit,NotebookEdit,Bash` (no allowance for filesystem mutation; per-WO execution does not use the communication-folder mechanism). Emits the full review as the subprocess's final chat message, captured by the orchestrator as stdout.

Inputs to every subprocess: the spawn prompt (built by the orchestrator from per-loop prompt builders), the on-disk artifact tree, the communication folder (upstream loops), and the skill body. Outputs: artifact-file edits or communication-file appends (per the subprocess's class) and a stdout summary ending with a `VERDICT:` trailer.

## System Contracts

### Key Contracts

- **Skill autonomy posture.** Generator skills carry "no clarifying questions mid-loop, decide and proceed" autonomy posture in their prompts. The subprocess does not pause to wait for operator input. Decisions that require operator input go to `_questions-pending.md` (upstream loops) or are filed as backlog work orders under `work-orders/_inbox/` (coding loop).
- **In-session verdict-trailer enforcement.** The #StopHookGenerator and #StopHookReviewer hooks block subprocess completion if the final chat message does not end with a recognised `VERDICT:` line. Each hook self-caps at `max_agent_retries` blocks per spawn (default 3) using the `HARNESS_STOP_HOOK_COUNTER` environment variable so a stubbornly-malformed model cannot loop forever.
- **Reviewer write isolation.** The #ReviewerPathGuardHook enforces single-writer-per-file by blocking any `Write`/`Edit` call whose target is not the reviewer's own communication file. Even if the reviewer skill or the artifacts it reads contain adversarial instructions, mutation outside the reviewer's own file is impossible.
- **Reviewers do not commit.** Reviewers run with `--disallowedTools Bash` (or with `Bash`/`NotebookEdit`/`Write`/`Edit` denied for coding-loop reviewers) and cannot run `git`. Generator subprocesses for upstream loops similarly do not commit (orchestrator commits on pass); only the coding-loop per-WO generator commits and pushes its own branch.
- **Session continuity within an invocation.** By default, the orchestrator passes `--session-id <uuid>` on attempt 1 and `--resume <uuid>` on attempts 2+ for the same role within one invocation. Sessions are per-invocation, never persisted across `python -m orchestrator …` runs. `--memoryless` defeats this, forcing every attempt to spawn a fresh session and rely on the communication folder alone.
- **Communication-folder is the cross-attempt durable record.** Even with session continuity, every spawn re-reads its communication file. With `--memoryless` or after a session rotation, the file is the only memory channel.
- **No direct API calls.** The subprocess interacts with the model exclusively through the Claude Code runtime; no skill or agent makes a raw Anthropic API call. The Claude Max subscription is the cost model.

### Integration Contracts

- **Stdout protocol.** Final chat message ends with a single trailing line: `VERDICT: pass` / `VERDICT: fail` (reviewer) or `VERDICT: ready_for_review` / `VERDICT: awaiting_clarification` (generator). For `awaiting_clarification`, the next two lines are `open_questions: <N>` and `questions_file: <path>`. For coding-loop per-WO generators, the trailer additionally lists each gate's result (`pass`, `fail`, or `not_run`).
- **Filesystem protocol.** Generators write only visible content files (`<slug>.md` in requirements and blueprints; `wo-<slug>.md` plus `_sequence.md` in the work-orders tree). They do not write dotted-hidden meta files; #MetaMaterialiser inside the orchestrator handles those after the subprocess exits.
- **Communication-file protocol (upstream loops).** Generators read every reviewer file in `<loop>_communication/` before deciding what to write. On retry attempts (≥ 2), the generator appends per-finding responses (fix / push back / surface to operator) to each failing reviewer's file plus a `## Changes since previous attempt` block to every reviewer's file. Reviewers append a `## Review — attempt N` block ending with the `VERDICT:` line and exit.
- **Question-file protocol.** Generators may append structured blocks to the loop's `_questions-pending.md` file when blocked on operator input. Block shapes (bare; with-options for the blueprint loop) are pinned in @Blueprint(questions-pending).
- **Hook protocol.** Hooks are configured in `.claude/settings.json` and log to `harness/logs/<wo-slug-or-loop-name>/hooks.log`. The Stop hook reads the chat-final-message buffer; the PreToolUse hook reads the proposed tool call and target path. Both can return non-zero to block; they do not have arbitrary side effects.
- **Subprocess exit codes.** `0` on a clean session end; non-zero on rate-limit failure (stderr matches a known pattern), Bash-disallowed tool calls, or session crashes. The orchestrator distinguishes rate-limit failure from generic non-zero via stderr inspection.

### Integration Boundaries

- **Subprocess vs orchestrator.** The orchestrator owns spawn arguments, captured stdout, and exit-code interpretation; the subprocess owns model calls, in-session reasoning, filesystem effects, and verdict emission. Hooks live in the subprocess (they execute in-session) but are configured by the orchestrator's installed `.claude/settings.json`. There is no IPC back-channel.
- **Subprocess vs project-repo.** The subprocess reads from and writes to the project-repo filesystem under tool-permission constraints (full access for generators; allowlisted-by-hook for reviewers). Git history is updated only by per-WO coding-loop generators; everywhere else, file edits are uncommitted until the orchestrator commits them.
- **Subprocess vs Anthropic API.** The Claude Code CLI brokers the model call; the subprocess does not see the API directly. Rate limits manifest as non-zero exit codes with stderr signatures the orchestrator reads.
- **Subprocess vs operator.** The operator does not interact with subprocesses directly. Interactive Claude Code sessions for `prd-authoring` and `blueprint-authoring` are out of band — the operator opens those sessions themselves; the orchestrator never spawns interactive Claude Code.

## Architecture Decision Records

### ADR-001: Subprocess-per-spawn rather than long-lived agent process

**Context.** A long-lived Claude Code process could host the generator and reviewers within one session, reducing spawn overhead. But Claude Code's session model is single-conversation; the orchestrator's pattern is N-conversation (one generator session, plus one session per reviewer, all per attempt). Multiplexing those on one process would either entangle the conversations or require a feature Claude Code does not expose.

**Decision.** Each spawn is a fresh `claude -p` subprocess. Session continuity within an invocation is achieved via `--session-id <uuid>` + `--resume <uuid>`, which preserves the agent's session memory across attempts of the same role.

**Consequences.** Spawn cost is real (cold-start latency, prompt-cache warm-up) but the orchestrator's parallel reviewer fan-out hides most of it. Each subprocess is fully isolated — a crash or a malformed verdict does not leak into other subprocesses. Session memory is per-role-per-invocation; cross-invocation memory lives in the communication folder and on-disk artifact trees.

### ADR-002: Hooks for in-session enforcement; orchestrator for cross-session decisions

**Context.** Output-contract enforcement (verdict trailer present, write paths allowlisted) must happen inside the session because that is where the model can react and re-emit. Cross-session decisions (attempt counting, retry vs commit, budget enforcement) cannot live in hooks because hooks have no view of the orchestrator's state.

**Decision.** Hooks (`Stop` for verdict-trailer validation, `PreToolUse` for reviewer write path-guard) run inside the subprocess and block completion or tool calls. The orchestrator handles everything cross-session.

**Consequences.** Each piece lives where it has the right context. Hooks self-cap at `max_agent_retries` so they cannot loop forever; the orchestrator records "fail" for any subprocess that exits with malformed stdout and continues. Trade-off: the operator has to keep `.claude/settings.json` in sync with the orchestrator's expectations; the kit ships a canonical settings file.

### ADR-003: Claude Code as runtime; no direct Anthropic API access

**Context.** The harness could call the Anthropic API directly (more control over message shape, finer-grained cost accounting) or go through Claude Code. The Claude Max subscription only pays off through Claude Code; per-token billing through direct API calls would erase that benefit.

**Decision.** Every model interaction goes through `claude -p`. The orchestrator never imports `anthropic` or makes raw HTTP calls to the API. New Claude Code features (improved tool use, new hook types, session improvements) become available without orchestrator changes.

**Consequences.** The harness inherits Claude Code's prompt-cache behaviour, tool ergonomics, and subscription pricing. The orchestrator's dependency surface is smaller (no SDK). Trade-off: features Claude Code does not expose (custom batch APIs, fine-grained sampling control) are not available; the harness lives within the CLI's surface area.

### ADR-004: Reviewer write allowlist enforced by hook, not denylist

**Context.** Upstream-loop reviewers need `Write`/`Edit` so they can append to their own communication file, but they must not mutate the artifact tree, the operator's `_questions-pending.md`, or any other reviewer's communication file. Two options: deny all writes (reviewer cannot append → break the channel) or allow writes and constrain the path.

**Decision.** Reviewers run with `Write`/`Edit` allowed; a `PreToolUse` path-guard hook intercepts every `Write`/`Edit` call and blocks anything other than the reviewer's own `<loop>_communication/<reviewer-name>.md`. Coding-loop per-WO reviewers have no communication file and run with `Write`/`Edit` disallowed.

**Consequences.** Single-writer-per-file is enforced even against adversarial instructions in the artifacts a reviewer reads. The path-guard hook is small and self-contained. Trade-off: the hook needs the reviewer-name as a parameter (passed via env var on spawn); the orchestrator and the hook share one piece of contract.
