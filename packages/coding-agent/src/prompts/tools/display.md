Displays user-facing previews using UI-only replay metadata.

<instruction>
- Supported `type` values: `image`, `color`
- `resources` must be a non-empty array of absolute `file:`, `http:`, `https:`, or `data:` URI strings
- Process resources independently and preserve input order
- Keep model-facing text concise (counts/outcomes only)
- Put replay payloads in `details.drawIntents`, never in summary text
- Mixed batches are best-effort: successful resources render, failed resources report per-resource errors, and the call fails only when every resource fails
- `image` resources must resolve to supported image bytes
- `color` resources must resolve to `text/plain` containing exactly one canonical `#RRGGBB` value
</instruction>

<output>
Returns concise summary text and structured metadata:
- `details.drawIntents`: successful replay entries (currently image draw intents with payload + dimensions)
- `details.report`: per-resource entries (`type`, `uri`, optional `error`)
</output>

<example name="single image">
```
{
  "type": "image",
  "resources": ["file:///absolute/path/to/image.png"]
}
```
</example>

<example name="mixed batch">
```
{
  "type": "color",
  "resources": [
    "data:text/plain,%23FF0000",
    "https://example.com/color.txt",
    "data:text/plain,not-a-color"
  ],
  "options": {
    "title": "Screenshot set",
    "mode": "auto"
  }
}
```
</example>

<avoid>
- Relative paths or plain filesystem paths
- Embedding replay base64 payloads in summary text
- Embedding base64 payloads in summary text
</avoid>