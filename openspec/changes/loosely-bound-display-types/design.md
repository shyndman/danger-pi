## Context

`display` is currently organized around one hardcoded path (`image`) and one hardcoded result shape (`details.images`). That structure worked for v0 but makes extension risky: each new type would require editing unrelated layers.

For this change, we want a junior engineer to be able to add new display types safely by touching a small, obvious set of files. This design therefore emphasizes explicit boundaries and a strict execution flow.

### Current state (today)

1. `packages/coding-agent/src/tools/display.ts` parses input, validates resources, reads files, and builds image output in one class.
2. `packages/coding-agent/src/modes/components/tool-execution.ts` has image-specific behavior that reads `details.images` directly.
3. Result: retrieval rules, type semantics, and rendering concerns are mixed.

### Target state (after this change)

1. Shared resolver: only transport/URI retrieval and limits.
2. Type definition: one type, one presentation path, no UI-state logic.
3. Runtime sink: receives draw calls (`showImage`) and failure reports.
4. TUI renderer: replays recorded draw calls; never re-runs type execution.

## Goals / Non-Goals

**Goals:**
- Separate retrieval from type behavior so new types do not duplicate protocol logic.
- Support runtime type registration (without central switch edits).
- Keep type execution one-shot; UI expansion/collapse replays existing data only.
- Preserve per-resource mixed outcomes (some succeed, some fail).
- Add `color` v1 using an image swatch rendering path.
- Make implementation straightforward for junior engineers through explicit interfaces and file-level steps.

**Non-Goals:**
- Implementing non-image sinks in v1 (ANSI/external-window types are future work).
- Building a generic multi-target router in this change.
- Supporting rich color grammar in v1.
- Versioning report payloads.

## Decisions

### 1) Introduce a `createDisplayTool(...)` bootstrap factory

**Decision:** The built-in tools registry should construct display via a dedicated factory that wires dependencies and registers built-in types.

**Why this helps a junior engineer:** There is one obvious entry point for display architecture setup.

**Implementation details:**
- Add factory: `createDisplayTool(session: ToolSession): DisplayTool`
- During creation:
  1. Instantiate resolver
  2. Instantiate runtime recorder
  3. Instantiate type registry
  4. Register built-in types (`image`, `color`)
  5. Return `DisplayTool`

**Alternatives considered:**
- Keep constructor wiring inside `DisplayTool`: rejected (harder to test and reason about)

### 2) Shared resolver is transport-focused and strict

**Decision:** Resolver handles only URI/scheme retrieval and payload limits.

**Rules:**
- Supported schemes: `file:`, `http:`, `https:`, `data:`
- `http(s)` timeout: 30 seconds
- Max payload (`http(s)` body and decoded `data:`): 20MB
- Resolver preserves input order and duplicate resources

**MIME usage for this change:**
- `image/*` (image type)
- `text/plain` (color type)

**Implementation details:**
- Resolver returns normalized objects with at least: `uri`, `scheme`, `mimeType?`, `bytes?`, `text?`
- Resolver does not interpret type-specific meaning (e.g., color parsing)

### 3) Runtime registry with strict duplicate behavior

**Decision:** Runtime registry remains mutable for session lifetime, but duplicate type names throw immediately.

**Rules:**
- `register(typeDef)` allowed anytime
- Duplicate registration of same `type` is an error
- No freeze stage

**Why:** This matches agreed behavior and keeps runtime extension possible.

### 4) Type definitions are effect-oriented and presentation-bound

**Decision:** A type definition owns one presentation path and executes through runtime sink methods.

**V1 sink surface:**
- `showImage(...)`

**Key constraint:** Type definitions do not receive UI state (`expanded`, `collapsed`, viewport width, etc.).

<intent>
Display result details are presentation metadata for replay surfaces. They are intentionally not the same thing as model-facing message content. Keep heavy draw payloads in details, and avoid moving display payloads into `toolResult.content` unless model-visible behavior is explicitly desired.
</intent>

**Method shape guidance (conceptual):**
1. Loop resources
2. In `try` block, call `prepare(...)` (which throws on invalid)
3. Call `runtime.showImage(...)`
4. In `catch`, call `runtime.reportFailure(...)`
5. After loop, call `runtime.throwIfAllFailed(...)`

### 5) Runtime records draw calls and failures for replay

**Decision:** Runtime is the per-call recorder.

**Runtime responsibilities:**
- Store successful draw intents when `showImage(...)` is called
- Store failures when `reportFailure(...)` is called
- Build report entries for tool result details
- Throw call-level error only if all resources failed

<intent>
Persisted display draw payloads must follow threshold-based externalization so sessions remain bounded and restorable. This mirrors existing image persistence behavior rather than introducing an always-inline or always-blob special case.
</intent>

**Not runtime responsibilities:**
- Rendering widgets
- Reading UI state
- Re-fetching resources

### 6) Rendering is replay-only after execution

**Decision:** The renderer consumes recorded draw intents from tool details.

**Critical behavior:**
- Expand/collapse and redraw events MUST NOT call resolver or type execution again.
- Renderer only maps recorded draw intents to TUI image components.

**Why this matters:** Prevents expensive and stateful re-execution tied to UI events.

<intent>
Display renderer code must replay draw intents from display details only. UI interactions (expand/collapse/redraw) must never trigger resolver or type execution again.
</intent>

### 7) Tool availability in non-UI contexts

**Decision:** `display` is not valuable without UI and should be gated out when UI is unavailable/non-interactive.

**Implementation detail:**
- Follow existing tool availability gating patterns in tool creation.
- Keep a runtime defensive check if needed, but primary behavior is “tool unavailable”.

### 8) `color` v1 behavior is intentionally narrow

**Decision:** `color` consumes `text/plain` resources and accepts exactly one canonical hex value per resource (`#RRGGBB`, ignoring surrounding whitespace).

**On success:** Convert color to swatch image and call `showImage(...)`.

**On failure:** Record per-resource failure and continue batch processing.

## Risks / Trade-offs

- **[Runtime detail payload size]** Large draw payloads can bloat session data  
  → **Mitigation:** Keep 20MB limits and rely on existing blob externalization pipeline.

- **[Interface drift over time]** Future contributors may leak UI logic into type definitions  
  → **Mitigation:** Add `<intent>` doc comments on resolver/runtime/type interfaces.

- **[Incremental adoption complexity]** Legacy `details.images` path and new path may overlap during migration  
  → **Mitigation:** Land migration in ordered steps and remove old coupling before completing change.

- **[Mutable registry misuse]** Late registration may surprise maintainers  
  → **Mitigation:** Document bootstrap-first convention and enforce duplicate-throw errors.

## Migration Plan

### Phase 1: Scaffolding and wiring
1. Add `createDisplayTool(...)` and wire it in tool registration.
2. Add display-specific modules for resolver/runtime/registry/type definitions.
3. Add `<intent>` comments to all new core interfaces.

### Phase 2: Port existing image behavior to new architecture
1. Implement image type definition using `prepare(...)` + `showImage(...)` + `reportFailure(...)`.
2. Ensure mixed outcome behavior matches current user-visible semantics.
3. Keep old tests passing or replace with equivalent coverage.

### Phase 3: Add color type
1. Implement minimal parser for `#RRGGBB` from `text/plain`.
2. Generate swatch image bytes and call `showImage(...)`.
3. Add explicit tests for parse success/failure and mixed batches.

### Phase 4: Replay rendering migration
1. Add display-specific renderer path that consumes recorded draw intents.
2. Remove direct `details.images` coupling specific to display execution path.
3. Verify expand/collapse behavior does not trigger re-execution.

### Phase 5: Prompt/contracts and verification
1. Update tool prompt/schema text to match new behavior.
2. Run targeted tests for resolver, registry, type execution, and renderer replay.

## Open Questions

- Should recorded draw intents store image bytes inline or by blob reference in details?
