## 1. Input Splitter & Validation

- [x] 1.1 Implement the line-by-line block parser (leading slash commands become blocks, everything else stays plain text) with unit tests.
- [x] 1.2 Add block eligibility validation + error messaging for ineligible commands (UI slash commands, bang/python shortcuts, etc.).
- [x] 1.3 Wire InputController to process parsed blocks sequentially and short-circuit on failure.

## 2. Session & Command Semantics

- [x] 2.1 Add `triggerTurn` support to `promptCustomMessage`/`sendCustomMessage` paths and update batching callers.
- [x] 2.2 Ensure slash/skill handlers use non-turn insertion inside batches but keep standalone behavior.
- [x] 2.3 Guarantee queued custom messages flush before the final concatenated user text triggers `session.prompt()`.

## 3. Documentation & UX

- [x] 3.1 Update slash-command docs/help overlays with multi-block submission instructions and limitations.
- [x] 3.2 Add validation warnings + tests covering invalid batching (UI commands, bang/python shortcuts, unrecognized combinations).
- [x] 3.3 Add regression tests for successful `/plan` + text batch, ensuring single user turn.
