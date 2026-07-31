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

The frontend bundles once at server startup: after editing `web/` TS, restart the server. `style.css` is read per request, so CSS changes only need `agent-browser reload`.

## 2. One browser session per worktree

```bash
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix mdnote)"
agent-browser open http://127.0.0.1:4477
agent-browser snapshot -i
```

`snapshot -i` prints interactive elements with `@eN` refs. Refs go stale on any page change (popover open, SSE repaint) — re-snapshot before each ref interaction. Full CLI patterns: `agent-browser skills get core`.

## 3. Drag-select text (the mdnote-specific part)

The annotation popover only appears on a document `mouseup` that leaves a live selection (`web/main.tsx`), so a programmatic `getSelection()` alone does nothing. Do a real drag: compute the phrase's screen coordinates with eval, then drive the mouse.

```bash
cat <<'EOF' | agent-browser eval --stdin
const el = document.querySelector('#doc p');          // any block element
const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
const t = node.textContent, s = t.indexOf('quick'), e = t.indexOf('fox') + 3;
const r = (i) => { const x = document.createRange(); x.setStart(node, i); x.setEnd(node, i); return x.getBoundingClientRect(); };
const a = r(s), b = r(e);
JSON.stringify({x1: a.x, y1: a.y + a.height/2, x2: b.x, y2: b.y + b.height/2})
EOF

agent-browser mouse move <x1> <y1>
agent-browser mouse down left
agent-browser mouse move <x2> <y2>
agent-browser mouse up left
agent-browser snapshot -i    # popover is now in the tree: textbox "Note…", button "Add note ⌘↩"
```

For a cross-block selection, compute the two rects from different elements; the drag works the same. If the target is below the fold, `agent-browser scroll down` first — the rects are viewport coordinates.

Then annotate:

```bash
agent-browser fill @eN "note text"     # the "Note…" textbox ref
agent-browser click @eM                # "Add note ⌘↩" (disabled until text is typed)
agent-browser wait --text "note text"  # sidebar card appeared
```

## 4. Assert results

Three layers, use whichever the change touches:

- **Sidecar (source of truth):** `cat "$F.mdnote.json"` — check `anchorText`, `lineRange`, `status`.
- **Sidebar/DOM:** `agent-browser snapshot -i`, or `agent-browser find text "lines" text` to read the line-range caption.
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

## 6. Debug and clean up

`agent-browser console` and `agent-browser errors` surface frontend exceptions; `agent-browser --headed open ...` shows the window when a flow misbehaves. When done:

```bash
agent-browser close
kill <server pid>       # removes the .mdnote.lock via the CLI's exit handler
rm -f "$F" "$F.mdnote.json"
```
