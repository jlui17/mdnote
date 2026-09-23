import { test, expect } from "bun:test";
import {
  GENERAL_NOTE_MIN_SIZE,
  clampGeneralNoteSize,
  resizeGeneralNote,
} from "../web/general-note-size.ts";

const viewport = { width: 1200, height: 800 };
const start = { width: 360, height: 200 };

test("a centered panel grows by twice the pointer travel, so the dragged edge follows the pointer", () => {
  expect(resizeGeneralNote(start, 50, 0, viewport)).toEqual({ width: 460, height: 200 });
  expect(resizeGeneralNote(start, 0, 30, viewport)).toEqual({ width: 360, height: 260 });
  expect(resizeGeneralNote(start, -20, 40, viewport)).toEqual({ width: 320, height: 280 });
});

test("a resize stops at the minimum and at the viewport less its margins", () => {
  expect(resizeGeneralNote(start, -500, -500, viewport)).toEqual(GENERAL_NOTE_MIN_SIZE);
  expect(resizeGeneralNote(start, 5000, 5000, viewport)).toEqual({ width: 1136, height: 736 });
});

test("a fractional start or travel lands on whole pixels", () => {
  expect(resizeGeneralNote({ width: 360, height: 192.5 }, 10.3, 0, viewport)).toEqual({
    width: 381,
    height: 193,
  });
});

test("a size saved on a big screen clamps to a small one; one that fits is untouched", () => {
  expect(clampGeneralNoteSize({ width: 1600, height: 900 }, { width: 1000, height: 600 })).toEqual({
    width: 936,
    height: 536,
  });
  expect(clampGeneralNoteSize({ width: 500, height: 300 }, viewport)).toEqual({ width: 500, height: 300 });
});

test("the minimum wins on a viewport too small for it", () => {
  expect(clampGeneralNoteSize({ width: 500, height: 300 }, { width: 300, height: 200 })).toEqual(
    GENERAL_NOTE_MIN_SIZE,
  );
});
