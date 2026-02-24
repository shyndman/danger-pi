## Context

The `read` tool streams status-only updates through `ReadToolGroupComponent`, even when the underlying tool result contains image content (`{ type: "image", data, mimeType }`). Users cannot preview assets without leaving pi, while other features such as `generate_image` already leverage Kitty/iTerm2 Terminal Graphics via the shared `Image` component. We also learned the read tool enforces a 20MB cap but the UI throws away the current payload, so no rendering happens even if the terminal advertises image support.

## Goals / Non-Goals

**Goals:**
- Preserve the image payload emitted by the read tool and attach it to each read entry so the UI can render previews.
- Add collapsed (two-row) and expanded (full) inline previews underneath each entry while maintaining the existing summary text.
- Display the formatted byte size next to each entry to keep resource usage visible.
- Apply deterministic width/height constraints derived from the actual container width, using full width for both states but limiting height to 2 rows collapsed and 30 rows expanded.

**Non-Goals:**
- Rendering textual file contents inside `ReadToolGroupComponent` (still handled via standard read tool output or separate tools).
- Changing the read tool’s API or increasing its max image size beyond the existing 20MB limit.
- Refactoring the generic `ToolExecutionComponent`; this change stays scoped to read-group specific rendering.

## Decisions

1. **Capture image metadata once per entry**
   - Extend `ReadEntry` to cache `{ data, mimeType, byteSize }` when `updateResult` sees an image block. The byte size can come from tool details (if available) or be calculated from the base64 payload. This ensures we reuse the existing buffer for both collapsed and expanded renders without re-reading the file.

2. **Reuse the shared `Image` component with explicit constraints**
   - Instantiate two `Image` components per entry (collapsed + expanded) that share the same payload but receive different `ImageOptions`. Both variants get the full available width (container width minus indent). Collapsed also enforces `maxHeightCells = 2`, while expanded sets `maxHeightCells = 30`.
   - Because the current `Image` class ignores `maxHeightCells`, we will plumb that option through to `renderImage`, which already returns `{ sequence, rows }` so we can stop additional rows if necessary.

3. **Manage child components inside `ReadToolGroupComponent`**
   - Maintain a map from `toolCallId` to `{ collapsed: Image, expanded: Image }`, plus helper containers that insert the previews right under each summary line with tree-style indentation.
   - `setExpanded(true)` shows the expanded component and hides the collapsed version; `setExpanded(false)` does the opposite. The `Text` summary remains the first child for compatibility with existing rendering.

4. **Size indicator formatting**
   - When rendering each entry, append `theme.fg("muted", formatSize(byteSize))` so the size appears inline with the path. When no byte size is known, fall back to “(unknown)” in muted text.

5. **Container width calculation**
   - During `render(width)`, compute the maximum sub-width by subtracting the length of the tree prefix (“   └─ ”) so we pass an accurate column count to both preview components. This keeps previews aligned regardless of terminal width or indentation changes.

## Risks / Trade-offs

- **Higher memory retention** → Each rendered image stays in memory for the session because we now store the base64 payload. Mitigation: read tool already enforces a 20MB cap; we only retain one image per entry and reuse existing arrays instead of duplicating.
- **Terminal flicker when toggling expansion** → Re-rendering both previews could cause minor cursor jumps. Mitigation: render collapsed/expanded components within dedicated containers and only swap visibility flags to minimize layout churn.
- **Rendering cost on narrow terminals** → Re-encoding for collapsed/expanded states adds CPU overhead. Mitigation: share the converted data when possible and leverage the `Image` cache/invalidate behavior so consecutive renders are cheap.

## Migration Plan

1. Implement data capture and preview rendering behind a feature flag (or ship directly, since it does not change external APIs).
2. Verify in Kitty/iTerm terminals as well as non-graphics terminals (should fall back to text-only placeholders).
3. Roll out; rollback simply reverts the UI changes since the read tool API remains unchanged.

## Open Questions

- Do we need to debounce or paginate for users who execute dozens of read commands in one turn? (If necessary we can collapse older entries or allow manual cleanup.)
