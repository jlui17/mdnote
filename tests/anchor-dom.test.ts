import { describe, expect, test } from "bun:test";
import {
  nthMatch,
  occurrenceAt,
  sameNormalizedText,
  separateBoxes,
  type Box,
} from "../web/anchor-dom.ts";

describe("sameNormalizedText", () => {
  test("exact match", () => {
    expect(sameNormalizedText("First paragraph.", "First paragraph.")).toBe(true);
  });

  test("whitespace runs are equivalent, matching locateSegments' normalization", () => {
    expect(sameNormalizedText("item one\nitem two", "item one   item two")).toBe(true);
  });

  test("leading/trailing whitespace does not affect the match", () => {
    expect(sameNormalizedText("  Filler paragraph.  ", "Filler paragraph.")).toBe(true);
  });

  test("a partial span of the text does not match", () => {
    expect(sameNormalizedText("First paragraph.", "First")).toBe(false);
  });

  test("text spanning two different blocks does not match either alone", () => {
    expect(sameNormalizedText("item one", "item one item two")).toBe(false);
  });
});

describe("nthMatch", () => {
  const text = "she said she knew that she was late";

  test("without an occurrence it is the first match", () => {
    expect(nthMatch(text, "she")).toBe(0);
    expect(nthMatch(text, "knew")).toBe(13);
  });

  test("an occurrence names its match by index", () => {
    expect(nthMatch(text, "she", { index: 0, total: 3 })).toBe(0);
    expect(nthMatch(text, "she", { index: 1, total: 3 })).toBe(9);
    expect(nthMatch(text, "she", { index: 2, total: 3 })).toBe(23);
  });

  test("an occurrence whose total disagrees with this text names nothing", () => {
    expect(nthMatch(text, "she", { index: 1, total: 2 })).toBeUndefined();
    expect(nthMatch(text, "she", { index: 1, total: 4 })).toBeUndefined();
  });

  test("overlapping matches each count, as they do on the server", () => {
    expect(nthMatch("aaaa", "aa", { index: 2, total: 3 })).toBe(2);
  });

  test("no match is undefined", () => {
    expect(nthMatch(text, "he said he")).toBeUndefined();
  });
});

describe("occurrenceAt", () => {
  const block = "she said\n  she knew that she was late";

  test("names the match starting where the selection starts", () => {
    expect(occurrenceAt(block, "she", 0)).toEqual({ index: 0, total: 3 });
    expect(occurrenceAt(block, "she", 11)).toEqual({ index: 1, total: 3 });
    expect(occurrenceAt(block, "she", 25)).toEqual({ index: 2, total: 3 });
  });

  test("a selection starting in the whitespace before its match still names it", () => {
    expect(occurrenceAt(block, " she", 8)).toEqual({ index: 1, total: 3 });
  });

  test("whitespace runs in the block do not shift the count", () => {
    expect(occurrenceAt(block, "said she", 4)).toEqual({ index: 0, total: 1 });
  });

  test("no match at or after the selection start is undefined", () => {
    expect(occurrenceAt(block, "she", 26)).toBeUndefined();
    expect(occurrenceAt(block, "he left", 0)).toBeUndefined();
  });
});

describe("separateBoxes", () => {
  const box = (top: number, height: number, left = 0, width = 100): Box => ({
    left,
    top,
    width,
    height,
  });

  test("halo-deep overlap separates into two boxes with the gap between them", () => {
    const a = box(0, 20);
    const b = box(16, 20); // overlaps a by 4px, the halo collision of adjacent list items
    separateBoxes([a, b], 8, 4);
    expect(a.top + a.height + 4).toBe(b.top);
    expect(b.top + b.height).toBe(36); // bottom edge unchanged
    expect(a.top).toBe(0); // top edge unchanged
  });

  test("exactly touching boxes still open the gap", () => {
    const a = box(0, 20);
    const b = box(20, 20);
    separateBoxes([a, b], 8, 4);
    expect(a.height).toBe(18);
    expect(b.top).toBe(22);
    expect(b.height).toBe(18);
  });

  test("overlap deeper than maxOverlap (a nested box) stays as measured", () => {
    const outer = box(0, 100);
    const inner = box(30, 20, 10, 80);
    separateBoxes([outer, inner], 8, 4);
    expect(outer).toEqual(box(0, 100));
    expect(inner).toEqual(box(30, 20, 10, 80));
  });

  test("horizontally disjoint boxes never separate", () => {
    const a = box(0, 20, 0, 40);
    const b = box(16, 20, 60, 40);
    separateBoxes([a, b], 8, 4);
    expect(a).toEqual(box(0, 20, 0, 40));
    expect(b).toEqual(box(16, 20, 60, 40));
  });

  test("boxes already gap-or-more apart stay as measured", () => {
    const a = box(0, 20);
    const b = box(24, 20);
    separateBoxes([a, b], 8, 4);
    expect(a).toEqual(box(0, 20));
    expect(b).toEqual(box(24, 20));
  });

  test("input order does not matter", () => {
    const a = box(20, 20);
    const b = box(0, 20);
    separateBoxes([a, b], 8, 4);
    expect(b.height).toBe(18);
    expect(a.top).toBe(22);
  });

  test("a run of three adjacent boxes gets a gap at each seam", () => {
    const boxes = [box(0, 20), box(16, 20), box(32, 20)];
    separateBoxes(boxes, 8, 4);
    expect(boxes[0]!.top + boxes[0]!.height + 4).toBeCloseTo(boxes[1]!.top);
    expect(boxes[1]!.top + boxes[1]!.height + 4).toBeCloseTo(boxes[2]!.top);
  });
});
