export type ActionId = "copy-prompt" | "toggle-theme";

export const ACTIONS: Record<ActionId, { label: string; keybinding?: string }> = {
  "copy-prompt": { label: "Copy review prompt", keybinding: "mod+shift+c" },
  "toggle-theme": { label: "Toggle theme" },
};

export function defaultKeybindings(): Record<ActionId, string | null> {
  return Object.fromEntries(
    (Object.keys(ACTIONS) as ActionId[]).map((id) => [id, ACTIONS[id].keybinding ?? null]),
  ) as Record<ActionId, string | null>;
}

export type Keybinding = { mod: boolean; shift: boolean; alt: boolean; key: string };

export function parseKeybinding(spec: string): Keybinding {
  const parts = spec.toLowerCase().split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = new Set(parts.slice(0, -1));
  return { mod: mods.has("mod"), shift: mods.has("shift"), alt: mods.has("alt"), key };
}

export function isValidKeybinding(spec: string): boolean {
  const parts = spec.toLowerCase().split("+");
  const key = parts[parts.length - 1] ?? "";
  return key !== "" && parts.slice(0, -1).every((m) => m === "mod" || m === "shift" || m === "alt");
}
