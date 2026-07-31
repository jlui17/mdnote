# Multi-file mdnote: one global server, path-as-URL

Design (signed off): one mdnote server per machine, found-or-started by `mdnote <file.md>`
(the bare-path invocation; the `review` subcommand is gone).
The URL is the file's absolute path on a fixed default port (4820), so links are
permanent across restarts. The server runs detached, idle-exits after 5 minutes with
zero SSE clients, and logs to `~/.local/state/mdnote/server.log` (truncated on start).
A single global lock (`~/.local/state/mdnote/server.json`: host, port, pid) replaces
per-file `.mdnote.lock` files. Unregistered paths auto-register on request — uniformly,
no host-dependent behavior — but only `.md`/`.markdown` files, enforced identically at
`/open` and auto-register. Sidecars remain the source of truth for annotations.

Explicitly not doing: in-page file switcher, session ids, per-file locks,
host-split auto-register behavior.

Work the frontier: any ticket whose blockers are all done.

---

## 01 — Path-as-URL on a single server (prefactor)

**What to build:** `mdnote foo.md` serves the document at
`http://127.0.0.1:4820/<absolute-path>` (fixed default port, `--port` still wins).
The HTTP API moves under a reserved `/api/` prefix and names the file per request;
the frontend derives which file it shows from `location.pathname` instead of assuming
a single implicit document. Still one file per process — this slice only changes
addressing, making every later slice easy.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `mdnote <file>` prints and opens a URL whose path is the file's absolute path, port 4820 by default
- [x] All API routes live under `/api/` and carry the file identity per request
- [x] Frontend fetches stay root-relative and derive the document from `location.pathname` (no localhost, per invariants)
- [x] Today's full flow works at the new URL: annotate, edit the file, re-anchor, stale marking (browser-test skill)
- [x] `bun test` and `bunx tsc --noEmit` clean

## 02 — Multi-file registry, `/open`, auto-register

**What to build:** the server holds a registry of open files (path → watcher + SSE
clients); `POST /api/open` registers a file; a GET for an unregistered path
auto-registers it when the file exists and ends in `.md`/`.markdown`, else 404s.
The extension check is one shared predicate so `/open` and auto-register can't drift.
Watchers are lazy (created when a tab connects) and shared per directory. SSE updates
are scoped per file — a tab only hears about its own document.

**Blocked by:** 01.

**Status:** done

- [x] Two files served by one server: start on one, paste the second file's URL, both render
- [x] Annotating in each tab writes the correct sidecar; editing one file updates only its tab
- [x] Unregistered existing `.md` auto-registers on GET; non-markdown or missing paths 404 at both `/open` and direct GET
- [x] Files in the same directory share one directory watcher
- [x] `bun test`, `bunx tsc --noEmit`, and a two-file browser-test pass

## 03 — Find-or-attach CLI: global lock, detach, `stop`

**What to build:** the first `mdnote <file.md>` spawns the server detached and exits
immediately; later invocations find the live server via a single global lock in the
state dir (pid-liveness checked, same test as today), POST `/open`, print/open the
URL, and exit. Bare invocations attach to whatever runs; an explicit `--host` or
`--port` that mismatches the live server dies with a "stop first" message.
`mdnote stop` kills the server and removes the lock. Per-file `.mdnote.lock` files
are gone; `comments` and `clear` discover via the global lock and talk to the host
recorded in it (not hardcoded loopback), with the sidecar fallback unchanged.

**Blocked by:** 02.

**Status:** done

- [x] Two `mdnote <file>` invocations from two terminals yield one server; both commands exit immediately
- [x] Explicit `--host`/`--port` mismatch with the live server errors and names `mdnote stop`
- [x] `mdnote stop` terminates the server and cleans the lock; stale lock (dead pid) is treated as no server
- [x] No `.mdnote.lock` file is ever written; `comments`/`clear` work against the live server and fall back to the sidecar when none runs
- [x] `bun test` and `bunx tsc --noEmit` clean

## 04 — Idle shutdown and server log

**What to build:** the detached server exits on its own after 5 minutes with zero
SSE clients across all files (any client connecting resets the clock), cleaning up
its lock on the way out. Its stdout/stderr go to a log file in the state dir,
truncated on each start, so bundle or watcher failures are diagnosable without a
terminal.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Server with no connected tabs exits within ~5 minutes and removes the lock; an open tab keeps it alive indefinitely
- [ ] Startup warnings (e.g. bundle failure) appear in the state-dir log; the log truncates on restart
- [ ] A `mdnote <file>` after idle-exit cold-starts cleanly and the old document URL still works (auto-register)
- [ ] `bun test` and `bunx tsc --noEmit` clean

## 05 — `/` index and `mdnote list`

**What to build:** the root URL renders a minimal index — registered files as links,
nothing else — and `mdnote list` prints the same set with URLs from the CLI,
reporting plainly when no server is running.

**Blocked by:** 03.

**Status:** done

- [x] With two files open, `/` shows both as clickable links to their document URLs
- [x] `mdnote list` prints file paths with URLs; with no live server it says so and exits 0
- [x] Index colors go through the `:root` token block (style test stays green)
- [x] `bun test` and `bunx tsc --noEmit` clean

## 06 — Registry persistence with age-out

**What to build:** registered paths persist in the state dir; on cold start the
server re-registers entries whose files still exist, so `/` and `mdnote list`
reflect the working set across idle-exits and reboots. Entries untouched for ~2
weeks age out. Persisting a path does not create a watcher — watchers stay lazy
until a tab connects.

**Blocked by:** 02 (lands naturally after 04).

**Status:** ready-for-agent

- [ ] `mdnote stop`, restart via `mdnote <file>` on one file: previously open files reappear in `/` and `mdnote list`
- [ ] Entries whose files no longer exist are dropped on load; entries untouched past the age-out window disappear
- [ ] Cold start with a persisted registry creates no watchers until a tab connects
- [ ] `bun test` and `bunx tsc --noEmit` clean
