## Why

The current implementation is image-only and centralized in one class: `DisplayTool` enforces `params.type === "image"`, accepts only absolute `file:` URIs, and emits image payloads via `details.images` (`packages/coding-agent/src/tools/display.ts`). The TUI also has global image handling that reads `result.details.images` directly (`packages/coding-agent/src/modes/components/tool-execution.ts`), so adding new display types currently requires cross-layer edits instead of type-local changes.

This change is needed now because we want to add `color` and expect more display types later, including types that may not share the same presentation surface.

## What Changes

- Move display implementation from single-file `packages/coding-agent/src/tools/display.ts` into a dedicated fork-local directory `packages/coding-agent/src/tools/display/` with a clear entrypoint (`index.ts`) and focused modules (resolver, runtime, registry, types).
- Replace direct display wiring in `BUILTIN_TOOLS` (`display: s => new DisplayTool(s)` in `packages/coding-agent/src/tools/index.ts`) with a dedicated bootstrap factory (`createDisplayTool(...)`) that assembles resolver/runtime/registry dependencies.
- Refactor `display` execution so resource retrieval is shared and transport-focused (`file:`, `http(s):`, `data:`), while display type behavior is runtime-registered.
- Introduce display type definitions that own type semantics and presentation intent, but do not receive TUI view state.
- Introduce a display runtime sink contract (starting with `showImage(...)`) plus per-resource failure reporting.
- Preserve best-effort batch behavior with explicit per-resource outcome entries; only raise call-level failure when all resources fail.
- Add `color` type (v1) with narrow `text/plain` hex parsing (`#RRGGBB`) and image-swatch rendering.
- Persist display image draw payloads using the existing decision-point pattern: keep small payloads inline and externalize large payloads as blob references (`blob:sha256:<hash>`).

## Capabilities

### New Capabilities
- `display-runtime-type-registry`: Runtime-registered display types with strict duplicate handling, shared retrieval, and one-shot type execution.
- `display-color-preview`: Color resource parsing and swatch preview through the display runtime.

### Modified Capabilities
- None.

## Impact

- **Existing files with verified coupling that will change**
  - `packages/coding-agent/src/tools/display.ts`: currently contains schema, resource resolution, and image-specific processing in one class; this will be replaced by `packages/coding-agent/src/tools/display/` modules.
  - `packages/coding-agent/src/tools/index.ts`: currently registers display directly (`display: s => new DisplayTool(s)`), with availability controlled by `display.enabled`.
  - `packages/coding-agent/src/modes/components/tool-execution.ts`: currently aggregates images from `content[type=image]` plus `details.images` and renders them generically.
  - `packages/coding-agent/src/tools/renderers.ts`: currently has no `display` renderer entry.
- **Existing configuration and prompt surfaces that will change**
  - `packages/coding-agent/src/config/settings-schema.ts`: currently defines `display.enabled` and `display.enableImage`.
  - `packages/coding-agent/src/prompts/tools/display.md`: currently documents v0 image-only + `file:` URI behavior.
- **Existing test surfaces that will change**
  - `packages/coding-agent/test/tools/display.test.ts`: currently validates image-only behavior and `details.images` output.
  - `packages/coding-agent/test/tools/index.test.ts`: currently validates display inclusion/exclusion via settings.
- **Message/detail model impact (verified)**
  - Tool results already carry `details` (`packages/ai/src/types.ts`) and are persisted as session messages (`packages/coding-agent/src/session/session-manager.ts`), so display detail schema can evolve without creating a new message type.
  - Existing blob-store primitives already exist (`packages/coding-agent/src/session/blob-store.ts`) and can be reused for display draw payload externalization.
