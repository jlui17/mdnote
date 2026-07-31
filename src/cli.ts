#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logPath, readLiveLock, removeLock, writeLock } from "./lock.ts";
import { readSidecar, writeSidecar } from "./store.ts";
import type { Annotation, ServerLock } from "./types.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4820;

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function origin(lock: ServerLock): string {
  return `http://${lock.host}:${lock.port}`;
}

function apiUrl(lock: ServerLock, file: string, route: string): string {
  return `${origin(lock)}/api${route}?file=${encodeURIComponent(resolve(file))}`;
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

/** Registers `file` with the running server, returning its document URL, or null if the server didn't answer. */
async function openOnServer(lock: ServerLock, file: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchWithTimeout(apiUrl(lock, file, "/open"), { method: "POST" }, 2000);
  } catch {
    return null;
  }
  if (res.status === 404) die(`mdnote: server refused ${file}: not a servable markdown file`);
  if (!res.ok) return null;
  const body = (await res.json()) as { url: string };
  return origin(lock) + body.url;
}

async function spawnServer(file: string, host: string, port: number): Promise<ServerLock> {
  const log = logPath();
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, "w");
  const child = spawn(
    process.execPath,
    [import.meta.path, file, "--serve", "--host", host, "--port", String(port)],
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  child.unref();
  closeSync(fd);

  for (let i = 0; i < 50; i++) {
    await Bun.sleep(100);
    const live = readLiveLock();
    if (live) return live;
  }
  die(`mdnote: server did not start on ${host}:${port}`);
}

async function cmdServe(file: string, host: string, port: number) {
  const { startServer } = await import("./server.ts");
  const server = await startServer({ file, host, port, onIdle: () => process.exit(0) });

  writeLock({ host, port: server.port, pid: process.pid });
  process.on("exit", () => removeLock());
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      removeLock();
      process.exit(0);
    });
  }
}

async function cmdReview(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const arg = positional[0];
  if (!arg) die("usage: mdnote <file.md> [--host H] [--port P]");
  if (!existsSync(arg)) die(`mdnote: no such file: ${arg}`);
  const file = resolve(arg);

  const host = typeof flags.host === "string" ? flags.host : DEFAULT_HOST;
  const port = typeof flags.port === "string" ? Number(flags.port) : DEFAULT_PORT;

  if (flags.serve === true) {
    await cmdServe(file, host, port);
    return;
  }

  let lock = readLiveLock();
  if (lock) {
    if (typeof flags.host === "string" && flags.host !== lock.host)
      die(`mdnote: server already running on ${lock.host}:${lock.port}; run \`mdnote stop\` to change --host`);
    if (typeof flags.port === "string" && port !== lock.port)
      die(`mdnote: server already running on ${lock.host}:${lock.port}; run \`mdnote stop\` to change --port`);
  } else {
    lock = await spawnServer(file, host, port);
  }

  const url = await openOnServer(lock, file);
  if (!url) die(`mdnote: server at ${origin(lock)} is not responding; run \`mdnote stop\``);

  console.log(url);
  if (lock.host === DEFAULT_HOST || lock.host === "localhost") Bun.spawn(["open", url]);
}

async function cmdList() {
  const lock = readLiveLock();
  if (!lock) {
    console.log("mdnote: no server running");
    return;
  }
  let files: { path: string; url: string }[];
  try {
    const res = await fetchWithTimeout(`${origin(lock)}/api/files`);
    if (!res.ok) throw new Error("bad response");
    files = ((await res.json()) as { files: { path: string; url: string }[] }).files;
  } catch {
    console.log("mdnote: server not responding");
    return;
  }
  if (files.length === 0) {
    console.log("mdnote: no files open");
    return;
  }
  for (const f of files) console.log(`${f.path}  ${origin(lock)}${f.url}`);
}

function cmdStop() {
  const lock = readLiveLock();
  if (!lock) {
    removeLock();
    console.log("mdnote: no server running");
    return;
  }
  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {}
  removeLock();
  console.log(`mdnote: stopped server on ${lock.host}:${lock.port}`);
}

async function cmdComments(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const file = positional[0];
  if (!file) die("comments: missing <file.md>");
  if (!existsSync(file)) die(`comments: no such file: ${file}`);

  let annotations: Annotation[] | null = null;
  const lock = readLiveLock();
  if (lock) {
    try {
      const res = await fetchWithTimeout(apiUrl(lock, file, "/annotations"));
      if (res.ok) annotations = ((await res.json()) as { annotations: Annotation[] }).annotations;
    } catch {}
  }
  annotations ??= readSidecar(file).annotations;

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
  const lock = readLiveLock();
  if (lock) {
    try {
      let ok = true;
      if (ids) {
        for (const id of ids) {
          const res = await fetchWithTimeout(apiUrl(lock, file, `/annotations/${id}`), {
            method: "DELETE",
          });
          ok = ok && res.ok;
        }
      } else {
        ok = (await fetchWithTimeout(apiUrl(lock, file, "/annotations"), { method: "DELETE" })).ok;
      }
      if (ok) return;
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
    case "comments":
      await cmdComments(rest);
      break;
    case "clear":
      await cmdClear(rest);
      break;
    case "stop":
      cmdStop();
      break;
    case "list":
      await cmdList();
      break;
    default:
      await cmdReview(process.argv.slice(2));
  }
}

main();
