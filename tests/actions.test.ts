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
});

test("bindingFor reads the resolved map, defaulting to the catalog", () => {
  expect(bindingFor("copy-prompt")).toEqual(parseKeybinding("mod+shift+c"));
  expect(bindingFor("toggle-theme")).toBeNull();
  expect(
    bindingFor("copy-prompt", {
      "copy-prompt": "mod+p",
      "toggle-theme": null,
      "annotate-block": "c",
      "annotate-document": "shift+c",
      "edit-annotation": "e",
      "delete-annotation": "d",
    }),
  ).toEqual(parseKeybinding("mod+p"));
  expect(
    bindingFor("copy-prompt", {
      "copy-prompt": null,
      "toggle-theme": "mod+t",
      "annotate-block": "c",
      "annotate-document": "shift+c",
      "edit-annotation": "e",
      "delete-annotation": "d",
    }),
  ).toBeNull();
});

test("every catalog keybinding parses to a real key", () => {
  for (const [id, def] of Object.entries(ACTIONS)) {
    if (!def.keybinding) continue;
    expect(parseKeybinding(def.keybinding).key, id).not.toBe("");
  }
});
