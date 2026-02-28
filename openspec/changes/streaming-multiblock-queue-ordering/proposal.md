## Why

Current behavior is split across two code paths:
- `InputController.setupEditorSubmitHandler()` always calls `runMultiBlockSubmission(...)` first, but `runMultiBlockSubmission` returns `{ processed: false }` when `ctx.session.isStreaming` is true (`packages/coding-agent/src/modes/controllers/input-controller.ts`, `packages/coding-agent/src/modes/controllers/multi-block-runner.ts`).
- After that bypass, streaming submit falls back to `session.prompt(text, { streamingBehavior: "steer" })`, which queues raw text as a single user message (`packages/coding-agent/src/modes/controllers/input-controller.ts`, `packages/coding-agent/src/session/agent-session.ts`).
- `InputController.handleFollowUp()` also queues raw text directly with `streamingBehavior: "followUp"` and does not run multi-block parsing (`packages/coding-agent/src/modes/controllers/input-controller.ts`).

This means multi-block ordering guarantees that exist in idle mode (explicit block parsing and ordered execution) are not applied in streaming mode. We need to remove that discrepancy while preserving two existing operator expectations that are already implemented and tested:
- imperative shortcuts (`!`, `!!`, `$`, `$$`, including fenced forms) execute immediately through existing handlers;
- queued delivery still happens at existing `steer`/`followUp` boundaries in the agent loop.

## What Changes

- Enable streaming multi-block processing by replacing the current streaming short-circuit in `runMultiBlockSubmission`.
- Keep the existing block grammar from `splitSubmissionIntoBlocks` unchanged:
  - command blocks: recognized supported slash commands only;
  - shortcut blocks: `!`, `!!`, `$`, `$$` (single-line and fenced).
- Keep existing fail-fast semantics from `runMultiBlockSubmission`:
  - parse errors call `ctx.showError(...)` and stop;
  - failed shortcut/command execution restores editor snapshot and stops.
- Add a streaming-aware compile stage that reuses existing multi-block execution helpers:
  - execute command blocks through existing slash/skill/file-command routing;
  - execute shortcut blocks through `executeBashShortcut` / `executePythonShortcut`, which call the existing immediate command handlers.
- Queue compiled prompt content through the existing mode queues (no second queue):
  - `steer` path uses current steering queue/dequeue boundary;
  - `followUp` path uses current follow-up queue/dequeue boundary.
- Preserve existing queue behavior in core agent runtime:
  - `Agent` already stores queue entries in `#steeringQueue` and `#followUpQueue` as `AgentMessage[]` with FIFO dequeue under default `one-at-a-time` mode.
- Preserve existing non-streaming multi-block behavior with no semantic change.
- Preserve existing command-result non-reexecution rule:
  - imperative blocks run at compile time;
  - dequeue stage delivers prepared prompt content only.

## Capabilities

### New Capabilities
- `streaming-multiblock-queue-compilation`: Defines submit-time streaming compilation using existing block parser and execution handlers, including fail-fast behavior parity with idle multi-block processing.
- `streaming-multiblock-boundary-delivery`: Defines delivery through existing `steer`/`followUp` queue boundaries, including FIFO ordering and `agent_end` restart behavior already implemented in `AgentSession`.

### Modified Capabilities
- _None._

## Impact

- `packages/coding-agent/src/modes/controllers/input-controller.ts`
  - Replace streaming raw-text fallback for multi-block input with compile-stage execution + queued compiled prompt delivery.
  - Unify mode-aware submission handling so both `steer` and `followUp` paths can run multi-block compilation when streaming.
- `packages/coding-agent/src/modes/controllers/multi-block-runner.ts`
  - Remove/adjust streaming bypass guard and preserve existing parse/fail-fast semantics.
  - Reuse existing command/shortcut/text block execution ordering logic for the streaming compile stage.
- `packages/coding-agent/src/modes/controllers/submission-blocks.ts`
  - No grammar change required; implementation must continue using current parser behavior for command and shortcut block detection.
- `packages/coding-agent/src/session/agent-session.ts`
  - Extend queue submission helpers (`#queueSteer`, `#queueFollowUp`, and queue-display bookkeeping) so compiled multi-block queue entries remain visible and are removed correctly when delivered.
  - Preserve existing `agent_end` auto-continue behavior for queued work.
- `packages/coding-agent/src/modes/utils/ui-helpers.ts`
  - Update pending-queue rendering if queue display payloads stop being plain text strings.
- `packages/agent/src/agent.ts`
  - No required structural queue change expected (existing queue storage is already `AgentMessage[]`); only touch if implementation introduces non-`AgentMessage` queue envelopes.
- Tests in `packages/coding-agent/test/`
  - Extend `multi-block-runner.test.ts` for streaming compile semantics.
  - Extend `input-controller-multi-block.test.ts` for streaming `steer`/`followUp` multi-block submission behavior.
  - Add/extend `agent-session` queue tests for queue-display bookkeeping and boundary delivery ordering.

Out of scope for this proposal:
- New user-facing submission syntax.
- Queue persistence format redesign.
- Provider-layer protocol changes.
