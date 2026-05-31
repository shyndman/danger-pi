## Why

Complex assistant-authored topics still benefit from a pager workflow. The fork wants the assistant to declare pager structure explicitly, keep the visible index lightweight, and move page advancement onto the existing tool/custom-message surfaces.

## What Changes

- Add a fork-owned `pager_index` tool under `packages/coding-agent/src/danger-pi/`.
- Persist pager index state as a hidden `custom` entry instead of parsing assistant `<pager-index>` text.
- Render the pager index as a compact inline tool result/control.
- Immediately queue a hidden next-turn pager advance after successful `pager_index`, so the user sees the index control and then the first real page.
- Keep `/pager:next` and `/pager:exit` as visible custom-message transcript entries with special rendering.
- Keep pager status through the existing keyed status surface.
- Add `Ctrl+J` as the extension shortcut for pager-next when idle.
- Explicitly avoid any Markdown-layer or assistant-message special handling for pager tags.

## Scope

### New Capabilities
- `pager_index`: assistant tool for declaring the pager title and ordered page titles before a paged response sequence.
- `pager-index-state`: hidden branch-local pager state persisted as a `custom` entry.

### Modified Capabilities
- `pager-mode`: now reconstructs from hidden pager index state plus visible `pager-next` / `pager-exit` transitions instead of assistant tag parsing.
- `extension-command-registration`: pager mode now owns a pager-next shortcut in addition to pager slash commands.
- `extension-status-ui`: keyed status continues to surface the active page cursor, but its source of truth is now the persisted pager index tool state.

## Impact

- Affected code remains centered in `packages/coding-agent/src/danger-pi/`.
- No new upstream runtime seam is required.
- The visible transcript gets cleaner: no raw pager index tags, no forced visible auto-next control, and the explicit pager-turn control only appears for user-driven page changes.
- Branch rewind/resume behavior stays deterministic because reconstruction still walks the active branch instead of trusting in-memory cursor state.
