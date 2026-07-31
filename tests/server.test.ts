import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToUrl, startServer } from "../src/server.ts";

let dir: string;
let file: string;
let server: Awaited<ReturnType<typeof startServer>>;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mdnote-server-"));
  file = join(dir, "doc with space.md");
  writeFileSync(file, "# Hello\n\nworld\n");
  server = await startServer({ file, host: "127.0.0.1", port: 0 });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true });
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

  test("GET / redirects to the file's path", async () => {
    const res = await fetch(base + "/", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(pathToUrl(file));
  });

  test("GET an unknown path 404s", async () => {
    const res = await fetch(base + "/some/other/file.md");
    expect(res.status).toBe(404);
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
});
