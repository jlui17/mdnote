import { expect, test } from "bun:test";

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor\(/gi;

test("style.css keeps every color literal inside the :root token block", async () => {
  const css = await Bun.file(new URL("../web/style.css", import.meta.url)).text();
  const start = css.indexOf(":root {");
  const end = css.indexOf("}", start);
  expect(start).toBeGreaterThanOrEqual(0);
  const outsideRoot = css.slice(0, start) + css.slice(end);
  expect(outsideRoot.match(COLOR_LITERAL) ?? []).toEqual([]);
});

test("frontend TS has no color literals", async () => {
  for (const name of ["main.tsx", "actions.tsx", "anchor-dom.ts", "help.tsx"]) {
    const src = await Bun.file(new URL(`../web/${name}`, import.meta.url)).text();
    expect(src.match(COLOR_LITERAL) ?? []).toEqual([]);
  }
});

// Pins the depth-hue cycle: highlight name d and block-box class k must resolve to
// the same token their (depth mod 3) slot names, so text and boxes can't drift.
test("depth highlight names and block-box classes agree on the hue cycle", async () => {
  const css = await Bun.file(new URL("../web/style.css", import.meta.url)).text();
  const tokens = ["--hl-open", "--hl-open-1", "--hl-open-2"];
  for (let d = 0; d <= 8; d++) {
    const rule = css.match(new RegExp(`::highlight\\(mdnote-open-d${d}\\)[^{]*\\{([^}]*)\\}`));
    expect(rule?.[1]).toContain(`var(${tokens[d % 3]})`);
  }
  for (let k = 0; k < 3; k++) {
    const rule = css.match(new RegExp(`\\.block-box\\.open\\.d${k}[^{]*\\{([^}]*)\\}`));
    expect(rule?.[1]).toContain(`var(${tokens[k]})`);
  }
});
