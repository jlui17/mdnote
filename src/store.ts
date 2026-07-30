import { readFileSync, writeFileSync, renameSync } from "node:fs";
import type { Sidecar } from "./types.ts";

export function sidecarPath(file: string): string {
  return `${file}.mdnote.json`;
}

export function readSidecar(file: string): Sidecar {
  try {
    return JSON.parse(readFileSync(sidecarPath(file), "utf8")) as Sidecar;
  } catch {
    return { version: 1, annotations: [] };
  }
}

export function writeSidecar(file: string, s: Sidecar): void {
  const path = sidecarPath(file);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, path);
}
