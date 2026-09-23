import type { GeneralNoteSize } from "../src/types.ts";

/** The smallest panel that still fits the label, two text rows, and the buttons. */
export const GENERAL_NOTE_MIN_SIZE: GeneralNoteSize = { width: 280, height: 180 };

/** Kept clear on each side of the panel; matches the scrim's padding. */
const VIEWPORT_MARGIN = 32;

/** Whole pixels between the minimum and the viewport less its margins; on a viewport too
 *  small for both, the minimum wins. */
export function clampGeneralNoteSize(size: GeneralNoteSize, viewport: GeneralNoteSize): GeneralNoteSize {
  const clamp = (value: number, min: number, max: number) =>
    Math.round(Math.max(min, Math.min(max, value)));
  return {
    width: clamp(size.width, GENERAL_NOTE_MIN_SIZE.width, viewport.width - 2 * VIEWPORT_MARGIN),
    height: clamp(size.height, GENERAL_NOTE_MIN_SIZE.height, viewport.height - 2 * VIEWPORT_MARGIN),
  };
}

/** The panel is centered, so it grows on both sides at once: a pointer travel of `dx`
 *  changes the width by twice that, which keeps the dragged edge under the pointer. */
export function resizeGeneralNote(
  start: GeneralNoteSize,
  dx: number,
  dy: number,
  viewport: GeneralNoteSize,
): GeneralNoteSize {
  return clampGeneralNoteSize(
    { width: start.width + 2 * dx, height: start.height + 2 * dy },
    viewport,
  );
}
