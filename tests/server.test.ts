import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMarkdownPath, pathToUrl, startServer } from "../src/server.ts";
import type { Annotation } from "../src/types.ts";

let dir: string;
let file: string;
let server: Awaited<ReturnType<typeof startServer>>;
let base: string;
let stateHome: string;
let prevStateHome: string | undefined;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mdnote-server-"));
  stateHome = mkdtempSync(join(tmpdir(), "mdnote-state-"));
  prevStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
  file = join(dir, "doc with space.md");
  writeFileSync(file, "# Hello\n\nworld\n");
  server = await startServer({ file, host: "127.0.0.1", port: 0 });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.stop();
  if (prevStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevStateHome;
  rmSync(dir, { recursive: true, force: true });
  rmSync(stateHome, { recursive: true, force: true });
});

describe("path-as-URL addressing", () => {
  test("server url is the file's absolute path", () => {
    expect(server.url).toBe(base + pathToUrl(file));
  });

  test("GET the file's path serves the app page", async () => {
    const res = await fetch(base + pathToUrl(file));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("__MDNOTE_CONFIG__");
  });

  test("GET / renders an index linking to the file's path", async () => {
    const res = await fetch(base + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain(`href="${pathToUrl(file)}"`);
  });

  test("GET an unknown path 404s", async () => {
    const res = await fetch(base + "/some/other/file.md");
    expect(res.status).toBe(404);
  });
});

describe("images under a registered doc's directory", () => {
  test("GET an image in the doc's subdirectory serves it with its type", async () => {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "diagram.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
    const res = await fetch(base + pathToUrl(join(dir, "assets", "diagram.svg")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });

  test("GET an image outside every registered doc's directory 404s", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mdnote-outside-"));
    writeFileSync(join(outside, "leak.svg"), "<svg/>");
    const res = await fetch(base + pathToUrl(join(outside, "leak.svg")));
    expect(res.status).toBe(404);
    rmSync(outside, { recursive: true, force: true });
  });

  test("GET a missing image under the doc's directory 404s", async () => {
    const res = await fetch(base + pathToUrl(join(dir, "assets", "missing.png")));
    expect(res.status).toBe(404);
  });

  test("GET an image-named symlink pointing outside the doc's directory 404s", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mdnote-secret-"));
    writeFileSync(join(outside, "secret.txt"), "private key material");
    symlinkSync(join(outside, "secret.txt"), join(dir, "evil.png"));
    const res = await fetch(base + pathToUrl(join(dir, "evil.png")));
    expect(res.status).toBe(404);
    rmSync(outside, { recursive: true, force: true });
  });

  test("GET a symlink resolving inside the doc's directory still serves", async () => {
    symlinkSync(join(dir, "assets", "diagram.svg"), join(dir, "alias.svg"));
    const res = await fetch(base + pathToUrl(join(dir, "alias.svg")));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
  });
});

describe("/api routes carry file identity", () => {
  test("doc responds for the served file", async () => {
    const res = await fetch(`${base}/api/doc?file=${encodeURIComponent(file)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; html: string };
    expect(body.path).toBe(file);
    expect(body.html).toContain("Hello");
  });

  test("missing or mismatched file param 404s", async () => {
    expect((await fetch(`${base}/api/doc`)).status).toBe(404);
    const other = encodeURIComponent(join(dir, "other.md"));
    expect((await fetch(`${base}/api/doc?file=${other}`)).status).toBe(404);
  });

  test("annotations round-trip through /api", async () => {
    const q = `?file=${encodeURIComponent(file)}`;
    const created = await fetch(`${base}/api/annotations${q}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineRange: [1, 1], anchorText: "Hello", note: "hi" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const list = await fetch(`${base}/api/annotations${q}`);
    const { annotations } = (await list.json()) as { annotations: { id: string }[] };
    expect(annotations.map((a) => a.id)).toContain(id);

    expect((await fetch(`${base}/api/annotations/${id}${q}`, { method: "DELETE" })).status).toBe(204);
  });

  test("POST carries the block marker through, and omits it otherwise", async () => {
    const q = `?file=${encodeURIComponent(file)}`;
    const post = (body: unknown) =>
      fetch(`${base}/api/annotations${q}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json() as Promise<Annotation>);

    const blocky = await post({ lineRange: [1, 1], anchorText: "Hello", note: "hi", block: true });
    const texty = await post({ lineRange: [1, 1], anchorText: "Hello", note: "hi" });
    expect(blocky.block).toBe(true);
    expect("block" in texty).toBe(false);

    for (const a of [blocky, texty])
      await fetch(`${base}/api/annotations/${a.id}${q}`, { method: "DELETE" });
  });

  test("POST carries the draft flag through and PATCH draft:false promotes", async () => {
    const q = `?file=${encodeURIComponent(file)}`;
    const created = await fetch(`${base}/api/annotations${q}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineRange: [1, 1], anchorText: "Hello", note: "", draft: true }),
    }).then((r) => r.json() as Promise<Annotation>);
    expect(created.draft).toBe(true);

    const promoted = await fetch(`${base}/api/annotations/${created.id}${q}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "done", draft: false }),
    }).then((r) => r.json() as Promise<Annotation>);
    expect(promoted.note).toBe("done");
    expect("draft" in promoted).toBe(false);

    await fetch(`${base}/api/annotations/${created.id}${q}`, { method: "DELETE" });
  });
});

describe("markdown predicate", () => {
  test("accepts .md and .markdown, case-insensitively", () => {
    expect(isMarkdownPath("/a/b.md")).toBe(true);
    expect(isMarkdownPath("/a/b.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("/a/b.txt")).toBe(false);
    expect(isMarkdownPath("/a/b")).toBe(false);
  });
});

describe("registry, /open and auto-register", () => {
  test("an existing .md auto-registers on GET and its api routes work", async () => {
    const second = join(dir, "second.md");
    writeFileSync(second, "# Second\n");
    const q = `?file=${encodeURIComponent(second)}`;

    expect((await fetch(`${base}/api/doc${q}`)).status).toBe(404);
    expect((await fetch(base + pathToUrl(second))).status).toBe(200);

    const res = await fetch(`${base}/api/doc${q}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { html: string }).html).toContain("Second");
  });

  test("POST /api/open registers a file named in the body", async () => {
    const third = join(dir, "third.md");
    writeFileSync(third, "# Third\n");
    const q = `?file=${encodeURIComponent(third)}`;

    expect((await fetch(`${base}/api/doc${q}`)).status).toBe(404);
    const opened = await fetch(`${base}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: third }),
    });
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ file: third, url: pathToUrl(third) });
    expect((await fetch(`${base}/api/doc${q}`)).status).toBe(200);
  });

  test("non-markdown and missing paths 404 at /open and on GET", async () => {
    const notMd = join(dir, "notes.txt");
    writeFileSync(notMd, "hello\n");
    const missing = join(dir, "missing.md");

    for (const target of [notMd, missing]) {
      expect((await fetch(base + pathToUrl(target))).status).toBe(404);
      const res = await fetch(`${base}/api/open?file=${encodeURIComponent(target)}`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
    }
  });
});

describe("index and /api/files", () => {
  test("GET / lists every registered file as a link", async () => {
    const second = join(dir, "listed.md");
    writeFileSync(second, "# Listed\n");
    await fetch(base + pathToUrl(second));

    const html = await (await fetch(base + "/")).text();
    expect(html).toContain(`href="${pathToUrl(file)}"`);
    expect(html).toContain(`href="${pathToUrl(second)}"`);

    const linked = await fetch(base + pathToUrl(second));
    expect(linked.status).toBe(200);
  });

  test("GET /api/files returns the registered files", async () => {
    const res = await fetch(`${base}/api/files`);
    expect(res.status).toBe(200);
    const { files } = (await res.json()) as { files: { path: string; url: string }[] };
    expect(files.map((f) => f.path)).toContain(file);
  });
});

describe("watchers and SSE scoping", () => {
  let other: string;

  /** Connect an SSE client for `target`, edit `file`, and report whether the client heard about it. */
  async function pokeWhileWatching(target: string, edit: string): Promise<string | null> {
    const res = await fetch(`${base}/api/events?file=${encodeURIComponent(target)}`);
    const reader = res.body!.getReader();
    await reader.read();
    const update = reader.read().then(({ value }) => new TextDecoder().decode(value));
    await Bun.sleep(30);
    writeFileSync(file, edit);
    try {
      return await Promise.race([update, Bun.sleep(600).then(() => null)]);
    } finally {
      await reader.cancel();
    }
  }

  beforeAll(async () => {
    other = join(dir, "scoped.md");
    writeFileSync(other, "# Scoped\n");
    await fetch(base + pathToUrl(other));
  });

  test("a client hears about its own file's change", async () => {
    expect(await pokeWhileWatching(file, "# Hello\n\nworld edited\n")).toContain("event: update");
  });

  test("a client hears nothing about another file's change", async () => {
    expect(await pokeWhileWatching(other, "# Hello\n\nworld edited again\n")).toBeNull();
  });

  test("files in one directory share a single directory watcher", () => {
    expect(server.watchedDirs()).toEqual([dir]);
  });
});

describe("rename-style writes and mutation broadcast", () => {
  /** Connect an SSE client for `file`, run `act`, and report whether `event` arrived. */
  async function updateAfter(
    act: () => void | Promise<void>,
    event = "update",
  ): Promise<boolean> {
    const res = await fetch(`${base}/api/events?file=${encodeURIComponent(file)}`);
    const reader = res.body!.getReader();
    await reader.read();
    await Bun.sleep(30);
    await act();
    const decoder = new TextDecoder();
    const deadline = Bun.sleep(600).then(() => null);
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (chunk === null || chunk.done) return false;
        if (decoder.decode(chunk.value).includes(`event: ${event}`)) return true;
      }
    } finally {
      await reader.cancel();
    }
  }

  test("a temp-file-plus-rename write to the doc triggers an update", async () => {
    const heard = await updateAfter(() => {
      const tmp = join(dir, "doc-write.tmp");
      writeFileSync(tmp, "# Hello\n\nworld replaced by rename\n");
      renameSync(tmp, file);
    });
    expect(heard).toBe(true);
  });

  test("a temp-file-plus-rename write to the sidecar triggers an update", async () => {
    const heard = await updateAfter(() => {
      const tmp = join(dir, "sidecar-write.tmp");
      writeFileSync(tmp, JSON.stringify({ version: 1, annotations: [] }));
      renameSync(tmp, `${file}.mdnote.json`);
    });
    expect(heard).toBe(true);
  });

  test("an annotation POST broadcasts a sidecar-only annotations event", async () => {
    const heard = await updateAfter(async () => {
      const res = await fetch(`${base}/api/annotations?file=${encodeURIComponent(file)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineRange: [1, 1], anchorText: "Hello", note: "broadcast me" }),
      });
      expect(res.status).toBe(201);
    }, "annotations");
    expect(heard).toBe(true);
  });
});

describe("registry persistence", () => {
  test("a persisted path is restored on cold start without creating a watcher", async () => {
    const docs = mkdtempSync(join(tmpdir(), "mdnote-persisted-"));
    const restored = join(docs, "restored.md");
    const started = join(docs, "started.md");
    writeFileSync(restored, "# Restored\n");
    writeFileSync(started, "# Started\n");
    const state = mkdtempSync(join(tmpdir(), "mdnote-state-"));
    mkdirSync(join(state, "mdnote"));
    writeFileSync(
      join(state, "mdnote", "registry.json"),
      JSON.stringify({ [restored]: new Date().toISOString() }),
    );
    process.env.XDG_STATE_HOME = state;
    let s: Awaited<ReturnType<typeof startServer>> | null = null;
    try {
      s = await startServer({ file: started, host: "127.0.0.1", port: 0 });
      expect(s.watchedDirs()).toEqual([]);
      const res = await fetch(`http://127.0.0.1:${s.port}/api/files`);
      const { files } = (await res.json()) as { files: { path: string }[] };
      expect(files.map((f) => f.path).sort()).toEqual([restored, started].sort());
    } finally {
      process.env.XDG_STATE_HOME = stateHome;
      await s?.stop();
      rmSync(docs, { recursive: true, force: true });
      rmSync(state, { recursive: true, force: true });
    }
  });
});

describe("SSE keepalive", () => {
  test("an idle client receives periodic pings", async () => {
    const prev = process.env.MDNOTE_PING_MS;
    process.env.MDNOTE_PING_MS = "50";
    const s = await startServer({ file, host: "127.0.0.1", port: 0 });
    try {
      const res = await fetch(
        `http://127.0.0.1:${s.port}/api/events?file=${encodeURIComponent(file)}`,
      );
      const reader = res.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(": connected");
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(": ping");
      await reader.cancel();
    } finally {
      if (prev === undefined) delete process.env.MDNOTE_PING_MS;
      else process.env.MDNOTE_PING_MS = prev;
      await s.stop();
    }
  });
});

describe("idle shutdown", () => {
  test("the clock runs from boot, a connected client cancels it, disconnecting restarts it", async () => {
    const prev = process.env.MDNOTE_IDLE_TIMEOUT_MS;
    process.env.MDNOTE_IDLE_TIMEOUT_MS = "150";
    let idle = 0;
    const s = await startServer({
      file,
      host: "127.0.0.1",
      port: 0,
      onIdle: () => {
        idle++;
      },
    });
    try {
      await Bun.sleep(300);
      expect(idle).toBe(1);

      const ac = new AbortController();
      const res = await fetch(
        `http://127.0.0.1:${s.port}/api/events?file=${encodeURIComponent(file)}`,
        { signal: ac.signal },
      );
      const reader = res.body!.getReader();
      await reader.read();
      await Bun.sleep(300);
      expect(idle).toBe(1);

      ac.abort();
      await Bun.sleep(600);
      expect(idle).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.MDNOTE_IDLE_TIMEOUT_MS;
      else process.env.MDNOTE_IDLE_TIMEOUT_MS = prev;
      await s.stop();
    }
  });
});
