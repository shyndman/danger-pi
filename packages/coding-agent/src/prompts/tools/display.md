Displays local images to the user using UI-only image metadata.

<instruction>
- v0 supports only `type: "image"`
- `resources` must be a non-empty array of absolute `file:` URI strings
- Process resources independently and preserve input order
- Keep model-facing text concise (counts/outcomes only)
- Put image payloads in `details.images`, never in summary text
- Include `widthPx` and `heightPx` for every successful image
- Use only these resource failure codes: `invalid_resource_uri`, `unsupported_scheme`, `resource_not_found`, `render_failed`
</instruction>

<output>
Returns concise summary text and structured metadata:
- `details.images`: successful image entries (`data`, `mimeType`, `widthPx`, `heightPx`)
- `details.failures`: per-resource failures (`index`, `resource`, `code`, `message`)
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
  "type": "image",
  "resources": [
    "file:///absolute/path/to/ok.png",
    "https://example.com/image.png",
    "file:///absolute/path/to/missing.png"
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
- Non-`file:` schemes in v0
- Embedding base64 payloads in summary text
</avoid>