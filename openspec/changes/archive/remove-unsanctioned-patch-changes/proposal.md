## Why

Coding-agent's `apply_patch` diverged from the OpenCode reference by introducing fuzzy matching, heuristic diff parsing, and side-effectful summaries, which adds risk and unpredictability to patch application. We need to restore parity so the agent behaves exactly like OpenCode except for BOM/CRLF preservation.

## What Changes

- Remove all non-OpenCode behaviors from coding-agent's patch subsystem (dual diff parser, dry-run validation loop, auto newline injection, summary rewrites, etc.).
- Keep only BOM and CRLF restoration so file encodings survive round-trips.
- Align extension outputs, warnings, and FS hooks with OpenCode's tool UX to ensure consistent downstream expectations.

## Capabilities

### New Capabilities
- `apply-patch-governance`: Documents the sanctioned behavior for `apply_patch`, specifying the single-source parser, deterministic matching strategy, and encoding rules inherited from OpenCode.

### Modified Capabilities
- `coding-agent-editing`: Requirements will explicitly state that editing tools must not add heuristics beyond the reference implementation, ensuring future edits don't reintroduce divergence.

## Impact

- `packages/coding-agent/src/extensions/codex-apply-patch.ts` (tool wiring) and `packages/coding-agent/src/patch/**` (parsing and applicator logic).
- Tests under `packages/coding-agent/test/core` and `test/extensions` that currently assume the custom behaviors.
- Documentation/prompt content describing `apply_patch` expectations so it matches OpenCode messaging.
