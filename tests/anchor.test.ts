import { describe, expect, test } from "bun:test";
import { locate, reanchor } from "../src/anchor.ts";
import type { Annotation } from "../src/types.ts";

const doc = [
  "# Title", // 1
  "", // 2
  "First paragraph with **bold** word and `code` here.", // 3
  "", // 4
  "A sentence that is", // 5
  "soft wrapped across lines.", // 6
  "", // 7
  "- item one", // 8
  "- item two", // 9
  "", // 10
  "The duplicate phrase appears here.", // 11
  "", // 12
  "Filler paragraph.", // 13
  "", // 14
  "The duplicate phrase appears here.", // 15
  "", // 16
].join("\n");

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: "a",
    type: "comment",
    lineRange: [1, 1],
    anchorText: "x",
    note: "n",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "open",
    ...over,
  };
}

describe("locate", () => {
  test("exact substring match", () => {
    expect(locate(doc, "Filler paragraph.")).toEqual([13, 13]);
  });

  test("heading text ignores the leading hashes", () => {
    expect(locate(doc, "Title")).toEqual([1, 1]);
  });

  test("rendered text matches source with bold markers stripped", () => {
    expect(locate(doc, "paragraph with bold word")).toEqual([3, 3]);
  });

  test("rendered text matches source with code backticks stripped", () => {
    expect(locate(doc, "bold word and code here.")).toEqual([3, 3]);
  });

  test("italic markers are tolerated", () => {
    expect(locate("some _emphasised_ text\n", "some emphasised text")).toEqual([1, 1]);
  });

  test("a selection crossing a soft wrap spans both lines", () => {
    expect(locate(doc, "that is soft wrapped")).toEqual([5, 6]);
  });

  test("a selection spanning a whole wrapped paragraph", () => {
    expect(locate(doc, "A sentence that is soft wrapped across lines.")).toEqual([5, 6]);
  });

  test("list markers are stripped so item text matches", () => {
    expect(locate(doc, "item one")).toEqual([8, 8]);
  });

  test("a selection across two list items spans both lines", () => {
    expect(locate(doc, "item one item two")).toEqual([8, 9]);
  });

  test("whitespace runs are equivalent", () => {
    expect(locate("a    b\n", "a b")).toEqual([1, 1]);
    expect(locate("a b\n", "a    b")).toEqual([1, 1]);
  });

  test("duplicated text without a hint takes the first occurrence", () => {
    expect(locate(doc, "The duplicate phrase")).toEqual([11, 11]);
  });

  test("hintRange disambiguates duplicates", () => {
    expect(locate(doc, "The duplicate phrase", [15, 15])).toEqual([15, 15]);
    expect(locate(doc, "The duplicate phrase", [14, 16])).toEqual([15, 15]);
    expect(locate(doc, "The duplicate phrase", [11, 11])).toEqual([11, 11]);
  });

  test("hintRange disambiguates duplicates that only match normalized", () => {
    const src = "the **same** phrase\n\nfiller\n\nthe **same** phrase\n";
    expect(locate(src, "the same phrase", [5, 5])).toEqual([5, 5]);
    expect(locate(src, "the same phrase", [1, 1])).toEqual([1, 1]);
  });

  test("missing text returns null", () => {
    expect(locate(doc, "nothing like this exists")).toBeNull();
  });

  test("empty or whitespace-only anchor returns null", () => {
    expect(locate(doc, "")).toBeNull();
    expect(locate(doc, "   \n ")).toBeNull();
  });

  test("leading and trailing whitespace in the selection is ignored", () => {
    expect(locate(doc, "  Filler paragraph.  ")).toEqual([13, 13]);
  });

  test("blockquote markers are stripped", () => {
    const src = "intro\n\n> quoted line\n> continues here\n";
    expect(locate(src, "quoted line continues here")).toEqual([3, 4]);
  });

  test("link text matches without the URL syntax", () => {
    const src = "see [the docs](http://example.com) for more\n";
    expect(locate(src, "see the docs")).toEqual([1, 1]);
  });
});

describe("reanchor", () => {
  test("found annotations stay open and get an updated lineRange", () => {
    const moved = "new intro\n\nmore intro\n\n" + doc;
    const out = reanchor(moved, [ann({ anchorText: "Filler paragraph.", lineRange: [13, 13] })]);
    expect(out[0]!.status).toBe("open");
    expect(out[0]!.lineRange).toEqual([17, 17]);
  });

  test("missing anchor text goes stale with its lineRange kept", () => {
    const out = reanchor(doc, [ann({ anchorText: "deleted sentence", lineRange: [3, 3] })]);
    expect(out[0]!.status).toBe("stale");
    expect(out[0]!.lineRange).toEqual([3, 3]);
  });

  test("a stale annotation reopens when its text comes back", () => {
    const out = reanchor(doc, [
      ann({ anchorText: "Filler paragraph.", lineRange: [1, 1], status: "stale" }),
    ]);
    expect(out[0]!.status).toBe("open");
    expect(out[0]!.lineRange).toEqual([13, 13]);
  });

  test("global annotations pass through untouched", () => {
    const global = ann({ type: "global", lineRange: null, anchorText: null });
    const out = reanchor(doc, [global]);
    expect(out[0]).toEqual(global);
  });

  test("the existing lineRange biases re-anchoring of duplicated text", () => {
    const out = reanchor(doc, [ann({ anchorText: "The duplicate phrase", lineRange: [15, 15] })]);
    expect(out[0]!.lineRange).toEqual([15, 15]);
  });

  test("input annotations are not mutated", () => {
    const input = ann({ anchorText: "gone forever", lineRange: [2, 2] });
    reanchor(doc, [input]);
    expect(input.status).toBe("open");
  });
});
