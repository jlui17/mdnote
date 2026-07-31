# mdnote — agent guide

What the tool is and how to use it: README.md. This file is what must stay true when you change the code.

## Map (runtime order)

- `src/cli.ts` — entry (`review` / `comments` / `clear`), lock-file server discovery. `review` dynamic-imports `server.ts` so `comments`/`clear` keep working even when the server is broken.
- `src/render.ts` — markdown-it with a rule stamping `data-source-line="start-end"` on block elements.
- `src/anchor.ts` — `locate()` matches rendered-text selections against Markdown source; `reanchor()` re-resolves annotations after edits. The load-bearing module: staleness is `locate()` returning null.
- `src/server.ts` — Bun.serve API + SSE + file watcher; bundles the frontend at startup.
- `src/store.ts` — sidecar JSON read/write (`<file>.mdnote.json`), atomic via temp-file + rename.
- `src/types.ts` — shared types. Import from here; never redeclare.
- `web/anchor-dom.ts` — framework-free DOM math (selection → `data-source-line` → line ranges, text-node search for highlight ranges). No Preact imports, by design.
- `web/main.tsx` — Preact chrome (sidebar, popover, SSE state) around the doc island.

## Invariants

- **The server owns source-position truth.** The browser sends rendered text and approximate lines; `locate()` normalizes them to source (stripping `**`/`_`/etc., treating whitespace runs as equal so selections cross soft-wrapped lines). Don't move anchoring into the client — rendered text and source text differ, and only the server has both.
- **The doc island's DOM stays byte-identical to the server's HTML.** Preact renders nothing inside `#doc` (filled via `dangerouslySetInnerHTML`, touched only through refs). Highlights use the CSS Custom Highlight API exclusively — no `<mark>` wrapping — so selection offsets and re-anchoring math never see a mutated DOM.
- **Set highlights by name, never `CSS.highlights.clear()`.** Four registered names (`mdnote-open`, `mdnote-stale`, `mdnote-pending`, `mdnote-focus`) are owned by three different effects; `clear()` wipes the whole registry and reintroduces a fixed bug (pending highlight vanishing on annotation repaint).
- **Line-number conventions differ by one.** `data-source-line` and `Annotation.lineRange` are 1-based inclusive; markdown-it's `token.map` is 0-based exclusive-end (`[s, e)` → `s+1`-`e`). This conversion is the repo's off-by-one hotspot; `tests/render.test.ts` pins it per block type.
- **Fences stamp `<pre>`, not `<code>`.** markdown-it's default fence renderer puts token attrs on `<code>`; `render.ts` overrides it so the innermost stamped ancestor is always the block element.
- **No localhost anywhere in the frontend.** Remote serving is first-class: all fetches are root-relative, SSE derives from `window.location`.
- **Every color literal lives in the `:root` token block of `style.css`.** Tokens carry both palettes via `light-dark()`; the theme toggle switches by setting `data-theme` on `<html>` (persisted to localStorage, applied pre-paint by an inline script in `index.html`), which flips `color-scheme`. `tests/style.test.ts` pins the no-literals rule for the CSS and the frontend TS — anything new that colors pixels (e.g. syntax highlighting) must go through tokens.
- **Stale annotations are never silently dropped.** `reanchor()` flips them to `status: "stale"` and keeps the old `lineRange`; only a human (or explicit `clear`) removes them.

## Hiccups

- **Frontend JS bundles once at server startup** (`Bun.build` on `web/main.tsx`). Restart `mdnote review` to see `web/` TS changes; `style.css` is read per request, so CSS changes only need a page reload.
- **The shebang on `src/cli.ts` is load-bearing.** `bun link` symlinks the bin straight to the file; without `#!/usr/bin/env bun` the shell executes it as a shell script.
- **The watcher is `fs.watch` on the parent directory, filtered by basename** (50ms debounce), not a per-file watch — editors and agents replace files by rename, which per-file watches lose track of.
- **The lock file (`<file>.mdnote.lock`) can be stale.** CLI discovery checks the recorded pid is alive and gives the API ~300ms before falling back to reading the sidecar directly; treat the sidecar as the source of truth, the API as an optimization.
- **JSX is Preact** via root tsconfig (`jsxImportSource: preact`), which `Bun.build` picks up. Don't add a per-file pragma or React types.

## Verifying changes

`bun test` (44 tests: render stamps, anchor matching, sidecar, style tokens) and `bunx tsc --noEmit` — both must be clean. Browser drag-selection has no automated coverage: any change to selection, popover, or highlight code needs a manual poke (`mdnote review README.md`, select text, annotate, edit the file, watch it re-anchor).
