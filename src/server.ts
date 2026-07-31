import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { render } from "./render.ts";
import { locate, reanchor } from "./anchor.ts";
import { loadConfig } from "./config.ts";
import { readSidecar, sidecarPath, writeSidecar } from "./store.ts";
import type { Annotation, AnnotationPatch, DocResponse, NewAnnotation } from "./types.ts";

const WEB_DIR = join(import.meta.dir, "..", "web");

const JSON_HEADERS = { "content-type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function bundleFrontend(): Promise<string> {
  const out = await Bun.build({ entrypoints: [join(WEB_DIR, "main.tsx")], target: "browser" });
  const first = out.outputs[0];
  return first ? await first.text() : "";
}

export function pathToUrl(file: string): string {
  return file.split("/").map(encodeURIComponent).join("/");
}

export function isMarkdownPath(file: string): boolean {
  const ext = extname(file).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

function servable(file: string): boolean {
  return isMarkdownPath(file) && existsSync(file);
}

interface FileState {
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
  timer: ReturnType<typeof setTimeout> | null;
}

interface DirWatch {
  watcher: FSWatcher;
  /** Watched basename (document or sidecar) → the document it belongs to. */
  names: Map<string, string>;
}

export async function startServer(opts: { file: string; host: string; port: number }): Promise<{
  url: string;
  port: number;
  watchedDirs(): string[];
  stop(): Promise<void> | void;
}> {
  const initial = resolve(opts.file);

  let mainJs = "";
  try {
    mainJs = await bundleFrontend();
  } catch (e) {
    console.error(`warning: could not bundle web/main.tsx: ${e}`);
  }

  const files = new Map<string, FileState>();
  const dirWatchers = new Map<string, DirWatch>();
  const encoder = new TextEncoder();

  function register(file: string): FileState {
    let state = files.get(file);
    if (!state) {
      state = { clients: new Set(), timer: null };
      files.set(file, state);
    }
    return state;
  }

  function broadcast(state: FileState) {
    for (const c of state.clients) {
      try {
        c.enqueue(encoder.encode("event: update\ndata: {}\n\n"));
      } catch {
        state.clients.delete(c);
      }
    }
  }

  function schedule(file: string) {
    const state = files.get(file);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => onChange(file), 50);
  }

  async function onChange(file: string) {
    const state = files.get(file);
    if (!state) return;
    state.timer = null;
    let source: string;
    try {
      source = await Bun.file(file).text();
    } catch {
      broadcast(state);
      return;
    }
    const sidecar = readSidecar(file);
    const next = reanchor(source, sidecar.annotations);
    if (JSON.stringify(next) !== JSON.stringify(sidecar.annotations))
      writeSidecar(file, { version: 1, annotations: next });
    broadcast(state);
  }

  function ensureWatch(file: string) {
    const dir = dirname(file);
    let entry = dirWatchers.get(dir);
    if (entry?.names.has(basename(file))) return;
    if (!entry) {
      const names = new Map<string, string>();
      let watcher: FSWatcher;
      try {
        watcher = watch(dir, (_event, name) => {
          const target = name ? names.get(name) : undefined;
          if (target) schedule(target);
        });
      } catch (e) {
        console.error(`warning: file watching disabled for ${dir}: ${e}`);
        return;
      }
      entry = { watcher, names };
      dirWatchers.set(dir, entry);
    }
    entry.names.set(basename(file), file);
    entry.names.set(basename(sidecarPath(file)), file);
  }

  register(initial);

  const server = Bun.serve({
    hostname: opts.host,
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "GET" && path === "/main.js") {
        return new Response(mainJs, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }

      if (req.method === "GET" && path === "/style.css") {
        const f = Bun.file(join(WEB_DIR, "style.css"));
        if (!(await f.exists())) return new Response("", { headers: { "content-type": "text/css" } });
        return new Response(f, { headers: { "content-type": "text/css; charset=utf-8" } });
      }

      if (path.startsWith("/api/")) {
        const route = path.slice("/api".length);
        let qfile = url.searchParams.get("file");

        if (route === "/open") {
          if (req.method !== "POST") return new Response("not found", { status: 404 });
          if (!qfile) {
            const body = (await req.json().catch(() => null)) as { file?: string } | null;
            qfile = body?.file ?? null;
          }
          if (!qfile) return json({ error: "unknown file" }, 404);
          const file = resolve(qfile);
          if (!servable(file)) return json({ error: "unknown file" }, 404);
          register(file);
          return json({ file, url: pathToUrl(file) });
        }

        if (!qfile) return json({ error: "unknown file" }, 404);
        const file = resolve(qfile);
        const state = files.get(file);
        if (!state) return json({ error: "unknown file" }, 404);
        return apiFetch(req, route, file, state);
      }

      let docPath: string;
      try {
        docPath = decodeURIComponent(path);
      } catch {
        return new Response("not found", { status: 404 });
      }
      if (docPath !== "/") docPath = resolve(docPath);

      if (req.method !== "GET") return new Response("not found", { status: 404 });

      if (docPath === "/")
        return new Response(null, { status: 302, headers: { location: pathToUrl(initial) } });

      if (!files.has(docPath)) {
        if (!servable(docPath)) return new Response("not found", { status: 404 });
        register(docPath);
      }

      const f = Bun.file(join(WEB_DIR, "index.html"));
      if (!(await f.exists())) return new Response("index.html not found", { status: 404 });
      const config = JSON.stringify(loadConfig()).replace(/</g, "\\u003c");
      return new Response((await f.text()).replace("__MDNOTE_CONFIG_JSON__", config), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  async function apiFetch(
    req: Request,
    path: string,
    file: string,
    state: FileState,
  ): Promise<Response> {
    const readSource = () => Bun.file(file).text();
    const persist = (annotations: Annotation[]) =>
      writeSidecar(file, { version: 1, annotations });

    if (req.method === "GET" && path === "/doc") {
      const source = await readSource();
      const body: DocResponse = { path: file, source, html: render(source) };
      return json(body);
    }

    if (path === "/annotations") {
      if (req.method === "GET") return json({ annotations: readSidecar(file).annotations });

      if (req.method === "POST") {
        const body = (await req.json()) as NewAnnotation;
        let lineRange = body.lineRange;
        if (body.anchorText) {
          const found = locate(await readSource(), body.anchorText, lineRange ?? undefined);
          if (found) lineRange = found;
        }
        const created: Annotation = {
          id: crypto.randomUUID(),
          lineRange: body.anchorText ? lineRange : null,
          anchorText: body.anchorText,
          note: body.note,
          createdAt: new Date().toISOString(),
          status: "open",
        };
        const sidecar = readSidecar(file);
        sidecar.annotations.push(created);
        persist(sidecar.annotations);
        return json(created, 201);
      }

      if (req.method === "DELETE") {
        persist([]);
        return new Response(null, { status: 204 });
      }
    }

    if (path.startsWith("/annotations/")) {
      const id = decodeURIComponent(path.slice("/annotations/".length));

      if (req.method === "PATCH") {
        const body = (await req.json()) as AnnotationPatch;
        const sidecar = readSidecar(file);
        const target = sidecar.annotations.find((a) => a.id === id);
        if (!target) return json({ error: "annotation not found" }, 404);
        target.note = body.note;
        persist(sidecar.annotations);
        return json(target);
      }

      if (req.method === "DELETE") {
        const sidecar = readSidecar(file);
        persist(sidecar.annotations.filter((a) => a.id !== id));
        return new Response(null, { status: 204 });
      }
    }

    if (req.method === "GET" && path === "/events") {
      ensureWatch(file);
      let self: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          self = controller;
          state.clients.add(controller);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          state.clients.delete(self);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    return new Response("not found", { status: 404 });
  }

  const port = server.port ?? opts.port;
  return {
    url: `http://${opts.host}:${port}${pathToUrl(initial)}`,
    port,
    watchedDirs: () => [...dirWatchers.keys()],
    stop() {
      for (const entry of dirWatchers.values()) entry.watcher.close();
      dirWatchers.clear();
      for (const state of files.values()) if (state.timer) clearTimeout(state.timer);
      return server.stop(true);
    },
  };
}
