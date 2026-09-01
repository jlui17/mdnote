import { useEffect, useRef } from "preact/hooks";
import {
  ACTIONS,
  defaultKeybindings,
  parseKeybinding,
  type ActionId,
  type Keybinding,
} from "../src/actions.ts";
import type { ResolvedConfig } from "../src/types.ts";

export { ACTIONS, defaultKeybindings, parseKeybinding, type ActionId, type Keybinding };

declare global {
  interface Window {
    __MDNOTE_CONFIG__?: ResolvedConfig;
  }
}

export const isMac = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform);

/** Submits any note form; not a catalog action because it only exists while a form is open. */
export const SUBMIT_KEY = isMac ? "⌘↩" : "Ctrl+↩";

export function matchesEvent(kb: Keybinding, e: KeyboardEvent, mac = isMac): boolean {
  return (
    e.key.toLowerCase() === kb.key &&
    (mac ? e.metaKey : e.ctrlKey) === kb.mod &&
    e.shiftKey === kb.shift &&
    e.altKey === kb.alt
  );
}

const KEY_GLYPHS: Record<string, string> = {
  enter: "↩",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

export function formatKeybinding(kb: Keybinding, mac = isMac): string {
  const key = KEY_GLYPHS[kb.key] ?? kb.key.toUpperCase();
  if (mac) {
    return (kb.mod ? "⌘" : "") + (kb.alt ? "⌥" : "") + (kb.shift ? "⇧" : "") + key;
  }
  const parts = [];
  if (kb.mod) parts.push("Ctrl");
  if (kb.alt) parts.push("Alt");
  if (kb.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

function configuredKeybindings(): Record<ActionId, string | null> {
  return (typeof window !== "undefined" && window.__MDNOTE_CONFIG__?.keybindings) || defaultKeybindings();
}

export function bindingFor(
  id: ActionId,
  keybindings: Record<ActionId, string | null> = configuredKeybindings(),
): Keybinding | null {
  const spec = keybindings[id];
  return spec ? parseKeybinding(spec) : null;
}

const registry = new Map<ActionId, () => void>();

export function useAction(id: ActionId, run: () => void): void {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    registry.set(id, () => ref.current());
    return () => void registry.delete(id);
  }, [id]);
}

export function runAction(id: ActionId): void {
  registry.get(id)?.();
}

export function useActionDispatcher(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // A control that takes typed or arrow-key input keeps its bare keys; a focused
      // checkbox or button takes neither, so shortcuts still fire after clicking one.
      const typing =
        !!target &&
        (/^(textarea|select)$/i.test(target.tagName) ||
          (target.tagName === "INPUT" &&
            !/^(checkbox|button|submit|reset)$/i.test((target as HTMLInputElement).type)));
      for (const id of Object.keys(ACTIONS) as ActionId[]) {
        const kb = bindingFor(id);
        if (!kb || (typing && !kb.mod)) continue;
        // An action nothing has mounted (the reading-line steps while the line is off)
        // leaves its key to the browser, so bare arrows still scroll.
        if (matchesEvent(kb, e) && registry.has(id)) {
          e.preventDefault();
          runAction(id);
          return;
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}

export function ActionButton(props: { id: ActionId; class?: string; label?: string }) {
  const kb = bindingFor(props.id);
  return (
    <button
      type="button"
      class={props.class}
      title={props.label ? ACTIONS[props.id].label : undefined}
      onClick={() => runAction(props.id)}
    >
      {props.label ?? ACTIONS[props.id].label}
      {kb && <kbd>{formatKeybinding(kb)}</kbd>}
    </button>
  );
}
