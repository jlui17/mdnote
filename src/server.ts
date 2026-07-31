import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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

export async function startServer(opts: { file: string; host: string; port: number }): Promise<{
  url: string;
  port: number;
  stop(): Promise<void> | void;
}> {
  const file = resolve(opts.file);
  const dir = dirname(file);
  const watched = new Set([basename(file), basename(sidecarPath(file))]);

  let mainJs = "";
  try {
    mainJs = await bundleFrontend();
  } catch (e) {
    console.error(`warning: could not bundle web/main.tsx: ${e}`);
  }

  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  function broadcast() {
    for (const c of clients) {
      try {
        c.enqueue(encoder.encode("event: update\ndata: {}\n\n"));
      } catch {
        clients.delete(c);
      }
    }
  }

  const readSource = () => Bun.file(file).text();

  function persist(annotations: Annotation[]) {
    writeSidecar(file, { version: 1, annotations });
  }

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
        const qfile = url.searchParams.get("file");
        if (!qfile || resolve(qfile) !== file) return json({ error: "unknown file" }, 404);
        return apiFetch(req, path.slice("/api".length));
      }

      let docPath: string;
      try {
        docPath = decodeURIComponent(path);
      } catch {
        return new Response("not found", { status: 404 });
      }

      if (req.method === "GET" && (docPath === "/" || docPath === file)) {
        if (docPath === "/")
          return new Response(null, { status: 302, headers: { location: pathToUrl(file) } });
        const f = Bun.file(join(WEB_DIR, "index.html"));
        if (!(await f.exists())) return new Response("index.html not found", { status: 404 });
        const config = JSON.stringify(loadConfig()).replace(/</g, "\\u003c");
        return new Response((await f.text()).replace("__MDNOTE_CONFIG_JSON__", config), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      return new Response("not found", { status: 404 });
    },
  });

  async function apiFetch(req: Request, path: string): Promise<Response> {
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
      let self: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          self = controller;
          clients.add(controller);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          clients.delete(self);
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

  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, (_event, name) => {
      if (!name || !watched.has(name)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, 50);
    });
  } catch (e) {
    console.error(`warning: file watching disabled: ${e}`);
  }

  async function onChange() {
    timer = null;
    let source: string;
    try {
      source = await readSource();
    } catch {
      broadcast();
      return;
    }
    const sidecar = readSidecar(file);
    const next = reanchor(source, sidecar.annotations);
    if (JSON.stringify(next) !== JSON.stringify(sidecar.annotations)) persist(next);
    broadcast();
  }

  const port = server.port ?? opts.port;
  return {
    url: `http://${opts.host}:${port}${pathToUrl(file)}`,
    port,
    stop() {
      if (timer) clearTimeout(timer);
      watcher?.close();
      for (const c of clients) {
        try {
          c.close();
        } catch {}
      }
      clients.clear();
      return server.stop(true);
    },
  };
}
