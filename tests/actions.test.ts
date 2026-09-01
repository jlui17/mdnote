import { expect, test } from "bun:test";
import {
  ACTIONS,
  bindingFor,
  formatKeybinding,
  matchesEvent,
  parseKeybinding,
} from "../web/actions.tsx";

const event = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;

test("parseKeybinding splits modifiers from the key", () => {
  expect(parseKeybinding("mod+shift+c")).toEqual({ mod: true, shift: true, alt: false, key: "c" });
  expect(parseKeybinding("alt+k")).toEqual({ mod: false, shift: false, alt: true, key: "k" });
  expect(parseKeybinding("Mod+Shift+C").key).toBe("c");
});

test("matchesEvent maps mod to meta on mac, ctrl elsewhere", () => {
  const kb = parseKeybinding("mod+shift+c");
  expect(matchesEvent(kb, event({ key: "c", metaKey: true, shiftKey: true }), true)).toBe(true);
  expect(matchesEvent(kb, event({ key: "c", ctrlKey: true, shiftKey: true }), true)).toBe(false);
  expect(matchesEvent(kb, event({ key: "c", ctrlKey: true, shiftKey: true }), false)).toBe(true);
  expect(matchesEvent(kb, event({ key: "C", metaKey: true, shiftKey: true }), true)).toBe(true);
});

test("matchesEvent rejects missing or extra modifiers", () => {
  const kb = parseKeybinding("mod+shift+c");
  expect(matchesEvent(kb, event({ key: "c", metaKey: true }), true)).toBe(false);
  expect(matchesEvent(kb, event({ key: "c", metaKey: true, shiftKey: true, altKey: true }), true)).toBe(false);
  expect(matchesEvent(parseKeybinding("mod+k"), event({ key: "k" }), true)).toBe(false);
});

test("formatKeybinding renders per platform", () => {
  const kb = parseKeybinding("mod+shift+c");
  expect(formatKeybinding(kb, true)).toBe("⌘⇧C");
  expect(formatKeybinding(kb, false)).toBe("Ctrl+Shift+C");
  expect(formatKeybinding(parseKeybinding("alt+k"), true)).toBe("⌥K");
  expect(formatKeybinding(parseKeybinding("mod+enter"), true)).toBe("⌘↩");
  expect(formatKeybinding(parseKeybinding("mod+enter"), false)).toBe("Ctrl+↩");
});

test("bindingFor reads the resolved map, defaulting to the catalog", () => {
  expect(bindingFor("annotate-block")).toEqual(parseKeybinding("c"));
  expect(bindingFor("toggle-theme")).toBeNull();
  expect(
    bindingFor("annotate-block", {
      "submit-review": "mod+enter",
      "copy-markdown": null,
      "toggle-theme": null,
      "toggle-reading-line": "r",
      "annotate-block": "mod+p",
      "annotate-document": "shift+c",
      "edit-annotation": "e",
      "delete-annotation": "shift+d",
      "show-help": "shift+?",
    }),
  ).toEqual(parseKeybinding("mod+p"));
  expect(
    bindingFor("annotate-block", {
      "submit-review": "mod+enter",
      "copy-markdown": null,
      "toggle-theme": "mod+t",
      "toggle-reading-line": "r",
      "annotate-block": null,
      "annotate-document": "shift+c",
      "edit-annotation": "e",
      "delete-annotation": "shift+d",
      "show-help": "shift+?",
    }),
  ).toBeNull();
});

test("every catalog keybinding parses to a real key", () => {
  for (const [id, def] of Object.entries(ACTIONS)) {
    if (!def.keybinding) continue;
    expect(parseKeybinding(def.keybinding).key, id).not.toBe("");
  }
});
