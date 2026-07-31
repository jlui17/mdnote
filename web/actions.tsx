import { useEffect, useRef } from "preact/hooks";
import {
  ACTIONS,
  defaultKeybindings,
  parseKeybinding,
  type ActionId,
  type Keybinding,
} from "../src/actions.ts";
import type { ResolvedConfig } from "../src/types.ts";

export { ACTIONS, parseKeybinding, type ActionId, type Keybinding };

declare global {
  interface Window {
    __MDNOTE_CONFIG__?: ResolvedConfig;
  }
}

export const isMac = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform);

export function matchesEvent(kb: Keybinding, e: KeyboardEvent, mac = isMac): boolean {
  return (
    e.key.toLowerCase() === kb.key &&
    (mac ? e.metaKey : e.ctrlKey) === kb.mod &&
    e.shiftKey === kb.shift &&
    e.altKey === kb.alt
  );
}

export function formatKeybinding(kb: Keybinding, mac = isMac): string {
  if (mac) {
    return (
      (kb.mod ? "⌘" : "") + (kb.alt ? "⌥" : "") + (kb.shift ? "⇧" : "") + kb.key.toUpperCase()
    );
  }
  const parts = [];
  if (kb.mod) parts.push("Ctrl");
  if (kb.alt) parts.push("Alt");
  if (kb.shift) parts.push("Shift");
  parts.push(kb.key.toUpperCase());
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
      const typing = !!target && /^(input|textarea|select)$/i.test(target.tagName);
      for (const id of Object.keys(ACTIONS) as ActionId[]) {
        const kb = bindingFor(id);
        if (!kb || (typing && !kb.mod)) continue;
        if (matchesEvent(kb, e)) {
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
