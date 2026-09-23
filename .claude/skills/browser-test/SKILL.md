---
name: browser-test
description: Verify mdnote changes end to end by driving the real UI in a browser. agent-browser (headless) first, Claude in Chrome as the fallback when agent-browser is not installed or its binary is killed on launch. Use whenever a change touches selection, popover, highlight, sidebar, SSE, or re-anchoring code and needs the manual poke CLAUDE.md asks for: open the page, drag-select text, annotate, edit the file, assert the result.
---

# Browser e2e testing for mdnote

Drives the real server + frontend with the `agent-browser` CLI (headless Chrome via CDP). Replaces the manual poke for selection/popover/highlight/SSE changes; `bun test` still covers everything else. Every recipe below was verified working.

**Pick the driver first.** Run `agent-browser --version`. If it prints a version, use sections 2–7. If it is not installed (`command not found`, exit 127) or the binary is killed on launch (exit 137, which is what Santa in Lockdown mode does), fall back to Claude in Chrome: section 1 for the server, then section 8 in place of 2–7.

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

The frontend bundles once at server startup: after editing `web/` TS, restart the server (`bun src/cli.ts stop`, then the start command again). `style.css` and `themes.css` are read per request, so CSS changes only need `agent-browser reload`.

The theme picker and reading-line toggle write through `PATCH /api/settings` into `$XDG_CONFIG_HOME/mdnote/settings.json` — another reason the config isolation above is mandatory: without it a test click rewrites the user's real settings.

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

Expected names: `mdnote-open-d0`..`d8` (one per nesting depth), `mdnote-stale`, `mdnote-pending`, `mdnote-draft`, `mdnote-focus`.

## 5. Test live edits / re-anchoring

Rewrite the file on disk and wait for SSE to repaint — no reload command needed:

```bash
printf '...new content...' > "$F"
agent-browser wait --text "some phrase unique to the new content"
cat "$F.mdnote.json"    # lineRange re-anchored, or status flipped to "stale"
```

Source-file changes push an `update` SSE event (full reload). Annotation CRUD through the API (a second client's POST, `mdnote clear` when a server is up) pushes a lighter `annotations` event — open tabs refetch annotations and the sidebar updates live, but the doc is not re-rendered. Only a direct sidecar write with no server (the CLI's fallback path) reaches tabs via the file watcher.

## 6. Test keybindings and remaps

Keys go through `agent-browser press`: `press c`, `press shift+d`, `press shift+?` (modifiers join with `+`). Three checks a keybinding change needs:

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

## 8. Fallback: Claude in Chrome

Same flow as sections 2–7, driven with the `mcp__claude-in-chrome__*` tools. Invoke the `claude-in-chrome` skill, then load the tools in one ToolSearch: `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `computer`, `javascript_tool`, `read_page`, `find`, `read_console_messages`, `browser_batch`. Put every predictable sequence in one `browser_batch`.

**This is the user's real Chrome.** Call `tabs_context_mcp`, then `tabs_create_mcp`, and work only in the tab id it returns. Never navigate, reuse, or close a tab you did not create. Never trigger a native `alert`/`confirm`/`prompt` (it blocks the extension); mdnote's delete and submit confirmations are in-page and safe. Close your tab with `tabs_close_mcp` when done.

**Open and reload:** start the server as in section 1, then `navigate` to `http://127.0.0.1:<port>$F`. Reload is `navigate` to the same URL.

**The tab is always hidden.** It lives in a parked offscreen window: `document.hidden` is true, `requestAnimationFrame` never fires by itself, and timers tick about once a second. A `computer` `screenshot` or `zoom` pumps a few frames (`scale: 0.1` keeps it cheap). Three rules follow:

- After every `navigate`, take a screenshot before the first click or drag. Until the page has painted, Chrome delivers `mousemove` but drops `mousedown`/`mouseup`, so the gesture silently does nothing.
- Effects lag: after a gesture, `computer` `wait` 1 before asserting highlights, popover, or sidebar.
- The annotation hover preview is rAF-sampled: `hover` on the word, `screenshot`, `wait` 2, then assert `.popover`. Leaving works the same way. `.hover-bar` and the `c` key need no screenshot (a plain `mousemove` sets the hovered block).

Do not call `resize_window`: it pumps no frames, and it changed the viewport-to-screenshot ratio for the next tab.

**Coordinates are screenshot pixels, not CSS px.** The viewport is emulated and the ratio varies (seen: 2064 CSS px wide with a 1456 px frame, and 1216 with 1331). Every screenshot result prints its frame (`1456x838`, or `coordinate frame: 1456x838` when scaled). Multiply CSS px by `frame width / innerWidth`.

`javascript_tool` returns the last expression (a top-level `return` and top-level `await` also work). Calls do not share `const`/`let` scope, so no IIFE is needed, but `window.*` survives until the next `navigate`. Define the helpers once per page load:

```js
window.SHOT_W = 1456;   // frame width from the latest screenshot result
window.mdPt = (sel, idx, offset) => {   // computer-tool point at a text offset inside the idx-th `sel` block
  const k = SHOT_W / innerWidth;
  const w = document.createTreeWalker(document.querySelectorAll(sel)[idx], NodeFilter.SHOW_TEXT);
  for (let n, pos = 0; (n = w.nextNode()); pos += n.length) {
    if (offset > pos + n.length) continue;
    const x = document.createRange(); x.setStart(n, offset - pos); x.setEnd(n, offset - pos);
    const r = x.getBoundingClientRect();
    return [Math.round(r.x * k), Math.round((r.y + r.height / 2) * k)];
  }
};
window.mdHl = () => {   // every painted highlight as [block tag, start, end, text], offsets within the block's text
  const off = (r) => {
    const b = r.startContainer.parentElement.closest('[data-source-line]');
    const pre = document.createRange(); pre.selectNodeContents(b); pre.setEnd(r.startContainer, r.startOffset);
    const s = pre.toString().length;
    return [b.tagName, s, s + r.toString().length, r.toString()];
  };
  return Object.fromEntries([...CSS.highlights].filter(([, h]) => h.size).map(([k, h]) => [k, [...h].map(off)]));
};
document.addEventListener('mousemove', (e) => (window.__at = [e.clientX, e.clientY]), true);
JSON.stringify({from: mdPt('#doc p', 0, 23), to: mdPt('#doc p', 0, 26)})   // offsets count the block's rendered text, across inline nodes
```

Self-check the ratio once: `hover` at `[700, 400]`, then `window.__at` must equal `[700, 400]` divided by the ratio (within 1 px).

**Drag-select:** `computer` `left_click_drag` with `start_coordinate: from`, `coordinate: to`. The page sees a trusted mousedown, three mousemoves, mouseup. Aiming at the exact glyph boundaries from `mdPt` selected a 3-character word every time; no inset needed. `getSelection()` is empty afterwards here too (the form takes focus and collapses it). After `wait` 1, `mdHl()` returns `{"mdnote-pending":[["P",23,26,"she"]]}`.

**Block gestures:** `left_click` at a point inside the block's text opens the form with `.block-pending`. Or `hover` there and `key` `c`.

**Annotate:** the textarea is focused once the form opens. Check `document.activeElement.tagName === 'TEXTAREA'` before `computer` `type`: if the gesture was dropped, every typed letter fires as a bare-key action instead. Save with `key` `cmd+Enter`, or `find` "Add button in the note popover" and `left_click` its `ref`. `read_page` with `filter: "interactive"` is the `snapshot -i` equivalent.

**Assert:** sidecar as in section 4. For highlights, `JSON.stringify(mdHl())`: saved notes are `mdnote-open-d0`..`d8` by nesting depth, a clicked one adds `mdnote-focus`. Screenshots do show highlights and block boxes; `zoom` with a `region` for a close look.

**Live edit:** rewrite the file as in section 5, `wait` 1, then read the block's `textContent` and `mdHl()`. Set `window.__mark = 1` before the edit and check it after to prove the tab updated without reloading. Clicks work right after an SSE repaint (only `navigate` needs the screenshot), but recompute coordinates.

**Keys:** `computer` `key` with `c`, `e`, `Escape`, `cmd+Enter`, `shift+?` (help is `.help-panel`), `shift+d` (opens the in-page delete confirmation; `key` `Enter` confirms).

**Console:** `read_console_messages` only records from its first call. Call it once (`pattern: "."`) right after the first `navigate`, reload, run the flow, then read again. `console.error('probe')` from `javascript_tool` confirms it is recording.

**Clean up:** `tabs_close_mcp` your tab, then stop the server and delete the scratch files as in section 7.
