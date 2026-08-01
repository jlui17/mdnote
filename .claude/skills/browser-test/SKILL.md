---
name: browser-test
description: Verify mdnote changes end to end by driving the real UI headlessly with agent-browser. Use whenever a change touches selection, popover, highlight, sidebar, SSE, or re-anchoring code and needs the manual poke CLAUDE.md asks for — open the page, drag-select text, annotate, edit the file, assert the result.
---

# Browser e2e testing for mdnote

Drives the real server + frontend with the `agent-browser` CLI (headless Chrome via CDP). Replaces the manual poke for selection/popover/highlight/SSE changes; `bun test` still covers everything else. Every recipe below was verified working.

## 1. Start a server (no browser popup)

`mdnote <file.md>` spawns `open` when host is `127.0.0.1`, which pops the user's real browser. Pass `--host 0.0.0.0` to skip that; still connect via 127.0.0.1.

Always test on a scratch copy, never a repo file (annotating writes `<file>.mdnote.json` next to it):

```bash
F=$SCRATCHPAD/test.md   # write known content here first
export XDG_STATE_HOME=$SCRATCHPAD/state    # your own lock, so you don't attach to (or stop) the user's server
export XDG_CONFIG_HOME=$SCRATCHPAD/config  # your own settings.json — the user's real remaps would change what every key recipe here does
bun src/cli.ts "$F" --host 0.0.0.0 --port 4477   # detaches and exits once the server answers
```

The document URL is `http://127.0.0.1:4477/<absolute path to $F>` (the CLI prints it; `/` 302-redirects there). Always pass an explicit `--port` — the default is 4820 and a user's real server may hold it. Re-run both `export`s in every Bash call that talks to your server; `XDG_CONFIG_HOME` in particular must be set when the server is *spawned*, because `loadConfig()` runs in the server process.

The frontend bundles once at server startup: after editing `web/` TS, restart the server (`bun src/cli.ts stop`, then the start command again). `style.css` is read per request, so CSS changes only need `agent-browser reload`.

## 2. One browser session per worktree

```bash
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix mdnote)"
agent-browser open "http://127.0.0.1:4477$F"   # the document URL printed by review
agent-browser snapshot -i
```

Shell env does not persist between tool calls: re-run the `export` at the top of every Bash invocation. Parallel agents in one worktree must not share a session or port — pick a unique `--prefix` (and server port) per agent.

`snapshot -i` prints interactive elements with `@eN` refs. Refs go stale on any page change (popover open, SSE repaint) — re-snapshot before each ref interaction. Full CLI patterns: `agent-browser skills get core`.

Two `eval` gotchas:

- Separate `eval --stdin` calls share one JS scope: a repeated top-level `const` throws "already been declared". Wrap every script in an IIFE — `(() => { ...; return JSON.stringify(...) })()`.
- `mouse move` rejects float coordinates with a misleading `Missing arguments for: mouse move` (and the script keeps going with the mouse at its old position, so the next click hits the wrong target). Always `Math.round()` coordinates in the eval.

## 3. Drag-select text (the mdnote-specific part)

The annotation popover only appears on a document `mouseup` that leaves a live selection (`web/main.tsx`), so a programmatic `getSelection()` alone does nothing. Do a real drag: compute the phrase's screen coordinates with eval, then drive the mouse.

```bash
cat <<'EOF' | agent-browser eval --stdin
(() => {
  const el = document.querySelector('#doc p');          // any block element
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node; while ((node = walker.nextNode()) && !node.textContent.includes('quick'));
  const t = node.textContent, s = t.indexOf('quick'), e = t.indexOf('fox') + 3;
  const r = (i) => { const x = document.createRange(); x.setStart(node, i); x.setEnd(node, i); return x.getBoundingClientRect(); };
  const a = r(s), b = r(e);
  const m = (v) => Math.round(v);
  return JSON.stringify({x1: m(a.x), y1: m(a.y + a.height/2), x2: m(b.x), y2: m(b.y + b.height/2)});
})()
EOF

agent-browser mouse move <x1> <y1>
agent-browser mouse down left
agent-browser mouse move <x2> <y2>
agent-browser mouse up left
agent-browser snapshot -i    # popover is now in the tree: textbox "Note…", button "Add ⌘↩"
```

The walker loop matters: the first text node of a list or blockquote is often whitespace, and `setStart` on the wrong node throws `IndexSizeError`. One intermediate `mouse move` between down and up is enough to register as a drag. Don't assert on `window.getSelection()` after mouseup — it reads empty under CDP even when the selection took; trust `CSS.highlights` and screenshots instead.

For a cross-block selection, compute the two rects from different elements; the drag works the same. If the target is below the fold, `agent-browser scroll down` first — the rects are viewport coordinates.

**Block annotations** (whole-block, no drag): a plain click on a stamped block — `mouse move` + `mouse down left` + `mouse up left` at one point, coordinates from the block's rect center — opens the popover with a `.block-pending` overlay div instead of a text highlight; so does hovering the block and `agent-browser press c`. Hovering alone renders a `.hover-bar` element at the block's left edge; all three are plain DOM, assertable via eval rects. Pitfall: an open popover overlays neighboring blocks — before clicking "another block" to dismiss, check the click point isn't inside `.popover`'s rect, or the popover eats the click.

Then annotate:

```bash
agent-browser fill @eN "note text"     # the "Note…" textbox ref
agent-browser click @eM                # "Add ⌘↩" (disabled until text is typed)
agent-browser wait --text "note text"  # sidebar card appeared
```

`fill` on the popover textbox sometimes dismisses the popover without typing. If the submit button stays disabled or the popover vanished, fall back to `click @eN` + `agent-browser keyboard type "note text"`, and eval-check the textarea's `.value` before submitting.

## 4. Assert results

Three layers, use whichever the change touches:

- **Sidecar (source of truth):** `cat "$F.mdnote.json"` — check `anchorText`, `lineRange`, `status`.
- **Sidebar/DOM:** `agent-browser snapshot -i`, or eval reading the element's `outerHTML`. The line-range caption uses an en-dash ("lines 3–3"), so hyphen text matches fail. If `wait --text` times out, re-snapshot before concluding anything — the state is often already correct and `wait` just missed it.
- **Highlights:** invisible to snapshots (CSS Custom Highlight API, no DOM change). Assert via eval, and screenshot for the actual pixels:

```bash
echo 'JSON.stringify([...CSS.highlights.keys()].map(k => [k, CSS.highlights.get(k).size]))' | agent-browser eval --stdin
agent-browser screenshot out.png    # then Read the png
```

Expected names: `mdnote-open`, `mdnote-stale`, `mdnote-pending`, `mdnote-focus`.

## 5. Test live edits / re-anchoring

Rewrite the file on disk and wait for SSE to repaint — no reload command needed:

```bash
printf '...new content...' > "$F"
agent-browser wait --text "some phrase unique to the new content"
cat "$F.mdnote.json"    # lineRange re-anchored, or status flipped to "stale"
```

Only source-file changes push SSE. Annotation CRUD through the API or CLI (`mdnote clear`, a second client's POST) writes the sidecar without repainting open tabs — `agent-browser reload` before asserting the sidebar after those.

## 6. Test keybindings and remaps

Keys go through `agent-browser press`: `press c`, `press d`, `press shift+?` (modifiers join with `+`). Three checks a keybinding change needs:

- **Remaps flow from settings.json.** Write a scratch config (the shape is action id → spec string, `null` unbinds; ids are the `ActionId`s in `src/actions.ts`) before starting the server — section 1's `XDG_CONFIG_HOME` export is what makes this safe and deterministic:

```bash
mkdir -p $SCRATCHPAD/config/mdnote
echo '{"keybindings": {"annotate-block": "x", "edit-annotation": "w"}}' > $SCRATCHPAD/config/mdnote/settings.json
# after starting the server and opening the page, confirm the config landed before trusting any keypress:
echo 'JSON.stringify(window.__MDNOTE_CONFIG__.keybindings)' | agent-browser eval --stdin
```

  Then assert all three directions: the remapped key fires the action, the old default is inert, and the help dialog (`press shift+?`) shows the remapped chips — its rows render from the resolved config, so a default chip there means the config never reached the page.

- **The typing guard.** With a note textarea focused, unmodified keys must type, not fire actions (`web/actions.tsx` skips them while typing): `press ?` into a focused textarea inserts a character and does not open the help dialog. Exercise this negative case whenever a change touches key dispatch.

- **Default bindings** are only trustworthy because of the config isolation above; without it, the user's real remaps silently change what `press c`/`press e` do.

## 7. Debug and clean up

`agent-browser console` and `agent-browser errors` surface frontend exceptions; `agent-browser --headed open ...` shows the window when a flow misbehaves.

One silent failure mode: a headless tab can flip `document.hidden` to true (a `reload` or a `console`/`errors` call can background it), which freezes `requestAnimationFrame` — and the frontend samples hover on rAF, so `mouse move` keeps succeeding while the app sees nothing. If hover checks stop firing for no visible reason, eval `document.hidden`; if it's true, `agent-browser close` and re-`open` (annotations live in the sidecar server-side, so nothing is lost).

When done:

```bash
agent-browser close
XDG_STATE_HOME=$SCRATCHPAD/state bun src/cli.ts stop
rm -f "$F" "$F.mdnote.json"
```
