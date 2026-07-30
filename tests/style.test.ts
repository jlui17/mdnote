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
  for (const name of ["main.tsx", "anchor-dom.ts"]) {
    const src = await Bun.file(new URL(`../web/${name}`, import.meta.url)).text();
    expect(src.match(COLOR_LITERAL) ?? []).toEqual([]);
  }
});
