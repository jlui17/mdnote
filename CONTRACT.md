# mdnote internal contract (build-time doc, deleted before ship)

Read BUILD_PROMPT.md first for the product spec. This file pins the interfaces
between the parallel workstreams. Do not change these without flagging it in
your final report; other workers build against them. `src/types.ts` is the
authoritative type definition — import from it, never redeclare.

## File ownership

- `src/types.ts` — shared types (already written; read-only for all workers)
- `src/render.ts`, `src/anchor.ts`, `src/server.ts`, `tests/render.test.ts`, `tests/anchor.test.ts` — SERVER worker
- `web/index.html`, `web/main.ts`, `web/style.css` — FRONTEND worker
- `src/store.ts`, `src/cli.ts`, `tests/store.test.ts` — CLI worker
- `SKILL.md`, `README.md` — DOCS worker

Touch only your files.

## Rendering (`src/render.ts`)

`export function render(source: string): string`

markdown-it, GFM basics on (tables, strikethrough; task lists via a small
inline rule or `linkify:false` default — no extra plugin deps beyond
markdown-it itself unless truly needed), `html: false`. A core/renderer rule
stamps `data-source-line="<start>-<end>"` on every block-level rendered
element that has a token `.map`, where start/end are **1-based inclusive**
source line numbers (markdown-it's `.map` is 0-based exclusive-end: `[s, e)` →
`s+1`-`e`). Nested blocks (list items, blockquote paragraphs) each get their
own stamp; the innermost stamped ancestor of a selection wins.

## Anchoring (`src/anchor.ts`)

`export function locate(source: string, anchorText: string, hintRange?: [number, number]): [number, number] | null`

Finds `anchorText` in `source` and returns the 1-based inclusive line range it
spans, or null if absent. Matching must tolerate the markdown syntax the
renderer stripped: the browser selection is *rendered* text ("bold word")
while the source has `**bold** word`, and a selection can cross soft-wrapped
lines (rendered space ↔ source newline). Strategy: exact substring first, then
a normalized scan that skips markdown punctuation (`*_`` ~[]()#>`-`) and treats
any whitespace run as equivalent. `hintRange` biases toward the previous
location when the text appears more than once. This is the load-bearing,
heavily-tested module: re-anchoring after agent edits calls it, staleness = it
returns null.

`export function reanchor(source: string, annotations: Annotation[]): Annotation[]`

Maps each non-global annotation: found → status "open" with updated
lineRange; not found → status "stale", lineRange kept as-is. Pure function.

## Sidecar (`src/store.ts`)

Path: `<file>.mdnote.json` next to the reviewed file (e.g. `notes.md` →
`notes.md.mdnote.json`). Shape: `Sidecar` from types.ts. Missing file reads as
`{version: 1, annotations: []}`. Writes are atomic (write temp + rename).

`export function sidecarPath(file: string): string`
`export function readSidecar(file: string): Sidecar`
`export function writeSidecar(file: string, s: Sidecar): void`

## HTTP API (server, Bun.serve, JSON)

- `GET /` — index.html; `GET /main.js`, `GET /style.css` — frontend assets.
  Server builds `web/main.ts` with `Bun.build` at startup (in-memory or temp
  dir output) and serves the bundle; frontend worker just writes `web/`.
- `GET /doc` → `DocResponse`
- `GET /annotations` → `{annotations: Annotation[]}`
- `POST /annotations` body `NewAnnotation` → created `Annotation` (server
  assigns `id` = crypto.randomUUID(), `createdAt`, `status: "open"`; runs
  `locate` on anchorText to normalize lineRange when found)
- `DELETE /annotations/:id` → 204
- `DELETE /annotations` → 204 (clear all)
- `GET /events` — SSE. Event `update` (no payload needed) whenever the source
  file or sidecar changes on disk; client refetches /doc and /annotations.

Every mutation persists to the sidecar immediately. On source-file change the
server re-renders, runs `reanchor`, persists any status/lineRange changes,
then emits `update`. Watch both the source file and the sidecar
(`fs.watch` on the parent dir, filtered — editors and agents replace files by
rename, which per-file watches lose).

All frontend fetches use relative URLs / `window.location` — no host baked in.

## Server discovery (CLI ↔ server)

`mdnote review` writes `<file>.mdnote.lock` next to the sidecar:
`{"port": n, "host": "...", "pid": n}`; removed on shutdown (SIGINT/SIGTERM
handlers + best effort). `comments` / `clear` try the API
(`http://127.0.0.1:<port>` with ~300ms timeout) when a lock exists and the
pid is alive, else operate on the sidecar directly and ignore stale locks.

## CLI (`src/cli.ts`, package.json bin `mdnote`)

- `mdnote review <file.md> [--host H] [--port P]` — default 127.0.0.1 +
  random port (port 0, read the real one from the server). Prints the URL;
  opens the browser (`open <url>`, macOS) only when bound to loopback.
- `mdnote comments <file.md> [--json]` — `--json`: print
  `{file, annotations}` as JSON. Without: human-readable list.
- `mdnote clear <file.md> [--id ID]` — clear all (or one) annotation(s).

Exit non-zero with a one-line error on missing file / unknown command.

## Frontend behavior (web/)

- Fetch /doc, inject html; fetch /annotations, paint highlights.
- Selection → annotation: on mouseup with a non-collapsed selection inside
  the doc, find the nearest `data-source-line` ancestors of the selection's
  start and end nodes → lineRange = [min start, max end]; anchorText = the
  selection's `toString()` (rendered text — the server's `locate` normalizes
  it to source). Popover with comment/replace/delete buttons + a note input
  (delete needs no note). POST, repaint.
- Highlights: wrap annotated ranges via CSS Highlights API
  (`CSS.highlights`) if available, else a per-block text-match walk that wraps
  matched text in `<mark data-annotation-id>`. Clicking a highlight or a
  sidebar entry shows the note + a resolve (DELETE) button. Stale annotations
  render visually distinct (e.g. struck-through in a sidebar list).
- A fixed sidebar lists all annotations (incl. global + stale) with
  type, anchor snippet, note, delete button; plus an "Add general note"
  button that POSTs a `global` annotation.
- SSE: on `update`, refetch /doc + /annotations and re-render, preserving
  scroll position.
