## Why

Interactive operators constantly need to run `/plan`, `/skill:<name>`, and a follow-up prompt as one logical thought, but the current pipeline forces three separate sends. Every extra submit means waiting for the model to finish before sending the real instruction, which wastes time and increases the chance the agent acts on incomplete context. Removing the XOR restriction lets users compose the exact bundle of context and instructions they already have in their head, without juggling multiple turns.
## What Changes

- Build a deterministic splitter that walks the submission line-by-line, treating each leading slash command (builtins, `/skill`, discovered file commands, etc.) as its own block while grouping all other lines as plain-text blocks; no new delimiter syntax is introduced, so existing single-command submissions behave exactly as before.
- For each block, reuse the existing routing (builtin slash commands, `/skill`, plain text) but add a controller that runs them in sequence, aborts on the first error, and logs which block failed so junior engineers can debug quickly.
- Extend `promptCustomMessage`/`sendCustomMessage` with a `triggerTurn` switch and update the slash/skill handlers so they append their content without triggering the LLM when inside a batch, but behave exactly as today when submitted alone.
- Concatenate every plain-text block into one final message, ensure all queued custom messages flush, then call `session.prompt()` exactly once so the model sees the whole bundle at the right time.
- Ship operator guidance (slash-command docs, `/help`, onboarding text) showing how sequential leading slash commands plus trailing text are interpreted as batches, which commands are eligible, and what errors appear when batching unsupported commands.

## Capabilities

### New Capabilities
- `multi-block-submission-processing`: Defines how a single editor submission is split, validated, and routed through existing handlers without changing their contracts while ensuring execution order and error propagation rules.
- `batched-slash-skill-context`: Specifies how slash commands and skill injections can opt out of automatic turn triggering when part of a batch, including safeguards so standalone behavior remains unchanged.
- `slash-command-batch-docs`: Captures the operator-facing documentation and help-surface requirements so users understand delimiter syntax, eligible commands, and failure handling without guesswork.

### Modified Capabilities
- _None._

## Impact

- `packages/coding-agent/src/modes/controllers/input-controller.ts`: add the block splitter, validation, sequential executor, and user-facing error handling; update history management so the original submission can be recalled.
- `packages/coding-agent/src/session/agent-session.ts`: add the `triggerTurn` option to `promptCustomMessage` (currently always triggers a turn) and ensure queued custom messages flush before the final user prompt is sent.
- `docs/slash-command-internals.md`, `/help`, and any inline hints: add a “Multi-block submissions” section that explains delimiters, eligible commands, and sample workflows, referencing the existing slash-command internals doc.
- Tests (run via the existing Bun-based test suites in `packages/coding-agent`) need new cases for delimiter parsing, invalid batching (UI slash commands, malformed fences), and happy-path `/plan` + text sequences to prevent regressions.
- No new third-party packages are required; the feature uses existing TUI, session, and documentation infrastructure already in the repo.
