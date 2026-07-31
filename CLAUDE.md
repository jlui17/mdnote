# mdnote — agent guide

What the tool is and how to use it: README.md. This file is what must stay true when you change the code.

## Map (runtime order)

- `src/cli.ts` — entry (`mdnote <file.md>` / `comments` / `clear` / `stop`; any non-subcommand argv is a review invocation), find-or-attach: it POSTs `/api/open` to the server named by the global lock, or spawns itself detached with the internal `--serve` flag, stdout/stderr pointed at the state-dir log (the serve process is the only one that runs `startServer`, writes the lock, and cleans it up). Review dynamic-imports `server.ts` so `comments`/`clear` keep working even when the server is broken.
- `src/lock.ts` — the state dir (`~/.local/state/mdnote`, `$XDG_STATE_HOME` honored) and what lives in it: the global lock `server.json` (`{host, port, pid}` read/write plus pid-liveness) and `logPath()` for `server.log`.
- `src/config.ts` — reads `~/.config/mdnote/settings.json` (`$XDG_CONFIG_HOME` honored), validates warn-and-drop per key, merges over defaults into a `ResolvedConfig`.
- `src/actions.ts` — pure action catalog (`ActionId`s, labels, default keybindings) and keybinding spec parsing; shared by `config.ts` and the frontend.
- `src/render.ts` — markdown-it with a rule stamping `data-source-line="start-end"` on block elements.
- `src/anchor.ts` — `locate()` matches rendered-text selections against Markdown source; `reanchor()` re-resolves annotations after edits. The load-bearing module: staleness is `locate()` returning null.
- `src/server.ts` — Bun.serve API + SSE + file watchers over a registry of open files (path → SSE clients); bundles the frontend at startup, runs the idle clock.
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
- **Every color literal lives in the `:root` token block of `style.css`.** Tokens carry both palettes via `light-dark()`; theme is set via `data-theme` on `<html>` (from settings.json, applied pre-paint by an inline script in `index.html`; the toggle changes it session-only), which flips `color-scheme`. `tests/style.test.ts` pins the no-literals rule for the CSS and the frontend TS — anything new that colors pixels (e.g. syntax highlighting) must go through tokens.
- **The server owns settings truth.** `loadConfig()` merges settings.json over defaults and the server injects the resolved result into `index.html` as `window.__MDNOTE_CONFIG__` per request (page reload applies edits). The frontend never merges or persists settings — localStorage is gone; the theme toggle is session-only.
- **What may be served is one predicate.** `isMarkdownPath()` plus an existence check gates both `POST /api/open` and document-GET auto-registration; both 404 identically. `/api/*?file=` serves only registered files — auto-registration happens on document GETs alone.
- **Stale annotations are never silently dropped.** `reanchor()` flips them to `status: "stale"` and keeps the old `lineRange`; only a human (or explicit `clear`) removes them.

## Hiccups

- **Frontend JS bundles once at server startup** (`Bun.build` on `web/main.tsx`). Restart the server (`mdnote <file.md>`) to see `web/` TS changes; `style.css` is read per request, so CSS changes only need a page reload.
- **The shebang on `src/cli.ts` is load-bearing.** `bun link` symlinks the bin straight to the file; without `#!/usr/bin/env bun` the shell executes it as a shell script.
- **Watchers are `fs.watch` on the parent directory, filtered by basename** (50ms debounce per file), not per-file watches — editors and agents replace files by rename, which per-file watches lose track of. One watcher per directory serves every registered file in it, created lazily when that file's first SSE client connects.
- **The global lock can be stale.** A lock whose pid is dead counts as no server everywhere (cold start, `stop`, `comments`/`clear`). `comments`/`clear` give the API ~300ms and fall back to reading the sidecar directly on a dead lock, a timeout, or a non-2xx (the server 404s files it hasn't registered); treat the sidecar as the source of truth, the API as an optimization.
- **Only SSE clients hold the server open.** The idle clock (5 min, `MDNOTE_IDLE_TIMEOUT_MS` overrides it for tests) runs whenever the total client count across every registered file is zero, starting at boot, so a server nobody opens a tab on dies on its own; `onIdle` (the serve process passes `process.exit(0)`) is what makes the clock exist at all, so a `startServer` call without it never times out. A registration via `/api/open` isn't a client and doesn't stop the clock.
- **The detached server's stdout/stderr go to `server.log` in the state dir**, truncated per cold start by the spawning CLI (it opens the fd with `"w"`), so bundle and watcher warnings are diagnosable after the fact.
- **The lock appearing is the cold-start readiness signal.** The serve process writes it only after `Bun.serve` is listening, so the spawning CLI polls for the lock file rather than the port.
- **JSX is Preact** via root tsconfig (`jsxImportSource: preact`), which `Bun.build` picks up. Don't add a per-file pragma or React types.

## Verifying changes

`bun test` (75 tests: render stamps, anchor matching, sidecar, style tokens, server registry/SSE scoping, idle shutdown, lock liveness) and `bunx tsc --noEmit` — both must be clean. Browser drag-selection has no automated coverage: any change to selection, popover, or highlight code needs a browser poke — use the `browser-test` skill (drives the real UI headlessly with agent-browser: drag-select, annotate, edit the file, assert sidecar/highlights).
