## 1. Deferred Payload Model

- [ ] 1.1 Define `DeferredMultiBlockPayload` types in session-layer code with delivery mode (`steer`/`followUp`) and ordered compiled prompt parts.
- [ ] 1.2 Extend existing `steer`/`followUp` queue item handling so compiled multi-block payloads enqueue/dequeue through the same FIFO paths as single messages.
- [ ] 1.3 Add replay guards so drained payloads are delivered once and are removed on success/failure boundaries.

## 2. Streaming Compile Path

- [ ] 2.1 Refactor multi-block runner helpers so compile-time execution and prompt-part assembly can be invoked without triggering immediate prompt delivery.
- [ ] 2.2 Update `InputController.handleSubmit` streaming path to detect multi-block input, compile it immediately, and enqueue deferred payloads instead of raw prompt text.
- [ ] 2.3 Preserve immediate execution semantics for `!`/`$` blocks during streaming compilation and ensure command failures surface with existing block-level errors.

## 3. Boundary Delivery Integration

- [ ] 3.1 Hook steer-bound deferred payload delivery into the existing steering dequeue boundary used for queued steering messages.
- [ ] 3.2 Hook follow-up-bound deferred payload delivery into the existing follow-up dequeue boundary and idle-restart continuation path.
- [ ] 3.3 Ensure delivery sends compiled prompt content only (no dequeue-time imperative execution) and keeps authored ordering intact.

## 4. Validation and Regression Coverage

- [ ] 4.1 Add tests for streaming multi-block `steer` delivery timing and content ordering parity with idle multi-block behavior.
- [ ] 4.2 Add tests for streaming multi-block `followUp` delivery timing, including post-`agent_end` enqueue and restart behavior.
- [ ] 4.3 Add mixed-queue tests covering interleaved single-message and multi-block payloads to verify FIFO ordering per delivery mode.
