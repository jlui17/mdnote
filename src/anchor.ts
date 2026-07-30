import type { Annotation } from "./types.ts";

const SKIP = new Set([..."*_`~[]()#>-"]);

/** Normalized view of `s`: markdown punctuation dropped, whitespace runs collapsed
 *  to one space. `map[i]` is the source offset that produced normalized char `i`. */
function normalize(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (SKIP.has(c)) continue;
    if (/\s/.test(c)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += " ";
      map.push(i);
      pendingSpace = false;
    }
    text += c;
    map.push(i);
  }
  return { text, map };
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) out.push(i);
  return out;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function pick<T>(
  candidates: T[],
  starts: number[],
  hintRange: [number, number] | undefined,
  offsetOf: (c: T) => number,
): T {
  if (!hintRange || candidates.length === 1) return candidates[0] as T;
  let best = candidates[0] as T;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = Math.abs(lineAt(starts, offsetOf(c)) - hintRange[0]);
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

export function locate(
  source: string,
  anchorText: string,
  hintRange?: [number, number],
): [number, number] | null {
  const starts = lineStarts(source);

  const trimmed = anchorText.trim();
  if (trimmed.length === 0) return null;

  const exact = occurrences(source, trimmed);
  if (exact.length > 0) {
    const at = pick(exact, starts, hintRange, (o) => o);
    return [lineAt(starts, at), lineAt(starts, at + trimmed.length - 1)];
  }

  const hay = normalize(source);
  const needle = normalize(anchorText);
  if (needle.text.length === 0) return null;

  const hits = occurrences(hay.text, needle.text);
  if (hits.length === 0) return null;

  const start = pick(hits, starts, hintRange, (h) => hay.map[h]!);
  return [
    lineAt(starts, hay.map[start]!),
    lineAt(starts, hay.map[start + needle.text.length - 1]!),
  ];
}

export function reanchor(source: string, annotations: Annotation[]): Annotation[] {
  return annotations.map((a) => {
    if (a.anchorText === null) return a;
    const found = locate(source, a.anchorText, a.lineRange ?? undefined);
    return found
      ? { ...a, lineRange: found, status: "open" as const }
      : { ...a, status: "stale" as const };
  });
}
