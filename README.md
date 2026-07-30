# mdnote

Highlight-and-comment review for Markdown files. Select a span in a rendered doc, attach a note, hand the notes to a coding agent, watch it apply them.

Iterating on Markdown (plans, docs, prompts) with a coding agent usually means typing free-form directions like "in the third paragraph under Setup, change X". mdnote replaces that with direct annotation: you review the rendered document in a browser and mark exactly the spans you mean; the agent reads your notes with precise source locations and edits the file.

## How it works

The server renders your Markdown so that every element carries its source line numbers, which lets a browser text selection map back to exact lines in the file. Each annotation you leave (a note, a replacement instruction, or a deletion) persists to a sidecar JSON next to the file, so nothing lives only in the browser tab. The agent never touches the browser: it pulls annotations through the CLI, edits the file, and the page live-reloads with the new content. Annotations follow the text they anchor to as lines shift; one whose text no longer exists is marked stale rather than silently dropped.

## Quick start

```
git clone git@github.com:jlui17/mdnote.git && cd mdnote
bun install
bun link          # puts `mdnote` on your PATH (needs ~/.bun/bin in PATH)
mdnote review notes.md
```

The browser opens on the rendered doc. Highlight a span, pick `comment` / `replace` / `delete` in the popover, type a note (or click "Add general note" for a doc-wide instruction not tied to a span).

Then an agent (or you, in another terminal) pulls what you left:

```
$ mdnote comments notes.md --json
{
  "file": "notes.md",
  "annotations": [
    {
      "id": "3f1e2b7a-...",
      "type": "replace",
      "lineRange": [12, 14],
      "anchorText": "the quick brown fox",
      "note": "make this punchier",
      "createdAt": "2026-07-30T18:04:00.000Z",
      "status": "open"
    }
  ]
}
```

The agent edits `notes.md` to match the notes, then clears what it addressed:

```
$ mdnote clear notes.md --id 3f1e2b7a-...
```

The browser page live-reloads on its own. Repeat until `mdnote comments` returns nothing open.

To have Claude Code run this loop itself when you say things like "I left notes", install the skill:

```
mkdir -p ~/.claude/skills/mdnote
ln -s "$(pwd)/SKILL.md" ~/.claude/skills/mdnote/SKILL.md
```

## Remote use

The server binds `127.0.0.1` on a random port by default. Reviewing a file on a VM or remote box is the same command with a bind flag:

```
mdnote review notes.md --host 0.0.0.0 --port 7777
```

Open `http://<vm-ip>:7777` from anywhere that can reach the host. Nothing in the page assumes the browser and server share a machine; securing the port (firewall, tailscale, ssh tunnel) is up to you.

## CLI reference

- **`mdnote review <file.md> [--host H] [--port P]`** — starts the server and opens the browser (loopback only). Defaults to `127.0.0.1` on a random port.
- **`mdnote comments <file.md> [--json]`** — lists annotations. `--json` prints `{file, annotations}`; without it, a human-readable list.
- **`mdnote clear <file.md> [--id ID]`** — clears one annotation by `--id`, or all annotations if omitted.

## Annotation schema

Annotations persist to `<file>.mdnote.json` next to the reviewed file.

```ts
type AnnotationType = "comment" | "replace" | "delete" | "global";
type AnnotationStatus = "open" | "stale";

interface Annotation {
  id: string;
  type: AnnotationType;
  lineRange: [number, number] | null; // 1-based inclusive source lines; null for "global"
  anchorText: string | null;          // exact selected text; null for "global"
  note: string;
  createdAt: string;
  status: AnnotationStatus;
}
```

## Live reload and staleness

The server watches both the source file and the sidecar. When the agent edits `notes.md`, the server re-renders it, re-anchors every annotation against the new source, and pushes the update to any open browser tab. An annotation whose anchor text still exists gets an updated `lineRange` and stays `open`; one whose anchor text is gone is marked `stale` instead of silently dropped, so you can re-check it rather than lose it.
