---
name: browser-test
description: Verify mdnote changes end to end by driving the real UI headlessly with agent-browser. Use whenever a change touches selection, popover, highlight, sidebar, SSE, or re-anchoring code and needs the manual poke CLAUDE.md asks for — open the page, drag-select text, annotate, edit the file, assert the result.
---

# Browser e2e testing for mdnote

Drives the real server + frontend with the `agent-browser` CLI (headless Chrome via CDP). Replaces the manual poke for selection/popover/highlight/SSE changes; `bun test` still covers everything else. Every recipe below was verified working.

## 1. Start a server (no browser popup)

`mdnote review` spawns `open` when host is `127.0.0.1`, which pops the user's real browser. Pass `--host 0.0.0.0` to skip that; still connect via 127.0.0.1.

Always test on a scratch copy, never a repo file (annotating writes `<file>.mdnote.json` and `.mdnote.lock` next to it):

```bash
F=$SCRATCHPAD/test.md   # write known content here first
bun src/cli.ts review "$F" --host 0.0.0.0 --port 4477   # run_in_background
for i in $(seq 1 20); do curl -sf http://127.0.0.1:4477/ -o /dev/null && break; sleep 0.3; done
```

The document URL is `http://127.0.0.1:4477/<absolute path to $F>` (`review` prints it; `/` 302-redirects there). Always pass an explicit `--port` — the default is 4820 and a user's real server may hold it.

The frontend bundles once at server startup: after editing `web/` TS, restart the server. `style.css` is read per request, so CSS changes only need `agent-browser reload`.

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
agent-browser snapshot -i    # popover is now in the tree: textbox "Note…", button "Add note ⌘↩"
```

The walker loop matters: the first text node of a list or blockquote is often whitespace, and `setStart` on the wrong node throws `IndexSizeError`. One intermediate `mouse move` between down and up is enough to register as a drag. Don't assert on `window.getSelection()` after mouseup — it reads empty under CDP even when the selection took; trust `CSS.highlights` and screenshots instead.

For a cross-block selection, compute the two rects from different elements; the drag works the same. If the target is below the fold, `agent-browser scroll down` first — the rects are viewport coordinates.

**Block annotations** (whole-block, no drag): a plain click on a stamped block — `mouse move` + `mouse down left` + `mouse up left` at one point, coordinates from the block's rect center — opens the popover with a `.block-pending` overlay div instead of a text highlight; so does hovering the block and `agent-browser press c`. Hovering alone renders a `.hover-bar` element at the block's left edge; all three are plain DOM, assertable via eval rects. Pitfall: an open popover overlays neighboring blocks — before clicking "another block" to dismiss, check the click point isn't inside `.popover`'s rect, or the popover eats the click.

Then annotate:

```bash
agent-browser fill @eN "note text"     # the "Note…" textbox ref
agent-browser click @eM                # "Add note ⌘↩" (disabled until text is typed)
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

## 6. Debug and clean up

`agent-browser console` and `agent-browser errors` surface frontend exceptions; `agent-browser --headed open ...` shows the window when a flow misbehaves. When done:

```bash
agent-browser close
kill <server pid>       # removes the .mdnote.lock via the CLI's exit handler
rm -f "$F" "$F.mdnote.json"
```
