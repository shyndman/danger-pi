## 1. Data Plumbing

- [x] 1.1 Extend `ReadEntry` structures to store image payload metadata (base64, mime type, byte size) when read results include image content.
- [x] 1.2 Ensure the read tool result details expose byte size information or compute it from the payload so the UI can display it.

## 2. Preview Rendering

- [x] 2.1 Instantiate collapsed and expanded `Image` components per read entry, wired up inside `ReadToolGroupComponent` with containers for tree-indented placement.
- [x] 2.2 Teach the `Image`/terminal rendering path to honor `maxHeightCells`, using 2 rows for collapsed previews and 30 rows for expanded previews while taking the full available width.
- [x] 2.3 Toggle between collapsed and expanded previews based on `setExpanded`, showing muted byte-size indicators in both states.

## 3. Validation

- [x] 3.1 Verify Kitty/iTerm2 terminals render previews correctly and that terminals without image protocol fall back to text-only summaries without escape sequences.
- [x] 3.2 Add or update tests (unit/manual checklist) to cover byte-size display and ensure multiple read entries each manage their own cached payload.
