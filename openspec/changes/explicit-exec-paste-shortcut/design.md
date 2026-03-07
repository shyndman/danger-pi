## Context

Current behavior loses paste intent before multi-block parsing:
1. Editor receives bracketed paste text.
2. Editor may compress large pastes into markers.
3. Submit path expands markers back into plain text.
4. Parser sees plain text only, so pasted lines and typed lines are indistinguishable.

That creates accidental execution risk because pasted lines starting with `/`, `!`, `!!`, `$`, or `$$` are treated like intentional commands/shortcuts.

This fork needs a surgical, merge-friendly solution:
- keep grammar unchanged,
- keep typed-input behavior unchanged,
- add explicit intent channel for pasted content.

## Goals / Non-Goals

**Goals:**
- Default terminal paste is safe: no slash/shortcut classification from safe pasted segments.
- Explicit execute-intent paste exists and is easy to reason about.
- Execute-intent action is configurable in keybindings, default `Ctrl+Shift+Alt+V`.
- Clipboard-read unavailability shows a non-blocking status message.
- Limitation is documented in both spec and code comment near clipboard read call.

**Non-Goals:**
- No parser grammar redesign.
- No arm/disarm mode.
- No changes to normal typed command/shortcut behavior.
- No broad refactor across unrelated editor/controller/parser modules.

## Decisions

1. **Represent paste origin with execution intent metadata**
   - Decision: carry paste metadata through submit pipeline as two intent classes:
     - `safe`: default bracketed paste
     - `exec`: explicit execute-intent paste action
   - Why: parser must know source intent to prevent accidental execution.
   - Alternative rejected: text-only heuristics (cannot distinguish typed vs pasted intent reliably).

2. **Use direct clipboard read for execute-intent paste**
   - Decision: add `readTextFromClipboard` native + TS wrapper and invoke from dedicated action.
   - Why: explicit action equals explicit intent; avoids ambiguous latching state.
   - Alternative rejected: arm-next-paste state.

3. **Use keybinding system instead of hardcoded chord**
   - Decision: add a new app action to keybinding model, default `Ctrl+Shift+Alt+V`, user-overridable.
   - Why: consistent with existing configurable app actions.
   - Alternative rejected: hardcoded non-configurable binding.

4. **Clipboard read failure is non-blocking**
   - Decision: show status, do not modify editor text, allow user to continue.
   - Why: remote/headless operation commonly lacks direct clipboard access.
   - Alternative rejected: hard error or modal interruption.

## Third-party Dependency Strategy (verified)

### Existing dependency baseline
- Rust crate `arboard` is already present in `crates/pi-natives/Cargo.toml` as `3.5.0` with `wayland-data-control`.
- Existing clipboard implementation already uses `Clipboard::new()` and matches `ContentNotAvailable` for image reads.

### Options considered
1. **Primary path (recommended): keep existing dependency set**
   - Implement text reads with existing `arboard` crate (`Clipboard::new()` -> `get_text()`).
   - Map `ContentNotAvailable` to `null`/no-content behavior.
   - Treat `ClipboardNotSupported` (headless/missing display) and `ClipboardOccupied` (concurrent access) as non-blocking unavailable/error states surfaced via status.

2. **Minor bump path: update `arboard` to current minor series**
   - Current registry latest is `3.6.1`; if adopted, declare minor range (`3.6`), not patch pin.
   - Requires targeted regression validation only in clipboard module.

3. **Optional fallback path: add `clipboardy`**
   - Current npm latest is `5.3.1`; if adopted, use `^5.3`.
   - API is simple (`read()`/`write()`), but package declares Node `>=20` ESM runtime and still requires display server on Linux.
   - Duplicates capability already provided by existing arboard-backed native bindings.
   - Not suitable as primary dependency for remote/headless improvement.

4. **Environment path: Termux CLI support**
   - `termux-clipboard-get` is provided by `termux-api` package and requires Termux:API app/service.
   - Command contract is simple: no args, delegates to `termux-api Clipboard` and emits clipboard text to stdout.
   - Must be optional under `TERMUX_VERSION` guard and non-blocking on failure.
   - Known failure sources to treat as unavailable: helper missing, API service missing, Android foreground clipboard restrictions.

## Implementation Map (Junior Execution Order)

### Step 1: Add clipboard text primitive
**Files:**
- `crates/pi-natives/src/clipboard.rs`
- `packages/natives/src/clipboard/types.ts`
- `packages/natives/src/clipboard/index.ts`
- `packages/natives/src/native.ts` (export validation list)

**Concrete work:**
1. Add native export `readTextFromClipboard` beside existing copy/image clipboard exports.
2. Use `Clipboard::new()` then `get_text()` in Rust binding; map `ContentNotAvailable` to `null`, and map `ClipboardNotSupported` / `ClipboardOccupied` into explicit non-blocking failure flow expected by caller.
3. In TS wrapper, keep best-effort call order explicit:
   - if `TERMUX_VERSION` is set, try `termux-clipboard-get` first,
   - then fall back to native `readTextFromClipboard`,
   - preserve non-blocking behavior on unavailable environments.
   - do not pass arguments to `termux-clipboard-get`.
4. Extend TS declaration merging (`NativeBindings`) with new method.
5. Add wrapper function in `packages/natives` mirroring current platform guards style.
6. Update native binding validation to include new export.

### Step 2: Add configurable execute-intent keybinding action
**Files:**
- `packages/coding-agent/src/config/keybindings.ts`
- `packages/coding-agent/src/modes/components/custom-editor.ts`
- `packages/coding-agent/src/modes/controllers/input-controller.ts`

**Concrete work:**
1. Add new `AppAction` (for example `pasteExec`) to union, defaults, and action list.
2. Add default binding `ctrl+shift+alt+v` in default app keybindings.
3. Wire action in `InputController.setupKeyHandlers()` through `getKeys(...)` + `setCustomKeyHandler(...)`.
4. Add callback path in `CustomEditor`/controller that triggers execute-intent paste insertion.

### Step 3: Carry paste intent through submit expansion and parsing
**Files:**
- `packages/tui/src/components/editor.ts`
- `packages/coding-agent/src/modes/controllers/submission-blocks.ts`
- `packages/coding-agent/src/modes/controllers/multi-block-runner.ts` (if interface plumb-through needed)

**Concrete work:**
1. Extend editor paste tracking data model to preserve intent per pasted segment/marker.
2. Ensure submit expansion returns both expanded text and segment metadata.
3. Update parser entrypoint shape to accept optional segment intent metadata.
4. During line classification, suppress slash/shortcut parsing when line start is from `safe` pasted segment.
5. Preserve existing behavior for `exec` segments and typed segments.

### Step 4: User feedback + required code comment
**Files:**
- Execute-intent paste handler in `input-controller.ts` (or extracted helper)

**Concrete work:**
1. On clipboard read unavailable/failure, call non-blocking status UI method.
2. Keep editor content unchanged.
3. Add required inline comment near clipboard-read call documenting:
   - remote/headless limitation,
   - why direct clipboard read is used here,
   - terminal bracketed paste fallback.
4. Add a doc comment with structural intent tag directly above the execute-intent paste handler function that performs clipboard read in `packages/coding-agent/src/modes/controllers/input-controller.ts`.
   - Required format:
     ```
     <intent>
     Execute-intent paste exists to allow deliberate command/shortcut execution from pasted clipboard text while default terminal paste remains non-executable for slash/shortcut classification.
     This handler reads clipboard text best-effort, applies execute intent metadata, and must fail non-blocking when clipboard access is unavailable.
     </intent>
     ```
   - Proposed location: immediately above the handler wired from the execute-intent keybinding (the method that calls `readTextFromClipboard`).
   - Cardinality rule for this change: exactly one `<intent>...</intent>` block in implementation code. Do not duplicate the same intent text in multiple locations.

## Risks / Trade-offs

- **[Risk] Intent mapping bugs at line boundaries** → **Mitigation:** add tests for mixed content (`typed + pasted`, multi-line, blank-line transitions).
- **[Risk] Platform-specific clipboard semantics** → **Mitigation:** explicit null/error contract and tests for unavailable path.
- **[Risk] Clipboard contention on parallel access (`ClipboardOccupied`)** → **Mitigation:** keep clipboard reads serialized in handler path; do not spawn concurrent clipboard reads for one action.
- **[Risk] Config action added but not wired everywhere** → **Mitigation:** test keybinding override path end-to-end at controller level.
- **[Risk] Regressing existing parser behavior** → **Mitigation:** preserve and re-run existing submission-block tests plus new intent tests.

## Migration Plan

1. Land clipboard primitive + wrapper first (compile-safe base).
2. Add keybinding action + execute-intent handler path.
3. Add metadata plumbing and parser gating.
4. Add/adjust tests in same commit(s) as behavior changes.
5. Rollback plan: disable execute-intent action and bypass intent-aware parser branch, restoring current behavior.

## Open Questions

- Should help/hotkey docs include an explicit line that execute-intent paste may be unavailable over remote/headless sessions in this same change, or follow-up docs-only change?
