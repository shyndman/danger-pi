## Why

Users cannot currently see the contents of an image when they use the `read` tool. The tool returns a status line only, forcing people to leave pi or re-run commands manually. Bringing inline previews to the read flow keeps the investigation loop tight and matches the affordances we already provide for generated images.

## What Changes

- Capture image metadata (base64 payload, mime type, byte size) from read-tool results instead of discarding it inside `ReadToolGroupComponent`.
- Extend `ReadToolGroupComponent` so each read entry can render a collapsed two-row preview and an expanded full-width preview of the image using the existing Terminal Graphics encoders.
- Surface the detected byte weight beside each entry to keep users aware of payload size.
- Respect explicit width/height constraints derived from the container width and fixed row caps (2 rows collapsed, 30 rows expanded) so previews stay tidy on any terminal size.

## Capabilities

### New Capabilities
- `read-image-preview`: Enables inline rendering of images returned by the read tool, including collapsed and expanded previews with size indicators.

### Modified Capabilities
- _None_

## Impact

- `packages/coding-agent/src/modes/components/read-tool-group.ts` needs richer state management, size formatting, and image rendering hooks.
- `packages/coding-agent/src/tools/read.ts` remains the producer of image payloads but may require minor detail additions (e.g., byte size metadata) to support the UI.
- `packages/tui/src/components/image.ts` / related terminal-capability helpers might need small adjustments to honor explicit height constraints.
