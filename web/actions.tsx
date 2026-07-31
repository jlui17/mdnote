import { useEffect, useRef } from "preact/hooks";

export type ActionId = "copy-prompt" | "toggle-theme";

export const ACTIONS: Record<ActionId, { label: string; keybinding?: string }> = {
  "copy-prompt": { label: "Copy review prompt", keybinding: "mod+shift+c" },
  "toggle-theme": { label: "Toggle theme" },
};

export type Keybinding = { mod: boolean; shift: boolean; alt: boolean; key: string };

export const isMac = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform);

export function parseKeybinding(spec: string): Keybinding {
  const parts = spec.toLowerCase().split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = new Set(parts.slice(0, -1));
  return { mod: mods.has("mod"), shift: mods.has("shift"), alt: mods.has("alt"), key };
}

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

export function bindingFor(
  id: ActionId,
  overrides?: Partial<Record<ActionId, string>>,
): Keybinding | null {
  const spec = overrides?.[id] ?? ACTIONS[id].keybinding;
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

export function ActionButton(props: { id: ActionId; class?: string }) {
  const kb = bindingFor(props.id);
  return (
    <button type="button" class={props.class} onClick={() => runAction(props.id)}>
      {ACTIONS[props.id].label}
      {kb && <kbd>{formatKeybinding(kb)}</kbd>}
    </button>
  );
}
