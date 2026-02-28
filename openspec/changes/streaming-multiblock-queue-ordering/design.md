## Context

`InputController` currently runs one of two paths while the agent is streaming: queue a single prompt (`streamingBehavior: "steer"|"followUp"`) or bypass multi-block execution. Multi-block behavior in idle mode is richer: it parses blocks, executes slash/shortcut blocks, emits transcript messages, and triggers prompting in a controlled sequence. The gap creates ordering ambiguity and inconsistent operator mental models.

The fork requirement is strict ordering parity with authored intent: command execution remains immediate, while prompt delivery follows existing steer/follow-up boundaries.

## Goals / Non-Goals

**Goals:**
- Preserve existing single-message streaming semantics (`steer` and `followUp`) and boundaries.
- Add a streaming multi-block path that compiles once at submit time and delivers later without re-execution.
- Guarantee deterministic ordering between text and command-result prompt content within one submission.
- Keep the implementation surgical and easy to merge by reusing existing multi-block and prompt plumbing.

**Non-Goals:**
- Reworking agent-loop boundary semantics.
- Changing non-streaming multi-block behavior.
- Introducing a new user-facing submission syntax.
- Refactoring unrelated session queue systems.

## Decisions

### 1) Submit-time compile, boundary-time delivery
- **Decision**: While streaming, multi-block submissions are parsed and compiled immediately into a deferred payload.
- **Rationale**: Keeps imperative execution immediate (current user expectation) while aligning delivery with existing queue boundaries.
- **Alternative considered**: Defer full execution until dequeue. Rejected because it changes command timing and violates expected immediate behavior.

### 2) Extend existing `steer`/`followUp` queues with a compiled pseudo-message entry
- **Decision**: Represent compiled multi-block submissions as a queue item variant inside the existing `steer` and `followUp` queues, carrying ordered prompt parts plus minimal metadata.
- **Rationale**: Preserves current queue timing behavior while avoiding cross-queue arbitration and ordering drift.
- **Alternative considered**: Add a dedicated second queue for compiled payloads. Rejected because it introduces unnecessary precedence and FIFO coordination risk between queues.

### 3) Reuse existing mode boundaries, do not invent new drain points
- **Decision**: Drain `steer` payloads where steering messages currently drain; drain `followUp` payloads where follow-up currently drains.
- **Rationale**: Preserves user-visible timing and avoids risky loop-control changes.
- **Alternative considered**: New custom boundary hooks in agent loop. Rejected as higher-churn and harder to keep upstream-compatible.

### 4) Unify ordering for compiled prompt content and command-result content
- **Decision**: The compiled payload includes all promptable parts in authored order; dequeue delivers that sequence exactly once.
- **Rationale**: Prevents current mismatch where pending bash/python arrays can surface later than queued text.
- **Alternative considered**: Keep separate pending arrays and merge on flush. Rejected because merge timing can reorder meaning.

### 5) Keep existing idle multi-block runner as behavioral reference
- **Decision**: Streaming compile path reuses the same parser/routing behavior as idle mode, with minimal adapter hooks.
- **Rationale**: Reduces divergence and lowers regression risk.
- **Alternative considered**: New streaming-only multi-block implementation. Rejected due to duplication and maintenance cost.

## Risks / Trade-offs

- **[Risk] Duplicate transcript emission between compile and delivery** → **Mitigation**: define explicit ownership per stage (compile emits execution artifacts; delivery emits prompt payload only).
- **[Risk] Queue starvation if steer payloads continuously arrive** → **Mitigation**: retain existing steer/follow-up priority behavior; add tests for mixed-mode draining fairness.
- **[Risk] Compiled payload may become stale if session context mutates before delivery** → **Mitigation**: keep payload representation minimal and text-based; avoid late dynamic re-expansion.
- **[Risk] Increased complexity around error handling for compile-time command failures** → **Mitigation**: preserve existing multi-block fail-fast behavior and surface block-indexed errors.

## Migration Plan

1. Introduce a compiled multi-block queue-item variant in `AgentSession` and extend existing `steer`/`followUp` dequeue handling.
2. Update `InputController` streaming submit branch to call compile-and-enqueue for multi-block submissions.
3. Add boundary drain hooks that deliver compiled payloads using existing steer/follow-up timing.
4. Add regression tests for ordering parity, immediate execution timing, and mixed single+multi-block queues.
5. Rollback strategy: revert streaming multi-block branch to current bypass behavior while keeping idle multi-block unchanged.

## Open Questions

- Should compiled payload records be persisted to session storage or remain in-memory only for this iteration?
- For compile-time command failures, should partial compiled content before the failure still enqueue, or should the entire submission abort?
- Do we need explicit UI affordances to distinguish “compiled and queued” from “raw queued” in pending message indicators?
