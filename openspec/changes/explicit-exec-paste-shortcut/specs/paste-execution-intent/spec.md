## ADDED Requirements

### Requirement: Default terminal paste SHALL be non-executable for command and shortcut classification
The system SHALL treat content originating from normal terminal bracketed paste as safe pasted content. Safe pasted content SHALL be parsed as text in multi-block classification, even when it begins with executable prefixes.

#### Scenario: Safe pasted line starts with bash shortcut prefix
- **WHEN** safe pasted content contains a line beginning with `!` or `!!`
- **THEN** that line SHALL be classified as text
- **AND** no `bash-shortcut` block SHALL be emitted for that line

#### Scenario: Safe pasted line starts with python shortcut prefix
- **WHEN** safe pasted content contains a line beginning with `$` or `$$`
- **THEN** that line SHALL be classified as text
- **AND** no `python-shortcut` block SHALL be emitted for that line

#### Scenario: Safe pasted line starts with slash command prefix
- **WHEN** safe pasted content contains a line beginning with `/`
- **THEN** that line SHALL be classified as text
- **AND** no `command` block SHALL be emitted for that line

#### Scenario: Safe pasted fenced shortcut syntax
- **WHEN** safe pasted content contains fenced shortcut syntax that would normally parse as shortcut blocks
- **THEN** it SHALL remain text content
- **AND** no fenced shortcut execution block SHALL be emitted

### Requirement: Execute-intent paste SHALL be available as a configurable keybinding action
The system SHALL expose an execute-intent paste app action that reads clipboard text and inserts it as execution-allowed pasted content. The action SHALL be configurable through keybindings and SHALL default to `Ctrl+Shift+Alt+V`.

#### Scenario: Default execute-intent binding is active
- **WHEN** no user override exists for execute-intent paste action
- **THEN** `Ctrl+Shift+Alt+V` SHALL trigger execute-intent paste behavior

#### Scenario: Execute-intent keybinding is overridden
- **WHEN** user keybindings override the execute-intent paste action
- **THEN** the overridden binding SHALL trigger execute-intent paste behavior
- **AND** the default binding SHALL follow normal keybinding override rules

#### Scenario: Execute-intent pasted shortcut line
- **WHEN** clipboard text inserted via execute-intent paste contains a valid shortcut line
- **THEN** parsing SHALL classify it using existing shortcut rules

#### Scenario: Execute-intent pasted slash command line
- **WHEN** clipboard text inserted via execute-intent paste contains a valid slash command line
- **THEN** parsing SHALL classify it using existing command rules

### Requirement: Typed input classification SHALL remain unchanged
Typed input (characters authored directly in editor, not from safe pasted segments) SHALL continue to use existing parser behavior.

#### Scenario: Typed shortcut line remains executable
- **WHEN** user types `!ls -al` directly
- **THEN** parser SHALL classify it as `bash-shortcut`

#### Scenario: Typed slash command remains executable
- **WHEN** user types a recognized slash command directly
- **THEN** parser SHALL classify it as `command`

### Requirement: Mixed submissions SHALL preserve intent per segment
When a submission mixes typed content, safe pasted content, and execute-intent pasted content, classification SHALL follow each segment’s intent without changing textual order.

#### Scenario: Typed line followed by safe pasted shortcut line
- **WHEN** submission contains a typed executable line and a safe pasted line that starts with shortcut syntax
- **THEN** typed line SHALL follow existing executable classification
- **AND** safe pasted line SHALL remain text
- **AND** relative line ordering in output blocks SHALL be preserved

#### Scenario: Safe pasted line followed by execute-intent line
- **WHEN** submission contains both safe pasted and execute-intent pasted lines with executable prefixes
- **THEN** safe pasted lines SHALL remain text
- **AND** execute-intent pasted lines SHALL classify normally

### Requirement: Clipboard-read limitation SHALL be explicitly documented and non-blocking
Execute-intent paste depends on local clipboard-read APIs and may be unavailable in remote/headless environments. Failures SHALL be non-blocking, SHALL not mutate editor content, and SHALL be documented inline near clipboard-read call sites.

#### Scenario: Clipboard read unavailable
- **WHEN** execute-intent paste is triggered where local clipboard read is unavailable
- **THEN** system SHALL show a non-blocking user-visible status
- **AND** editor text SHALL remain unchanged
- **AND** terminal bracketed paste SHALL remain available as fallback

#### Scenario: Clipboard read throws error
- **WHEN** execute-intent paste encounters runtime clipboard-read error
- **THEN** system SHALL show a non-blocking user-visible status
- **AND** editor text SHALL remain unchanged

#### Scenario: Termux helper unavailable
- **WHEN** execute-intent paste runs in a Termux environment where `termux-clipboard-get` (invoked without arguments) cannot return clipboard text because helper/service is unavailable or clipboard access is restricted to foreground app state
- **THEN** system SHALL treat this as non-blocking clipboard unavailability
- **AND** editor text SHALL remain unchanged
- **AND** terminal bracketed paste SHALL remain available as fallback

#### Scenario: Implementation comment requirement
- **WHEN** execute-intent paste is implemented
- **THEN** code near clipboard-read call SHALL include an inline comment that documents remote/headless clipboard-read limitation, why direct clipboard read is used for execute intent, and terminal bracketed paste fallback
