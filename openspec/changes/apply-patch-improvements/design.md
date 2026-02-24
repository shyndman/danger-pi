## Context

- `apply_patch` is currently wired up only for Codex sessions, parses Codex patches via `parsePatchStrict`, applies them in `applyPatchOperations`, and reports success text with no structured details.
- The Edit/Write tools already leverage LSP writethrough for formatting, diagnostics, batching, and renderer metadata; `apply_patch` bypasses that pipeline and writes directly using Bun APIs.
- The TUI renderer framework expects per-tool renderers; only the edit/write/etc. tools currently provide rich display, so `apply_patch` falls back to plain text output.

## Goals / Non-Goals

**Goals:**
- Provide a consistent, informative visualization for every `apply_patch` invocation (diffstat summary + per-file diffs on demand).
- Ensure all patch writes pass through the same LSP infrastructure (format-on-write, diagnostics, filesystem invalidation) that Edit/Write use.
- Maintain the strict OpenCode patch semantics (no new heuristics/fuzziness) while augmenting metadata and I/O handling.

**Non-Goals:**
- Changing how Codex patches are parsed or matched (that is governed by the OpenCode compatibility spec).
- Modifying non-Codex editing tools or introducing new editing modes.
- Reworking plan-mode governance; enforcement continues to sit in existing utilities.

## Decisions

1. **Capture per-file diffs immediately after patch application**
  - After `applyPatchOperations` returns a `FileChange[]`, compute a normalized diff for each change using `generateUnifiedDiffString` (create/delete cases synthesize empty baselines).
  - Store `{ path, type, rename?, diff, firstChangedLine }` alongside optional diagnostics inside `toolResult.details.changes` so renderers and downstream automation can consume the structured data.

2. **Introduce an LSP-backed FileSystem implementation for patch mode**
  - Extend `applyPatchOperations` to accept an optional `FileSystem` implementation; default remains the current Bun-backed behavior.
  - Create `LspPatchFileSystem` that proxies `write` calls to `createLspWritethrough`, uses Bun for `read/exists`, and handles `delete/mkdir` with the existing helpers.
  - Pass the new FS when LSP is enabled (respecting session settings for diagnostics/formatting/batching) so we get formatting + diagnostics for all touched files.

3. **Add a dedicated renderer for `apply_patch`**
  - Register `apply_patch` in `toolRenderers` with a renderer similar to the edit renderer but optimized for multiple files.
  - Collapsed view: git-style diffstat table (`filename | ++++----`) plus aggregate summary line.
  - Expanded view: per-file diff blocks rendered via the shared diff rendering utilities, each respecting expand hints and theming.

4. **Preserve tool summaries while appending metadata**
  - Keep the existing short success text for compatibility but append per-file summaries when multiple files change.
  - Populate `outputMeta().diagnostics()` using merged diagnostics from the writethrough pipeline to keep the TUI consistent with other editing tools.

## Risks / Trade-offs

- [Diff computation cost] → Mitigation: reuse normalized content already available from `FileChange` buffers; limit diff preview length when rendering and compute lazily if performance becomes an issue.
- [Formatter side effects] → Mitigation: run writethrough sequentially per change (or via batch flush) and update `FileChange.newContent` to reflect formatted output so diff output matches on-disk content.
- [Renderer clutter for large patches] → Mitigation: default to collapsed diffstat view and rely on expand toggles plus truncation helpers from `truncateDiffByHunk`.
- [LSP unavailability] → Mitigation: fall back to the default Bun file system when LSP is disabled or misconfigured; renderer still works because diffs are derived from actual content regardless of formatting.

## Migration Plan

1. Land the new FS abstraction and ensure `apply_patch` opts in only when session.enableLsp is true.
2. Capture per-file diffs + metadata and update tool outputs/tests (existing comprehensive tests provide good coverage; add new assertions for metadata shape).
3. Introduce the renderer and wire it into `toolRenderers`.
4. Add changelog entries/document behavior changes in user prompt files.

## Open Questions

- Should diff capture also emit summaries for plan-mode enforcement (e.g., to block apply_patch in plan mode)? (currently assumed no change.)
- Do we need configuration flags to disable diff rendering or LSP writethrough for `apply_patch`, or should it follow the same settings as Edit/Write automatically?