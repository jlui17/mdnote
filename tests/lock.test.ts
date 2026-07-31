import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockPath, logPath, readLiveLock, removeLock, writeLock } from "../src/lock.ts";

let dir: string;

function setup(): string {
  dir = mkdtempSync(join(tmpdir(), "mdnote-lock-"));
  return join(dir, "server.json");
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("the lock and log live in the state dir, honoring XDG_STATE_HOME", () => {
  const prev = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = "/x/state";
  try {
    expect(lockPath()).toBe("/x/state/mdnote/server.json");
    expect(logPath()).toBe("/x/state/mdnote/server.log");
  } finally {
    if (prev === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = prev;
  }
});

test("a lock naming this process round-trips", () => {
  const path = setup();
  writeLock({ host: "127.0.0.1", port: 4820, pid: process.pid }, path);
  expect(readLiveLock(path)).toEqual({ host: "127.0.0.1", port: 4820, pid: process.pid });
});

test("a missing, malformed, or dead-pid lock reads as no server", () => {
  const path = setup();
  expect(readLiveLock(path)).toBeNull();

  writeFileSync(path, "{nope");
  expect(readLiveLock(path)).toBeNull();

  const exited = Bun.spawnSync(["true"]);
  writeLock({ host: "127.0.0.1", port: 4820, pid: exited.pid }, path);
  expect(readLiveLock(path)).toBeNull();

  removeLock(path);
  expect(readLiveLock(path)).toBeNull();
});
