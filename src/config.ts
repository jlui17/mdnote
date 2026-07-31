import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ACTIONS, defaultKeybindings, isValidKeybinding, type ActionId } from "./actions.ts";
import type { ResolvedConfig } from "./types.ts";

export function settingsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "mdnote", "settings.json");
}

function warn(msg: string) {
  console.error(`mdnote: settings: ${msg}`);
}

/** Reads settings.json and merges it over app defaults. Missing file is fine; invalid entries warn and fall back per-key. */
export function loadConfig(path = settingsPath()): ResolvedConfig {
  const resolved: ResolvedConfig = { theme: "dark", keybindings: defaultKeybindings() };

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
    if (s.theme === "light" || s.theme === "dark" || s.theme === "system") {
      resolved.theme = s.theme;
    } else {
      warn(`ignoring theme ${JSON.stringify(s.theme)}: expected "light", "dark", or "system"`);
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
