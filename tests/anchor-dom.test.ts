import { describe, expect, test } from "bun:test";
import { sameNormalizedText, separateBoxes, type Box } from "../web/anchor-dom.ts";

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
