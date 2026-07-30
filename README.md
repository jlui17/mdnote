# mdnote

Highlight-and-comment review for Markdown files. Select a span in a rendered doc, attach a note, hand the notes to a coding agent, watch it apply them.

## The loop

```
$ mdnote review notes.md
http://127.0.0.1:53214
```

The browser opens on the rendered doc. You highlight a span, a popover appears, you pick `comment` / `replace` / `delete` and type a note (or click "Add general note" for a doc-wide instruction not tied to a span).

Then, in a terminal or via the SKILL.md loop, an agent pulls what you left:

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

## Install

```
bun install
```

Run it directly:

```
bun src/cli.ts review notes.md
```

Or link it so `mdnote` is on your `PATH`:

```
bun link
mdnote review notes.md
```

## CLI reference

- **`mdnote review <file.md> [--host H] [--port P]`** — starts the server and opens the browser. Defaults to `127.0.0.1` on a random port; pass `--host 0.0.0.0` (optionally with `--port`) to serve on all interfaces, e.g. from a VM.
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

## Installing the skill

`SKILL.md` teaches Claude Code this loop so it runs the CLI on its own when you say things like "I left notes." Symlink it in:

```
mkdir -p ~/.claude/skills/mdnote
ln -s "$(pwd)/SKILL.md" ~/.claude/skills/mdnote/SKILL.md
```
