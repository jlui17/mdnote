import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, settingsPath } from "../src/config.ts";

let dir: string;

function setup(contents?: string) {
  dir = mkdtempSync(join(tmpdir(), "mdnote-config-"));
  const path = join(dir, "settings.json");
  if (contents !== undefined) writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("settingsPath honors XDG_CONFIG_HOME", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/x/cfg";
  try {
    expect(settingsPath()).toBe("/x/cfg/mdnote/settings.json");
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  }
});

test("missing file yields defaults: dark theme, catalog keybindings", () => {
  const cfg = loadConfig(setup());
  expect(cfg.theme).toBe("dark");
  expect(cfg.keybindings).toEqual({
    "copy-prompt": "mod+shift+c",
    "toggle-theme": null,
    "annotate-block": "c",
    "annotate-document": "shift+c",
    "delete-annotation": "d",
  });
});

test("settings override defaults per-key", () => {
  const cfg = loadConfig(
    setup(JSON.stringify({ theme: "light", keybindings: { "toggle-theme": "Mod+Shift+T" } })),
  );
  expect(cfg.theme).toBe("light");
  expect(cfg.keybindings["toggle-theme"]).toBe("mod+shift+t");
  expect(cfg.keybindings["copy-prompt"]).toBe("mod+shift+c");
});

test("null unbinds a default keybinding", () => {
  const cfg = loadConfig(setup(JSON.stringify({ keybindings: { "copy-prompt": null } })));
  expect(cfg.keybindings["copy-prompt"]).toBeNull();
});

test("invalid entries warn and fall back per-key", () => {
  const cfg = loadConfig(
    setup(
      JSON.stringify({
        theme: "solarized",
        keybindings: { "copy-prompt": "hyper+c", "no-such-action": "mod+x", "toggle-theme": 7 },
      }),
    ),
  );
  expect(cfg.theme).toBe("dark");
  expect(cfg.keybindings).toEqual({
    "copy-prompt": "mod+shift+c",
    "toggle-theme": null,
    "annotate-block": "c",
    "annotate-document": "shift+c",
    "delete-annotation": "d",
  });
});

test("invalid JSON or a non-object yields defaults", () => {
  const path = setup("{nope");
  expect(loadConfig(path)).toEqual(loadConfig(join(dir, "absent.json")));
  writeFileSync(path, "[1]");
  expect(loadConfig(path).theme).toBe("dark");
});
