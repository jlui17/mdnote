import { test, expect, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sidecarPath, readSidecar, writeSidecar } from "../src/store.ts";
import type { Sidecar } from "../src/types.ts";

let dir: string;

function setup() {
  dir = mkdtempSync(join(tmpdir(), "mdnote-store-"));
  return join(dir, "notes.md");
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("sidecarPath naming", () => {
  expect(sidecarPath("notes.md")).toBe("notes.md.mdnote.json");
  expect(sidecarPath("/a/b/notes.md")).toBe("/a/b/notes.md.mdnote.json");
});

test("missing sidecar reads as empty", () => {
  const file = setup();
  expect(readSidecar(file)).toEqual({ version: 1, annotations: [] });
});

test("write/read round-trip", () => {
  const file = setup();
  const sidecar: Sidecar = {
    version: 1,
    annotations: [
      {
        id: "abc",
        lineRange: [1, 2],
        anchorText: "hello",
        note: "make it punchier",
        createdAt: new Date().toISOString(),
        status: "open",
      },
    ],
  };
  writeSidecar(file, sidecar);
  expect(readSidecar(file)).toEqual(sidecar);
});

test("write is atomic: no leftover temp file", () => {
  const file = setup();
  writeSidecar(file, { version: 1, annotations: [] });
  const entries = readdirSync(dir);
  expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
  expect(existsSync(sidecarPath(file))).toBe(true);
});
