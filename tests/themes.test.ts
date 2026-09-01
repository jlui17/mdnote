import { expect, test } from "bun:test";
import { THEME_NAMES } from "../src/themes.ts";
import {
  contrast,
  declarations,
  deltaE,
  minPairwiseDeltaE,
  resolveColor,
  VISIONS,
  type RGB,
} from "./color-math.ts";

const style = await Bun.file(new URL("../web/style.css", import.meta.url)).text();
const themes = await Bun.file(new URL("../web/themes.css", import.meta.url)).text();

const rootStart = style.indexOf(":root {");
const ROOT = declarations(style.slice(rootStart + ":root {".length, style.indexOf("}", rootStart)));

/** Top-level `selector { body }` rules of themes.css, which has no nesting or at-rules. */
const RULES = [...themes.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.trim(),
  decls: declarations(m[2]!),
}));

const NAMED_SELECTOR = /^:root\[data-theme="([a-z]+)"\]$/;
const SHARED_SELECTOR = /^:root\[data-theme\]:not\((.*)\)$/;

function appliesTo(selector: string, theme: string): boolean {
  const named = selector.match(NAMED_SELECTOR);
  if (named) return named[1] === theme;
  const shared = selector.match(SHARED_SELECTOR);
  if (shared) return !shared[1]!.includes(`"${theme}"`);
  throw new Error(`themes.css selector the test can't place: ${selector}`);
}

const blockNames = RULES.map((r) => r.selector.match(NAMED_SELECTOR)?.[1]).filter((n): n is string => !!n);

/** A theme's token map: the root tokens under every themes.css rule that selects it. */
function tokensFor(theme: string): { vars: Map<string, string>; scheme: "light" | "dark" } {
  const vars = new Map(ROOT);
  for (const rule of RULES) if (appliesTo(rule.selector, theme)) for (const [k, v] of rule.decls) vars.set(k, v);
  const scheme = theme === "light" || theme === "dark" ? theme : vars.get("color-scheme");
  if (scheme !== "light" && scheme !== "dark") throw new Error(`${theme}: color-scheme must be light or dark`);
  return { vars, scheme };
}

/** Every token that colors pixels on its own (the accent-derived washes follow --accent). */
const COLOR_TOKENS = [
  "--bg",
  "--fg",
  "--muted",
  "--line",
  "--accent",
  "--accent-fg",
  "--panel",
  "--surface",
  "--hl-open",
  "--hl-open-1",
  "--hl-open-2",
  "--hl-open-edge",
  "--hl-open-1-edge",
  "--hl-open-2-edge",
  "--hl-stale",
  "--hl-focus",
  "--code-keyword",
  "--code-string",
  "--code-comment",
  "--code-number",
  "--code-function",
  "--code-type",
  "--code-variable",
  "--code-meta",
];

const ALL_THEMES = ["light", "dark", ...THEME_NAMES];

function resolved(theme: string): Record<string, RGB> {
  const { vars, scheme } = tokensFor(theme);
  return Object.fromEntries(COLOR_TOKENS.map((t) => [t, resolveColor(`var(${t})`, vars, scheme)]));
}

test("themes.css has exactly one block per name in THEME_NAMES", () => {
  expect([...blockNames].sort()).toEqual([...THEME_NAMES].sort());
});

test("every named block sets color-scheme, so light-dark() tokens and form controls follow the palette", () => {
  for (const rule of RULES) {
    const name = rule.selector.match(NAMED_SELECTOR)?.[1];
    if (name) expect(rule.decls.get("color-scheme"), name).toMatch(/^(light|dark)$/);
  }
});

// Thresholds are what the shipped light/dark palette scores under this simulation
// (Machado 2009 at full severity, CIE76), so a palette may match the default's
// separation but not fall below it.
const FILL_MIN = 15;
const EDGE_MIN = 13;
const FILL_VS_BG_MIN = 10;

for (const theme of ALL_THEMES) {
  test(`${theme}: every color token resolves`, () => {
    resolved(theme);
  });

  test(`${theme}: the three depth hues stay apart under red-green color blindness`, () => {
    const c = resolved(theme);
    const fills = [c["--hl-open"]!, c["--hl-open-1"]!, c["--hl-open-2"]!];
    const edges = [c["--hl-open-edge"]!, c["--hl-open-1-edge"]!, c["--hl-open-2-edge"]!];
    for (const vision of VISIONS) {
      expect(minPairwiseDeltaE(fills, vision), `fills under ${vision}`).toBeGreaterThanOrEqual(FILL_MIN);
      expect(minPairwiseDeltaE(edges, vision), `edges under ${vision}`).toBeGreaterThanOrEqual(EDGE_MIN);
    }
    fills.forEach((fill, i) =>
      expect(deltaE(fill, c["--bg"]!), `fill ${i} against the page`).toBeGreaterThanOrEqual(FILL_VS_BG_MIN),
    );
  });

  test(`${theme}: text stays readable`, () => {
    const c = resolved(theme);
    const bg = c["--bg"]!;
    expect(contrast(c["--fg"]!, bg), "fg on bg").toBeGreaterThanOrEqual(4.5);
    expect(contrast(c["--muted"]!, bg), "muted on bg").toBeGreaterThanOrEqual(3);
    expect(contrast(c["--accent"]!, bg), "accent on bg").toBeGreaterThanOrEqual(3);
    expect(contrast(c["--accent-fg"]!, c["--accent"]!), "accent-fg on accent").toBeGreaterThanOrEqual(2.5);
    for (const fill of ["--hl-open", "--hl-open-1", "--hl-open-2"])
      expect(contrast(c["--fg"]!, c[fill]!), `fg on ${fill}`).toBeGreaterThanOrEqual(2.8);
  });
}
