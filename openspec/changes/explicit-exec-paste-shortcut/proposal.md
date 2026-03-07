## Why

Pasted terminal content currently reaches multi-block parsing as plain text with no origin metadata, so pasted lines can be classified the same way as typed executable lines. That creates accidental execution risk for pasted session snippets containing slash-command or shortcut prefixes.

## What Changes

- Add a safe-by-default paste policy: content from normal terminal bracketed paste is treated as text in multi-block parsing, even when lines begin with `/`, `!`, `!!`, `$`, or `$$`.
- Add an explicit execute-intent paste action that reads clipboard text and inserts it as execution-allowed pasted content.
- Add native and TypeScript clipboard text read support (`readTextFromClipboard`) used by execute-intent paste.
- Make execute-intent paste configurable in keybindings, with default binding `Ctrl+Shift+Alt+V`.
- Require non-blocking status feedback when execute-intent clipboard read is unavailable.
- Require explicit documentation of clipboard-read limitations (remote/headless) in both spec requirements and inline implementation comments near the clipboard-read path.

### Third-party dependency options (verified)

1. **Option A (recommended): no new dependency; use existing `arboard` path**
   - Current repo state: `crates/pi-natives` already depends on `arboard = 3.5.0` with `wayland-data-control` feature.
   - Verified API supports text reads: `Clipboard::new()` then `get_text()`.
   - Expected no-text/unsupported handling can key on documented variants: `ContentNotAvailable`, `ClipboardNotSupported`, and `ClipboardOccupied`.
   - Dependency impact: none (reuse existing crate).

2. **Option B: minor-update existing `arboard` dependency**
   - Registry shows latest `arboard` is `3.6.1`.
   - If we update, use a minor series constraint (for example `3.6`), not a patch pin.
   - Dependency impact: still no new dependency, but requires validating behavior changes against current clipboard code paths and Linux backend behavior.

3. **Option C: add optional JS fallback (`clipboardy`)**
   - Current npm latest is `5.3.1`; if added, use a minor range (for example `^5.3`).
   - Verified API: async `read()`/`write()` plus sync methods.
   - Verified constraints: package declares Node `>=20` ESM runtime; Linux clipboard still requires display server (headless remains unsupported).
   - Dependency impact: introduces new JS package plus platform backend expectations (`wl-clipboard`/xsel/PowerShell fallbacks) and duplicates existing arboard-backed clipboard capability. Use only as optional fallback, not primary path.

4. **Option D: Termux-specific read helper path**
   - `termux-clipboard-get` is provided by the `termux-api` package and depends on the Termux:API Android app/service (current app release noted in upstream README: `v0.53.0`).
   - Helper semantics are fixed CLI behavior (no arguments; delegates to `termux-api Clipboard`).
   - This is an environment dependency (not npm/cargo) and should remain best-effort under `TERMUX_VERSION` guard.
   - Failure modes that MUST stay non-blocking: missing helper binary, missing Termux:API service (for example `cmd: Can't find service: activity`), and Android foreground-clipboard restrictions.

### Dependency research references

- arboard registry/API/errors:
  - https://crates.io/api/v1/crates/arboard
  - https://docs.rs/arboard/latest/arboard/struct.Clipboard.html
  - https://docs.rs/arboard/latest/arboard/enum.Error.html
- clipboardy version/API/runtime constraints:
  - https://registry.npmjs.org/clipboardy
  - https://raw.githubusercontent.com/sindresorhus/clipboardy/main/readme.md
  - https://raw.githubusercontent.com/sindresorhus/clipboardy/main/package.json
- Termux helper and API requirements:
  - https://raw.githubusercontent.com/termux/termux-api-package/master/scripts/termux-clipboard-get.in
  - https://raw.githubusercontent.com/termux/termux-api/master/README.md
  - https://developer.android.com/about/versions/10/privacy/changes#clipboard-data

### Verified current baseline (source-checked in this session)

- `packages/tui/src/components/editor.ts`
  - Bracketed paste enters via `BracketedPasteHandler` and `#handlePaste(...)`.
  - Large pastes are stored in `#pastes` and rendered as `[paste #N ...]` markers.
  - `#submitValue()` expands markers back to text and calls `onSubmit(text: string)` with plain text only.
- `packages/tui/src/bracketed-paste.ts`
  - Terminal paste handling is based on bracketed paste delimiters `\x1b[200~` and `\x1b[201~`.
- `packages/coding-agent/src/modes/controllers/input-controller.ts`
  - Submit path calls `runMultiBlockSubmission({ text, ... })` with the editor’s text only.
  - `Ctrl+V` is currently wired to image paste (`readImageFromClipboard`) and falls back with status text when no image is available.
- `packages/coding-agent/src/modes/controllers/multi-block-runner.ts`
  - Multi-block parsing calls `splitSubmissionIntoBlocks(text, { isSupportedSlashCommand })` with no paste-origin metadata.
- `packages/coding-agent/src/modes/controllers/submission-blocks.ts`
  - Parser classifies recognized slash commands as `command` blocks.
  - Parser classifies `!`, `!!` as bash shortcuts and `$`, `$$` as python shortcuts.
  - Parser includes markdown image guard for single-`!` (`![...]` case).
- `packages/coding-agent/src/config/keybindings.ts`
  - App keybindings are configurable via `keybindings.json` and `KeybindingsManager`.
  - There is currently no execute-intent paste app action in `AppAction` defaults.
- `crates/pi-natives/src/clipboard.rs` + `packages/natives/src/clipboard/*`
  - Clipboard exports currently include text copy and image read.
  - There is currently no text-read clipboard export (`readTextFromClipboard`).
  - Existing wrapper already uses Termux-specific `termux-clipboard-set` best-effort path for writes.
  - Existing Rust clipboard code already maps `ContentNotAvailable` to `None` for image reads; text-read path should follow this error-mapping style.
- Existing tests
  - `packages/coding-agent/test/submission-blocks.test.ts` covers shortcut classification and markdown-image regression.
  - `packages/tui/test/editor.test.ts` exists but does not currently cover bracketed-paste marker expansion path.
  - `packages/natives/test/native.test.ts` exists and currently has no clipboard-specific coverage.

## Capabilities

### New Capabilities
- `paste-execution-intent`: Defines safe default paste versus explicit execute-intent paste, including parser classification behavior, keybinding behavior, mixed-input behavior, and clipboard-availability handling.

### Modified Capabilities
- None.

## Impact

Confirmed implementation touch points:
- `crates/pi-natives/src/clipboard.rs` (add native text-read clipboard export)
- `packages/natives/src/clipboard/types.ts` and `packages/natives/src/clipboard/index.ts` (add TS binding + wrapper)
- `packages/natives/src/native.ts` (extend native export validation)
- `packages/coding-agent/src/config/keybindings.ts` (add configurable execute-intent app action)
- `packages/coding-agent/src/modes/controllers/input-controller.ts` (wire execute-intent handler and non-blocking status behavior)
- `packages/tui/src/components/editor.ts` (preserve paste intent metadata through marker expansion/submit flow)
- `packages/coding-agent/src/modes/controllers/submission-blocks.ts` and `packages/coding-agent/src/modes/controllers/multi-block-runner.ts` (consume intent metadata for classification)

Potentially avoidable touch point (depends on implementation choice):
- `packages/coding-agent/src/modes/components/custom-editor.ts` may not require changes if execute-intent binding is handled via existing `setCustomKeyHandler(...)` plumbing in `InputController`.

Test impact (verified baseline + required additions):
- Extend parser/controller tests in `packages/coding-agent/test/`.
- Add explicit bracketed-paste intent tests in `packages/tui/test/editor.test.ts` (currently absent).
- Add clipboard text-read coverage in `packages/natives/test/` (currently absent for clipboard APIs).
