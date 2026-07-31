/**
 * Hover-preview timing, split out from the DOM so it can be tested without a browser.
 * States: idle → resting (open timer) → open → leaving (grace timer) → idle. Both timers survive
 * repeated calls in the same state, so a slow drag across a span still rests and a mouse sweeping
 * off it can't keep pushing the close out.
 */
export interface HoverController<T> {
  /** Pointer is over `target`. On the open target this cancels a pending close. */
  enter(target: T): void;
  /** Pointer is somewhere that should hold the open target (the popover itself). */
  keepOpen(): void;
  /** Pointer is over neither the target nor its popover. */
  leave(): void;
  /** Drop timers and forget what is open (pinning, a note form, an external close). */
  cancel(): void;
}

export function createHoverController<T>(opts: {
  openDelay: number;
  closeDelay: number;
  keyOf: (target: T) => string;
  onOpen: (target: T) => void;
  onClose: () => void;
}): HoverController<T> {
  let openKey: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let restingKey: string | null = null;
  let leaving = false;

  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    restingKey = null;
    leaving = false;
  };

  return {
    enter(target) {
      const key = opts.keyOf(target);
      if (key === openKey) {
        stop();
        return;
      }
      if (key === restingKey) return;
      stop();
      restingKey = key;
      timer = setTimeout(() => {
        timer = null;
        restingKey = null;
        openKey = key;
        opts.onOpen(target);
      }, opts.openDelay);
    },
    keepOpen() {
      if (leaving) stop();
    },
    leave() {
      if (leaving) return;
      const wasOpen = openKey !== null;
      stop();
      if (!wasOpen) return;
      leaving = true;
      timer = setTimeout(() => {
        timer = null;
        leaving = false;
        openKey = null;
        opts.onClose();
      }, opts.closeDelay);
    },
    cancel() {
      stop();
      openKey = null;
    },
  };
}
