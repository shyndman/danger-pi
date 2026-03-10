## ADDED Requirements

### Requirement: Display SHALL be unavailable when UI capability is absent
The system SHALL gate the `display` tool from non-UI/non-interactive contexts.

#### Scenario: Session has no UI capability
- **WHEN** tool creation occurs for a session where UI capability is unavailable
- **THEN** the `display` tool SHALL NOT be included in the active tool set

### Requirement: Display SHALL resolve resources through a shared transport layer
The display tool SHALL resolve every `resources[]` entry through a shared resolver before any type-specific logic runs.

#### Scenario: Supported schemes are resolved
- **WHEN** a display call includes `file:`, `http:`, `https:`, or `data:` URIs
- **THEN** the resolver SHALL normalize each resource for type execution in input order

#### Scenario: Duplicate resources are not deduplicated
- **WHEN** the same URI appears multiple times in `resources[]`
- **THEN** each occurrence SHALL be resolved independently and kept in list order

#### Scenario: Unsupported scheme is reported per resource
- **WHEN** a resource uses an unsupported URI scheme
- **THEN** that resource SHALL be reported as failed and remaining resources SHALL still be processed

#### Scenario: HTTP timeout is enforced
- **WHEN** an `http(s)` resource does not complete within 30 seconds
- **THEN** that resource SHALL be reported as failed due to timeout and remaining resources SHALL still be processed

#### Scenario: Size limit is enforced for network and data URIs
- **WHEN** an `http(s)` body or decoded `data:` payload exceeds 20MB
- **THEN** that resource SHALL be reported as failed due to size limit and remaining resources SHALL still be processed

### Requirement: Display types SHALL be runtime-registered
The display system SHALL dispatch by runtime type registry instead of hardcoded type branching.

#### Scenario: Built-in types are registered at display bootstrap
- **WHEN** `createDisplayTool(...)` constructs the display tool
- **THEN** built-in type definitions SHALL be registered before the first call executes

#### Scenario: Duplicate type registration is rejected
- **WHEN** registration is attempted for a type name already in the registry
- **THEN** registration SHALL throw an error

### Requirement: Type execution SHALL use runtime sink and failure reporting APIs
Type definitions SHALL present output through runtime sink calls and SHALL report per-resource failures through runtime report calls.

#### Scenario: Successful image presentation is recorded by sink call
- **WHEN** a type successfully prepares an image resource
- **THEN** it SHALL call `showImage(...)` on the display runtime

#### Scenario: Single failure path reports through runtime
- **WHEN** prepare or sink logic throws for a resource
- **THEN** the type SHALL call `reportFailure(type, uri, error)` for that resource

#### Scenario: Call-level failure is evaluated after full batch
- **WHEN** all resources in a batch have been processed
- **THEN** runtime SHALL raise a call-level error only if all resources failed

### Requirement: Display SHALL return per-resource report entries
Display result details SHALL include report entries that match each processed resource occurrence.

#### Scenario: Success entry shape
- **WHEN** a resource is displayed successfully
- **THEN** its report entry SHALL include `type` and `uri`

#### Scenario: Failure entry shape
- **WHEN** a resource fails
- **THEN** its report entry SHALL include `type`, `uri`, and `error`

### Requirement: Display rendering SHALL replay recorded draw intents
Rendering after tool execution SHALL use recorded draw intents and SHALL NOT re-run resolver or type execution.

#### Scenario: Expand/collapse does not re-execute type logic
- **WHEN** user toggles expanded/collapsed state in the UI
- **THEN** rendering SHALL replay recorded draw intents and SHALL NOT re-run resource resolution or type execution

#### Scenario: Redraw events use recorded data only
- **WHEN** the UI redraws due to unrelated terminal/layout changes
- **THEN** display output SHALL be reconstructed from recorded draw intents without new type execution

### Requirement: Display image draw intents SHALL use threshold-based persistence
Display image draw-intent payloads SHALL follow an inline-vs-blob decision point consistent with existing image persistence behavior.

#### Scenario: Small payload remains inline
- **WHEN** a display type records a successful image draw intent with payload below the configured externalization threshold
- **THEN** persisted intent data SHALL remain inline

#### Scenario: Large payload is externalized to blob ref
- **WHEN** a display type records a successful image draw intent with payload at or above the configured externalization threshold
- **THEN** persisted intent data SHALL reference `blob:sha256:<hash>`

#### Scenario: Replay resolves blob-backed image payload
- **WHEN** a session containing blob-backed display draw intents is restored
- **THEN** replay rendering SHALL resolve blob references back to image payload data before rendering
