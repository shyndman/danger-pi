## 1. Patch metadata plumbing

- [ ] 1.1 Extend `applyPatchOperations` (and related types/tests) to return structured per-file diff metadata (diff text, firstChangedLine) for every `FileChange`
- [ ] 1.2 Update `codex-apply-patch` extension to populate tool result `details` with the per-file metadata plus existing summaries/meta
- [ ] 1.3 Expand the comprehensive apply_patch test suite to cover metadata output for create/update/delete/move scenarios

## 2. LSP writethrough integration

- [ ] 2.1 Introduce an LSP-backed FileSystem (wrapping `createLspWritethrough`) and thread it through `applyPatchOperations`
- [ ] 2.2 Ensure diagnostics/formatter output is associated with each changed file (and falls back cleanly when LSP disabled)
- [ ] 2.3 Add regression tests covering both LSP-enabled and fallback modes

## 3. Renderer and UX

- [ ] 3.1 Register a dedicated `apply_patch` renderer that shows the diffstat table in collapsed view and per-file diffs when expanded
- [ ] 3.2 Reuse the shared diff rendering utilities and truncate logic so large patches remain readable (add renderer unit tests)
- [ ] 3.3 Document the new output behavior in prompts/CHANGELOG so users know what to expect
