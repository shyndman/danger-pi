## ADDED Requirements

### Requirement: Viewer SHALL render a coding-agent session file as an OMP-like transcript snapshot
The agent session viewer SHALL accept a coding-agent session JSONL file and render the persisted conversation as a single initial header followed by transcript rows.

#### Scenario: Snapshot render from valid session file
- **WHEN** the viewer is launched with a valid session JSONL file path
- **THEN** it SHALL print an initial header containing the session file identity and current working directory when present
- **AND** it SHALL render persisted conversation content in session order without launching the full coding-agent application

#### Scenario: Header shows startup metadata only
- **WHEN** the viewer performs its initial snapshot render
- **THEN** line 1 of the header SHALL show the CLI-provided agent label as the primary identity, plus mode/model/thinking when those fields are available
- **AND** line 2 of the header SHALL show cwd and a concise session/file label derived from the basename when those fields are available
- **AND** any missing header fields SHALL be omitted instead of rendered as placeholders
- **AND** later metadata changes SHALL not be rendered by repainting that original header

#### Scenario: Session header seeds chrome but not a transcript row
- **WHEN** the viewer reads the initial `type: "session"` entry from the JSONL file
- **THEN** it SHALL use that entry to seed header metadata such as session identity, title, and cwd
- **AND** it SHALL not render that header entry as a user, assistant, tool, or notice transcript row

### Requirement: Viewer SHALL use a small row grammar derived from persisted session content
The viewer SHALL derive rows as user, assistant, tool, or notice. Assistant thinking SHALL remain within assistant rows, and tool calls/results SHALL use the same generic tool presentation without requiring in-place transcript rewrites.

#### Scenario: Assistant thinking stays with assistant text
- **WHEN** an assistant message contains both thinking and text content
- **THEN** the viewer SHALL render the thinking as assistant subcontent rather than a separate transcript row
- **AND** it SHALL render the assistant text in the same assistant block

#### Scenario: User row shows only user-authored content
- **WHEN** the viewer renders a persisted user message
- **THEN** that user row SHALL contain the user's text and any renderable user image content from that message
- **AND** it SHALL not include assistant thinking or tool status content

#### Scenario: User and assistant text use proper word wrapping
- **WHEN** the viewer renders user text, assistant text, or assistant thinking that exceeds the available width
- **THEN** it SHALL wrap that content at word boundaries when possible instead of hard clipping it
- **AND** it SHALL use the existing ANSI-aware wrapping path already available in shared OMP TUI code rather than a new wrapping dependency

#### Scenario: Assistant row excludes tool execution chrome
- **WHEN** the viewer renders a persisted assistant message that contains text, thinking, and a tool call
- **THEN** the assistant row SHALL contain only the assistant text and thinking content
- **AND** the tool call SHALL be rendered separately using the generic tool presentation

#### Scenario: Assistant tool call becomes tool row
- **WHEN** an assistant message contains a `toolCall`
- **THEN** the viewer SHALL emit a tool row keyed to that tool call

#### Scenario: Tool-call row shows generic call information only
- **WHEN** the viewer renders a tool-call row
- **THEN** it SHALL show the tool name, generic tool status/title treatment, and a compact argument preview when arguments exist
- **AND** it SHALL not show result body content or result images in that tool-call row

#### Scenario: Tool-call args preview stays single-line and compact
- **WHEN** the viewer renders a tool-call row with persisted arguments
- **THEN** it SHALL render those arguments as a single logical args line that preserves argument field names
- **AND** it SHALL not truncate that argument content in this change
- **AND** if there are no arguments it SHALL omit the args-preview line entirely

#### Scenario: Wrapped tool-call args reuse shared wrapping behavior
- **WHEN** a tool-call args line exceeds the available width
- **THEN** the viewer SHALL rely on the same shared ANSI-aware wrapping behavior used by OMP text rendering rather than adding a new wrapping library for this change

#### Scenario: Later tool result becomes later tool row
- **WHEN** a later `toolResult` arrives with the same tool-call id as an earlier tool call
- **THEN** the viewer SHALL emit a later tool-result row using the same generic tool presentation
- **AND** it MAY reuse stored metadata from the earlier tool call
- **AND** it SHALL not rewrite or repaint the earlier tool-call row

#### Scenario: Tool-result row shows generic result information only
- **WHEN** the viewer renders a tool-result row
- **THEN** it SHALL show the tool name again using the generic tool presentation plus final result status styling
- **AND** it SHALL render result text, structured JSON output, and result images when those result payloads are available
- **AND** it SHALL not depend on mutating any earlier tool-call row

#### Scenario: Tool-result content is not truncated
- **WHEN** the viewer renders tool-result text content
- **THEN** it SHALL render the full available result content in this change rather than a collapsed preview

#### Scenario: Tool-result text wraps cleanly
- **WHEN** tool-result text exceeds the available width
- **THEN** the viewer SHALL wrap that text cleanly rather than clipping it
- **AND** it SHALL reuse the existing ANSI-aware wrapping path already present in shared OMP TUI code

#### Scenario: Tool-result row shows dim no-output marker
- **WHEN** a tool result has no text output to display
- **THEN** the viewer SHALL render a dim `(no output)` marker in the tool-result row instead of leaving the row body ambiguous

#### Scenario: Structured JSON result is rendered structurally
- **WHEN** a tool-result text payload is structured JSON
- **THEN** the viewer SHALL render it structurally rather than as one minified raw JSON line
- **AND** it SHALL not apply depth or line-count truncation in this change

#### Scenario: Tool names are not prettified
- **WHEN** the viewer renders a generic tool row for a persisted tool name such as `generate_image`
- **THEN** it SHALL use that persisted tool name as-is
- **AND** it SHALL not replace it with a prettified alias or title-cased label

#### Scenario: Unmatched tool result stays truthful
- **WHEN** the viewer encounters a `toolResult` whose tool-call id does not match any previously rendered tool row
- **THEN** the viewer SHALL surface that event as a notice or other clearly non-fabricated fallback
- **AND** it SHALL not invent a synthetic tool call that was not present in the persisted session

#### Scenario: Metadata update becomes notice in follow mode
- **WHEN** follow mode encounters a later model or thinking-level change after the initial header has already been printed
- **THEN** the viewer SHALL emit a compact notice row for the change
- **AND** it SHALL not rewrite previously printed output

#### Scenario: Metadata notices are emitted one by one
- **WHEN** follow mode encounters multiple persisted metadata changes after startup
- **THEN** the viewer SHALL emit one notice per persisted change, in the same order those changes were persisted
- **AND** it SHALL not coalesce or drop intermediate metadata changes in this change

#### Scenario: Notice row is visibly fallback/system material
- **WHEN** the viewer emits a notice row for metadata change, unsupported content, or unmatched tool results
- **THEN** that row SHALL be visually distinct from ordinary user and assistant rows
- **AND** it SHALL present the event as system/viewer information rather than as fabricated chat content

#### Scenario: Unsupported persisted content degrades to notice
- **WHEN** the viewer encounters persisted session content that is not clearly a user row, assistant row, or tool pair
- **THEN** it SHALL render that content as a notice row rather than dropping it silently
- **AND** it SHALL not pretend that content was ordinary user or assistant chat

### Requirement: Viewer SHALL use one generic tool presentation
The viewer SHALL render every tool invocation using one generic tool presentation instead of tool-specific widgets.

#### Scenario: Different tools share one presentation shape
- **WHEN** the viewer renders both a `read` tool call and a `generate_image` tool call
- **THEN** both SHALL use the same generic tool container and status treatment
- **AND** differences between them SHALL come from tool name, summarized arguments, and result content only

#### Scenario: Result row may be multiline while call row stays compact
- **WHEN** the viewer renders a tool-call row and a later tool-result row for the same tool
- **THEN** the tool-call row SHALL remain compact
- **AND** the tool-result row MAY be multiline to show result body content, structured output, and images or fallbacks

### Requirement: Viewer SHALL render images when available and degrade safely when missing
The viewer SHALL render images in kitty when usable image bytes are available in persisted session data, and it SHALL fall back to truthful text when those bytes or referenced files are missing.

#### Scenario: Persisted image bytes are rendered
- **WHEN** the viewer encounters persisted image bytes in message content or in `generate_image` result details
- **THEN** it SHALL render those images in the viewer using the kitty-compatible rendering path already used by shared TUI components

#### Scenario: Missing image fallback stays in the surrounding element
- **WHEN** an image cannot be rendered for a user row or tool-result row
- **THEN** the viewer SHALL place the textual fallback inside that surrounding row/block rather than inventing a new transcript row kind for image failure

#### Scenario: Textual fallback truthfully states the failure
- **WHEN** the viewer renders a textual fallback for an image it could not show
- **THEN** that fallback SHALL explicitly state that the image is missing, unavailable, or could not be loaded
- **AND** it SHALL include a surviving real identifier such as a file path or mime type when one is available
- **AND** it SHALL not imply that the image rendered successfully

#### Scenario: Missing image data or missing file does not break the transcript
- **WHEN** the viewer cannot load an image because the bytes are missing or a referenced file path such as `/tmp/...` no longer exists
- **THEN** it SHALL render a truthful textual fallback instead of crashing or aborting follow mode
- **AND** it SHALL continue rendering the rest of the transcript

#### Scenario: Existing path-backed image is rendered
- **WHEN** an image reference is path-backed rather than byte-backed and the referenced file still exists
- **THEN** the viewer SHALL attempt to load and render that file in the surrounding row/block
- **AND** it SHALL fall back to truthful text only if the file cannot be loaded

### Requirement: Viewer SHALL use OMP Rose Pine styling by default
The viewer SHALL render with the coding-agent dark-rose-pine theme by default so its header, message, and tool surfaces strongly resemble the main OMP experience.

#### Scenario: Default theme on startup
- **WHEN** the viewer starts without an explicit theme override
- **THEN** it SHALL use the dark-rose-pine theme
- **AND** shared semantic colors and formatting helpers SHALL determine the rendered appearance

### Requirement: Viewer SHALL keep follow mode explicit, terminal-native, and kitty-only
The viewer SHALL default to snapshot mode. The viewer SHALL only tail appended session content when `-f` or `--follow` is provided, and follow mode SHALL append newly rendered rows without repainting earlier output. This change SHALL target kitty only and SHALL not add cross-terminal rendering branches.

#### Scenario: Viewer stays on ordinary terminal output
- **WHEN** the viewer is running inside kitty
- **THEN** it SHALL render on the normal terminal screen rather than taking over the alternate screen
- **AND** it SHALL leave scrollback retention to kitty's configured history limits instead of promising viewer-managed history

#### Scenario: Change does not add cross-terminal support branches
- **WHEN** the viewer is implemented for this change
- **THEN** it SHALL rely on kitty-compatible rendering paths already available in shared code
- **AND** it SHALL not add alternate terminal-specific support logic as part of this change

#### Scenario: Snapshot mode is the default
- **WHEN** the viewer is launched without `-f` or `--follow`
- **THEN** it SHALL render the current file contents once
- **AND** it SHALL exit without waiting for appended entries

#### Scenario: Follow mode tails completed entries only
- **WHEN** the viewer is launched with `-f` and the session file later receives complete appended JSONL lines
- **THEN** the viewer SHALL parse only the appended lines and render only the newly derived rows
- **AND** it SHALL leave previously printed output intact

#### Scenario: Follow mode does not duplicate earlier output
- **WHEN** follow mode wakes up after the session file has grown
- **THEN** it SHALL continue from the last successfully processed byte offset rather than reprocessing the entire file
- **AND** rows that were already printed before that wake-up SHALL not be printed a second time

#### Scenario: Incomplete trailing line is buffered
- **WHEN** follow mode reads appended bytes that do not yet end in a newline
- **THEN** the viewer SHALL wait for the line to complete before parsing it
- **AND** it SHALL not render a partial row from that incomplete JSONL line

#### Scenario: Missing file at startup fails immediately
- **WHEN** the viewer is launched against a session file path that does not exist or cannot be opened
- **THEN** it SHALL print a truthful error message
- **AND** it SHALL exit with failure instead of retrying or waiting for the file to appear

#### Scenario: File disappears during follow mode
- **WHEN** the session file becomes unavailable after follow mode has started
- **THEN** the viewer SHALL print a truthful error message
- **AND** it SHALL stop following and exit with failure instead of retrying

#### Scenario: File truncation fails follow mode
- **WHEN** follow mode detects that the file has shrunk after establishing the processed byte offset
- **THEN** it SHALL print a truthful error message that the append-only assumption was violated
- **AND** it SHALL stop following and exit with failure instead of restarting from byte 0

#### Scenario: File replacement or rotation fails follow mode
- **WHEN** follow mode detects that the file at the target path is no longer the same append-only stream it started with
- **THEN** it SHALL print a truthful error message
- **AND** it SHALL stop following and exit with failure instead of trying to reopen or recover automatically

#### Scenario: Malformed appended JSONL fails follow mode
- **WHEN** follow mode encounters appended content that is not valid JSONL after a complete newline-terminated line is available
- **THEN** it SHALL print a truthful parse error message
- **AND** it SHALL stop following and exit with failure instead of skipping the malformed entry or continuing silently
