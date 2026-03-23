## Context

Danger Pi already has a fork-local extension seam at `packages/coding-agent/src/danger-pi/extensions/`. The bundled extension index in that directory is loaded as part of the coding-agent SDK startup path, which means any file added there becomes part of the server-side runtime graph unless we deliberately keep browser-only code behind a build boundary.

That runtime detail matters for this feature because the user wants two things at the same time:

1. the browser viewer and its markdown-rendering dependencies must ship with `omp`
2. the server-side extension must not import Marked or DOMPurify directly

The feature is intentionally narrow. It is not a transcript browser, not a history viewer, and not a second chat surface. It is a better reading surface for the latest completed assistant reply, with one extra capability: ask the configured `smol` model to summarize whatever markdown is currently being shown in the browser.

### Relevant existing system behavior

A junior engineer implementing this should anchor on these existing facts:

- Bundled Danger Pi extensions are registered from `packages/coding-agent/src/danger-pi/extensions/index.ts`.
- Extensions can register slash commands and observe session/message lifecycle events.
- Assistant messages in this codebase are structured content arrays. Existing code commonly extracts visible assistant text by filtering blocks where `content.type === "text"`.
- The codebase already performs small in-process helper model calls with `completeSimple(...)` after resolving a model and retrieving auth through `modelRegistry`.
- Static text used as prompts in this repository must live in `.md` files and be imported with `with { type: "text" }`; prompt strings must not be built inline in code.
- The codebase already has a helper for opening a URL in the default browser, but its existing HTML export path currently references CDN-hosted browser libraries. That means the viewer's locally served client bundle is new first-party packaging work, not an existing browser-asset convention we are simply copying.
- Third-party dependency assumptions for this feature have been checked against current upstream docs: the viewer needs `marked` and `dompurify`, while browser WebSocket support comes from the platform and does not require an extra package. Because sanitization stays in the browser, DOMPurify does not require `jsdom` or `isomorphic-dompurify` for this feature.

### Terms used in this design

- **Viewer buffer**: the extension-owned authoritative markdown string currently being displayed in the browser.
- **Revision**: a monotonically increasing number attached to the viewer buffer. It changes every time the authoritative buffer is replaced. It exists to reject stale summarize completions.
- **Active client**: the newest connected browser WebSocket. Only this socket receives updates; older sockets are ignored or closed.
- **Completed assistant text**: the concatenated text from assistant content blocks whose type is `text`, captured only when the assistant message is complete.

## Goals / Non-Goals

**Goals:**
- Add a fork-local bundled extension in `packages/coding-agent/src/danger-pi/extensions/` that exposes `/viewer`.
- Start a localhost web server lazily on first `/viewer`, then always open the viewer URL when `/viewer` runs again.
- Serve both the HTML page and the browser client asset from that local server.
- Keep one authoritative viewer buffer in extension state, populated only from completed assistant `text` blocks.
- Push the current authoritative state immediately when the browser connects.
- Render markdown in the browser with Marked and sanitize the resulting HTML with DOMPurify.
- Support repeated summarization of the authoritative viewer buffer using the user's configured `smol` model and `completeSimple(...)`.
- Preserve the buffer on summarization failure, ignore summarize requests while one is already in flight, and ignore stale summarize results.
- Keep browser-only dependencies out of the server-side extension module graph.

**Non-Goals:**
- No browser history, transcript navigation, sidebar, or multi-message archive.
- No token streaming or incremental update UI; the viewer updates only when a completed assistant reply is available.
- No inclusion of thinking blocks, tool calls, tool results, user messages, or custom messages.
- No separate frontend package for v1.
- No stop command, background daemon, or persistence of viewer state across `omp` restarts.
- No mutation of session transcript or assistant history when summarizing.
- No custom markdown dialect beyond what Marked handles normally for this page.

## Decisions

### 1. Implement as a fork-local bundled extension
The viewer lives under `packages/coding-agent/src/danger-pi/extensions/` and is registered from that directory's bundled extension index.

This is the correct seam because the user explicitly locked the extension location and because the feature is Danger Pi-specific rather than a general upstream extension package.

A junior engineer should treat this as a normal bundled extension addition, similar in placement to the existing fork-local extensions already present in that directory.

**Alternatives considered:**
- **Filesystem-discovered extension**: more dynamic, but conflicts with the locked requirement to keep this fork-local and bundled.
- **Separate package**: only worth the complexity if the browser UI grows into a substantial product area later.

### 2. Split the implementation into three runtime layers
The implementation should be mentally divided into three layers, each with a single responsibility:

1. **Server-side extension layer**
   - registers `/viewer`
   - starts and owns the local server
   - tracks authoritative state
   - listens for completed assistant messages
   - runs summarization requests

2. **Served browser asset layer**
   - HTML shell and client bundle served by the extension
   - no server-only imports

3. **Browser client layer**
   - opens WebSocket
   - renders markdown
   - displays status/errors
   - sends summarize requests

This split is more important than the exact filenames. A junior engineer should not collapse these layers together because doing so is the easiest way to accidentally put Marked or DOMPurify on the server-side runtime path.

A practical file layout would look roughly like:

- `viewer.ts` or similar: extension runtime
- `viewer-client.ts`: browser entrypoint
- `viewer.html` or generated HTML text asset: served shell
- `viewer-summary.md`: static summarizer prompt text
- generated client bundle artifact or equivalent server-consumable asset wrapper

The exact filenames can vary, but the separation of responsibilities should not.

**Alternatives considered:**
- **One combined module**: simpler at first glance, but too easy to violate the client/server dependency boundary.

### 3. Use a lazy localhost HTTP server plus WebSocket
`/viewer` ensures the server exists, starts it if missing, and always opens the resulting URL in the browser. The server binds to `127.0.0.1` on port `0`, so the OS chooses an ephemeral port. The server exposes:

- `GET /` -> viewer page
- one client asset route -> browser JS bundle (path can be `/viewer.js`, `/assets/viewer.js`, or similar)
- `GET /ws` (upgrade) -> WebSocket endpoint

The user explicitly prefers a socket rather than SSE. Even though the current feature only needs a small set of messages, the socket gives a clean bidirectional path for future growth.

A junior engineer should note two implementation details here:

- `port: 0` is not a bug; it is the mechanism for asking the OS to pick a free ephemeral port.
- The server is process-scoped, not session-persistent. Restarting `omp` is the shutdown mechanism for v1.

**Alternatives considered:**
- **Fixed port**: simpler for copy-pasting URLs, but creates collisions and needless operational recovery work.
- **SSE + POST**: adequate for one-way push plus a single command, but rejected by user preference.

### 4. The extension owns authoritative state
The extension should keep a small explicit state object. At minimum, it needs:

- `buffer: string`
- `revision: number`
- `summarizeInFlight: boolean`
- `activeSocket: WebSocket | undefined`
- `server handle / chosen URL`

Optionally, it may also track the last summarize start revision or similar helper fields, but the core contract is that the extension, not the browser, is the source of truth.

This prevents divergent state across reconnects and makes the summarize button semantics simple: the browser is asking the extension to summarize whatever the extension currently believes is the active buffer.

**Alternatives considered:**
- **Client-owned state**: rejected because reconnects, multiple tabs, and stale buffers become ambiguous.

### 5. Enforce single-client semantics: newest socket wins
When a new WebSocket connection arrives, it becomes the active client. Any previous socket should be ignored or explicitly closed. Immediately after accepting the new client, the extension sends the current `buffer` event so the page starts from authoritative state instead of waiting for future assistant output.

This is locked by the user. A junior engineer should not implement fanout or per-client state in v1.

**Alternatives considered:**
- **Broadcast to all sockets**: more general, but contrary to the locked product behavior and adds complexity with no current benefit.

### 6. Update the buffer only from completed assistant text
The viewer buffer changes when a completed assistant message arrives. The extraction rule is:

- only assistant messages
- only completed messages
- only content blocks where `type === "text"`
- concatenate those text blocks in order
- trim or normalize only as needed to preserve readable markdown, not to rewrite meaning

The viewer must not include:

- thinking blocks
- tool-call scaffolding
- tool results
- user messages
- system/custom/hook messages

This is one of the most important behavioral rules in the feature. A junior engineer should not infer buffer content from what is easiest to access; they should extract from the final assistant message object using the explicit text-block filter.

This rule is intentionally simple: v1 should show **every piece of assistant message text** in order. Do not try to detect a special "summary section" or only the assistant's apparent concluding paragraph. If the completed assistant message contains multiple `text` blocks, all of them belong in the viewer buffer, concatenated in order. The product hypothesis is that agents usually end with summarizing text anyway, so the safest first implementation is to show all assistant message text and learn from real usage rather than inventing smarter selection logic up front.

A useful mental model is:

```text
assistant message completes
-> extract every assistant text block in order
-> replace authoritative viewer buffer
-> revision += 1
-> push new buffer to active browser, if present
```

**Alternatives considered:**
- **Stream on `message_update`**: deliberately rejected.
- **Try to detect only the assistant's final summary/conclusion**: rejected for v1 because it introduces brittle heuristics and is unnecessary when the explicit requirement is to show all assistant message text.
- **Use transcript/RPC snapshots as the primary source**: workable, but less direct and easier to accidentally couple to session history semantics.

### 7. Use revision numbers to guard against stale summarize completions
Every buffer replacement increments `revision`.

That includes:
- a new completed assistant reply
- a successful summarize result

It does **not** include:
- failed summarize attempts
- browser reconnects
- ignored duplicate summarize clicks

When summarize starts, capture the current revision. When the summarize response returns, only apply it if the authoritative revision is still the same revision that the summarize began from. If the revision has changed, the result is stale and must be discarded.

Example:

1. buffer revision is 5
2. user clicks summarize
3. summarize starts against revision 5
4. a new assistant message completes and replaces the buffer -> revision becomes 6
5. summarize response for revision 5 returns late
6. discard it

This is why `revision` exists. It is not a UI flourish; it is a correctness guard.

### 8. Summarize with the configured `smol` model, in-process
The summarize flow is:

1. browser sends `summarize`
2. extension checks `summarizeInFlight`
3. extension snapshots the current `buffer` and `revision`
4. extension resolves the configured `smol` model role
5. extension gets auth through `modelRegistry`
6. extension calls `completeSimple(...)` with the resolved `smol` model
7. extension reads text from the response
8. if still current, replace the buffer and increment revision
9. if failed, keep the old buffer and send an error event

The summarizer prompt must live in a static `.md` file and be imported as text, because repository rules prohibit building prompts inline in code. The prompt content is locked to the user-provided contract:

> You work as part of a team of models in a coding harness. Your job is to take the output of high reasoning models, which is often quite verbose, and condense it into a distilled form, so the user can read it more quickly. You MUST NOT lose important details during this process, nor should any information be introduced that is not supported by the original message.

This flow should remain entirely outside the main agent conversation loop. It is a helper model call initiated by the extension, not a new assistant turn.

**Alternatives considered:**
- **Use current primary model**: rejected by the user's explicit preference for their configured `smol` model.
- **Route through the main agent session**: rejected because it mutates behavior and muddles transcript semantics.

### 9. Make summarize non-destructive and single-flight
If a summarize request is already running, additional summarize requests are ignored. The extension should send `status` updates so the browser can disable the button or otherwise reflect the busy state.

The desired user experience is intentionally explicit rather than subtle:

- when summarize starts, the browser should visibly enter a busy state (for example, disable the button and show `Summarizing...`)
- when summarize succeeds, the busy state clears and the buffer swaps to the summary
- when summarize fails, the busy state clears, the current buffer remains visible, and an error message is shown prominently enough that the action does not feel like a silent no-op
- when a new assistant reply arrives during an in-flight summarize, the new assistant reply wins and the late summarize result is discarded by revision

On success:
- replace `buffer`
- increment `revision`
- clear busy state
- send new `buffer`

On failure:
- keep `buffer` unchanged
- keep `revision` unchanged
- clear busy state
- send `error`

This is intentionally conservative. The user wants predictable behavior, not request queuing.

This means the main UX correctness requirement for v1 is not fancy interaction design; it is legible state transitions. A junior engineer implementing this should prefer obvious, minimal state indicators over subtle UI treatment.

**Alternatives considered:**
- **Queue requests**: more permissive but too easy to produce confusing delayed summaries of outdated content.

### 10. Render markdown entirely in the browser client
The browser client entrypoint imports Marked and DOMPurify directly and uses this pipeline:

```text
markdown buffer
-> Marked.parse(...)
-> DOMPurify.sanitize(..., { USE_PROFILES: { html: true } })
-> container.innerHTML = sanitizedHtml
```

The server-side extension must not import `marked` or `dompurify` directly.

This is a locked runtime boundary. The junior engineer should think of the browser bundle as shipped data executed by the browser, not server runtime code executed by the extension.

Dependency details verified for this spec:

- **Marked:** current upstream release line is 17.x (current release observed during spec review: `17.0.5`). Official docs show `marked.parse(markdownString)` for browser use and explicitly warn that Marked does **not** sanitize output HTML.
- **DOMPurify:** current upstream release line is 3.3.x (current release observed during spec review: `3.3.3`). Official docs show `DOMPurify.sanitize(dirty)` for browser use and document `USE_PROFILES: { html: true }` as the way to restrict sanitization to HTML only.
- **No extra browser-rendering dependency is required for v1:** the spec intentionally excludes optional additions such as syntax highlighting (`marked-highlight`, `highlight.js`) or presentational CSS (`github-markdown-css`) because the user explicitly prioritized mechanics over visuals.
- **No server-side DOM bridge is required:** do not add `jsdom` or `isomorphic-dompurify`, because this feature does not sanitize on the server.

The browser client should also be responsible for:

- opening the WebSocket
- handling reconnect/load-time initialization
- rendering buffer updates
- showing a visible summarize busy state
- surfacing error messages without clearing the current rendered content
- ensuring the summarize button does not feel silently broken during ignored duplicate clicks

**Alternatives considered:**
- **CDN assets**: rejected because localhost viewing should not fail when offline.
- **Server-side rendering**: rejected because it would put markdown-rendering dependencies on the wrong side of the runtime boundary.
- **Extra rendering/styling packages for v1**: rejected because the feature does not need syntax highlighting, GitHub-like presentation, or richer markdown plugins to satisfy the locked mechanics-first scope.

### 11. Use a built client asset boundary, not runtime imports
The safe import rule is:

- browser entrypoint **does** import Marked and DOMPurify directly
- server-side extension **does not** import Marked or DOMPurify
- server-side extension serves a built asset artifact produced from the browser entrypoint

That built artifact can be generated in different ways, but a junior engineer should preserve the principle rather than over-focus on the mechanism. This is an important wording detail: the repository does not currently have a strong first-party precedent for locally bundling browser dependencies for a served page. The existing export HTML template uses CDN scripts, so this feature is intentionally introducing a new local asset-packaging path instead of extending a mature existing one.

Good shape:

```text
viewer-client.ts -> build step -> served asset
viewer extension -> imports served asset text/bytes only
```

Bad shape:

```text
viewer extension -> imports viewer-client.ts -> viewer-client.ts imports marked/dompurify
```

The second shape violates the locked boundary even if it "works".

### 11a. Exploratory spike results: the boundary works in practice
This design point is no longer hypothetical. An implementation spike was run directly in `packages/coding-agent` to prove the boundary mechanically.

The spike added these files:

- `packages/coding-agent/scripts/generate-viewer-spike-bundle.ts`
- `packages/coding-agent/src/danger-pi/extensions/viewer-spike/client.ts`
- `packages/coding-agent/src/danger-pi/extensions/viewer-spike/client.generated.ts`
- `packages/coding-agent/src/danger-pi/extensions/viewer-spike/server.ts`

The spike also added the real feature dependencies to `packages/coding-agent/package.json` and `bun.lock`:

- `marked@^17.0.5`
- `dompurify@^3.3.3`

What the spike proved:

- A browser-only entrypoint can import `marked` and `dompurify` directly.
- `Bun.build(...)` can bundle that entrypoint into a single browser artifact successfully.
- The working Bun build settings for this shape were `target: "browser"`, `format: "iife"`, `minify: true`, and `write: false`, followed by writing a generated TypeScript file that exports the bundle as a string constant.
- Server-side code can import only the generated artifact and contain no direct `marked` or `dompurify` imports.
- The generated bundle had no unresolved `marked` or `dompurify` imports after bundling.
- A real browser execution path confirmed that Marked rendering plus DOMPurify sanitization worked together as expected.

The spike used this minimal server-consumable pattern:

```text
client.ts -> Bun.build(browser, iife) -> client.generated.ts exporting bundled JS string
server.ts -> imports client.generated.ts only -> serves inline script/HTML
```

Important caveat discovered during the spike:

- A synthetic Bun/runtime DOM evaluation was not a reliable verification method for DOMPurify behavior.
- A real browser check using headless Puppeteer was reliable and confirmed that `<script>` content in markdown was sanitized correctly after the Marked -> DOMPurify pipeline ran.

Implication for the real feature:

- The client/server asset boundary should be treated as established, not speculative.
- The remaining work is build integration and feature wiring, not proof of bundling feasibility.
- Verification for the real feature should include at least one real-browser path for markdown rendering/sanitization rather than relying only on synthetic DOM environments.

### 12. Keep the wire protocol intentionally small and explicit
The initial protocol should use four JSON message types.

#### Server -> client: `buffer`
Sent immediately on connect and whenever the authoritative buffer is replaced.

Example:

```json
{ "type": "buffer", "text": "# Title\n\nBody", "revision": 3 }
```

#### Server -> client: `status`
Communicates summarize busy state.

Example:

```json
{ "type": "status", "busy": true }
```

#### Server -> client: `error`
Communicates failures without changing the current buffer.

Example:

```json
{ "type": "error", "message": "Failed to summarize viewer buffer" }
```

#### Client -> server: `summarize`
Requests summarization of the authoritative buffer currently held by the extension.

Example:

```json
{ "type": "summarize" }
```

The user explicitly rejected a `hello` message. The initial snapshot is carried by `buffer`.

A junior engineer should keep this protocol narrow. v1 does not need multiplexing, general RPC, or arbitrary commands.

### 13. The HTML page should be intentionally minimal
Visual design is not the goal here, but the page still needs enough structure to support the mechanics. At minimum, the page should provide:

- a main content container where rendered markdown is displayed
- a summarize button
- a small status/error area
- client bootstrapping for the WebSocket URL and asset initialization

It should not try to become a full application shell. The simplicity is part of the feature contract.

## Risks / Trade-offs

- **Browser surface increases local attack surface** -> Bind only to `127.0.0.1`, keep routes narrow, and avoid adding any capability beyond page serving, WebSocket updates, and summarize requests.
- **A junior engineer could accidentally violate the client/server dependency boundary** -> Keep browser code in a separate entrypoint, use a build artifact boundary, and explicitly forbid server-side imports of Marked/DOMPurify in code review and tests.
- **Summary quality depends on the configured `smol` model** -> This is intentional; failures are non-destructive and visible to the user.
- **Single-client semantics may surprise users with multiple tabs** -> Make the rule explicit in comments, design docs, and connection handling; close or ignore older sockets deterministically.
- **Incorrect message extraction could include non-user-visible content** -> Filter explicitly to completed assistant `text` blocks and add targeted verification for that extraction rule.
- **Bundled client assets increase binary size** -> Accept the trade-off because the feature must ship with `omp`, but keep browser dependencies out of the server runtime path so the size increase does not become a startup/runtime dependency problem.
- **Build plumbing for the client bundle introduces maintenance overhead** -> Keep the client tiny and the asset build explicit so failures are easy to diagnose. The spike demonstrated that the mechanics work; the maintainability question is now where to hook generation into normal package/binary workflows and whether the generated artifact is checked in or regenerated as part of those workflows.
- **Synthetic DOM verification can give false confidence** -> Prefer a real-browser verification path for markdown rendering and sanitization behavior, because the spike found that a synthetic Bun/runtime DOM evaluation did not reflect DOMPurify behavior reliably enough.

## Migration Plan

1. Create the browser client entrypoint, minimal HTML shell, and a build path that produces a server-consumable client asset. The spike already proved a viable shape: bundle the browser entrypoint with `Bun.build(...)`, target `browser`, use `iife` output, and write a generated TypeScript artifact that exports the bundled script as a string.
2. Add the static summarizer prompt file as repository text content, not an inline string.
3. Add `marked@^17.0.5` and `dompurify@^3.3.3` to `packages/coding-agent` dependencies, but import them only from the browser entrypoint. Do not add `jsdom`, `isomorphic-dompurify`, `highlight.js`, or markdown presentation CSS for v1.
4. Implement the extension runtime: command registration, lazy server startup, state object, WebSocket handling, active-client replacement, and buffer updates from completed assistant messages.
5. Implement the summarize flow using the resolved `smol` model and the locked prompt text.
6. Wire the extension into the bundled Danger Pi extension registry and update package changelog/build plumbing. Build-plumbing work must decide whether the generated viewer artifact is checked in, generated by a dedicated coding-agent script, or generated as part of a larger binary/prepack flow.
7. Verify behavior end to end: `/viewer` opens the page, current buffer is sent on connect, the page updates on the next completed assistant reply, summarize succeeds when the helper model succeeds, summarize preserves the buffer on failure, and a new assistant reply overwrites a previous summary. Include at least one real-browser verification for markdown rendering and sanitization, following the lesson from the spike.
8. Rollback is straightforward because the feature is additive: remove the bundled extension registration and its supporting files, and the rest of the session/transcript model remains unchanged.

## Open Questions

None. The feature scope, extension location, client/server boundary, protocol, summarizer behavior, runtime model choice, and user-facing semantics are all locked.
