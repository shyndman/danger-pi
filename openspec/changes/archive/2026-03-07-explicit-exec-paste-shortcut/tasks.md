## 0. Confirm third-party dependency path

- [x] 0.1 Choose dependency option from proposal/design (A: existing arboard, B: arboard minor bump, C: optional clipboardy fallback).
- [x] 0.2 If option B is selected, update cargo dependency to minor range (`3.6`) and run clipboard-targeted regression checks.
- [x] 0.3 If option C is selected, add `clipboardy` using a minor range (`^5.3`) and gate it as optional fallback (not primary path).
- [x] 0.4 Document Termux environment dependency (`termux-api` package + Termux:API app/service) for `termux-clipboard-get` path and keep failures non-blocking.

## 1. Add clipboard text primitive in natives

- [x] 1.1 Update `crates/pi-natives/src/clipboard.rs` to export `readTextFromClipboard` with explicit no-content/unavailable behavior.
- [x] 1.2 Update native TypeScript bindings in `packages/natives/src/clipboard/types.ts` with new method signature.
- [x] 1.3 Add `readTextFromClipboard` wrapper to `packages/natives/src/clipboard/index.ts` with explicit call order: Termux `termux-clipboard-get` (when `TERMUX_VERSION`, no CLI args) then native binding fallback.
- [x] 1.4 Update native export validation in `packages/natives/src/native.ts` so missing export fails fast.
- [x] 1.5 Add/extend tests for wrapper behavior covering available text, unavailable clipboard, and failure propagation contract.
- [x] 1.6 Add/extend tests for Termux-specific unavailable command behavior (missing helper, missing Termux:API service, foreground restriction outcomes) remaining non-blocking.
- [x] 1.7 Add/extend tests for native clipboard contention/unavailable variants (`ClipboardOccupied`, `ClipboardNotSupported`) mapping to non-blocking status path.

## 2. Add configurable execute-intent paste action

- [x] 2.1 Extend `AppAction` in `packages/coding-agent/src/config/keybindings.ts` with execute-intent paste action name.
- [x] 2.2 Add default keybinding `ctrl+shift+alt+v` for execute-intent action in default app keybindings.
- [x] 2.3 Add action to app action list so config parsing and lookups support it.
- [x] 2.4 Wire action in `InputController.setupKeyHandlers()` using `ctx.keybindings.getKeys(...)` and `setCustomKeyHandler(...)`.
- [x] 2.5 Implement execute-intent paste handler that reads clipboard text and inserts content with execute intent metadata.
- [x] 2.6 Add required inline comment at clipboard-read call documenting remote/headless limitation and bracketed-paste fallback.
- [x] 2.7 Add required `<intent>...</intent>` doc comment directly above the execute-intent paste handler (the function that calls `readTextFromClipboard`) in `packages/coding-agent/src/modes/controllers/input-controller.ts`.
- [x] 2.8 Enforce cardinality for this change: exactly one `<intent>...</intent>` block in implementation code (no duplicate copies of the same intent text).
- [x] 2.9 Ensure clipboard read unavailable/error path uses non-blocking status and leaves editor content unchanged.

## 3. Preserve and propagate paste intent through submit pipeline

- [x] 3.1 Extend editor paste tracking model in `packages/tui/src/components/editor.ts` to retain intent (`safe` vs `exec`) per pasted segment.
- [x] 3.2 Ensure submit expansion returns/retains enough metadata for parser to determine line intent.
- [x] 3.3 Plumb metadata through multi-block submission entrypoints (`input-controller`/`multi-block-runner` as needed) without changing unrelated behavior.
- [x] 3.4 Update `packages/coding-agent/src/modes/controllers/submission-blocks.ts` classification logic to suppress slash and shortcut parsing for `safe` pasted lines.
- [x] 3.5 Confirm execute-intent pasted lines and typed lines still use existing slash/shortcut classification.
- [x] 3.6 Confirm existing markdown image guard behavior remains intact while adding intent logic.

## 4. Add targeted tests for junior-verifiable behavior

- [x] 4.1 Add parser tests: safe pasted `!`, `!!`, `$`, `$$`, and `/...` lines remain text.
- [x] 4.2 Add parser tests: execute-intent pasted lines classify as command/shortcut when syntactically valid.
- [x] 4.3 Add mixed-submission tests: typed + safe paste + execute-intent paste preserve both ordering and intent behavior.
- [x] 4.4 Add keybinding tests: execute-intent action defaults to `ctrl+shift+alt+v` and supports override via keybindings config.
- [x] 4.5 Add handler tests: clipboard-unavailable/error paths show non-blocking status and preserve editor text.
- [x] 4.6 Re-run existing markdown image regression tests to ensure no regression in shortcut misclassification fix.

## 5. Verification commands and reporting

- [x] 5.1 Run targeted test files for touched parser and controller behavior in `packages/coding-agent`.
- [x] 5.2 Run targeted tests for `packages/tui` editor paste behavior touched by this change.
- [x] 5.3 Run targeted tests for `packages/natives` clipboard wrapper/binding behavior touched by this change.
- [x] 5.4 Record exact command lines and pass/fail counts in implementation summary.
