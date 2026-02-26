## Deferred for Post-v0

### Additional display types
- ANSI/text rendering (`text.ansi`) for TUI design iteration.
- URL/folder/open actions and other non-image display handlers.

### Input model expansion
- Support for additional resource schemes beyond `file:`.
- Optional plain path acceptance (in addition to URI strings).
- Optional richer resource object form (labels/hints/metadata).

### Type-specific payload options
- Add `params` for type-specific behavior once a second image mode (or second display type) is introduced.
- Define per-type runtime validators and compact usage snippets.

### Display lifecycle controls
- Add stable `display_id` identity for update/replace semantics.
- Add append/replace policies for iterative preview workflows.

### Payload/persistence controls
- Size/count limits for display payloads.
- Metadata externalization strategy for large `details.images` payloads to avoid session truncation.

### Policy and safety follow-ups
- Transcript policy for display metadata retention and redaction.
- Final mode degradation policy (`auto` degrade vs strict `inline`/`external` semantics).

### Capability framework follow-up
- Keep docs capability-generic (`tools.<tool>.capabilities.<capability-id>`) without coupling docs to a fixed capability list.
- Require every registered capability to have explicit settings metadata.