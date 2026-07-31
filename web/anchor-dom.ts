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
  /** Set for whole-block anchors: the stamped element, so pending paints the block box, not the text. */
  block?: Element;
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

/** Anchor covering a stamped block's full contents. Null for stampless or text-free blocks. */
export function blockAnchor(block: Element): SelectionAnchor | null {
  const lineRange = parseStamp(block);
  const anchorText = block.textContent ?? "";
  if (!lineRange || !anchorText.trim()) return null;
  const range = document.createRange();
  range.selectNodeContents(block);
  return { lineRange, anchorText, rect: block.getBoundingClientRect(), range, block };
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
