import { useEffect } from "preact/hooks";
import { ACTIONS, bindingFor, formatKeybinding, isMac, SUBMIT_KEY, type ActionId } from "./actions.tsx";

/**
 * The interaction cheatsheet. Keyboard rows resolve through the action catalog, so a remap
 * shows the user's keys; mouse gestures have no catalog, so they are the static rows below.
 * Any change to how mdnote is driven belongs in GROUPS in the same round.
 */

type Row =
  | { action: ActionId; mouse?: string }
  | { what: string; key?: string; mouse?: string };

const GROUPS: { title: string; hint?: string; rows: Row[] }[] = [
  {
    title: "Annotate",
    rows: [
      { what: "Note a span of text", mouse: "Drag across the text" },
      {
        what: "Note a whole block",
        mouse: "Drag across all of it — the selection promotes to a block annotation",
      },
      { action: "annotate-block", mouse: "Click a block (the accent bar marks the target)" },
      { action: "annotate-document", mouse: "+ General note, in the sidebar" },
      { what: "Save the note you are typing", key: SUBMIT_KEY },
      { what: "Cancel the note you are typing", key: "Esc" },
    ],
  },
  {
    title: "Review",
    hint: "Edit and Delete act on the sidebar entry under the pointer, else the open popover.",
    rows: [
      { what: "Preview an annotation's note", mouse: "Rest the pointer on it" },
      {
        what: "Pin a note open",
        mouse: "Click the annotation — the sidebar jumps to its entry",
      },
      { what: "Jump to an annotation in the document", mouse: "Click its sidebar entry" },
      { action: "edit-annotation", mouse: "✎ on an entry, or double-click its note" },
      { action: "delete-annotation", mouse: "× on an entry" },
    ],
  },
  {
    title: "Document",
    rows: [
      { action: "copy-prompt", mouse: "Copy review prompt, at the sidebar foot" },
      { action: "copy-markdown", mouse: "⧉ in the sidebar header" },
      { action: "toggle-theme", mouse: "◐ in the sidebar header" },
      { action: "show-help", mouse: "? in the sidebar header" },
    ],
  },
];

export interface HelpEntry {
  what: string;
  /** Formatted keys, or null when the action carries no binding. */
  key: string | null;
  mouse: string | null;
}

export function helpGroups(
  keybindings?: Record<ActionId, string | null>,
  mac = isMac,
): { title: string; hint?: string; rows: HelpEntry[] }[] {
  return GROUPS.map((g) => ({
    ...g,
    rows: g.rows.map((row) => {
      if (!("action" in row)) {
        return { what: row.what, key: row.key ?? null, mouse: row.mouse ?? null };
      }
      const kb = bindingFor(row.action, keybindings);
      return {
        what: ACTIONS[row.action].label,
        key: kb ? formatKeybinding(kb, mac) : null,
        mouse: row.mouse ?? null,
      };
    }),
  }));
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
        {helpGroups().map((g) => (
          <section key={g.title} class="help-group">
            <h3>{g.title}</h3>
            {g.hint && <p class="help-hint">{g.hint}</p>}
            <dl class="help-rows">
              {g.rows.map((row) => (
                <div key={row.what} class="help-row">
                  <dt>{row.what}</dt>
                  <dd>
                    {row.key && <kbd>{row.key}</kbd>}
                    {row.mouse && <span class="help-mouse">{row.mouse}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
