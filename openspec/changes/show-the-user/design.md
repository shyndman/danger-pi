## Context

`read` and `display` serve different purposes:

- `read` is model-facing: it gathers content for the agent/model.
- `display` is user-facing: it shows visual output to the user.

Today, image preview is reachable through `read`, but that path is not ideal for a feature whose primary value is local, user-visible rendering. We want a dedicated `display` tool so call intent is explicit and the implementation can evolve independently.

This change is intentionally scoped to a small v0 so a junior engineer can implement and validate it safely:

- One display type: `image`
- One resource source: absolute `file:` URIs
- One primary UI path: existing `details.images` rendering in `ToolExecutionComponent`

The user additionally required a strict implementation split from `read` internals in this phase so `read` work can be upstreamed independently.

## Goals / Non-Goals

**Goals:**
- Add a new built-in `display` tool (`packages/coding-agent/src/tools/display.ts`).
- Accept only `type: "image"` in v0.
- Accept only non-empty `resources: string[]`.
- Accept only absolute `file:` URIs in v0.
- Emit image metadata in `details.images` so existing UI rendering path is reused.
- Include `widthPx` and `heightPx` for every successful image metadata entry.
- Keep model-visible output small (summary text only, no base64 payload in text blocks).
- Enforce capability toggle before image processing.
- Support mixed-success batches (successes shown even if some resources fail).
- Keep runtime logic isolated from `read` (no import reuse from `read.ts` execution internals).

**Non-Goals:**
- ANSI rendering (`text.ansi`).
- URL/folder opening behavior.
- Generic multi-type display router beyond `image`.
- `params` payload support.
- `display_id` replace/update lifecycle.
- Session payload externalization improvements for huge `details.images` payloads.
- Refactoring `read` and `display` into shared helpers in this change.

## Decisions

1. **Tool scope is image-only for v0**
   - Decision: `display` accepts only `type: "image"`.
   - Why: keeps schema/provider behavior simple and implementation/debugging small.
   - Junior implementation rule: do not add placeholder support for future types in runtime paths. Keep one explicit branch only.

2. **Input shape is minimal and strict**
   - Decision: v0 request contract:

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

   - `params` is intentionally omitted.
   - Why: fewer moving parts, lower chance of malformed tool calls across providers.

3. **Resources are URI strings, `file:` only**
   - Decision: each resource must parse as an absolute URI and use `file:` scheme.
   - Why: future-proof input model without introducing multi-scheme behavior now.
   - Error mapping:
     - parse failure / non-absolute URI -> `invalid_resource_uri`
     - absolute URI but scheme != `file` -> `unsupported_scheme`
     - valid `file:` URI but no file at path -> `resource_not_found`

4. **Schema-level hard failure is mandatory**
   - Decision: every object in input schema must set `additionalProperties: false`.
   - Why: runtime validator does not reject unknown keys by default unless schema opts in.
   - Junior implementation rule: apply this both at root object and nested objects (`options`).

5. **UI metadata channel reused; model text minimized**
   - Decision: return short text summary in `content` and image payload in `details.images`.
   - Why: existing `ToolExecutionComponent` already merges image blocks from `content` and `details.images`; this avoids new UI component work.
   - Junior implementation rule: never place base64 image data in text content.

6. **Dimensions are required per successful image**
   - Decision: each success entry must include `widthPx` and `heightPx` as source pixel dimensions.
   - Why: explicit user requirement and useful for fallback/inspection.
   - Junior implementation rule: if dimensions cannot be determined, treat resource as failed.

7. **Mixed-success semantics**
   - Decision: process resources independently; do not fail-fast at first bad resource.
   - Why: user-visible output benefits from partial success.
   - Call-level result policy:
     - Envelope/capability validation failure -> immediate call-level error.
     - At least one success -> success result with summary + failure records in details.
     - Zero successes -> call-level error.

8. **Capability gating is required before dispatch**
   - Decision: image display must be behind a setting key and validated before processing resources.
   - Why: explicit governance requirement.
   - Junior implementation rule: capability-disabled path must fail with `capability_disabled` and include exact settings key in error details.

9. **Display implementation must stay isolated from read runtime logic**
   - Decision: no runtime helper imports from `packages/coding-agent/src/tools/read.ts`.
   - Why: user requires independent validation/upstream paths.
   - Junior implementation rule: if logic resembles `read`, duplicate behavior in `display.ts` instead of importing from `read.ts`.

10. **Deterministic error vocabulary**
    - Decision: v0 codes are fixed:
      - `invalid_args`
      - `invalid_type`
      - `invalid_resource_uri`
      - `unsupported_scheme`
      - `resource_not_found`
      - `capability_disabled`
      - `render_failed`
    - Why: predictable behavior improves retries and test assertions.

## Data Contracts

### Input Contract (v0)

- `type`: required string, must equal `"image"`.
- `resources`: required non-empty `string[]`.
- `options`: optional object with known keys only.
  - `title?: string`
  - `mode?: "inline" | "external" | "auto"`

### Suggested Details Contract (v0)

Implementation may choose exact property names, but must carry equivalent information:

- `details.images`: array of successful image metadata entries.
  - Required fields per entry:
    - `data` (base64 image payload)
    - `mimeType`
    - `widthPx`
    - `heightPx`
- `details.failures`: array of per-resource failures.
  - Required fields per failure:
    - resource index
    - original resource string
    - failure code
    - short message

### Model-Facing Text Contract (v0)

- Text must be concise and deterministic.
- Must include counts at minimum (for example: `Displayed 3 image(s); 1 failed.`).
- Must not include base64 payload strings.

## End-to-End Flow

```text
Agent calls display
       |
       v
Validate envelope schema
(type/resources/options)
       |
       +--> fail -> invalid_args
       |
       v
Check type == "image"
       |
       +--> fail -> invalid_type
       |
       v
Check capability enabled
       |
       +--> fail -> capability_disabled
       |
       v
For each resource (independent):
  parse URI -> scheme check -> resolve file -> read/decode -> dimensions
       |
       +--> per-resource failure record
       |
       v
Collect successes + failures
       |
       +--> no successes -> call-level error
       |
       v
Return success summary text + details.images + details.failures
```

## File-by-File Implementation Plan

1. `packages/coding-agent/src/prompts/tools/display.md`
   - Add tool description with image-only v0 instructions.
   - Keep docs short and strict.
   - Mention only supported type/scheme and key failures.

2. `packages/coding-agent/src/tools/display.ts`
   - Add input schema and tool class.
   - Implement execution flow described above.
   - Build deterministic summary text.
   - Emit image metadata and failure records in details.
   - Keep logic self-contained; do not import runtime helpers from `read.ts`.

3. `packages/coding-agent/src/tools/index.ts`
   - Export `DisplayTool` and associated types.
   - Register `display` in `BUILTIN_TOOLS`.

4. `packages/coding-agent/src/config/settings-schema.ts`
   - Add display capability setting entry for image.
   - Provide UI metadata so it appears in settings.

5. `packages/coding-agent/test/tools/display.test.ts`
   - Add tests for all required behaviors (validation, URI handling, mixed success, dimensions, summary text).

6. `packages/coding-agent/test/tools/index.test.ts`
   - Assert `display` is created in default built-in tool list.
   - Assert settings-based control works as intended.

## Validation and Test Plan

### Unit/Integration Cases Required

1. **Input validation**
   - missing `type` -> `invalid_args`
   - missing/empty `resources` -> `invalid_args`
   - unknown extra object keys -> `invalid_args`

2. **Type and capability**
   - `type != image` -> `invalid_type`
   - capability disabled -> `capability_disabled` (with setting key)

3. **Resource parsing**
   - malformed URI -> per-resource `invalid_resource_uri`
   - `https:` URI -> per-resource `unsupported_scheme`
   - valid `file:` URI missing on disk -> per-resource `resource_not_found`

4. **Success path**
   - valid file URI returns success entry in `details.images`
   - success entry contains `widthPx` and `heightPx` > 0

5. **Mixed-success path**
   - one valid + one invalid resource -> success call with one rendered image and one failure record

6. **All-failed path**
   - all resources invalid -> call-level error

7. **Summary text constraints**
   - summary includes success/failure counts
   - summary does not contain base64 payload content

8. **Isolation guard**
   - static check/test ensures `display.ts` has no runtime import from `tools/read.ts`

## Risks / Trade-offs

- **[Duplicated image handling logic]** -> Mitigation: accept duplication in v0 by design; document consolidation as a future follow-up after upstreaming constraints are resolved.
- **[Large `details.images` payloads may bloat session persistence]** -> Mitigation: keep summary text tiny; explicitly defer payload externalization work to `future.md`.
- **[Strict URI policy may reject user-friendly raw paths]** -> Mitigation: clear error messages and failure codes; path support can be added later as explicit scope.
- **[Mixed-success complexity]** -> Mitigation: deterministic summary and deterministic failure record schema.

## Migration Plan

1. Add `display` prompt + tool + registration.
2. Add settings key for image capability.
3. Add tests and run targeted test commands.
4. Verify interactive behavior in image-capable and non-image-capable terminals.
5. Ship as additive feature.

Rollback:

- Remove `display` registration and settings key.
- Remove `display.ts` and associated tests.
- No data migration needed.

## Open Questions

- Should v0 also accept plain filesystem paths (non-URI), or keep URI-only strictly?
- For `mode` handling, should explicit `inline`/`external` hard-fail when unsupported while `auto` degrades?
- What payload-size threshold should trigger metadata externalization in a follow-up?
