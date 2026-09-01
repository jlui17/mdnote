/**
 * Resolves the CSS color forms the theme token blocks use (hex, rgb(), oklch(), var(),
 * light-dark(), color-mix() in oklab or srgb) to linear sRGB and measures them: WCAG
 * contrast, and CIE Lab distance under simulated red-green color blindness
 * (Machado et al. 2009, full severity). Shared by the theme tests; not a test itself.
 */

/** Linear sRGB, nominally 0..1; out-of-gamut values are clipped at the end of resolution. */
export type RGB = [number, number, number];

export class ColorSyntaxError extends Error {}

/** Substitutes every var() textually, the way the cascade does, then parses the result. */
export function resolveColor(expr: string, vars: Map<string, string>, scheme: "light" | "dark"): RGB {
  return parse(expand(expr, vars, 0), scheme);
}

function expand(expr: string, vars: Map<string, string>, depth: number): string {
  if (depth > 32) throw new ColorSyntaxError(`var() cycle while resolving ${expr}`);
  return expr.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const value = vars.get(name);
    if (value === undefined) throw new ColorSyntaxError(`undefined ${name}`);
    return expand(value, vars, depth + 1);
  });
}

function parse(expr: string, scheme: "light" | "dark"): RGB {
  const s = expr.trim();
  if (s.startsWith("#")) return clip(hexToLinear(s));
  const fn = s.match(/^([a-z-]+)\((.*)\)$/s);
  if (!fn) throw new ColorSyntaxError(`unsupported color: ${s}`);
  const [, name, inner] = fn;
  const args = splitTopLevel(inner!);
  const sub = (e: string) => parse(e, scheme);
  switch (name) {
    case "light-dark": {
      if (args.length !== 2) throw new ColorSyntaxError(`light-dark needs two colors: ${s}`);
      return sub(scheme === "light" ? args[0]! : args[1]!);
    }
    case "color-mix": {
      const space = args[0]?.trim().match(/^in\s+(oklab|srgb)$/)?.[1];
      if (!space || args.length !== 3) throw new ColorSyntaxError(`unsupported color-mix: ${s}`);
      const [a, pa] = splitPercent(args[1]!);
      const [b, pb] = splitPercent(args[2]!);
      const wa = pa ?? (pb === null ? 50 : 100 - pb);
      const wb = pb ?? 100 - wa;
      const t = wb / (wa + wb);
      const ca = sub(a);
      const cb = sub(b);
      if (space === "oklab") return clip(oklabToLinear(lerp3(linearToOklab(ca), linearToOklab(cb), t)));
      return clip(lerp3(ca.map(toGamma) as RGB, cb.map(toGamma) as RGB, t).map(toLinear) as RGB);
    }
    case "oklch": {
      const parts = inner!.split("/")[0]!.trim().split(/\s+/);
      if (parts.length !== 3) throw new ColorSyntaxError(`oklch needs L C H: ${s}`);
      const L = parts[0]!.endsWith("%") ? parseFloat(parts[0]!) / 100 : parseFloat(parts[0]!);
      const C = parseFloat(parts[1]!);
      const H = (parseFloat(parts[2]!) * Math.PI) / 180;
      return clip(oklabToLinear([L, C * Math.cos(H), C * Math.sin(H)]));
    }
    case "rgb":
    case "rgba": {
      const parts = inner!.split("/")[0]!.trim().split(/[\s,]+/);
      if (parts.length !== 3) throw new ColorSyntaxError(`rgb needs three channels: ${s}`);
      return clip(parts.map((p) => toLinear(parseFloat(p) / 255)) as RGB);
    }
    default:
      throw new ColorSyntaxError(`unsupported color function ${name}(): ${s}`);
  }
}

/** `--name: value;` and `color-scheme: value;` declarations of a CSS block body, in source order. */
export function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of stripped.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((a) => a.trim()).filter((a) => a.length > 0);
}

function splitPercent(arg: string): [string, number | null] {
  const m = arg.trim().match(/^(.*?)\s+([\d.]+)%$/s);
  return m ? [m[1]!, parseFloat(m[2]!)] : [arg.trim(), null];
}

function hexToLinear(hex: string): RGB {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => toLinear(c / 255)) as RGB;
}

export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const clip = (c: RGB): RGB => c.map((v) => Math.min(1, Math.max(0, v))) as RGB;
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as RGB;
const cbrt = (v: number) => Math.sign(v) * Math.abs(v) ** (1 / 3);

export function linearToOklab([r, g, b]: RGB): RGB {
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function toHex(c: RGB): string {
  return (
    "#" +
    c
      .map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** WCAG 2 contrast ratio, order-independent. */
export function contrast(a: RGB, b: RGB): number {
  const lum = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type Vision = "normal" | "protanopia" | "deuteranopia";
export const VISIONS: Vision[] = ["normal", "protanopia", "deuteranopia"];

const CVD: Record<Exclude<Vision, "normal">, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

export function simulate(c: RGB, vision: Vision): RGB {
  if (vision === "normal") return c;
  const m = CVD[vision];
  return clip(m.map((row) => row[0]! * c[0] + row[1]! * c[1] + row[2]! * c[2]) as RGB);
}

function linearToLab([r, g, b]: RGB): RGB {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 Lab distance. */
export function deltaE(a: RGB, b: RGB): number {
  const la = linearToLab(a);
  const lb = linearToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** Smallest pairwise distance among `colors` under `vision`. */
export function minPairwiseDeltaE(colors: RGB[], vision: Vision): number {
  let min = Infinity;
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++)
      min = Math.min(min, deltaE(simulate(colors[i]!, vision), simulate(colors[j]!, vision)));
  return min;
}
