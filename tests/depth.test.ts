import { expect, test } from "bun:test";
import { computeDepths, computeHeights } from "../web/depth.ts";

type Interval = { id: string; start: number; end: number };

const iv = (id: string, start: number, end: number): Interval => ({ id, start, end });

/** Proper containment over intervals, mirroring the Range predicate in main.tsx. */
const contains = (outer: Interval, inner: Interval) =>
  outer.start <= inner.start &&
  outer.end >= inner.end &&
  (outer.start < inner.start || outer.end > inner.end);

const depthsById = (items: Interval[]) => {
  const m = computeDepths(items, contains);
  return Object.fromEntries(items.map((i) => [i.id, m.get(i)]));
};

test("lone annotations are depth 0", () => {
  expect(depthsById([iv("a", 0, 10), iv("b", 20, 30)])).toEqual({ a: 0, b: 0 });
});

test("a chain nests one level per container", () => {
  expect(depthsById([iv("block", 0, 100), iv("phrase", 10, 40), iv("word", 20, 25)])).toEqual({
    block: 0,
    phrase: 1,
    word: 2,
  });
});

test("partial overlaps are siblings, not nesting", () => {
  expect(depthsById([iv("a", 0, 20), iv("b", 10, 30)])).toEqual({ a: 0, b: 0 });
});

test("identical ranges do not deepen each other", () => {
  expect(depthsById([iv("a", 0, 10), iv("b", 0, 10)])).toEqual({ a: 0, b: 0 });
});

test("an item ending where its container ends still nests", () => {
  expect(depthsById([iv("outer", 0, 10), iv("inner", 5, 10)])).toEqual({ outer: 0, inner: 1 });
});

test("two disjoint containers each deepen their own inner item", () => {
  expect(
    depthsById([iv("a", 0, 10), iv("a1", 2, 4), iv("b", 20, 30), iv("b1", 22, 24)]),
  ).toEqual({ a: 0, a1: 1, b: 0, b1: 1 });
});

test("heights: a lone item and an innermost item are height 0", () => {
  const items = [iv("lone", 0, 5), iv("outer", 10, 40), iv("inner", 20, 30)];
  const m = computeHeights(items, contains);
  expect(m.get(items[0]!)).toBe(0);
  expect(m.get(items[1]!)).toBe(1);
  expect(m.get(items[2]!)).toBe(0);
});

test("heights: a chain counts levels below, not descendants", () => {
  const items = [iv("a", 0, 100), iv("b", 10, 60), iv("c", 20, 30), iv("c2", 40, 50)];
  const m = computeHeights(items, contains);
  expect(m.get(items[0]!)).toBe(2); // a > b > c, two levels despite three descendants
  expect(m.get(items[1]!)).toBe(1);
  expect(m.get(items[2]!)).toBe(0);
  expect(m.get(items[3]!)).toBe(0);
});

test("heights: partial overlaps do not count as containment", () => {
  const items = [iv("a", 0, 20), iv("b", 10, 30)];
  const m = computeHeights(items, contains);
  expect(m.get(items[0]!)).toBe(0);
  expect(m.get(items[1]!)).toBe(0);
});
