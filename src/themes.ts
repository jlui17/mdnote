/** `system` follows the OS; `light`/`dark` are mdnote's own palettes. */
export const THEME_MODES = ["system", "light", "dark"] as const;

/** Named palettes mirror the DaisyUI themes of the same name; each has a token block in web/themes.css. */
export const THEME_NAMES = [
  "abyss",
  "aqua",
  "coffee",
  "cupcake",
  "cyberpunk",
  "dim",
  "dracula",
  "forest",
  "halloween",
  "luxury",
  "night",
  "nord",
  "retro",
  "sunset",
  "synthwave",
  "valentine",
] as const;

export const THEMES = [...THEME_MODES, ...THEME_NAMES] as const;

export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}
