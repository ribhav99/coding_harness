# PRD Authoring

## Overview

The `prd-authoring` feature is an interactive Claude Code skill the operator invokes at the start of a new project to draft and refine a single monolithic `PRD.md` at the project repo's root. It is the only stage of the harness where the operator works inside an interactive session — every downstream stage is autonomous. The skill wears a senior product-manager role, helps the operator shape the product description, and critiques the drafted PRD on request so that the downstream autonomous loops have a coherent input.

Users need this feature because the PRD is the harness's single source of truth. A passing Requirements Loop on an incoherent PRD produces incoherent FRDs; an incoherent FRD tree wrecks the Blueprint Loop. Catching contradictions, gaps, and ambiguity at authoring time — while the operator's context is still hot — costs far less than resolving them later through the non-blocking questions mechanism.

## Terminology

- **PRD** — the single monolithic `PRD.md` file at the project repo's root, authored by the operator in prose. Input to the Requirements Loop; never edited by any autonomous loop.
- **Critique rubric** — the five categories the skill applies when the operator asks for review: CONFLICT, MISSING, AMBIGUOUS, DUPLICATION, STALE.
- **Clarification policy** — the rule the skill follows when the operator's ask is unclear: ambiguous → ask and wait; specific → act; middle → propose plus up to two questions.
- **Feature-unit scoping** — the discipline that defines what counts as a feature (standalone value, implementation footprint, independent deployability, incremental value). The skill applies it informally during authoring; formal feature shaping happens in the Requirements Loop.

## Requirements

### REQ-PRDA-001 — Interactive PRD drafting
**User Story.** As an operator, I want to drive an interactive Claude Code session that helps me draft `PRD.md` at the project repo's root, so that I can produce a coherent PRD without writing every sentence myself.
- **AC-PRDA-001.1** — When the operator invokes the `prd-authoring` skill in a Claude Code session, the skill shall read any existing `PRD.md` at the project repo's root and offer to continue or revise it.
- **AC-PRDA-001.2** — The skill shall use Claude Code's filesystem tools (Read, Write, Edit) to write and edit `PRD.md` directly at the project repo's root.
- **AC-PRDA-001.3** — The skill shall never write to files outside `PRD.md` during authoring.

### REQ-PRDA-002 — Senior-PM role and writing rules
**User Story.** As an operator, I want the skill to write in a consistent overview-document style, so that the PRD reads as a coherent product description rather than a collection of drafted paragraphs in different voices.
- **AC-PRDA-002.1** — The skill shall use narrative prose and active voice.
- **AC-PRDA-002.2** — The skill shall focus on WHAT the product does and why, not HOW it will be implemented.
- **AC-PRDA-002.3** — The skill shall avoid fluff adjectives (comprehensive, seamless, powerful, engaging, and similar).
- **AC-PRDA-002.4** — The skill shall not fabricate personas, metrics, terminology, or constraints the operator has not provided.
- **AC-PRDA-002.5** — The skill shall not introduce refactor breadcrumbs such as "(renamed from X)", "previously…", or references to a prior PRD version.

### REQ-PRDA-003 — Clarification policy
**User Story.** As an operator, I want the skill to judge when to ask me questions and when to just act, so that authoring does not stall on trivial decisions or race past decisions I would have wanted to make.
- **AC-PRDA-003.1** — When the operator's ask is genuinely ambiguous, the skill shall ask a clarifying question and wait for the operator's answer before writing.
- **AC-PRDA-003.2** — When the operator's ask is specific, the skill shall act directly without asking.
- **AC-PRDA-003.3** — When the operator's ask is in the middle, the skill shall propose a concrete approach and ask at most two targeted clarifying questions alongside the proposal.

### REQ-PRDA-004 — Critique on demand
**User Story.** As an operator, I want to ask the same skill to critique what I have drafted, so that I can catch defects before triggering the autonomous Requirements Loop without switching to a separate skill.
- **AC-PRDA-004.1** — When the operator asks for review, critique, or feedback on the PRD, the skill shall apply the five-category rubric (CONFLICT, MISSING, AMBIGUOUS, DUPLICATION, STALE) in-line within the same session.
- **AC-PRDA-004.2** — The skill shall filter findings to critical-only — direct contradictions, critical product-level gaps blocking understanding, genuine confusion about user experience or feature behavior, significant duplicated content needing consolidation, and refactor residue that only makes sense against a prior version.
- **AC-PRDA-004.3** — The skill shall not forward critique findings to a separate skill or external file; critique lives in the conversation.

### REQ-PRDA-005 — Feature-unit scoping discipline during drafting
**User Story.** As an operator, I want the skill to apply feature-unit scoping when I describe features, so that the PRD reflects a reasonable feature shape even though formal decomposition happens in the Requirements Loop.
- **AC-PRDA-005.1** — When the operator describes a feature, the skill shall evaluate it informally against the feature-unit definition (standalone value, implementation footprint, independent deployability, incremental value) and surface scoping concerns in-line.
- **AC-PRDA-005.2** — The skill shall not produce formal FRDs; FRD production belongs to the Requirements Loop.

## Feature Behavior & Rules

The skill runs only inside an interactive Claude Code session — it is never invoked by the orchestrator as a subprocess. The operator drives the session; the skill responds. This is the only stage of the harness where a human sits inside the loop.

Output is a single file: `PRD.md` at the project repo's root. The skill does not produce a tree of overview documents, a tree of FRDs, blueprints, or work orders. Those come from downstream autonomous loops. If the operator asks the skill to do decomposition, the skill declines and points at the Requirements Loop.

Critique is a mode of the same skill, not a separate skill. The operator invokes critique by asking ("what's missing?", "critique this section", "check for contradictions"). The skill applies the rubric inside the ongoing conversation and returns findings as part of the dialogue. Forcing a separate skill boundary would add friction without adding value — the autonomous Requirements Loop downstream applies stricter checks anyway, catching defects the operator missed in-session.

The clarification policy keeps the skill from stalling on every minor decision while still surfacing genuine ambiguity. The operator can override the skill's judgment at any time by asking a direct question or giving a direct instruction.

No-fabrication discipline is load-bearing. The PRD must reflect the operator's actual decisions, including the decision to leave things out. If the operator does not describe personas, the PRD has no personas section. The skill does not fill gaps with plausible-sounding prose. This discipline carries forward into every downstream loop.
