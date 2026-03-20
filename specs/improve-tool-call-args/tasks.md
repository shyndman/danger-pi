## 1. Normalize tool-call metadata
- [x] 1.1 Update `packages/agent-session-viewer/src/types.ts` and `src/normalize.ts` so the viewer-local persisted tool-call shape includes `intent?: string`, tool-call rows carry explicit intent plus structured display arguments instead of a preformatted `argsLine`, and normalization prefers persisted `toolCall.intent` while falling back to `arguments._i` only when intent is absent. Make the normalized row decide the display intent once so `render.ts` only consumes already-prepared viewer data.
- [x] 1.1a Add or update normalization-focused tests in `packages/agent-session-viewer/test/normalize-render.test.ts` to prove `_i` is removed from displayed args, explicit `intent` wins when present, and older sessions without explicit intent still render a truthful fallback intent. These tests should inspect normalized rows directly where possible, not only final rendered text.

## 2. Render structured call arguments

- [x] 2.1 Update `packages/agent-session-viewer/src/render.ts` to render tool-call headers with same-line muted intent and a viewer-local YAML-like argument block that uses two-space indentation, preserves key order, renders nested objects and arrays readably, omits any `args:` label, leaves tool-result rows unchanged, and routes the rendered lines through the existing `wrapStyledText()` helper. Implement the structured formatter as a small helper instead of embedding recursive formatting directly inside `renderToolRow()`.
- [x] 2.1a Extend `packages/agent-session-viewer/test/normalize-render.test.ts` with render assertions for nested objects, arrays, quoting-only-when-needed behavior, multiline string behavior if implemented specially, and unchanged tool-result rendering. Prefer focused assertions that check important lines over one large brittle transcript assertion.

## 3. Validate package behavior

- [x] 3.1 Run `bun test test/*.test.ts` in `packages/agent-session-viewer/`, matching the package's current `test` script, and confirm the updated viewer tests pass with the new tool-call presentation. Treat any failing existing viewer test as part of the feature work, because the viewer contract is changing.
- [x] 3.1a Save the test output artifact or command log produced by the package test run so the change has a concrete verification record. The artifact should make it obvious which package test command was run and whether it passed.

```mermaid
graph LR
  "1.1" --> "1.1a"
  "1.1" --> "2.1"
  "2.1" --> "2.1a"
  "1.1a" --> "3.1"
  "2.1a" --> "3.1"
  "3.1" --> "3.1a"
```
