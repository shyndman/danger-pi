## ADDED Requirements

### Requirement: Streaming multi-block submissions SHALL compile at submit time
When a submission contains multiple parsed blocks and the session is currently streaming, the system SHALL compile the submission immediately instead of downgrading it to a raw single text prompt.

#### Scenario: Streaming multi-block submission enters compile path
- **WHEN** the user submits input that parses into more than one submission block while `isStreaming` is true
- **THEN** the system SHALL create a deferred compiled submission payload
- **AND** the system SHALL NOT enqueue the original raw submission text as a single message

### Requirement: Imperative shortcut blocks MUST execute during compilation
Imperative shortcut blocks (`!`, `!!`, `$`, `$$`, including fenced forms) MUST execute during submit-time compilation and MUST NOT be deferred to queue-delivery time.

#### Scenario: Bash shortcut executes immediately while streaming
- **WHEN** a streaming multi-block submission contains a bash shortcut block
- **THEN** the bash command SHALL execute during compilation
- **AND** the compiled payload SHALL include promptable content derived from the execution result in authored block order

#### Scenario: Python shortcut executes immediately while streaming
- **WHEN** a streaming multi-block submission contains a python shortcut block
- **THEN** the python code SHALL execute during compilation
- **AND** the compiled payload SHALL include promptable content derived from the execution result in authored block order

### Requirement: Compiled payload assembly SHALL preserve authored order
The compiled prompt payload SHALL preserve the exact relative order of text blocks, command-derived prompt text, and shortcut-result prompt text produced from one submission.

#### Scenario: Mixed block sequence preserves order
- **WHEN** a submission contains interleaved text and imperative blocks
- **THEN** the compiled payload SHALL preserve the original block sequence as authored
- **AND** no later block content SHALL be inserted before earlier block content

### Requirement: Dequeue-time delivery MUST NOT re-execute imperative blocks
Any imperative block execution associated with a compiled streaming multi-block submission MUST occur only during compilation.

#### Scenario: Deferred payload is delivered without rerunning commands
- **WHEN** a compiled multi-block payload is later delivered from a queue boundary
- **THEN** the system SHALL deliver only the compiled prompt content
- **AND** the system SHALL NOT execute bash or python shortcut blocks during dequeue
