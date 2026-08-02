export interface Segment {
  node: Text;
  start: number;
  end: number;
}

export interface SelectionAnchor {
  lineRange: [number, number];
  anchorText: string;
  rect: DOMRect;
  /** Survives the native selection collapsing when the popover takes the click. */
  range: Range;
  /** Set for whole-block anchors: the stamped elements the anchor covers (a consecutive
   *  sibling run, usually one), so pending paints the block box, not the text. */
  blocks?: Element[];
}

export function parseStamp(el: Element): [number, number] | null {
  const raw = el.getAttribute("data-source-line");
  if (!raw) return null;
  const [a, b] = raw.split("-");
  const start = Number(a);
  const end = Number(b ?? a);
  return Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null;
}

function textNodes(root: Node): { nodes: Text[]; starts: number[]; text: string } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    nodes.push(t);
    starts.push(text.length);
    text += t.data;
    n = walker.nextNode();
  }
  return { nodes, starts, text };
}

/** Collapses whitespace runs to one space, keeping a raw-index per output char. */
function normalize(raw: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === " ") {
      if (!inSpace && norm.length > 0) {
        norm += " ";
        map.push(i);
        inSpace = true;
      }
    } else {
      norm += c;
      map.push(i);
      inSpace = false;
    }
  }
  while (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

export function locateSegments(root: Node, anchorText: string): Segment[] | null {
  const target = normalize(anchorText).norm;
  if (!target) return null;
  const { nodes, starts, text } = textNodes(root);
  const { norm, map } = normalize(text);
  const hit = norm.indexOf(target);
  if (hit < 0) return null;
  const rawStart = map[hit]!;
  const rawEnd = map[hit + target.length - 1]! + 1;

  const segs: Segment[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const nodeStart = starts[i]!;
    const nodeEnd = nodeStart + nodes[i]!.data.length;
    const s = Math.max(rawStart, nodeStart);
    const e = Math.min(rawEnd, nodeEnd);
    if (e > s) segs.push({ node: nodes[i]!, start: s - nodeStart, end: e - nodeStart });
  }
  return segs.length ? segs : null;
}

/** Blocks whose stamped source range overlaps `lineRange`, innermost first. */
function candidateBlocks(doc: Element, lineRange: [number, number] | null): Element[] {
  if (!lineRange) return [];
  const out: { el: Element; span: number }[] = [];
  for (const el of doc.querySelectorAll("[data-source-line]")) {
    const parsed = parseStamp(el);
    if (!parsed) continue;
    if (parsed[0] <= lineRange[1] && parsed[1] >= lineRange[0]) {
      out.push({ el, span: parsed[1] - parsed[0] });
    }
  }
  out.sort((a, b) => a.span - b.span);
  return out.map((o) => o.el);
}

export function findRange(
  doc: Element,
  anchorText: string,
  lineRange: [number, number] | null,
): Range | null {
  let segs: Segment[] | null = null;
  for (const block of candidateBlocks(doc, lineRange)) {
    segs = locateSegments(block, anchorText);
    if (segs) break;
  }
  segs ??= locateSegments(doc, anchorText);
  if (!segs) return null;
  const first = segs[0]!;
  const last = segs[segs.length - 1]!;
  const range = document.createRange();
  range.setStart(first.node, first.start);
  range.setEnd(last.node, last.end);
  return range;
}

/** The stamped blocks holding `anchorText`, for painting a block annotation's box. */
export function findBlocks(
  doc: Element,
  anchorText: string,
  lineRange: [number, number] | null,
): Element[] | null {
  const range = findRange(doc, anchorText, lineRange);
  return range && blockRun(doc, range);
}

/** True when `a` and `b` are the same text after collapsing whitespace runs — the same
 *  equivalence `locateSegments` matches against, reused so block promotion agrees with anchoring. */
export function sameNormalizedText(a: string, b: string): boolean {
  return normalize(a).norm === normalize(b).norm;
}

/** The consecutive run of stamped blocks a range spans: the endpoints lifted to children
 *  of the range's common ancestor and the siblings between them — so two list items form
 *  a run of items, not their list. When no such run exists (endpoints inside one block,
 *  or an unstamped sibling in between), the enclosing stamped block alone is the run;
 *  null when there is none. */
export function blockRun(doc: Element, range: Range): Element[] | null {
  const node = range.commonAncestorContainer;
  const anc = node instanceof Element ? node : node.parentElement;
  if (!anc || !doc.contains(anc)) return null;
  const lift = (n: Node): Element | null => {
    let el: Element | null = n instanceof Element ? n : n.parentElement;
    while (el && el !== anc && el.parentElement !== anc) el = el.parentElement;
    return el === anc ? null : el;
  };
  const first = lift(range.startContainer);
  const last = lift(range.endContainer);
  if (first && last) {
    const run: Element[] = [];
    for (let el: Element | null = first; el; el = el.nextElementSibling) {
      if (!parseStamp(el)) break;
      run.push(el);
      if (el === last) return run;
    }
  }
  const single = anc.closest("[data-source-line]");
  return single && doc.contains(single) && parseStamp(single) ? [single] : null;
}

/** Anchor covering a run of stamped blocks' full contents. Null for stampless or text-free runs. */
export function blockAnchor(blocks: Element[]): SelectionAnchor | null {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) return null;
  const start = parseStamp(first);
  const end = parseStamp(last);
  const anchorText = blocks.map((el) => el.textContent ?? "").join("\n\n");
  if (!start || !end || !anchorText.trim()) return null;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  return {
    lineRange: [start[0], end[1]],
    anchorText,
    rect: range.getBoundingClientRect(),
    range,
    blocks,
  };
}

function nearestStamp(doc: Element, node: Node | null): [number, number] | null {
  let el: Element | null = node instanceof Element ? node : (node?.parentElement ?? null);
  while (el && doc.contains(el)) {
    const parsed = parseStamp(el);
    if (parsed) return parsed;
    el = el.parentElement;
  }
  return null;
}

export function selectionAnchor(doc: Element): SelectionAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!doc.contains(range.startContainer) || !doc.contains(range.endContainer)) return null;
  const anchorText = sel.toString();
  if (!anchorText.trim()) return null;
  // A drag or triple-click often spills an endpoint just inside a neighbor block (offset 0
  // of the next, or the very end of the previous), adding it to the run with no selected
  // text; the trimmed variants let such a selection still promote.
  const run = blockRun(doc, range) ?? [];
  const runs = [run, run.slice(0, -1), run.slice(1), run.slice(1, -1)];
  for (const r of runs) {
    const promoted = r.length ? blockAnchor(r) : null;
    if (promoted && sameNormalizedText(promoted.anchorText, anchorText)) return promoted;
  }
  const a = nearestStamp(doc, range.startContainer);
  const b = nearestStamp(doc, range.endContainer);
  if (!a && !b) return null;
  const start = a ?? b!;
  const end = b ?? a!;
  return {
    lineRange: [Math.min(start[0], end[0]), Math.max(start[1], end[1])],
    anchorText,
    rect: range.getBoundingClientRect(),
    range: range.cloneRange(),
  };
}

export function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = d.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}
