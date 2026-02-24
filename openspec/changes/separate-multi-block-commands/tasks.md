## 1. Multi-block orchestration

- [x] 1.1 Refactor `runMultiBlockSubmission` to loop over blocks and call a new `dispatchTextBlock` helper instead of accumulating `textParts`
- [x] 1.2 Implement `dispatchTextBlock` that trims text, calls `session.prompt` with `triggerTurn` controlled by `suppressTurn`, clears the editor, and records history
- [x] 1.3 Update builtin slash command handling to wrap results in `CustomMessage` objects and send them via `session.sendCustomMessage`
- [x] 1.4 Update file-based slash command handling to reuse the existing renderer metadata (diff/diagnostics) and emit a custom message per execution
- [x] 1.5 Ensure `InputController` history captures the original submission plus subsequent text blocks so the order can be restored later

## 2. Validation

- [x] 2.1 Expand `input-controller-multi-block.test.ts` with scenarios for text-command-text, command-only stacks, and failure handling
- [x] 2.2 Add renderer-level tests confirming builtin/file commands show the same output when triggered inside multi-block submissions
- [x] 2.3 Manually reproduce the three `/test-multi.block` scenario and capture screenshots/logs to confirm transcript ordering
