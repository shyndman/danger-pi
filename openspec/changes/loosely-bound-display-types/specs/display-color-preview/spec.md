## ADDED Requirements

### Requirement: Display SHALL support a color type
The display tool SHALL support `type: "color"` as a runtime-registered display type.

#### Scenario: Color type is recognized
- **WHEN** the display tool is called with `type: "color"`
- **THEN** the color type definition SHALL be selected from the display type registry

### Requirement: Color type SHALL only consume plain-text resources in v1
The color type SHALL accept only resources resolved as `text/plain` in this change.

#### Scenario: Non-plain-text resource is rejected
- **WHEN** a resource for type `color` resolves to a MIME type other than `text/plain`
- **THEN** that resource SHALL be reported as failed

### Requirement: Color type SHALL parse one canonical hex color per resource
Color v1 SHALL parse exactly one canonical hex color value in the format `#RRGGBB` per resource.

#### Scenario: Canonical hex color is accepted
- **WHEN** a resource text contains a valid `#RRGGBB` value (with optional surrounding whitespace)
- **THEN** the color type SHALL accept the value and prepare it for preview rendering

#### Scenario: Short hex is rejected in v1
- **WHEN** a resource text contains a short hex value such as `#RGB`
- **THEN** that resource SHALL be reported as failed

#### Scenario: Multiple or malformed tokens are rejected
- **WHEN** a resource text does not resolve to exactly one valid `#RRGGBB` token
- **THEN** that resource SHALL be reported as failed

### Requirement: Color previews SHALL render as image swatches
The color type SHALL render successful previews by calling the image sink.

#### Scenario: Valid color produces an image sink call
- **WHEN** a color resource is parsed successfully
- **THEN** runtime SHALL receive `showImage(...)` for that resource

#### Scenario: Swatch rendering uses parsed color value
- **WHEN** `showImage(...)` is called for a parsed color
- **THEN** the rendered swatch SHALL visually represent the parsed `#RRGGBB` value

### Requirement: Color SHALL preserve display batch behavior
Color execution SHALL follow the same mixed-outcome semantics as other display types.

#### Scenario: Mixed batch continues after invalid colors
- **WHEN** a batch includes both valid and invalid color resources
- **THEN** valid resources SHALL still produce swatch previews and invalid resources SHALL produce failure reports

#### Scenario: Call-level failure occurs only when all color resources fail
- **WHEN** every color resource in the batch fails
- **THEN** the call SHALL end with a call-level error after full batch processing

### Requirement: Color report entries SHALL follow shared shape
Color report entries SHALL use the shared per-resource report schema.

#### Scenario: Success entry includes type and URI
- **WHEN** a color resource renders successfully
- **THEN** the report entry SHALL include `type: "color"` and the resource `uri`

#### Scenario: Failure entry includes type, URI, and error
- **WHEN** a color resource fails during parse or rendering
- **THEN** the report entry SHALL include `type: "color"`, the resource `uri`, and an `error` message
