## ADDED Requirements

### Requirement: Display tool SHALL validate a strict image-only v0 input envelope
The `display` tool SHALL accept a v0 input envelope with:
- required `type`
- required `resources`
- optional `options`

For v0, `type` MUST be `"image"`.

#### Scenario: Valid envelope is accepted
- **WHEN** the agent calls `display` with `type: "image"` and `resources` containing at least one item
- **THEN** the tool SHALL continue to resource processing

#### Scenario: Missing required field is rejected
- **WHEN** the agent omits a required envelope field (`type` or `resources`)
- **THEN** the tool SHALL fail with `invalid_args`

#### Scenario: Unknown top-level field is rejected
- **WHEN** the agent sends an unexpected top-level property not defined by the envelope schema
- **THEN** the tool SHALL fail with `invalid_args`

### Requirement: Display tool SHALL reject unsupported display types
The v0 `display` implementation SHALL reject any `type` other than `"image"`.

#### Scenario: Non-image type is rejected
- **WHEN** `type` is any value other than `"image"`
- **THEN** the tool SHALL fail with `invalid_type`
- **AND** the tool SHALL not attempt to process resources

### Requirement: Display image resources SHALL be absolute file URIs in v0
Each resource SHALL be provided as a URI string that parses as an absolute URI and uses the `file:` scheme.

#### Scenario: Malformed URI is reported
- **WHEN** a resource cannot be parsed as an absolute URI
- **THEN** that resource SHALL be recorded as failed with `invalid_resource_uri`

#### Scenario: Unsupported scheme is reported
- **WHEN** a resource URI uses any scheme other than `file:`
- **THEN** that resource SHALL be recorded as failed with `unsupported_scheme`

#### Scenario: Missing local file is reported
- **WHEN** a resource is a valid `file:` URI but the target path does not exist
- **THEN** that resource SHALL be recorded as failed with `resource_not_found`

### Requirement: Display image capability MUST gate execution
The display image handler SHALL require an explicit capability setting and SHALL block execution when disabled.

#### Scenario: Capability disabled blocks the call
- **WHEN** the display image capability setting is disabled
- **THEN** the tool SHALL fail with `capability_disabled`
- **AND** the error details SHALL include the exact setting key to enable

### Requirement: Display image processing SHALL emit dimensions for every successful resource
For each successful image, the tool SHALL include source pixel dimensions as `widthPx` and `heightPx`.

#### Scenario: Successful image includes source dimensions
- **WHEN** a resource is successfully processed as an image
- **THEN** its metadata SHALL include integer `widthPx` and `heightPx` values greater than zero

#### Scenario: Resource fails if dimensions cannot be determined
- **WHEN** image dimensions cannot be determined for a resource
- **THEN** that resource SHALL be recorded as failed
- **AND** that resource SHALL NOT appear in successful image metadata

### Requirement: Display result SHALL separate model-facing summary text from UI image payload
The tool SHALL keep model-facing text concise and SHALL carry image payloads in metadata used by UI rendering.

#### Scenario: Summary text is concise and non-binary
- **WHEN** the tool returns a successful or mixed result
- **THEN** summary text SHALL include counts/outcomes
- **AND** summary text SHALL NOT include base64 image data

#### Scenario: Successful images are emitted in UI metadata
- **WHEN** one or more resources succeed
- **THEN** the result SHALL include `details.images` entries consumable by the existing tool execution image renderer

### Requirement: Display image batch execution SHALL support mixed success
The tool SHALL process resources independently within one call.

#### Scenario: Mixed valid and invalid resources
- **WHEN** a call contains both valid and invalid resources
- **THEN** valid resources SHALL be emitted as successful images
- **AND** invalid resources SHALL be reported with per-resource failure codes

#### Scenario: All resources fail
- **WHEN** no resources succeed in a call
- **THEN** the call SHALL return an error result

### Requirement: Display image failure vocabulary SHALL be deterministic in v0
The implementation SHALL use a stable error vocabulary for v0 behavior.

#### Scenario: Resource failures use v0 codes
- **WHEN** a resource fails during validation or processing
- **THEN** its failure code SHALL be one of `invalid_resource_uri`, `unsupported_scheme`, `resource_not_found`, or `render_failed`

#### Scenario: Envelope and gating failures use v0 codes
- **WHEN** envelope, type, or capability checks fail
- **THEN** the returned error SHALL use `invalid_args`, `invalid_type`, or `capability_disabled` respectively

### Requirement: Display image implementation SHALL remain isolated from read runtime implementation in v0
The display tool runtime implementation MUST NOT import execution logic from `packages/coding-agent/src/tools/read.ts` in this change.

#### Scenario: Read runtime import causes validation failure
- **WHEN** `display` runtime code imports execution helpers from `packages/coding-agent/src/tools/read.ts`
- **THEN** the change SHALL be considered non-compliant and fail validation
