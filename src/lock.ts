import { readFileSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ServerLock } from "./types.ts";

function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "mdnote");
}

export function lockPath(): string {
  return join(stateDir(), "server.json");
}

export function logPath(): string {
  return join(stateDir(), "server.log");
}

export function registryPath(): string {
  return join(stateDir(), "registry.json");
}

/** The recorded server, or null when the lock is absent, unreadable, or names a dead pid. */
export function readLiveLock(path = lockPath()): ServerLock | null {
  let lock: ServerLock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8")) as ServerLock;
  } catch {
    return null;
  }
  try {
    process.kill(lock.pid, 0);
  } catch {
    return null;
  }
  return lock;
}

export function writeLock(lock: ServerLock, path = lockPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(lock));
}

export function removeLock(path = lockPath()): void {
  try {
    unlinkSync(path);
  } catch {}
}
