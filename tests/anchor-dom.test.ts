import { describe, expect, test } from "bun:test";
import { sameNormalizedText } from "../web/anchor-dom.ts";

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
