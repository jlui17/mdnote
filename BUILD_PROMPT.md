# Build prompt: mdnote

Build `mdnote`, a local web app for annotating Markdown files and handing the annotations to a coding agent.

## Purpose / vision

I iterate on Markdown files (plans, docs, prompts) with Claude Code. Today the feedback loop is clumsy: I read the file, then type free-form notes like "in the third paragraph under Setup, change X" into the agent. I want the Hunk workflow (hunk.dev's terminal diff reviewer) applied to whole Markdown documents: I view the rendered doc, highlight a span (a sentence, a paragraph, a mid-sentence phrase), attach a note like "I don't like this, make it punchier", and the agent pulls my annotations, edits the file, and I re-review until clean.

Rendering must be rich, which is why this is a web app and not a TUI: real scaled headings, actual bold/italic, styled lists and code fences. Existing tools miss this spec: Hunk is diffs-only, revdiff/rep show raw source text, and Plannotator does everything but is heavier than I want. This is the lean version: one binary-ish process, one page, one sidecar file, one CLI command for the agent.

## Scope

**In scope (v1):**

- `mdnote review <file.md>` starts the server and opens the browser to the rendered doc (loopback + random port by default, `--host`/`--port` to serve remotely; details in Workflow).
- Rendered Markdown where every rendered element knows its source position, so a browser text selection maps back to source lines and character offsets.
- Select any span and attach an annotation. Three types: **comment** (free-form note), **replace** (note says what it should become), **delete**. Plus a document-level general note not anchored to a span.
- Annotations persist to a sidecar JSON next to the file (`<file>.md.mdnote.json`), so they survive closing the tab and the server.
- `mdnote comments <file.md> --json` prints the annotations for the agent; `mdnote clear <file.md>` empties them.
- Live reload: the page watches the source file and re-renders when the agent edits it, re-anchoring or flagging stale annotations.
- A `SKILL.md` teaching Claude Code the loop (see Workflow), installable by symlink.

**Out of scope (do not build):**

- Diffs, git integration, multi-file review, folders.
- Auth, sharing, collaboration, TLS. The server binds wherever you tell it (see Workflow); anything beyond that is the host's problem (firewall, tailscale, ssh tunnel).
- Image attachments, themes/settings UI, MCP server (Hunk shipped one and deleted it in favor of a plain CLI; copy that decision).

## Workflow (end to end)

1. I run `mdnote review notes.md` in a terminal (or the agent runs it for me). The CLI starts the server, prints the URL, and opens the browser when running locally. By default it binds `127.0.0.1` on a random port; `--host 0.0.0.0` (with optional `--port`) binds all interfaces, so the same command on a VM serves at `vm-ip:port` with no other changes. Remote is a first-class deployment, not a mode: nothing in the server may assume the browser is on the same machine (no `localhost` baked into frontend URLs; the page derives the API and SSE endpoints from `window.location`).
2. I highlight a span, a small popover appears, I pick comment/replace/delete and type the note. The annotated span stays visibly marked in the doc. Repeat.
3. I tell the agent "I left notes" (or the SKILL.md tells it to check after pointing me at a doc). The agent runs `mdnote comments notes.md --json` and gets each annotation with its anchor: source line range, character offsets, and the exact selected text.
4. The agent edits `notes.md`. The page live-reloads with the new content. Annotations whose anchor text no longer exists are marked resolved-or-stale rather than silently dropped; the agent runs `mdnote clear` for the ones it addressed.
5. Loop until I have no notes left.

The agent never drives the browser; its whole interface is the CLI. This mirrors Hunk's design: TUI for the human, `hunk session *` CLI for the agent, SKILL.md as the only integration glue.

## Tech stack

- **Runtime:** Bun, TypeScript throughout. One process serves the page, the API, and the file watcher. Target a single `bunx mdnote` / compiled-binary install later; don't architect against it.
- **Markdown rendering:** `markdown-it` server-side, with a rule that stamps `data-source-line` (from each token's `.map`) onto rendered block elements. This is the load-bearing piece: the selection→source mapping depends on it. GFM basics (tables, strikethrough, task lists) on; raw HTML off.
- **Frontend:** one page, Preact + TypeScript bundled by Bun (no build pipeline beyond `bun build`). Preact owns the chrome: annotation sidebar, selection popover, status badges, SSE-driven state. The rendered document is an island Preact does not manage — a container filled with the server's HTML via `dangerouslySetInnerHTML` and touched only through refs; no component ever renders inside it. Selection via `window.getSelection()`, resolved to source anchors by walking up to the nearest `data-source-line` element and computing offsets within it. Annotated spans are painted with the CSS Custom Highlight API (`CSS.highlights` + `::highlight()`), driven by an effect watching annotation state — never by wrapping text nodes in mark elements, so the document DOM stays byte-identical to what the server sent and re-anchoring math stays simple.
- **Persistence:** the sidecar JSON, schema below. No database.
- **API:** plain JSON over HTTP (`GET/POST/DELETE /annotations`, `GET /doc`, plus an SSE endpoint for live reload). The CLI subcommands hit the same API when a server is running, and fall back to reading the sidecar directly when not.

Annotation schema (adapted from Hunk's agent-context format, single-sided since there's no diff):

```json
{
  "id": "uuid",
  "type": "comment | replace | delete | global",
  "lineRange": [12, 14],
  "anchorText": "the exact selected text",
  "note": "make this punchier",
  "createdAt": "ISO timestamp",
  "status": "open | stale"
}
```

`lineRange` is 1-based inclusive source lines; `anchorText` is what re-anchoring and staleness checks match against after the agent edits the file.

## Expected end state

Done means this scenario works, demonstrated live: open a real Markdown file with `mdnote review`, add one annotation of each type in the browser, run `mdnote comments --json` in another terminal and see all four with correct line ranges and anchor text, have Claude Code (with the SKILL.md installed) apply them, and watch the page re-render with the edits and the addressed annotations cleared. The repo ships with the server, the frontend, the CLI, the SKILL.md, a README showing the loop, and tests covering the source-mapping logic (selection offsets → line ranges) and the sidecar read/write path, since the mapping is the part most likely to be subtly wrong.

Keep it small. Every feature not in the workflow above is scope creep; when in doubt, cut.
