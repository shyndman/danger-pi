## 0. Preparation and Guardrails

- [x] 0.1 Re-read `openspec/changes/loosely-bound-display-types/design.md` and both capability specs before coding.
- [x] 0.2 Add named constants for display resolver limits (`30s`, `20MB`) in one display-specific module (no magic numbers).
- [x] 0.3 Create a dedicated display directory at `packages/coding-agent/src/tools/display/` and define the module layout there (keep existing shared-file edits to integration touchpoints only).

## 1. Bootstrap and Type Registration

- [x] 1.1 Add `createDisplayTool(session)` in `packages/coding-agent/src/tools/display/`.
- [x] 1.2 Move display dependency wiring into `createDisplayTool(...)` (resolver, runtime recorder, registry).
- [x] 1.3 Register built-in display types (`image`, `color`) inside `createDisplayTool(...)`.
- [x] 1.4 Update `packages/coding-agent/src/tools/index.ts` so built-in `display` uses `createDisplayTool(...)` instead of direct constructor wiring.
- [x] 1.5 Add duplicate registration guard in the registry (throw if `type` already exists).

## 2. Shared Resolver (Transport Layer Only)

- [x] 2.1 Add resolver interface/type definitions for normalized resources (`uri`, `scheme`, `mimeType`, `bytes/text`).
- [x] 2.2 Implement absolute URI parsing and scheme dispatch for `file:`, `http:`, `https:`, and `data:`.
- [x] 2.3 Implement `file:` reading path with local filesystem validation and MIME detection.
- [x] 2.4 Implement `http(s)` fetch path with `AbortSignal.timeout(30_000)`.
- [x] 2.5 Enforce `20MB` max payload for `http(s)` responses.
- [x] 2.6 Implement `data:` decoding path and enforce `20MB` decoded-size limit.
- [x] 2.7 Ensure resolver preserves input order and processes duplicate URIs independently.
- [x] 2.8 Ensure resolver does not include type-specific parsing rules (no color parsing in resolver).

## 3. Runtime Recorder and Report Assembly

- [x] 3.1 Define `DisplayRuntime` with `showImage(...)`, `reportFailure(...)`, `throwIfAllFailed(...)`, and report/draw-intent output access.
- [x] 3.2 Add `<intent>` doc comments to `DisplayRuntime` describing recorder semantics and no-UI-state constraints.
- [x] 3.3 Implement runtime recorder to capture successful draw intents when `showImage(...)` is called.
- [x] 3.4 Implement failure ledger via `reportFailure(type, uri, error)`.
- [x] 3.5 Implement call-level failure guard: throw only when all resources fail.
- [x] 3.6 Implement report entry assembly logic for each processed resource occurrence.
- [x] 3.7 Success entries include `type` and `uri`.
- [x] 3.8 Failure entries include `type`, `uri`, and `error`.
- [x] 3.9 Implement threshold-based externalization for display image draw payloads (small inline, large as `blob:sha256:<hash>` refs).
- [x] 3.10 Ensure replay path resolves blob-backed draw payloads before rendering.

## 4. Type Definition Interfaces and Intent Documentation

- [x] 4.1 Define `DisplayTypeDefinition` interface (effect-oriented execute method).
- [x] 4.2 Add `<intent>` doc comments to `DisplayTypeDefinition` clarifying one type = one presentation path.
- [x] 4.3 Add `<intent>` comments to resolver types clarifying transport-only responsibilities.
- [x] 4.4 Ensure type definitions do not receive TUI state (`expanded`, viewport, etc.).
- [x] 4.5 Add `<intent>` comment on display result-details types clarifying details are replay metadata, not model-facing content.
- [x] 4.6 Add `<intent>` comment on persistence externalization hook clarifying threshold-based inline-vs-blob behavior for display draw payloads.
- [x] 4.7 Add `<intent>` comment on display renderer path clarifying replay-from-details and no re-execution on UI interactions.

## 5. Implement `image` Type on New Runtime Path

- [x] 5.1 Create `image` type definition module.
- [x] 5.2 Move/port existing image validation logic into `image` type helper methods.
- [x] 5.3 Implement `prepare(...)` helper that throws on invalid resource conditions.
- [x] 5.4 In `execute(...)`, wrap `prepare(...)` and `showImage(...)` in a single `try/catch`.
- [x] 5.5 In `catch`, call only `reportFailure(...)` for that resource.
- [x] 5.6 After processing all resources, call `throwIfAllFailed(...)`.
- [x] 5.7 Verify duplicate resources produce independent report entries.

## 6. Implement `color` Type (V1)

- [x] 6.1 Create `color` type definition module.
- [x] 6.2 Accept only resources resolved as `text/plain`.
- [x] 6.3 Implement parser that accepts exactly one canonical `#RRGGBB` value (whitespace allowed around value).
- [x] 6.4 Reject short hex (`#RGB`) and malformed/multi-token input with per-resource failure reporting.
- [x] 6.5 Convert parsed color to swatch image bytes.
- [x] 6.6 Call `showImage(...)` for valid color resources.
- [x] 6.7 Ensure mixed valid/invalid color batches continue processing all resources.

## 7. Display Tool Integration

- [x] 7.1 Refactor `DisplayTool.execute(...)` to use shared resolver + type registry dispatch.
- [x] 7.2 Keep batch processing best-effort per resource.
- [x] 7.3 Ensure display tool returns report entries and recorded draw intents in details.
- [x] 7.4 Keep error behavior: call-level error only when all resources fail.
- [x] 7.5 Add/confirm display availability gating for no-UI/non-interactive contexts.

## 8. TUI Replay Rendering Integration

- [x] 8.1 Add display-specific tool renderer registration in `packages/coding-agent/src/tools/renderers.ts`.
- [x] 8.2 Implement display renderer call/result components that consume recorded draw intents from details.
- [x] 8.3 Map image draw intents to existing TUI image component flow.
- [x] 8.4 Ensure expand/collapse (`RenderResultOptions.expanded`) only changes presentation, not execution.
- [x] 8.5 Remove display-specific dependency on legacy `details.images` coupling path.

## 9. Prompt and Schema Updates

- [x] 9.1 Update `packages/coding-agent/src/prompts/tools/display.md` to describe supported schemes (`file/http(s)/data`).
- [x] 9.2 Update prompt text to describe mixed-outcome reporting semantics.
- [x] 9.3 Update tool schema/parameter descriptions to reflect multi-type behavior and current type set.

## 10. Tests (Required Before Hand-off)

- [x] 10.1 Add resolver tests for supported schemes, unsupported schemes, timeout handling, and size limits.
- [x] 10.2 Add registry tests for duplicate registration throw behavior.
- [x] 10.3 Add image type tests for success path, single-catch failure reporting, and all-failed call behavior.
- [x] 10.4 Add color type tests for valid `#RRGGBB`, invalid short hex, malformed text, and mixed batches.
- [x] 10.5 Add display tool integration tests for per-resource report entry shapes.
- [x] 10.6 Add UI replay tests ensuring expand/collapse does not trigger re-resolution or type re-execution.
- [x] 10.7 Add persistence tests covering the decision point (small payload inline, large payload blob-ref) in saved sessions.
- [x] 10.8 Add restore tests confirming blob-backed display payloads render correctly after session reload.

## 11. Final Verification

- [x] 11.1 Run targeted display-related tests in `packages/coding-agent`.
- [x] 11.2 Run `bun check:ts` from repository root.
- [x] 11.3 Confirm OpenSpec artifacts still align with final implementation behavior before marking complete.
