import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registryPath } from "../src/lock.ts";
import { loadRegistry, saveRegistry } from "../src/registry.ts";

let dir: string;

function setup(): { path: string; doc: string } {
  dir = mkdtempSync(join(tmpdir(), "mdnote-registry-"));
  const doc = join(dir, "doc.md");
  writeFileSync(doc, "# Doc\n");
  return { path: join(dir, "registry.json"), doc };
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("the registry lives in the state dir, honoring XDG_STATE_HOME", () => {
  const prev = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = "/x/state";
  try {
    expect(registryPath()).toBe("/x/state/mdnote/registry.json");
  } finally {
    if (prev === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = prev;
  }
});

test("a saved entry round-trips", () => {
  const { path, doc } = setup();
  const at = Date.now();
  saveRegistry(new Map([[doc, at]]), path);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ [doc]: new Date(at).toISOString() });
  expect(loadRegistry(path)).toEqual(new Map([[doc, at]]));
});

test("a missing or malformed registry loads as empty", () => {
  const { path } = setup();
  expect(loadRegistry(path).size).toBe(0);
  writeFileSync(path, "{nope");
  expect(loadRegistry(path).size).toBe(0);
});

test("entries for deleted files and entries past the age-out window are dropped on load", () => {
  const { path, doc } = setup();
  const gone = join(dir, "gone.md");
  const stale = join(dir, "stale.md");
  writeFileSync(stale, "# Stale\n");
  const now = Date.now();
  const old = now - 15 * 24 * 60 * 60 * 1000;
  saveRegistry(
    new Map([
      [doc, now],
      [gone, now],
      [stale, old],
    ]),
    path,
  );
  expect([...loadRegistry(path, now).keys()]).toEqual([doc]);
});
