## Why

The current `read` tool is the wrong abstraction when the only goal is “show this image to the user.” This is now verified in code, not inferred:

- `packages/coding-agent/src/tools/read.ts` emits image payloads as `content` blocks (`{ type: "image", data, mimeType }`).
- `packages/agent/src/agent-loop.ts` forwards `result.content` directly into `ToolResultMessage.content`.
- Provider serializers (for example `packages/ai/src/providers/openai-completions.ts`, `packages/ai/src/providers/anthropic.ts`, and `packages/ai/src/providers/google-shared.ts`) serialize `toolResult.content` into model request payloads.
- `packages/coding-agent/src/modes/components/tool-execution.ts` already supports UI-only images via `details.images`.

So we need a dedicated `display` tool that keeps user-visible rendering separate from model-visible content, while reusing existing UI behavior.

## What Changes

- Add a new built-in `display` tool in `packages/coding-agent/src/tools/display.ts`.
- Ship **image-only v0** behavior:
  - `type` MUST be `"image"`.
  - `resources` MUST be a non-empty list of URI strings.
  - v0 accepts only absolute `file:` URIs.
- Validate strictly and fail hard for invalid envelope or unsupported type/scheme.
- Process resources independently (mixed-success semantics):
  - Valid resources render.
  - Invalid resources report structured failure codes.
  - The whole call fails only if zero resources succeed (or envelope/capability checks fail).
- Reuse the existing UI rendering pathway by returning summary text + image metadata in `details.images`.
- Require each successful image metadata entry to include source dimensions: `widthPx` and `heightPx`.
- Keep implementation isolated from `read` runtime logic in this change (no imports from `read.ts` execution internals).
- Add tool-level enablement in existing optional-tool style (`<tool>.enabled`) and wire it through `createTools` filtering in `packages/coding-agent/src/tools/index.ts`.
- Add display image capability gating in settings using existing grouped-toggle naming style (`<prefix>.enableX`, as used by Exa settings).

v0 request shape (for clarity):

```json
{
  "type": "image",
  "resources": ["file:///absolute/path/to/image.png"],
  "options": {
    "title": "optional",
    "mode": "auto"
  }
}
```

## Capabilities

### New Capabilities
- `display-image`: Display local images for the user through a dedicated tool contract, with strict validation, capability gating, mixed-success handling, and dimensions in render metadata.

### Modified Capabilities
- None.

## Impact

- **Tool implementation**
  - New file: `packages/coding-agent/src/tools/display.ts`.
  - New prompt doc: `packages/coding-agent/src/prompts/tools/display.md`.
- **Tool registration**
  - Update `packages/coding-agent/src/tools/index.ts` to import/export/register `display` in `BUILTIN_TOOLS`.
  - Update `isToolAllowed` in `packages/coding-agent/src/tools/index.ts` to honor display enablement settings.
- **Settings/capabilities**
  - Update `packages/coding-agent/src/config/settings-schema.ts` with display settings keys and UI metadata, following existing boolean toggle conventions used by optional tools and Exa feature toggles.
- **Rendering path**
  - No new renderer required for v0; output must be compatible with existing `ToolExecutionComponent` handling that merges image blocks from both `content` and `details.images`.
- **Tests**
  - Add display tool tests for input validation, URI scheme handling, capability-disabled behavior, mixed-success behavior, and dimensions metadata.
  - Update tool-index coverage so `display` registration is validated.