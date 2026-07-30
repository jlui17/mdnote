---
name: mdnote
description: Review and apply annotations left on a Markdown file with mdnote (highlight-and-comment review for .md files). Trigger when the user says "I left notes", "check my annotations", "review my notes on <file>", asks you to look at feedback on a doc, or after you've pointed the user at a Markdown file for review.
---

# mdnote review loop

Annotations live in a sidecar next to the file (`<file>.mdnote.json`), created via a browser UI. You never open the browser; you only use the CLI.

## 1. Start review (skip if already running)

If the user hasn't already run it (ask if unclear), start the server:

```
mdnote review <file.md>
```

Run it backgrounded or in another terminal — it serves the page and opens the browser, and keeps running for live reload. Optional `--host`/`--port` if the user wants it bound elsewhere; default is fine for local use.

## 2. Pull annotations

```
mdnote comments <file.md> --json
```

Returns `{file, annotations}`. Each annotation:

- `lineRange`: `[start, end]`, 1-based inclusive source lines (`null` for a doc-wide note)
- `anchorText`: exact selected text (`null` for a doc-wide note)
- `note`: the instruction
- `status`: `open` | `stale`

Only act on `status: "open"`.

## 3. Apply each annotation

The `note` is a free-form instruction about the anchored span: "make this punchier" means revise it, "remove" means delete it, and so on. When `anchorText` is `null`, the note is doc-wide — apply it across the whole file.

Use `lineRange` to jump to the spot; confirm you have the right span by matching `anchorText` (lines may have shifted from earlier edits in this same pass — re-check rather than trusting stale line numbers).

## 4. Clear addressed annotations

```
mdnote clear <file.md> --id <id>
```

One call per annotation you addressed, or clear everything at once when done:

```
mdnote clear <file.md>
```

The page live-reloads on its own — you don't need to touch it.

## 5. Loop

Re-run `mdnote comments <file.md> --json`. Keep editing and clearing until it returns no `open` annotations.

**Stale annotations** (`status: "stale"`, anchor text no longer found after edits) are not yours to guess at — surface them to the user for a manual re-check instead of clearing or reinterpreting them.
