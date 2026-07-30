import { render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Annotation, AnnotationPatch, DocResponse, NewAnnotation } from "../src/types.ts";
import { caretAt, findRange, selectionAnchor, type SelectionAnchor } from "./anchor-dom.ts";

const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
  .Highlight;
const highlights =
  typeof CSS !== "undefined" && "highlights" in CSS && HighlightCtor
    ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights
    : null;

function setHighlight(name: string, ranges: Range[]): void {
  if (!highlights || !HighlightCtor) return;
  if (ranges.length) highlights.set(name, new HighlightCtor(...ranges));
  else highlights.delete(name);
}

async function getDoc(): Promise<DocResponse | null> {
  const res = await fetch("/doc");
  return res.ok ? ((await res.json()) as DocResponse) : null;
}

async function getAnnotations(): Promise<Annotation[]> {
  const res = await fetch("/annotations");
  if (!res.ok) return [];
  return ((await res.json()) as { annotations: Annotation[] }).annotations;
}

async function postAnnotation(body: NewAnnotation): Promise<void> {
  await fetch("/annotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function deleteAnnotation(id: string): Promise<void> {
  await fetch(`/annotations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function patchAnnotation(id: string, body: AnnotationPatch): Promise<void> {
  await fetch(`/annotations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function agentPrompt(path: string): string {
  return `I left annotations on ${path} with mdnote. Read them:

  mdnote comments "${path}" --json

Apply each annotation with status "open": the note is a free-form instruction about the anchored span ("make this punchier", "remove this"); when anchorText is null it applies to the whole document. lineRange is 1-based inclusive source lines; confirm the spot against anchorText before editing. After addressing an annotation, clear it:

  mdnote clear "${path}" --id <id>

Repeat until no open annotations remain. Leave "stale" annotations alone and flag them to me.`;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

const isMac = /Mac|iP/.test(navigator.platform);

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? flat.slice(0, 160) + "…" : flat;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function App() {
  const [doc, setDoc] = useState<DocResponse | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pending, setPending] = useState<SelectionAnchor | null>(null);
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  const docRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const rangesRef = useRef<{ id: string; range: Range }[]>([]);

  const refreshAnnotations = async () => setAnnotations(await getAnnotations());

  useEffect(() => {
    void (async () => {
      setDoc(await getDoc());
      await refreshAnnotations();
    })();

    const events = new EventSource("/events");
    events.addEventListener("update", () => {
      const y = window.scrollY;
      setPending(null);
      void (async () => {
        setDoc(await getDoc());
        await refreshAnnotations();
        requestAnimationFrame(() => window.scrollTo({ top: y }));
      })();
    });
    return () => events.close();
  }, []);

  useEffect(() => {
    const container = docRef.current;
    rangesRef.current = [];
    if (!container || !highlights || !HighlightCtor) return;
    const open: Range[] = [];
    const stale: Range[] = [];
    for (const a of annotations) {
      if (!a.anchorText) continue;
      const range = findRange(container, a.anchorText, a.lineRange);
      if (!range) continue;
      rangesRef.current.push({ id: a.id, range });
      (a.status === "stale" ? stale : open).push(range);
    }
    setHighlight("mdnote-open", open);
    setHighlight("mdnote-stale", stale);
  }, [annotations, doc?.html]);

  useEffect(() => {
    setHighlight("mdnote-pending", pending ? [pending.range] : []);
    return () => setHighlight("mdnote-pending", []);
  }, [pending]);

  const copyPrompt = () => {
    const path = doc?.path;
    if (!path) return;
    void copyText(agentPrompt(path)).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    });
  };

  useEffect(() => {
    if (!doc?.path) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== "c") return;
      e.preventDefault();
      copyPrompt();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [doc?.path]);

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      const container = docRef.current;
      setPending(container ? selectionAnchor(container) : null);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setPending(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPending(null);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const submit = (body: NewAnnotation) => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
    void postAnnotation(body).then(refreshAnnotations);
  };

  const remove = (id: string) => void deleteAnnotation(id).then(refreshAnnotations);

  const edit = (id: string, note: string) =>
    void patchAnnotation(id, { note }).then(refreshAnnotations);

  const focusAnnotation = (id: string) => setFocus((f) => ({ id, tick: (f?.tick ?? 0) + 1 }));

  const onDocClick = (e: MouseEvent) => {
    const caret = caretAt(e.clientX, e.clientY);
    if (!caret) return;
    const hit = rangesRef.current.find((r) => r.range.isPointInRange(caret.node, caret.offset));
    if (hit) focusAnnotation(hit.id);
  };

  const scrollTo = (id: string) => {
    focusAnnotation(id);
    const rect = rangesRef.current.find((r) => r.id === id)?.range.getBoundingClientRect();
    if (rect) window.scrollBy({ top: rect.top - window.innerHeight / 2, behavior: "smooth" });
  };

  return (
    <>
      <div
        id="doc"
        class="doc"
        ref={docRef}
        onClick={onDocClick}
        dangerouslySetInnerHTML={{ __html: doc?.html ?? "" }}
      />
      <Sidebar
        path={doc?.path ?? ""}
        annotations={annotations}
        focus={focus}
        onFocus={scrollTo}
        onDelete={remove}
        onEdit={edit}
        onGlobal={(note) => submit({ lineRange: null, anchorText: null, note })}
        onCopyPrompt={copyPrompt}
      />
      {copied && <div class="toast">Copied agent prompt</div>}
      {pending && (
        <Popover
          popoverRef={popoverRef}
          rect={pending.rect}
          onPick={(note) =>
            submit({ lineRange: pending.lineRange, anchorText: pending.anchorText, note })
          }
        />
      )}
    </>
  );
}

function Sidebar(props: {
  path: string;
  annotations: Annotation[];
  focus: { id: string; tick: number } | null;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, note: string) => void;
  onGlobal: (note: string) => void;
  onCopyPrompt: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!props.focus) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-annotation-id="${CSS.escape(props.focus.id)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.animate([{ backgroundColor: "#fff2a8" }, { backgroundColor: "#ffffff" }], {
      duration: 1200,
      easing: "ease-out",
    });
  }, [props.focus]);

  const startEditing = (a: Annotation) => {
    setEditingId(a.id);
    setDraft(a.note);
  };

  const saveEdit = () => {
    if (editingId && draft.trim()) props.onEdit(editingId, draft.trim());
    setEditingId(null);
  };

  const name = props.path.split("/").pop() ?? "mdnote";

  return (
    <aside class="sidebar">
      <header class="sidebar-head">
        <h2 class="doc-path" title={props.path}>
          {name}
        </h2>
        <button type="button" onClick={() => setAdding(true)}>
          Add general note
        </button>
      </header>

      <button type="button" class="copy-prompt" onClick={props.onCopyPrompt}>
        Copy review prompt
        <kbd>{isMac ? "⌘⇧C" : "Ctrl+Shift+C"}</kbd>
      </button>

      {adding && (
        <form
          class="global-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            props.onGlobal(note.trim());
            setNote("");
            setAdding(false);
          }}
        >
          <textarea
            rows={3}
            placeholder="Note about the whole document"
            value={note}
            autofocus
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                (e.target as HTMLTextAreaElement).form?.requestSubmit();
            }}
          />
          <div class="row">
            <button type="submit">Add</button>
            <button
              type="button"
              onClick={() => {
                setNote("");
                setAdding(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul class="annotation-list" ref={listRef}>
        {props.annotations.length === 0 && (
          <li class="empty">No annotations yet. Select text in the document.</li>
        )}
        {props.annotations.map((a) => (
          <li
            key={a.id}
            class={`entry ${a.status}${props.focus?.id === a.id ? " focused" : ""}`}
            data-annotation-id={a.id}
            onClick={() => props.onFocus(a.id)}
          >
            <div class="entry-head">
              {!a.anchorText && <span class="badge badge-global">global</span>}
              {a.status === "stale" && <span class="badge badge-stale">stale</span>}
              <button
                type="button"
                class="edit"
                title="Edit note"
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing(a);
                }}
              >
                ✎
              </button>
              <button
                type="button"
                class="del"
                title="Delete annotation"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete(a.id);
                }}
              >
                ×
              </button>
            </div>
            {a.anchorText && <blockquote class="anchor">{snippet(a.anchorText)}</blockquote>}
            {editingId === a.id ? (
              <form
                class="edit-form"
                onClick={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  saveEdit();
                }}
              >
                <textarea
                  rows={2}
                  value={draft}
                  autofocus
                  onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                      (e.target as HTMLTextAreaElement).form?.requestSubmit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <div class="row">
                  <button type="submit" disabled={!draft.trim()}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              a.note && (
                <p class="note" onDblClick={() => startEditing(a)}>
                  {a.note}
                </p>
              )
            )}
            <time class="meta">
              {a.lineRange ? `lines ${a.lineRange[0]}–${a.lineRange[1]} · ` : ""}
              {formatTime(a.createdAt)}
            </time>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Popover(props: {
  popoverRef: { current: HTMLDivElement | null };
  rect: DOMRect;
  onPick: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [pos, setPos] = useState({ left: props.rect.left, top: props.rect.bottom + 8 });

  useLayoutEffect(() => {
    const el = props.popoverRef.current;
    if (!el) return;
    const left = Math.min(Math.max(8, props.rect.left), window.innerWidth - el.offsetWidth - 8);
    const below = props.rect.bottom + 8;
    const top =
      below + el.offsetHeight > window.innerHeight
        ? Math.max(8, props.rect.top - el.offsetHeight - 8)
        : below;
    setPos({ left, top });
    el.querySelector("textarea")?.focus();
  }, [props.rect]);

  return (
    <div class="popover" ref={props.popoverRef} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      <textarea
        rows={2}
        placeholder={`Note… (${isMac ? "⌘↩" : "Ctrl+↩"} to add)`}
        value={note}
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && note.trim())
            props.onPick(note.trim());
        }}
      />
      <div class="row">
        <button type="button" disabled={!note.trim()} onClick={() => props.onPick(note.trim())}>
          Add note
        </button>
      </div>
    </div>
  );
}

render(<App />, document.getElementById("root")!);
