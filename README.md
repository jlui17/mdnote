# mdnote

Highlight-and-comment review for Markdown files. Select a span in a rendered doc, attach a note, hand the notes to a coding agent, watch it apply them.

Iterating on Markdown (plans, docs, prompts) with a coding agent usually means typing free-form directions like "in the third paragraph under Setup, change X". mdnote replaces that with direct annotation: you review the rendered document in a browser and mark exactly the spans you mean; the agent reads your notes with precise source locations and edits the file.

## How it works

The server renders your Markdown so that every element carries its source line numbers, which lets a browser text selection map back to exact lines in the file. Each note you leave ("make this punchier", "remove this") persists to a sidecar JSON next to the file, so nothing lives only in the browser tab. The agent never touches the browser: it pulls annotations through the CLI, edits the file, and the page live-reloads with the new content. Annotations follow the text they anchor to as lines shift; one whose text no longer exists is marked stale rather than silently dropped.

## Quick start

```
git clone git@github.com:jlui17/mdnote.git && cd mdnote
bun install
bun link          # puts `mdnote` on your PATH (needs ~/.bun/bin in PATH)
mdnote notes.md
```

The browser opens on the rendered doc. One background server per machine serves every file you open this way — the command exits right after printing the URL, and the server shuts itself down 5 minutes after the last tab closes (`mdnote stop` ends it now). Highlight a span and type a note in the popover — "make this punchier", "remove this paragraph" — and hit ⌘↩ (Ctrl+↩ elsewhere) or the Add button (Esc cancels) (or click "Add general note", or press `Shift+C`, for a doc-wide instruction not tied to a span). To annotate a whole block (paragraph, heading, list item, code fence), hover it — an accent bar marks the target — and click it or press `c`; hovering a list or blockquote's own gutter targets the whole container. Resting the pointer on an annotation — annotated text, or anywhere inside a block annotation's box — opens its note in a popover (move onto the popover to reach Edit or Delete; moving away closes it); clicking pins that popover open and jumps to the note in the sidebar. The ✎ button (or double-clicking the note) edits it in place.

The page opens in dark mode (or whatever `theme` you set in [Settings](#settings)); the ◐/☀/☾ button in the sidebar switches it for the session.

When you're done annotating, click **Copy review prompt** in the sidebar (or hit ⌘⇧C / Ctrl+Shift+C) to copy a ready-made prompt for your agent: paste it into the session and it walks the agent through reading, applying, and clearing your notes.

Then an agent (or you, in another terminal) pulls what you left:

```
$ mdnote comments notes.md --json
{
  "file": "notes.md",
  "annotations": [
    {
      "id": "3f1e2b7a-...",
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
$ mdnote clear notes.md --ids 3f1e2b7a-...
```

The browser page live-reloads on its own. Repeat until `mdnote comments` returns nothing open.

To have Claude Code run this loop itself when you say things like "I left notes", install the skill:

```
mkdir -p ~/.claude/skills/mdnote
ln -s "$(pwd)/SKILL.md" ~/.claude/skills/mdnote/SKILL.md
```

## Settings

An optional `~/.config/mdnote/settings.json` (honors `$XDG_CONFIG_HOME`) overrides the app defaults:

```json
{
  "theme": "light",
  "keybindings": {
    "copy-prompt": "mod+p",
    "toggle-theme": "mod+shift+t"
  }
}
```

- **`theme`** — `"dark"` (the default), `"light"`, or `"system"` (follow the OS preference).
- **`keybindings`** — action → shortcut, merged over the defaults; `null` unbinds a default. A spec is `mod`/`shift`/`alt` modifiers plus a key, joined by `+` (`mod` is ⌘ on Mac, Ctrl elsewhere). Actions: `copy-prompt` (default `mod+shift+c`), `annotate-block` (default `c`), `annotate-document` (default `shift+c`), `delete-annotation` (default `d`), and `copy-markdown` and `toggle-theme` (unbound by default).

An invalid entry warns in the server log (`~/.local/state/mdnote/server.log`, truncated each time the server starts) and falls back to the default for that key. Edits apply on page reload; no server restart needed.

## Remote use

The server binds `127.0.0.1:4820` by default. Reviewing a file on a VM or remote box is the same command with a bind flag:

```
mdnote notes.md --host 0.0.0.0 --port 7777
```

The bind flags take effect on a cold start, so `mdnote stop` first if a loopback server is already running. Open `http://<vm-ip>:7777/<absolute path to notes.md>` (the exact URL is printed) from anywhere that can reach the host. Nothing in the page assumes the browser and server share a machine; securing the port (firewall, tailscale, ssh tunnel) is up to you.

## CLI reference

- **`mdnote <file.md> [--host H] [--port P]`** — opens the file in the browser (loopback only) and exits, starting the background server first if none is running. Defaults to `127.0.0.1:4820`; the document lives at the file's absolute path on that port. `--host`/`--port` apply to a cold start; passing either with values that disagree with the running server is an error telling you to `mdnote stop` first.
- **`mdnote stop`** — stops the background server. It also stops itself after 5 minutes with no open tab, and the next `mdnote <file.md>` cold-starts it again.
- **`mdnote list`** — lists every file open on the running server with its URL; says so and exits 0 if no server is running. The list survives restarts and reboots: paths persist in the state dir, and a cold-started server re-lists the ones whose files still exist and that you've touched in the last two weeks.
- **`mdnote comments <file.md> [--json]`** — lists annotations. `--json` prints `{file, annotations}`; without it, a human-readable list.
- **`mdnote clear <file.md> [--ids ID[,ID...]]`** — clears the listed annotations by `--ids` (comma-separated), or all annotations if omitted.

## Annotation schema

Annotations persist to `<file>.mdnote.json` next to the reviewed file.

```ts
type AnnotationStatus = "open" | "stale";

interface Annotation {
  id: string;
  lineRange: [number, number] | null; // 1-based inclusive source lines; null for a doc-wide note
  anchorText: string | null;          // exact selected text; null for a doc-wide note
  note: string;
  createdAt: string;
  status: AnnotationStatus;
  block?: true;                       // set when the note targets a whole block, not a text span
}
```

## Live reload and staleness

The server watches both the source file and the sidecar. When the agent edits `notes.md`, the server re-renders it, re-anchors every annotation against the new source, and pushes the update to any open browser tab. An annotation whose anchor text still exists gets an updated `lineRange` and stays `open`; one whose anchor text is gone is marked `stale` instead of silently dropped, so you can re-check it rather than lose it.
