import { expect, test } from "bun:test";
import { ACTIONS, type ActionId } from "../web/actions.tsx";
import { helpGroups } from "../web/help.tsx";

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

const rows = (over?: Partial<Record<ActionId, string | null>>) =>
  helpGroups(bindings(over), true).flatMap((g) => g.rows);

test("every catalog action gets exactly one row, under its catalog label", () => {
  const labels = rows().map((r) => r.what);
  for (const [id, def] of Object.entries(ACTIONS)) {
    expect(labels.filter((l) => l === def.label).length, id).toBe(1);
  }
});

test("keyboard rows show the resolved binding, not the catalog default", () => {
  const remapped = rows({ "annotate-block": "alt+n" }).find(
    (r) => r.what === ACTIONS["annotate-block"].label,
  );
  expect(remapped?.key).toBe("⌥N");
});

test("an unbound action still appears, pointing at its button", () => {
  const row = rows().find((r) => r.what === ACTIONS["copy-markdown"].label);
  expect(row?.key).toBeNull();
  expect(row?.mouse).toContain("⧉");
});

test("mouse gestures are grouped alongside the keyboard rows", () => {
  const groups = helpGroups(bindings(), true);
  expect(groups.map((g) => g.title)).toEqual(["Annotate", "Review", "Document"]);
  for (const g of groups) {
    expect(g.rows.some((r) => r.mouse !== null), g.title).toBe(true);
    expect(g.rows.some((r) => r.key !== null), g.title).toBe(true);
  }
});

test("every row is reachable by some input", () => {
  for (const r of rows()) expect(r.key ?? r.mouse, r.what).not.toBeNull();
});
