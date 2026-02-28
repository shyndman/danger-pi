## 0. Fork-Safe Implementation Guardrails

- [x] 0.1 TODO: Keep edits in existing upstream-owned files surgical and minimal (`packages/coding-agent/src/tools/index.ts`, `packages/coding-agent/src/config/settings-schema.ts`, and targeted existing tests only).
- [x] 0.2 TODO: Keep the majority of new code in new display-specific modules (`packages/coding-agent/src/tools/display.ts`, `packages/coding-agent/src/prompts/tools/display.md`, and `packages/coding-agent/test/tools/display.test.ts`).
- [x] 0.3 TODO: Do not extract or refactor shared runtime helpers between `read` and `display` in this change; capture consolidation work as a separate follow-up change.

## 1. Create Tool Skeleton and Prompt

- [x] 1.1 Create `packages/coding-agent/src/prompts/tools/display.md` with image-only v0 instructions and examples.
- [x] 1.2 Create `packages/coding-agent/src/tools/display.ts` with exported input/detail types and `DisplayTool` class shell.
- [x] 1.3 Set tool identity fields in `display.ts` (`name`, `label`, `description`, `parameters`, `strict`).
- [x] 1.4 Wire prompt text import in `display.ts` and render description from the prompt template.

## 2. Register Tool and Settings

- [x] 2.1 Export `DisplayTool` and its public types from `packages/coding-agent/src/tools/index.ts`.
- [x] 2.2 Add `display` to `BUILTIN_TOOLS` in `packages/coding-agent/src/tools/index.ts`.
- [x] 2.3 Add a display image capability setting entry in `packages/coding-agent/src/config/settings-schema.ts` with tab/label/description metadata.
- [x] 2.4 Add or update any settings type/interface definitions needed so the new setting key is type-safe.

## 3. Implement Strict Input Schema

- [x] 3.1 Define TypeBox schema for `display` input in `display.ts` with required `type` and `resources`.
- [x] 3.2 Add optional `options` object (`title`, `mode`) to schema.
- [x] 3.3 Set `additionalProperties: false` on root input object.
- [x] 3.4 Set `additionalProperties: false` on nested `options` object.
- [x] 3.5 Enforce non-empty `resources` array in schema or explicit runtime guard.
- [x] 3.6 Add runtime type guard so non-`image` `type` returns `invalid_type` before resource processing.

## 4. Implement Resource Validation and Normalization

- [x] 4.1 Iterate resources in stable input order and keep the original index for each item.
- [x] 4.2 Parse each resource string as an absolute URI.
- [x] 4.3 For parse failures, record per-resource `invalid_resource_uri` and continue.
- [x] 4.4 For non-`file:` scheme URIs, record per-resource `unsupported_scheme` and continue.
- [x] 4.5 Resolve valid `file:` URIs to local filesystem paths.
- [x] 4.6 Check file existence for each resolved path.
- [x] 4.7 For missing files, record per-resource `resource_not_found` and continue.

## 5. Implement Image Processing (Read-Isolated)

- [x] 5.1 Implement image MIME detection in `display.ts` without importing runtime execution helpers from `packages/coding-agent/src/tools/read.ts`.
- [x] 5.2 Add image size guardrails for oversized files and map processing failures to `render_failed` (resource-level).
- [x] 5.3 Read valid image files, encode payload as base64 for `details.images` metadata.
- [x] 5.4 Determine source pixel dimensions for each processed image.
- [x] 5.5 Require `widthPx` and `heightPx` for success entries; if unavailable, record a resource failure.
- [x] 5.6 Keep all processing logic in `display.ts` or display-specific helpers (no runtime imports from `read.ts`).

## 6. Implement Result Assembly and Mixed-Success Behavior

- [x] 6.1 Build `details.images` array for successful resources with `data`, `mimeType`, `widthPx`, and `heightPx`.
- [x] 6.2 Build per-resource failure records (index, resource, code, message) for failed resources.
- [x] 6.3 Generate concise summary text with deterministic counts (for example, success/failed totals).
- [x] 6.4 Ensure summary text contains no base64 payload content.
- [x] 6.5 Return success result when at least one resource succeeds.
- [x] 6.6 Return call-level error when zero resources succeed.

## 7. Enforce Capability Gating and Error Contracts

- [x] 7.1 Read display image capability setting before processing resources.
- [x] 7.2 If capability is disabled, return `capability_disabled` with the exact setting key in error details.
- [x] 7.3 Ensure envelope-level failures use `invalid_args`.
- [x] 7.4 Ensure type-level failures use `invalid_type`.
- [x] 7.5 Ensure resource-level failures use only approved v0 codes (`invalid_resource_uri`, `unsupported_scheme`, `resource_not_found`, `render_failed`).

## 8. Add Tests for Display Tool Behavior

- [x] 8.1 Create `packages/coding-agent/test/tools/display.test.ts` with a helper for constructing `ToolSession` and settings overrides.
- [x] 8.2 Add test: valid image file URI produces success and `details.images` entry.
- [x] 8.3 Add test: success image entry includes integer `widthPx` and `heightPx` greater than zero.
- [x] 8.4 Add test: invalid `type` returns `invalid_type`.
- [x] 8.5 Add test: malformed resource URI records `invalid_resource_uri`.
- [x] 8.6 Add test: non-`file:` URI records `unsupported_scheme`.
- [x] 8.7 Add test: missing file URI records `resource_not_found`.
- [x] 8.8 Add test: mixed-success call returns success with both success metadata and failure records.
- [x] 8.9 Add test: all-failed call returns call-level error.
- [x] 8.10 Add test: capability-disabled call returns `capability_disabled` and includes setting key.
- [x] 8.11 Add test: summary text does not include base64 image payload.

## 9. Update Tool Registration Tests

- [x] 9.1 Update `packages/coding-agent/test/tools/index.test.ts` to assert `display` appears in default tool set.
- [x] 9.2 Add test coverage (or equivalent assertion) that settings can disable display capability behavior.

## 10. Add Isolation Guard and Run Targeted Validation

- [x] 10.1 Add a static guard test (or equivalent check) that runtime `display` implementation does not import execution helpers from `packages/coding-agent/src/tools/read.ts`.
- [x] 10.2 Run `bun test test/tools/display.test.ts` from `packages/coding-agent/`.
- [x] 10.3 Run `bun test test/tools/index.test.ts` from `packages/coding-agent/`.
- [x] 10.4 If necessary, run focused schema-validation tests touching the display tool schema.
