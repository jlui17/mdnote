#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { readSidecar, writeSidecar } from "./store.ts";
import type { Annotation } from "./types.ts";

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function lockPath(file: string): string {
  return `${file}.mdnote.lock`;
}

interface Lock {
  port: number;
  host: string;
  pid: number;
}

function readLiveLock(file: string): Lock | null {
  let lock: Lock;
  try {
    lock = JSON.parse(readFileSync(lockPath(file), "utf8"));
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

function apiUrl(lock: Lock, file: string, route: string): string {
  return `http://127.0.0.1:${lock.port}/api${route}?file=${encodeURIComponent(resolve(file))}`;
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 300): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function cmdReview(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const file = positional[0];
  if (!file) die("review: missing <file.md>");
  if (!existsSync(file)) die(`review: no such file: ${file}`);

  const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
  const port = typeof flags.port === "string" ? Number(flags.port) : 4820;

  const { startServer } = await import("./server.ts");
  const server = await startServer({ file, host, port });

  writeFileSync(lockPath(file), JSON.stringify({ port: server.port, host, pid: process.pid }));
  const cleanup = () => {
    try {
      unlinkSync(lockPath(file));
    } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  console.log(server.url);
  if (host === "127.0.0.1" || host === "localhost") {
    Bun.spawn(["open", server.url]);
  }
}

async function cmdComments(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const file = positional[0];
  if (!file) die("comments: missing <file.md>");
  if (!existsSync(file)) die(`comments: no such file: ${file}`);

  let annotations: Annotation[];
  const lock = readLiveLock(file);
  if (lock) {
    try {
      const res = await fetchWithTimeout(apiUrl(lock, file, "/annotations"));
      annotations = ((await res.json()) as { annotations: Annotation[] }).annotations;
    } catch {
      annotations = readSidecar(file).annotations;
    }
  } else {
    annotations = readSidecar(file).annotations;
  }

  if (flags.json) {
    console.log(JSON.stringify({ file, annotations }));
    return;
  }
  if (annotations.length === 0) {
    console.log("no annotations");
    return;
  }
  for (const a of annotations) {
    const range = a.lineRange ? `lines ${a.lineRange[0]}-${a.lineRange[1]}` : "whole doc";
    console.log(`[${a.status}] (${range}): ${a.note}`);
  }
}

async function cmdClear(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const file = positional[0];
  if (!file) die("clear: missing <file.md>");
  if (!existsSync(file)) die(`clear: no such file: ${file}`);

  const ids = typeof flags.ids === "string" ? flags.ids.split(",").filter(Boolean) : undefined;
  const lock = readLiveLock(file);
  if (lock) {
    try {
      if (ids) {
        for (const id of ids) {
          await fetchWithTimeout(apiUrl(lock, file, `/annotations/${id}`), { method: "DELETE" });
        }
      } else {
        await fetchWithTimeout(apiUrl(lock, file, "/annotations"), { method: "DELETE" });
      }
      return;
    } catch {
      // fall through to sidecar
    }
  }

  const sidecar = readSidecar(file);
  sidecar.annotations = ids ? sidecar.annotations.filter((a) => !ids.includes(a.id)) : [];
  writeSidecar(file, sidecar);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "review":
      await cmdReview(rest);
      break;
    case "comments":
      await cmdComments(rest);
      break;
    case "clear":
      await cmdClear(rest);
      break;
    default:
      die(`unknown command: ${cmd ?? "<none>"}`);
  }
}

main();
