import { expect, test } from "bun:test";
import { ACTIONS, type ActionId } from "../web/actions.tsx";
import { helpRows } from "../web/help.tsx";

const bindings = (over: Partial<Record<ActionId, string | null>> = {}) =>
  ({
    "copy-prompt": "mod+shift+c",
    "copy-markdown": null,
    "toggle-theme": null,
    "annotate-block": "c",
    "annotate-document": "shift+c",
    "edit-annotation": "e",
    "delete-annotation": "d",
    "show-help": "shift+?",
    ...over,
  }) as Record<ActionId, string | null>;

const rows = (over?: Partial<Record<ActionId, string | null>>) => helpRows(bindings(over), true);

test("every keybound action except show-help gets exactly one row, under its catalog label", () => {
  const labels = rows().map((r) => r.what);
  for (const [id, def] of Object.entries(ACTIONS)) {
    const expected = def.keybinding && id !== "show-help" ? 1 : 0;
    expect(labels.filter((l) => l === def.label).length, id).toBe(expected);
  }
});

test("rows show the resolved binding, not the catalog default", () => {
  const remapped = rows({ "annotate-block": "alt+n" }).find(
    (r) => r.what === ACTIONS["annotate-block"].label,
  );
  expect(remapped?.key).toBe("⌥N");
});

test("every row carries its key", () => {
  for (const r of rows()) expect(r.key, r.what).not.toBeNull();
});
