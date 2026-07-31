import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { registryPath } from "./lock.ts";

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Persisted shape: absolute document path → last-touched ISO timestamp. */
type Persisted = Record<string, string>;

/** Paths worth restoring: the file still exists and it was touched inside the age-out window. */
export function loadRegistry(path = registryPath(), now = Date.now()): Map<string, number> {
  let raw: Persisted;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Persisted;
  } catch {
    return new Map();
  }
  const entries = new Map<string, number>();
  if (!raw || typeof raw !== "object") return entries;
  for (const [file, touched] of Object.entries(raw)) {
    const at = Date.parse(String(touched));
    if (Number.isNaN(at) || now - at > MAX_AGE_MS) continue;
    if (!existsSync(file)) continue;
    entries.set(file, at);
  }
  return entries;
}

export function saveRegistry(entries: Map<string, number>, path = registryPath()): void {
  const body: Persisted = {};
  for (const [file, at] of entries) body[file] = new Date(at).toISOString();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(body, null, 2));
  renameSync(tmp, path);
}
