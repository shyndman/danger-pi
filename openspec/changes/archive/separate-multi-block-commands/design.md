## Context

Multi-block submissions currently run inside `runMultiBlockSubmission`. The helper splits the submission into blocks, executes any slash commands immediately, and pushes free-text blocks into a `textParts` array. After the loop finishes, the helper trims and sends a single user message with the accumulated text. Builtin and file commands run quietly, so the transcript never shows what they did. Only `/skill:` commands call `promptCustomMessage`, which is why skills still show up in the UI.

The TUI already supports emitting multiple follow-up entries before the agent starts responding (e.g., queued compaction messages). Therefore the safest approach is to reuse the existing `session.prompt`, `session.sendCustomMessage`, and renderer pipelines rather than inventing a new transport.

## Goals / Non-Goals

**Goals:**
- Preserve the order of every block (text or slash command) from a multi-block submission in the chat transcript.
- Allow builtin and file commands to emit their UI components just like `/skill:` commands do.
- Keep suppress-turn semantics whenever another block remains, so we still avoid multiple round trips.
- Ensure editor history records the full stacked submission exactly as typed so the user can recall/replay it later.

**Non-Goals:**
- Changing how single-block submissions behave.
- Redesigning the slash command registry or adding new command types.
- Streaming/mid-command interleaving; blocks still execute sequentially.

## Decisions

1. **Block execution produces immediate chat entries.** Instead of collecting text, enhance the runner with a `dispatchTextBlock(text, { suppressTurn })` helper that calls `ctx.session.prompt(text, { expandPromptTemplates: false, streamingBehavior: suppressTurn ? "followUp" : undefined })`. This function should trim but not merge text and must set `ctx.editor.setText("")` after sending so the next block starts from a clean slate.
2. **Builtin/file commands forward metadata into chat.** Wrap `executeBuiltinSlashCommand` results inside a `CustomMessage` describing the command and feed it through `session.sendCustomMessage`. File commands should use the existing renderer metadata (diff + diagnostics) so the output matches `apply_patch`. When a command fails, emit an error message immediately and stop the multi-block run to mimic current failure semantics.
3. **Suppress-turn flag driven by lookahead.** Reuse the existing `hasFutureTextBlock` logic but extend it to detect any future block (command or text). When true, pass `{ suppressTurn: true }` into the handlers so they call `promptCustomMessage`/`prompt` with `triggerTurn: false`. The last block should run without suppression so the agent wakes up naturally.
4. **History updates per block.** Extend `InputController` so it adds the original submission to history (unchanged) and also records each text block as it gets dispatched. This gives users a chronological history that matches the transcript. Store command entries as part of the system’s chat log so they can be restored when sessions reload.
5. **Testing hooks.** Add explicit testing seams (e.g., stubbed `handleBlockDispatch`) so unit tests can assert the exact order of emitted entries.

## Risks / Trade-offs

- **Chat noise** → Multi-block submissions may create many entries. *Mitigation:* Provide compact rendering (e.g., a “Stacked Blocks” label) and document the feature so users know what to expect.
- **Regression potential in InputController** → More user messages per submission may expose latent bugs (e.g., queue draining). *Mitigation:* Add targeted tests covering text-command-text scenarios and verify queued message restoration still works.
- **Tool handlers expecting single message** → Downstream logic that assumed aggregated text might misbehave. *Mitigation:* Audit known consumers (auto-continue, compaction, follow-up queue) during implementation and add telemetry around stacked submissions to catch anomalies early.
