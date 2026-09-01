import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ACTIONS, defaultKeybindings, isValidKeybinding, type ActionId } from "./actions.ts";
import { isTheme, THEMES } from "./themes.ts";
import type { ResolvedConfig, SettingsPatch } from "./types.ts";

export function settingsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "mdnote", "settings.json");
}

function warn(msg: string) {
  console.error(`mdnote: settings: ${msg}`);
}

const THEME_LIST = THEMES.map((t) => JSON.stringify(t)).join(", ");

/** Reads settings.json and merges it over app defaults. Missing file is fine; invalid entries warn and fall back per-key. */
export function loadConfig(path = settingsPath()): ResolvedConfig {
  const resolved: ResolvedConfig = {
    theme: "dark",
    lineNumbers: false,
    readingLine: false,
    keybindings: defaultKeybindings(),
  };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return resolved;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warn(`${path} is not valid JSON; using defaults`);
    return resolved;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warn(`${path} must be a JSON object; using defaults`);
    return resolved;
  }
  const s = parsed as Record<string, unknown>;

  if (s.theme !== undefined) {
    if (isTheme(s.theme)) {
      resolved.theme = s.theme;
    } else {
      warn(`ignoring theme ${JSON.stringify(s.theme)}: expected one of ${THEME_LIST}`);
    }
  }

  for (const key of ["lineNumbers", "readingLine"] as const) {
    const value = s[key];
    if (value === undefined) continue;
    if (typeof value === "boolean") {
      resolved[key] = value;
    } else {
      warn(`ignoring ${key} ${JSON.stringify(value)}: expected true or false`);
    }
  }

  if (s.keybindings !== undefined) {
    if (typeof s.keybindings !== "object" || s.keybindings === null || Array.isArray(s.keybindings)) {
      warn(`ignoring keybindings: expected an object of action → keybinding`);
    } else {
      for (const [id, spec] of Object.entries(s.keybindings)) {
        if (!(id in ACTIONS)) {
          warn(`ignoring keybinding for unknown action ${JSON.stringify(id)}`);
          continue;
        }
        if (spec === null) {
          resolved.keybindings[id as ActionId] = null;
          continue;
        }
        if (typeof spec !== "string" || !isValidKeybinding(spec)) {
          warn(`ignoring keybinding for ${JSON.stringify(id)}: ${JSON.stringify(spec)} is not a valid spec (e.g. "mod+shift+c")`);
          continue;
        }
        resolved.keybindings[id as ActionId] = spec.toLowerCase();
      }
    }
  }

  return resolved;
}

/** A settings write the server refuses; `status` is the HTTP answer it maps to. */
export class SettingsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409,
  ) {
    super(message);
  }
}

/**
 * Writes `patch` into settings.json (created, directory included, if absent), keeps every
 * other key verbatim, and returns the config as loadConfig now sees it. Only the keys the
 * UI toggles are accepted; a hand-broken file is refused rather than replaced.
 */
export function updateSettings(patch: unknown, path = settingsPath()): ResolvedConfig {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new SettingsError("expected a JSON object", 400);
  }
  const accepted: SettingsPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "theme") {
      if (!isTheme(value)) throw new SettingsError(`theme must be one of ${THEME_LIST}`, 400);
      accepted.theme = value;
    } else if (key === "readingLine") {
      if (typeof value !== "boolean") throw new SettingsError("readingLine must be true or false", 400);
      accepted.readingLine = value;
    } else {
      throw new SettingsError(`${JSON.stringify(key)} is not a setting the UI can write`, 400);
    }
  }

  let existing: Record<string, unknown> = {};
  let raw: string | null = null;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SettingsError(`${path} is not valid JSON; fix it by hand`, 409);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new SettingsError(`${path} must be a JSON object; fix it by hand`, 409);
    }
    existing = parsed as Record<string, unknown>;
  }

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...existing, ...accepted }, null, 2) + "\n");
  renameSync(tmp, path);
  return loadConfig(path);
}
