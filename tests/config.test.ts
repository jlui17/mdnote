import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, SettingsError, settingsPath, updateSettings } from "../src/config.ts";

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
    "submit-review": "mod+enter",
    "copy-markdown": null,
    "toggle-theme": null,
    "toggle-reading-line": "r",
    "reading-line-down": "arrowdown",
    "reading-line-up": "arrowup",
    "annotate-block": "c",
    "annotate-document": "shift+c",
    "edit-annotation": "e",
    "delete-annotation": "shift+d",
    "show-help": "shift+?",
  });
});

test("settings override defaults per-key", () => {
  const cfg = loadConfig(
    setup(JSON.stringify({ theme: "light", keybindings: { "toggle-theme": "Mod+Shift+T" } })),
  );
  expect(cfg.theme).toBe("light");
  expect(cfg.keybindings["toggle-theme"]).toBe("mod+shift+t");
  expect(cfg.keybindings["annotate-block"]).toBe("c");
});

test("lineNumbers defaults off, parses booleans, drops anything else", () => {
  const path = setup();
  expect(loadConfig(path).lineNumbers).toBe(false);
  writeFileSync(path, JSON.stringify({ lineNumbers: true }));
  expect(loadConfig(path).lineNumbers).toBe(true);
  writeFileSync(path, JSON.stringify({ lineNumbers: "yes" }));
  expect(loadConfig(path).lineNumbers).toBe(false);
});

test("theme accepts a named palette and drops an unknown name", () => {
  const path = setup(JSON.stringify({ theme: "dracula" }));
  expect(loadConfig(path).theme).toBe("dracula");
  writeFileSync(path, JSON.stringify({ theme: "solarized" }));
  expect(loadConfig(path).theme).toBe("dark");
});

test("readingLine defaults off, parses booleans, drops anything else", () => {
  const path = setup();
  expect(loadConfig(path).readingLine).toBe(false);
  writeFileSync(path, JSON.stringify({ readingLine: true }));
  expect(loadConfig(path).readingLine).toBe(true);
  writeFileSync(path, JSON.stringify({ readingLine: "yes" }));
  expect(loadConfig(path).readingLine).toBe(false);
});

test("updateSettings creates the file and its directory, writing just the patch", () => {
  const path = join(setup(), "..", "nested", "settings.json");
  const cfg = updateSettings({ theme: "nord", readingLine: true }, path);
  expect(cfg.theme).toBe("nord");
  expect(cfg.readingLine).toBe(true);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ theme: "nord", readingLine: true });
});

test("updateSettings keeps every other key verbatim, keybindings and unknown ones alike", () => {
  const path = setup(JSON.stringify({ theme: "light", keybindings: { "annotate-block": "x" }, future: 1 }));
  updateSettings({ readingLine: true }, path);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    theme: "light",
    keybindings: { "annotate-block": "x" },
    future: 1,
    readingLine: true,
  });
  expect(loadConfig(path).keybindings["annotate-block"]).toBe("x");
});

test("updateSettings rejects bad values and non-UI keys without touching the file", () => {
  const before = JSON.stringify({ theme: "light" });
  const path = setup(before);
  for (const patch of [{ theme: "solarized" }, { readingLine: "yes" }, { lineNumbers: true }, [], null, "x"]) {
    let err: unknown;
    try {
      updateSettings(patch, path);
    } catch (e) {
      err = e;
    }
    expect(err, JSON.stringify(patch)).toBeInstanceOf(SettingsError);
    expect((err as SettingsError).status, JSON.stringify(patch)).toBe(400);
  }
  expect(readFileSync(path, "utf8")).toBe(before);
});

test("updateSettings refuses to replace a hand-broken settings file", () => {
  for (const broken of ["{nope", "[1]"]) {
    const path = setup(broken);
    let err: unknown;
    try {
      updateSettings({ theme: "dark" }, path);
    } catch (e) {
      err = e;
    }
    expect(err, broken).toBeInstanceOf(SettingsError);
    expect((err as SettingsError).status, broken).toBe(409);
    expect(readFileSync(path, "utf8")).toBe(broken);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("null unbinds a default keybinding", () => {
  const cfg = loadConfig(setup(JSON.stringify({ keybindings: { "annotate-block": null } })));
  expect(cfg.keybindings["annotate-block"]).toBeNull();
});

test("invalid entries warn and fall back per-key", () => {
  const cfg = loadConfig(
    setup(
      JSON.stringify({
        theme: "solarized",
        keybindings: { "annotate-block": "hyper+c", "no-such-action": "mod+x", "toggle-theme": 7 },
      }),
    ),
  );
  expect(cfg.theme).toBe("dark");
  expect(cfg.keybindings).toEqual({
    "submit-review": "mod+enter",
    "copy-markdown": null,
    "toggle-theme": null,
    "toggle-reading-line": "r",
    "reading-line-down": "arrowdown",
    "reading-line-up": "arrowup",
    "annotate-block": "c",
    "annotate-document": "shift+c",
    "edit-annotation": "e",
    "delete-annotation": "shift+d",
    "show-help": "shift+?",
  });
});

test("invalid JSON or a non-object yields defaults", () => {
  const path = setup("{nope");
  expect(loadConfig(path)).toEqual(loadConfig(join(dir, "absent.json")));
  writeFileSync(path, "[1]");
  expect(loadConfig(path).theme).toBe("dark");
});
