## ADDED Requirements

### Requirement: Session persistence SHALL externalize generate_image result bytes
The coding-agent session persistence path SHALL store `generate_image` result image bytes outside the JSONL session file and persist blob references in their place.

#### Scenario: Result images are blob-backed in persisted session
- **WHEN** a `generate_image` tool result includes `details.images[*].data`
- **THEN** the persisted session entry SHALL replace each inline data payload with a blob reference
- **AND** the JSONL line SHALL not contain the original image byte payload at that location

#### Scenario: Result externalization preserves the existing details shape
- **WHEN** a `generate_image` tool result is persisted with blob-backed images
- **THEN** persistence SHALL preserve the existing non-byte details fields such as `provider`, `model`, `imageCount`, `imagePaths`, `responseText`, `promptFeedback`, and `usage`
- **AND** it SHALL not require a shape change in the in-memory `generate_image` tool result contract

### Requirement: Session persistence SHALL externalize inline generate_image input bytes but leave path-backed inputs unchanged
The persistence path SHALL externalize inline `generate_image` input image bytes when present, and it SHALL preserve existing path-backed inputs without copying the referenced file into session storage.

#### Scenario: Inline input data is externalized
- **WHEN** a `generate_image` tool call includes `arguments.input[*].data` with a non-empty byte payload
- **THEN** the persisted session entry SHALL replace that payload with a blob reference
- **AND** the corresponding input item SHALL keep its non-byte metadata

#### Scenario: Path-backed input remains path-backed
- **WHEN** a `generate_image` tool call includes `arguments.input[*].path` and an empty `data` field
- **THEN** the persisted session entry SHALL preserve the input path as provided
- **AND** the system SHALL not create a duplicate session blob solely for that path-backed input

#### Scenario: Inline input keeps non-byte metadata
- **WHEN** a `generate_image` tool call includes inline input bytes plus companion metadata such as `path` or `mime_type`
- **THEN** persistence SHALL replace only the byte payload field with a blob reference
- **AND** the remaining input item fields SHALL stay present so reload preserves the existing input shape

### Requirement: Session load SHALL resolve persisted generate_image blob references
When a persisted session is read back, blob-backed `generate_image` inputs and results SHALL be resolved into the same in-memory message shape that viewer/render code expects.

#### Scenario: Reloaded result exposes resolved image data
- **WHEN** a persisted session containing blob-backed `generate_image` result images is loaded
- **THEN** the loaded `toolResult.details.images[*].data` values SHALL be resolved before consumers read the message
- **AND** viewer or render code SHALL not need a special second lookup to access those bytes

#### Scenario: Reloaded inline input exposes resolved data
- **WHEN** a persisted session containing blob-backed inline `generate_image` inputs is loaded
- **THEN** the loaded `toolCall.arguments.input[*].data` values SHALL be resolved before consumers read the assistant message
- **AND** the input shape SHALL remain compatible with existing `generate_image` handling

#### Scenario: Consumers do not perform a second generate_image-specific blob lookup
- **WHEN** any consumer reads a loaded session entry that contains `generate_image` tool input or result data
- **THEN** the consumer SHALL receive the ordinary in-memory `generate_image` message shape with resolved `data` fields
- **AND** the consumer SHALL not need a separate `generate_image`-specific blob-resolution step
