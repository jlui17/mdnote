/** Nesting depth per item: how many other items properly contain it. Containment
 *  counting (rather than tree-building) makes partial overlaps siblings and lets
 *  two containers share an inner item without ambiguity. O(n²) over the handful
 *  of annotations a document carries. */
/** Nesting height per item: how many levels of items sit properly inside it (0 when
 *  none). Proper containment is a strict partial order, so the recursion can't cycle. */
export function computeHeights<T>(
  items: readonly T[],
  contains: (outer: T, inner: T) => boolean,
): Map<T, number> {
  const memo = new Map<T, number>();
  const height = (item: T): number => {
    const cached = memo.get(item);
    if (cached !== undefined) return cached;
    let h = 0;
    for (const other of items) {
      if (other !== item && contains(item, other)) h = Math.max(h, height(other) + 1);
    }
    memo.set(item, h);
    return h;
  };
  for (const item of items) height(item);
  return memo;
}

export function computeDepths<T>(
  items: readonly T[],
  contains: (outer: T, inner: T) => boolean,
): Map<T, number> {
  const depths = new Map<T, number>();
  for (const item of items) {
    let depth = 0;
    for (const other of items) {
      if (other !== item && contains(other, item)) depth++;
    }
    depths.set(item, depth);
  }
  return depths;
}
