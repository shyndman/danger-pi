## MODIFIED Requirements

### Requirement: editing tools stay in lockstep with OpenCode
The `coding-agent-editing` capability SHALL require that every editing tool (including `apply_patch`, hashline, and replace) matches the OpenCode reference implementation for functionality and messaging, except where explicitly documented (currently only BOM/CRLF preservation). Any deviation SHALL be treated as a bug and removed.

#### Scenario: future edit tool proposal is rejected when diverging
- **WHEN** an engineer attempts to introduce a new heuristic to `apply_patch` (e.g., fuzzy matching or extra diff summarization)
- **THEN** the reviewer SHALL block the change unless there is an accompanying OpenCode change or a documented exception approved in the specs
