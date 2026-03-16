## ADDED Requirements

### Requirement: Native OMP command bodies support post-render shell interpolation
The system MUST scan rendered native OMP command bodies for single-line Claude-style shell expressions written as ``!`...` `` and replace each occurrence with the command's stdout after Handlebars rendering completes.

#### Scenario: Rendered command body includes shell expression
- **WHEN** a native OMP command body renders text containing ``!`gh pr diff` ``
- **THEN** the system SHALL execute `gh pr diff` in the session working directory
- **AND** SHALL replace the expression with the command stdout after trimming exactly one trailing newline

#### Scenario: Handlebars decides whether shell expression exists
- **WHEN** Handlebars rendering emits a shell expression in the final native OMP command body
- **THEN** the shell interpolation pass SHALL execute the emitted expression
- **AND** SHALL ignore branches that did not render into the final body text

#### Scenario: Multiple shell expressions appear in one command body
- **WHEN** a rendered native OMP command body contains multiple ``!`...` `` expressions
- **THEN** the system SHALL execute each occurrence independently in left-to-right order
- **AND** SHALL NOT memoize or reuse output across occurrences

#### Scenario: Command frontmatter remains literal
- **WHEN** a native OMP command markdown file contains text matching ``!`...` `` inside frontmatter fields such as `description`
- **THEN** the system SHALL treat that text as literal frontmatter content
- **AND** SHALL execute shell interpolation only against the rendered body text

### Requirement: Native OMP skill bodies support post-render shell interpolation
The system MUST apply the same single-line shell interpolation behavior to native OMP skill bodies before the skill body is injected into session context.

#### Scenario: Native skill body includes shell expression
- **WHEN** a native OMP skill body contains a rendered shell expression
- **THEN** the system SHALL execute the embedded command in the session working directory with inherited environment
- **AND** SHALL inject the skill body with the expression replaced by stdout trimmed of one trailing newline

#### Scenario: Skill metadata is not part of shell expansion
- **WHEN** the system appends the `Skill:` and `User:` metadata lines for a native skill invocation
- **THEN** the system SHALL perform shell interpolation before those metadata lines are appended
- **AND** SHALL NOT treat metadata text as shell-expression input

#### Scenario: Skill frontmatter remains literal
- **WHEN** a native OMP skill frontmatter field contains text matching ``!`...` ``
- **THEN** the system SHALL treat that text as literal frontmatter content
- **AND** SHALL NOT execute it as a shell expression

### Requirement: Shell interpolation is limited to native OMP sources and visible failures
The system MUST restrict shell interpolation to native OMP command and skill bodies and MUST fail visibly when an embedded shell command cannot be executed successfully.

#### Scenario: Non-native command source contains shell expression syntax
- **WHEN** a non-native command or skill source contains text matching ``!`...` ``
- **THEN** the system SHALL leave that text unchanged
- **AND** SHALL NOT execute it through this feature

#### Scenario: Embedded shell command exits non-zero
- **WHEN** a native OMP command or skill body contains an embedded shell command that exits with a non-zero status
- **THEN** the system SHALL abort expansion of that body
- **AND** SHALL surface a visible error that identifies the failing source and command text

#### Scenario: Embedded shell command syntax is malformed
- **WHEN** a native OMP command or skill body contains text beginning with ``!` `` that does not form a valid single-line shell expression
- **THEN** the system SHALL surface a visible error instead of silently rewriting the body

#### Scenario: Embedded shell command crosses a newline
- **WHEN** a native OMP command or skill body contains ``!` `` followed by a newline before the closing backtick
- **THEN** the system SHALL treat the expression as malformed
- **AND** SHALL surface a visible error because multiline shell-expression syntax is not supported in this change
