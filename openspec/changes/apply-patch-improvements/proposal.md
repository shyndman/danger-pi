## Why

`apply_patch` currently behaves like a black box when agents run it: the TUI only shows a generic success line and the tool writes directly to disk with no formatting or diagnostics. Engineers cannot see which files changed until they inspect the repo manually, so validating Codex edits requires leaving the TUI and running `git status`. Because `apply_patch` skips the LSP writethrough plumbing, we also lose format-on-write, diagnostics, and batching that the Edit/Write tools already provide. The net result is that our most commonly used Codex tool produces the lowest-fidelity UX.

## What Changes

- **Renderer**: Introduce a new `apply_patch` renderer registered in `toolRenderers` (the map currently wiring `edit`, `write`, etc.). Today `codex-apply-patch.ts` only returns the text “Success. Patch applied.” so the TUI renders a plain string. The renderer MUST synthesize a git-style diffstat table (one line per file plus rollup) when collapsed, and SHOULD display unified diffs with the same helpers as `editToolRenderer` (syntax highlighting, truncation, expand hint) whenever the user expands a file.
- **Metadata plumbing**: `applyPatchOperations` already returns `FileChange[]` with `oldContent` / `newContent`. We SHALL compute normalized diffs for each change (create/update/delete/move) immediately after the call and attach `{ path, type, rename?, diff text, firstChangedLine }` to the tool result so the renderer has everything it needs without recomputing diffs.
- **LSP integration**: `opencode-patch.ts` currently writes directly using `Bun.write` / `fs.unlink`, so `apply_patch` never touches `createLspWritethrough`. We SHALL change `applyPatchOperations` to require a FileSystem argument and pass an LSP-aware implementation (wrapping `createLspWritethrough`, mirroring the `LspFileSystem` used in the Edit tool) so patch writes are formatted/diagnosed/batched like Edit/Write. When LSP is disabled the provided FileSystem still routes through the shared abstraction (using the existing fallback behavior) so there is no direct Bun usage.
- **Meta + summary**: Extend the tool output to include per-file summary lines (e.g., `M src/foo.ts`, `A docs/bar.md`) along with diagnostics metadata (`outputMeta().diagnostics`). This keeps `apply_patch` parity with Edit/Write outputs so downstream automation (plan mode checks, log scrapers) sees a consistent structure.

## Capabilities

### New Capabilities
- `apply-patch-rendering`: Defines the renderer contract: diffstat in collapsed mode, expandable per-file diffs, rename indicators, truncation behavior, and summary text so any engineer can reason about tool output without digging through git.
- `apply-patch-lsp-integration`: Specifies exactly when and how `apply_patch` routes through `createLspWritethrough`, what batching looks like, and how to fall back when LSP is disabled.

### Modified Capabilities
- `coding-agent-editing`: Explicitly states that `apply_patch` must follow the same rules as Edit/Write: writes go through the approved FS abstraction, metadata (diffs + diagnostics) is required, and any attempt to introduce new heuristics must be justified via OpenCode parity docs.

## Impact

- `packages/coding-agent/src/extensions/codex-apply-patch.ts`: parse the tool response, gather `FileChange` diffs, attach diagnostics/meta, and emit per-file summary strings.
- `packages/coding-agent/src/patch/opencode-patch.ts`: add an optional FileSystem parameter, instantiate the LSP-backed FS, and make sure every file operation (create/update/delete/move) goes through it.
- `packages/coding-agent/src/tools/renderers.ts` and a new renderer module (e.g., `tools/apply-patch-renderer.ts`): register the renderer, implement diffstat + diff display, and add renderer unit tests mirroring `editToolRenderer` coverage.
- `packages/coding-agent/src/lsp/` utilities: implement `LspPatchFileSystem` (wraps `createLspWritethrough`), batching helpers, and any diagnostic merging needed for multiple files.
