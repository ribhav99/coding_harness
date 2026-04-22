# Current State

Claude Code provides the runtime primitives the harness depends on: subprocess invocation via `claude -p`, skills, hooks, and subagents via the Task tool. The operator has been using these primitives manually — one-off sessions for PRD drafting, another session for decomposition, and another session per work order for execution.

Software Factory exists as a separate service for multi-person teams to manage requirements, blueprints, and work orders alongside an agent assistant, but it assumes humans in every loop and is not structured for single-operator autonomy. Nothing available today gives a single operator an end-to-end autonomous pipeline from PRD to merged PR, with verification as a first-class gate at each stage. The harness fills that gap by reusing Claude Code's primitives and borrowing Software Factory's entity model, while replacing the human-in-every-loop assumption with autonomous generator/reviewer cycles.
