import { useEffect } from "preact/hooks";
import { ACTIONS, bindingFor, formatKeybinding, isMac, type ActionId } from "./actions.tsx";

/**
 * The keybinding cheatsheet: only keybound actions, with a description where the behavior
 * is non-obvious (targeting rules, what gets copied). Rows resolve through the action
 * catalog, so a remap shows the user's keys. The intro line teaches the core mouse gesture;
 * everything else (buttons, hover, click-to-pin) is discoverable in place. A new keybound
 * action belongs in ROWS in the same round.
 */

const INTRO = "Click a block or highlight some text to add a note.";

const ROWS: { action: ActionId; desc?: string }[] = [
  {
    action: "annotate-block",
    desc: "Note the block under the pointer. Click it, or press the key while hovering.",
  },
  { action: "annotate-document" },
  {
    action: "edit-annotation",
    desc: "Edits the hovered sidebar entry, else the open popover. Also double-click the note.",
  },
  { action: "delete-annotation", desc: "Same target as Edit; ↩ confirms." },
  { action: "copy-prompt", desc: "Copy a prompt for an agent to address the comments." },
];

export interface HelpEntry {
  what: string;
  /** The non-obvious part only; null when the name says it all. */
  desc: string | null;
  /** Formatted keys, or null when the action carries no binding. */
  key: string | null;
}

export function helpRows(
  keybindings?: Record<ActionId, string | null>,
  mac = isMac,
): HelpEntry[] {
  return ROWS.map((row) => {
    const kb = bindingFor(row.action, keybindings);
    return {
      what: ACTIONS[row.action].label,
      desc: row.desc ?? null,
      key: kb ? formatKeybinding(kb, mac) : null,
    };
  });
}

export function HelpDialog(props: { onClose: () => void }) {
  const { onClose } = props;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      class="help-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="help-panel" role="dialog" aria-modal="true" aria-label={ACTIONS["show-help"].label}>
        <header class="help-head">
          <h2>Using mdnote</h2>
          <button type="button" class="btn-icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p class="help-intro">{INTRO}</p>
        <div class="help-table">
          <div class="help-cols" aria-hidden="true">
            <span>Action</span>
            <span>Description</span>
            <span>Key</span>
          </div>
          <dl class="help-rows">
            {helpRows().map((row) => (
              <div key={row.what} class="help-row">
                <dt>{row.what}</dt>
                <dd class="help-desc">{row.desc}</dd>
                <dd class="help-key">{row.key && <kbd>{row.key}</kbd>}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
