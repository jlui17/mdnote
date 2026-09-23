import { describe, expect, test } from "bun:test";
import { locate, occurrenceOf, reanchor } from "../src/anchor.ts";
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
    expect(locate(doc, "Filler paragraph.")?.lineRange).toEqual([13, 13]);
  });

  test("heading text ignores the leading hashes", () => {
    expect(locate(doc, "Title")?.lineRange).toEqual([1, 1]);
  });

  test("rendered text matches source with bold markers stripped", () => {
    expect(locate(doc, "paragraph with bold word")?.lineRange).toEqual([3, 3]);
  });

  test("rendered text matches source with code backticks stripped", () => {
    expect(locate(doc, "bold word and code here.")?.lineRange).toEqual([3, 3]);
  });

  test("italic markers are tolerated", () => {
    expect(locate("some _emphasised_ text\n", "some emphasised text")?.lineRange).toEqual([1, 1]);
  });

  test("a selection crossing a soft wrap spans both lines", () => {
    expect(locate(doc, "that is soft wrapped")?.lineRange).toEqual([5, 6]);
  });

  test("a selection spanning a whole wrapped paragraph", () => {
    expect(locate(doc, "A sentence that is soft wrapped across lines.")?.lineRange).toEqual([5, 6]);
  });

  test("list markers are stripped so item text matches", () => {
    expect(locate(doc, "item one")?.lineRange).toEqual([8, 8]);
  });

  test("a selection across two list items spans both lines", () => {
    expect(locate(doc, "item one item two")?.lineRange).toEqual([8, 9]);
  });

  test("whitespace runs are equivalent", () => {
    expect(locate("a    b\n", "a b")?.lineRange).toEqual([1, 1]);
    expect(locate("a b\n", "a    b")?.lineRange).toEqual([1, 1]);
  });

  test("duplicated text without a hint takes the first occurrence", () => {
    expect(locate(doc, "The duplicate phrase")?.lineRange).toEqual([11, 11]);
  });

  test("hintRange disambiguates duplicates", () => {
    expect(locate(doc, "The duplicate phrase", { lineRange: [15, 15] })?.lineRange).toEqual([15, 15]);
    expect(locate(doc, "The duplicate phrase", { lineRange: [14, 16] })?.lineRange).toEqual([15, 15]);
    expect(locate(doc, "The duplicate phrase", { lineRange: [11, 11] })?.lineRange).toEqual([11, 11]);
  });

  test("hintRange disambiguates duplicates that only match normalized", () => {
    const src = "the **same** phrase\n\nfiller\n\nthe **same** phrase\n";
    expect(locate(src, "the same phrase", { lineRange: [5, 5] })?.lineRange).toEqual([5, 5]);
    expect(locate(src, "the same phrase", { lineRange: [1, 1] })?.lineRange).toEqual([1, 1]);
  });

  test("missing text returns null", () => {
    expect(locate(doc, "nothing like this exists")).toBeNull();
  });

  test("empty or whitespace-only anchor returns null", () => {
    expect(locate(doc, "")).toBeNull();
    expect(locate(doc, "   \n ")).toBeNull();
  });

  test("leading and trailing whitespace in the selection is ignored", () => {
    expect(locate(doc, "  Filler paragraph.  ")?.lineRange).toEqual([13, 13]);
  });

  test("blockquote markers are stripped", () => {
    const src = "intro\n\n> quoted line\n> continues here\n";
    expect(locate(src, "quoted line continues here")?.lineRange).toEqual([3, 4]);
  });

  test("link text matches without the URL syntax", () => {
    const src = "see [the docs](http://example.com) for more\n";
    expect(locate(src, "see the docs")?.lineRange).toEqual([1, 1]);
  });
});

// "she" sits at columns 1, 10 and 24 of line 3.
const sheLine = "she said she knew that she was late.";
const she = `intro\n\n${sheLine}\n\noutro\n`;
const middleShe = {
  lineRange: [3, 3] as [number, number],
  columnRange: [10, 12] as [number, number],
  textBefore: "she said ",
  textAfter: " knew that she was late.",
};

describe("locate: which match", () => {
  test("an occurrence picks the first, middle, or last match on one line", () => {
    const at = (index: number) =>
      locate(she, "she", { lineRange: [3, 3], occurrence: { index, total: 3 } });
    expect(at(0)).toEqual({
      lineRange: [3, 3],
      columnRange: [1, 3],
      textBefore: "",
      textAfter: " said she knew that she ",
    });
    expect(at(1)).toEqual(middleShe);
    expect(at(2)).toEqual({
      lineRange: [3, 3],
      columnRange: [24, 26],
      textBefore: "she said she knew that ",
      textAfter: " was late.",
    });
  });

  test("an occurrence counts matches that cross markup along with the plain ones", () => {
    const src = "she said, **she** said, she said.\n";
    const hint = { lineRange: [1, 1] as [number, number], occurrence: { index: 1, total: 3 } };
    expect(locate(src, "she said", hint)).toEqual({
      lineRange: [1, 1],
      columnRange: [13, 22],
      textBefore: "she said, **",
      textAfter: ", she said.",
    });
  });

  test("an occurrence picks the right line of a soft-wrapped paragraph", () => {
    const src = "then she left\nand nobody saw\nwhere she went\n";
    const hint = { lineRange: [1, 3] as [number, number], occurrence: { index: 1, total: 2 } };
    expect(locate(src, "she", hint)).toEqual({
      lineRange: [3, 3],
      columnRange: [7, 9],
      textBefore: "where ",
      textAfter: " went",
    });
  });

  test("an occurrence counts only matches that start inside the hinted block", () => {
    const src = `she came\n\n${sheLine}\n`;
    const hint = { lineRange: [3, 3] as [number, number], occurrence: { index: 0, total: 3 } };
    expect(locate(src, "she", hint)?.columnRange).toEqual([1, 3]);
    expect(locate(src, "she", hint)?.lineRange).toEqual([3, 3]);
  });

  test("an occurrence whose total disagrees yields lines without columns", () => {
    const hint = { lineRange: [3, 3] as [number, number], occurrence: { index: 1, total: 5 } };
    expect(locate(she, "she", hint)).toEqual({ lineRange: [3, 3] });
  });

  test("a same-line tie with no way to break it yields lines without columns", () => {
    expect(locate(she, "she", { lineRange: [3, 3] })).toEqual({ lineRange: [3, 3] });
    expect(locate(she, "she")).toEqual({ lineRange: [3, 3] });
  });

  test("the hinted lines are a range: two matches inside it tie, whatever their lines", () => {
    const src = "then she left\nand nobody saw\nwhere she went\n";
    expect(locate(src, "she", { lineRange: [1, 3] })).toEqual({ lineRange: [1, 1] });
    const mismatched = { lineRange: [1, 3] as [number, number], occurrence: { index: 1, total: 5 } };
    expect(locate(src, "she", mismatched)).toEqual({ lineRange: [1, 1] });
  });

  test("a match outside the hinted lines loses to one inside them", () => {
    const src = "x\nshe came\nalpha\nbeta\ngamma\nthen she left\n";
    expect(locate(src, "she", { lineRange: [3, 6] })).toEqual({
      lineRange: [6, 6],
      columnRange: [6, 8],
      textBefore: "then ",
      textAfter: " left",
    });
  });

  test("a unique match gets columns with no occurrence", () => {
    expect(locate(she, "knew", { lineRange: [3, 3] })).toEqual({
      lineRange: [3, 3],
      columnRange: [14, 17],
      textBefore: "she said she ",
      textAfter: " that she was late.",
    });
  });

  test("the nearest line breaks a tie, so its match gets columns", () => {
    expect(locate(doc, "duplicate", { lineRange: [15, 15] })?.columnRange).toEqual([5, 13]);
  });

  test("a span across lines pairs each column with its own line", () => {
    expect(locate(doc, "that is soft wrapped")).toEqual({
      lineRange: [5, 6],
      columnRange: [12, 12],
      textBefore: "A sentence ",
      textAfter: " across lines.",
    });
  });

  test("a normalized match spans the text alone, not the markers around it", () => {
    expect(locate("he said **she** knew\n", "said she knew")?.columnRange).toEqual([4, 20]);
    expect(locate("**she** knew\n", "she knew")?.columnRange).toEqual([3, 12]);
  });
});

// "the server" crosses bold markers on line 3 and sits plain on line 9.
const servers = [
  "# Ops", // 1
  "", // 2
  "Restart the **server** after the change.", // 3
  "", // 4
  "Filler one.", // 5
  "", // 6
  "Filler two.", // 7
  "", // 8
  "If the server is down, wait.", // 9
  "", // 10
].join("\n");
const markupServer = {
  lineRange: [3, 3] as [number, number],
  columnRange: [9, 20] as [number, number],
  textBefore: "Restart ",
  textAfter: "** after the change.",
};

describe("locate: exact and markup-crossing matches are one candidate list", () => {
  test("create stores the markup-crossing match it was pointed at", () => {
    const hint = { lineRange: [3, 3] as [number, number], occurrence: { index: 0, total: 1 } };
    expect(locate(servers, "the server", hint)).toEqual(markupServer);
  });

  test("re-anchoring stays on the markup-crossing match though a plain one exists", () => {
    const a = ann({ anchorText: "the server", ...markupServer });
    expect(reanchor(servers, [a])[0]).toMatchObject({ status: "open", ...markupServer });
    expect(reanchor("New top line.\n" + servers, [a])[0]).toMatchObject({
      ...markupServer,
      lineRange: [4, 4],
    });
  });

  test("an annotation saved without columns stays on its markup line: the nearest line wins", () => {
    const out = reanchor(servers, [ann({ anchorText: "the server", lineRange: [3, 3] })]);
    expect(out[0]).toMatchObject(markupServer);
  });

  test("a plain match is one candidate, not an exact one plus its normalized twin", () => {
    expect(locate(servers, "Filler two.")?.columnRange).toEqual([1, 11]);
    expect(locate("a  b c\n", "a  b")?.columnRange).toEqual([1, 4]);
  });

  test("an anchor holding markdown punctuation keeps to its exact matches when it has any", () => {
    const src = "x marks (x) and x\n";
    expect(locate(src, "(x)", { lineRange: [1, 1] })).toEqual({
      lineRange: [1, 1],
      columnRange: [9, 11],
      textBefore: "x marks ",
      textAfter: " and x",
    });
    expect(locate("see (**x**) here\n", "(x)")?.columnRange).toEqual([8, 8]);
  });

  test("a position created from an occurrence converts back to the same occurrence", () => {
    const src = "she said, **she** said, she said.\n";
    for (const index of [0, 1, 2]) {
      const occurrence = { index, total: 3 };
      const found = locate(src, "she said", { lineRange: [1, 1], occurrence });
      expect(found?.columnRange).toBeDefined();
      expect(occurrenceOf(src, ann({ anchorText: "she said", ...found }), [[1, 1]])).toEqual(
        occurrence,
      );
    }
  });
});

describe("occurrenceOf", () => {
  test("turns a stored column back into a match index within the innermost block", () => {
    const src = `she came\n\n${sheLine}\n`;
    const a = ann({ anchorText: "she", ...middleShe });
    expect(occurrenceOf(src, a, [[1, 1], [3, 3]])).toEqual({ index: 1, total: 3 });
  });

  test("the innermost block is the smallest stamped range holding the first line", () => {
    const src = "- she and she\n  - she again\n";
    const a = ann({ anchorText: "she", lineRange: [2, 2], columnRange: [5, 7] });
    expect(occurrenceOf(src, a, [[1, 2], [1, 2], [2, 2], [2, 2]])).toEqual({ index: 0, total: 1 });
  });

  test("a match that crosses markup is indexed among the plain ones", () => {
    const src = "she said, **she** said, she said.\n";
    const a = ann({ anchorText: "she said", lineRange: [1, 1], columnRange: [13, 22] });
    expect(occurrenceOf(src, a, [[1, 1]])).toEqual({ index: 1, total: 3 });
  });

  test("null without a column, without a block, or when no match starts there", () => {
    const blocks: [number, number][] = [[3, 3]];
    expect(occurrenceOf(she, ann({ anchorText: "she", lineRange: [3, 3] }), blocks)).toBeNull();
    expect(occurrenceOf(she, ann({ anchorText: "she", ...middleShe }), [])).toBeNull();
    const off = ann({ anchorText: "she", ...middleShe, columnRange: [11, 13] });
    expect(occurrenceOf(she, off, blocks)).toBeNull();
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

  test("a draft that re-anchors survives with its flag", () => {
    const moved = "new intro\n\nmore intro\n\n" + doc;
    const out = reanchor(moved, [
      ann({ anchorText: "Filler paragraph.", lineRange: [13, 13], draft: true }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.draft).toBe(true);
    expect(out[0]!.status).toBe("open");
    expect(out[0]!.lineRange).toEqual([17, 17]);
  });

  test("a draft whose anchor text is gone is deleted, not marked stale", () => {
    const out = reanchor(doc, [
      ann({ anchorText: "deleted sentence", lineRange: [3, 3], draft: true }),
      ann({ id: "b", anchorText: "Filler paragraph.", lineRange: [13, 13] }),
    ]);
    expect(out.map((a) => a.id)).toEqual(["b"]);
  });

  test("global annotations pass through untouched", () => {
    const global = ann({ lineRange: null, anchorText: null });
    const out = reanchor(doc, [global]);
    expect(out[0]).toEqual(global);
  });

  test("the existing lineRange biases re-anchoring of duplicated text", () => {
    const out = reanchor(doc, [ann({ anchorText: "The duplicate phrase", lineRange: [15, 15] })]);
    expect(out[0]!.lineRange).toEqual([15, 15]);
  });

  test("the block marker survives re-anchoring, open or stale", () => {
    const out = reanchor(doc, [
      ann({ id: "moved", anchorText: "Filler paragraph.", lineRange: [1, 1], block: true }),
      ann({ id: "lost", anchorText: "deleted sentence", lineRange: [3, 3], block: true }),
      ann({ id: "text", anchorText: "Filler paragraph.", lineRange: [13, 13] }),
    ]);
    expect(out.map((a) => [a.status, a.block])).toEqual([
      ["open", true],
      ["stale", true],
      ["open", undefined],
    ]);
  });

  test("input annotations are not mutated", () => {
    const input = ann({ anchorText: "gone forever", lineRange: [2, 2] });
    reanchor(doc, [input]);
    expect(input.status).toBe("open");
  });

  test("text inserted earlier on the line moves the columns with the match", () => {
    const edited = she.replace(sheLine, "Well, " + sheLine);
    const out = reanchor(edited, [ann({ anchorText: "she", ...middleShe })]);
    expect(out[0]).toMatchObject({
      status: "open",
      lineRange: [3, 3],
      columnRange: [16, 18],
      textBefore: "Well, she said ",
      textAfter: " knew that she was late.",
    });
  });

  test("a new match inserted earlier on the line does not steal the annotation", () => {
    const edited = she.replace(sheLine, "she and " + sheLine);
    const out = reanchor(edited, [ann({ anchorText: "she", ...middleShe })]);
    expect(out[0]).toMatchObject({
      lineRange: [3, 3],
      columnRange: [18, 20],
      textBefore: "she and she said ",
      textAfter: " knew that she was late.",
    });
  });

  test("the previous column breaks a tie the context cannot", () => {
    const edited = she.replace(sheLine, "she heard she knew what she was told.");
    const out = reanchor(edited, [ann({ anchorText: "she", ...middleShe })]);
    expect(out[0]!.columnRange).toEqual([11, 13]);
  });

  test("a line inserted above moves the lines and keeps the columns", () => {
    const out = reanchor("new intro\n" + she, [ann({ anchorText: "she", ...middleShe })]);
    expect(out[0]).toMatchObject({ ...middleShe, lineRange: [4, 4] });
  });

  test("a stale annotation keeps its old columns and context", () => {
    const out = reanchor("intro\n\nnothing left\n", [ann({ anchorText: "she", ...middleShe })]);
    expect(out[0]).toMatchObject({ status: "stale", ...middleShe });
  });

  test("an annotation saved without columns stays without them on an ambiguous line", () => {
    const out = reanchor(she, [ann({ anchorText: "she", lineRange: [3, 3] })]);
    expect(out[0]).toEqual(ann({ anchorText: "she", lineRange: [3, 3] }));
    expect("columnRange" in out[0]!).toBe(false);
  });

  test("columns are removed when the new source no longer tells the matches apart", () => {
    const before = ann({
      anchorText: "she",
      lineRange: [1, 1],
      columnRange: [4, 6],
      textBefore: "xx ",
      textAfter: " yy",
    });
    const out = reanchor("she a she\n", [before]);
    expect(out[0]!.status).toBe("open");
    expect(out[0]!.lineRange).toEqual([1, 1]);
    for (const key of ["columnRange", "textBefore", "textAfter"]) expect(key in out[0]!).toBe(false);
  });

  test("block annotations never get columns", () => {
    const out = reanchor(doc, [ann({ anchorText: "Filler paragraph.", lineRange: [13, 13], block: true })]);
    expect("columnRange" in out[0]!).toBe(false);
  });
});
