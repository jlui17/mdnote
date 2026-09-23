import type { Annotation, Occurrence } from "./types.ts";

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

/** A match in source offsets, both ends inclusive. */
type Span = [number, number];

function exactSpans(source: string, anchorText: string): Span[] {
  const trimmed = anchorText.trim();
  if (trimmed.length === 0) return [];
  return occurrences(source, trimmed).map((at) => [at, at + trimmed.length - 1]);
}

function normalizedSpans(source: string, anchorText: string): Span[] {
  const hay = normalize(source);
  const needle = normalize(anchorText).text;
  if (needle.length === 0) return [];
  return occurrences(hay.text, needle).map((hit) => [
    hay.map[hit]!,
    hay.map[hit + needle.length - 1]!,
  ]);
}

/** Every place the anchor text may sit, in source order: the exact matches, plus the
 *  normalized matches no exact one contains (the same text crossing markup or a soft
 *  wrap). An anchor holding SKIP characters normalizes lossily ("(x)" would match every
 *  bare "x"), so its normalized matches count only when it has no exact one. */
function candidateSpans(source: string, anchorText: string): Span[] {
  const exact = exactSpans(source, anchorText);
  if (exact.length > 0 && [...anchorText].some((c) => SKIP.has(c))) return exact;
  const crossing = normalizedSpans(source, anchorText).filter(
    (n) => !exact.some((e) => e[0] <= n[0] && n[1] <= e[1]),
  );
  return [...exact, ...crossing].sort((a, b) => a[0] - b[0]);
}

const CONTEXT_CHARS = 24;

/** Where `locate` found the anchor text. The column fields (see `Annotation`) are absent
 *  when several matches tied and no hint could tell them apart: no position is better
 *  than a wrong one. */
export interface Located {
  lineRange: [number, number];
  columnRange?: [number, number];
  textBefore?: string;
  textAfter?: string;
}

/** What is known about where the match should be: the selection's block lines plus its
 *  `occurrence` when creating, the annotation's previous position when re-anchoring. */
export type LocateHint = Partial<Located> & { occurrence?: Occurrence };

function position(source: string, starts: number[], [start, end]: Span): Required<Located> {
  const lineRange: [number, number] = [lineAt(starts, start), lineAt(starts, end)];
  const lineStart = starts[lineRange[0] - 1]!;
  const newline = source.indexOf("\n", end);
  const lineEnd = newline === -1 ? source.length : newline;
  return {
    lineRange,
    columnRange: [start - lineStart + 1, end - starts[lineRange[1] - 1]! + 1],
    textBefore: source.slice(Math.max(lineStart, start - CONTEXT_CHARS), start),
    textAfter: source.slice(end + 1, Math.min(lineEnd, end + 1 + CONTEXT_CHARS)),
  };
}

function startsWithin(starts: number[], lines: [number, number]): (span: Span) => boolean {
  return ([start]) => {
    const line = lineAt(starts, start);
    return line >= lines[0] && line <= lines[1];
  };
}

/** The candidate the hint ranks best: nearest to the hinted lines (a range, since on
 *  create it is the whole block: any start line inside it is distance 0), then agreeing
 *  context (both sides beat one beats none), then nearest start column; the earliest
 *  wins what is left, and `tied` says the hint had nothing to separate it from another. */
function pick(
  source: string,
  starts: number[],
  spans: Span[],
  hint: LocateHint,
): { at: Required<Located>; tied: boolean } {
  const rank = (at: Required<Located>): number[] => [
    hint.lineRange
      ? Math.max(hint.lineRange[0] - at.lineRange[0], at.lineRange[0] - hint.lineRange[1], 0)
      : 0,
    -(Number(at.textBefore === hint.textBefore) + Number(at.textAfter === hint.textAfter)),
    hint.columnRange ? Math.abs(at.columnRange[0] - hint.columnRange[0]) : 0,
  ];
  let best = position(source, starts, spans[0]!);
  let bestRank = rank(best);
  let tied = false;
  for (const span of spans.slice(1)) {
    const at = position(source, starts, span);
    const r = rank(at);
    const i = r.findIndex((v, k) => v !== bestRank[k]);
    if (i === -1) tied = true;
    else if (r[i]! < bestRank[i]!) {
      best = at;
      bestRank = r;
      tied = false;
    }
  }
  return { at: best, tied };
}

export function locate(source: string, anchorText: string, hint: LocateHint = {}): Located | null {
  const starts = lineStarts(source);

  const spans = candidateSpans(source, anchorText);

  if (hint.lineRange && hint.occurrence) {
    const inBlock = spans.filter(startsWithin(starts, hint.lineRange));
    const span = inBlock[hint.occurrence.index];
    if (span && inBlock.length === hint.occurrence.total) return position(source, starts, span);
  }

  if (spans.length === 0) return null;
  const { at, tied } = pick(source, starts, spans, hint);
  return tied ? { lineRange: at.lineRange } : at;
}

/** Which match of its anchor text `a` is within its innermost stamped block, for the
 *  client to paint: the stored column turned back into an `Occurrence`, counted over the
 *  same candidates `locate` resolves an occurrence against, so the two round-trip.
 *  `blocks` are the document's stamped line ranges. Null when `a` has no column or no
 *  match starts there. */
export function occurrenceOf(
  source: string,
  a: Annotation,
  blocks: [number, number][],
): Occurrence | null {
  if (!a.anchorText || !a.lineRange || !a.columnRange) return null;
  const line = a.lineRange[0];
  let block: [number, number] | undefined;
  for (const b of blocks) {
    if (b[0] > line || b[1] < line) continue;
    if (!block || b[1] - b[0] < block[1] - block[0]) block = b;
  }
  if (!block) return null;
  const starts = lineStarts(source);
  const start = starts[line - 1]! + a.columnRange[0] - 1;
  const inBlock = candidateSpans(source, a.anchorText).filter(startsWithin(starts, block));
  const index = inBlock.findIndex((span) => span[0] === start);
  return index === -1 ? null : { index, total: inBlock.length };
}

export function reanchor(source: string, annotations: Annotation[]): Annotation[] {
  const out: Annotation[] = [];
  for (const a of annotations) {
    if (a.anchorText === null) {
      out.push(a);
      continue;
    }
    const { columnRange, textBefore, textAfter, ...rest } = a;
    const found = locate(source, a.anchorText, {
      lineRange: a.lineRange ?? undefined,
      columnRange,
      textBefore,
      textAfter,
    });
    if (found)
      out.push({
        ...rest,
        ...(a.block ? { lineRange: found.lineRange } : found),
        status: "open" as const,
      });
    // A stale draft has no resume handle (drafts paint only through their doc
    // anchor), so it is deleted rather than kept invisible and immortal.
    else if (!a.draft) out.push({ ...a, status: "stale" as const });
  }
  return out;
}
