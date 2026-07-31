import { render, type RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Annotation, AnnotationPatch, DocResponse, NewAnnotation, Theme } from "../src/types.ts";
import { ActionButton, isMac, useAction, useActionDispatcher } from "./actions.tsx";
import { blockAnchor, caretAt, findRange, selectionAnchor, type SelectionAnchor } from "./anchor-dom.ts";

const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown })
  .Highlight;
const highlights =
  typeof CSS !== "undefined" && "highlights" in CSS && HighlightCtor
    ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights
    : null;

function setHighlight(name: string, ranges: Range[], priority = 0): void {
  if (!highlights || !HighlightCtor) return;
  if (ranges.length) {
    const h = new HighlightCtor(...ranges) as { priority: number };
    h.priority = priority;
    highlights.set(name, h);
  } else highlights.delete(name);
}

const FILE = decodeURIComponent(window.location.pathname);

function api(route: string): string {
  return `/api${route}?file=${encodeURIComponent(FILE)}`;
}

async function getDoc(): Promise<DocResponse | null> {
  const res = await fetch(api("/doc"));
  return res.ok ? ((await res.json()) as DocResponse) : null;
}

async function getAnnotations(): Promise<Annotation[]> {
  const res = await fetch(api("/annotations"));
  if (!res.ok) return [];
  return ((await res.json()) as { annotations: Annotation[] }).annotations;
}

async function sendJson(route: string, method: string, body: unknown): Promise<void> {
  await fetch(api(route), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const postAnnotation = (body: NewAnnotation) => sendJson("/annotations", "POST", body);

const patchAnnotation = (id: string, body: AnnotationPatch) =>
  sendJson(`/annotations/${encodeURIComponent(id)}`, "PATCH", body);

async function deleteAnnotation(id: string): Promise<void> {
  await fetch(api(`/annotations/${encodeURIComponent(id)}`), { method: "DELETE" });
}

function agentPrompt(path: string): string {
  return `I left annotations on ${path} with mdnote. Read them:

  mdnote comments "${path}" --json

Apply each "open" annotation's note to its anchored span (whole document when anchorText is null; lineRange is 1-based inclusive source lines). Then clear what you addressed:

  mdnote clear "${path}" --ids <id>,<id>,...

Leave "stale" annotations alone and flag them to me.`;
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

const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON: Record<Theme, string> = { system: "◐", light: "☀", dark: "☾" };

function ThemeToggle() {
  const [mode, setMode] = useState<Theme>(() => window.__MDNOTE_CONFIG__?.theme ?? "dark");
  const cycle = () => setMode((m) => THEME_NEXT[m]);

  useEffect(() => {
    if (mode === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = mode;
    }
  }, [mode]);

  useAction("toggle-theme", cycle);

  return (
    <button type="button" class="theme-toggle" title={`Theme: ${mode}`} onClick={cycle}>
      {THEME_ICON[mode]}
    </button>
  );
}

/** Block box extended to the parent list's left edge, covering markers, which render outside the li box. */
function blockBox(el: Element): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  if (el.tagName !== "LI") return r;
  const list = el.parentElement?.getBoundingClientRect();
  const left = list ? Math.min(r.left, list.left) : r.left;
  return { left, top: r.top, width: r.right - left, height: r.height };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? flat.slice(0, 160) + "…" : flat;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** onReload fires before each refetch, so callers can drop state anchored to the old DOM. */
function useDocSync(onReload: () => void) {
  const [doc, setDoc] = useState<DocResponse | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;

  const refreshAnnotations = async () => setAnnotations(await getAnnotations());

  useEffect(() => {
    const reload = () => {
      const y = window.scrollY;
      onReloadRef.current();
      void (async () => {
        setDoc(await getDoc());
        setAnnotations(await getAnnotations());
        requestAnimationFrame(() => window.scrollTo({ top: y }));
      })();
    };

    reload();

    let firstOpen = true;
    const events = new EventSource(api("/events"));
    events.addEventListener("update", reload);
    events.addEventListener("open", () => {
      if (firstOpen) firstOpen = false;
      else reload();
    });
    return () => events.close();
  }, []);

  return { doc, annotations, refreshAnnotations };
}

function useHighlights(
  docRef: RefObject<HTMLDivElement>,
  annotations: Annotation[],
  docHtml: string | undefined,
  pending: SelectionAnchor | null,
  focus: { id: string; tick: number } | null,
) {
  const rangesRef = useRef<{ id: string; range: Range }[]>([]);

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
  }, [annotations, docHtml]);

  useEffect(() => {
    setHighlight("mdnote-pending", pending && !pending.block ? [pending.range] : []);
    return () => setHighlight("mdnote-pending", []);
  }, [pending]);

  useEffect(() => {
    if (!focus) return;
    const range = rangesRef.current.find((r) => r.id === focus.id)?.range;
    if (!range) return;
    setHighlight("mdnote-focus", [range], 1);
    const t = window.setTimeout(() => setHighlight("mdnote-focus", []), 1200);
    return () => {
      clearTimeout(t);
      setHighlight("mdnote-focus", []);
    };
  }, [focus]);

  return rangesRef;
}

function useDocEvents(args: {
  docRef: RefObject<HTMLDivElement>;
  popoverRef: RefObject<HTMLDivElement>;
  annPopoverRef: RefObject<HTMLDivElement>;
  setPending: (p: SelectionAnchor | null) => void;
  setOpenAnn: (a: null) => void;
  setHovered: (el: Element | null) => void;
}) {
  const dismissRef = useRef(false);
  const draggedRef = useRef(false);

  useEffect(() => {
    const inPopover = (t: EventTarget | null) =>
      args.popoverRef.current?.contains(t as Node) || args.annPopoverRef.current?.contains(t as Node);
    const onMouseUp = (e: MouseEvent) => {
      if (inPopover(e.target)) return;
      const container = args.docRef.current;
      const anchor = container ? selectionAnchor(container) : null;
      // Chrome reports a collapsed selection during the click that follows a
      // selection drag, so the click handler can't read it live; record here.
      draggedRef.current = anchor !== null;
      args.setPending(anchor);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (inPopover(e.target)) return;
      dismissRef.current = args.popoverRef.current !== null || args.annPopoverRef.current !== null;
      draggedRef.current = false;
      args.setPending(null);
      args.setOpenAnn(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        args.setPending(null);
        args.setOpenAnn(null);
      }
    };
    let current: Element | null = null;
    const onMouseMove = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-source-line]") ?? null;
      const block = el && args.docRef.current?.contains(el) ? el : null;
      if (block !== current) {
        current = block;
        args.setHovered(block);
      }
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousemove", onMouseMove);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return { dismissRef, draggedRef };
}

function useToast(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | null>(null);

  const show = () => {
    setOn(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), ms);
  };

  return [on, show];
}

function App() {
  const [pending, setPending] = useState<SelectionAnchor | null>(null);
  const [openAnn, setOpenAnn] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const [copied, showCopied] = useToast(2000);

  const docRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const annPopoverRef = useRef<HTMLDivElement>(null);

  const { doc, annotations, refreshAnnotations } = useDocSync(() => {
    setPending(null);
    setOpenAnn(null);
  });
  const rangesRef = useHighlights(docRef, annotations, doc?.html, pending, focus);
  const { dismissRef, draggedRef } = useDocEvents({
    docRef,
    popoverRef,
    annPopoverRef,
    setPending,
    setOpenAnn,
    setHovered,
  });

  const copyPrompt = () => {
    const path = doc?.path;
    if (!path) return;
    void copyText(agentPrompt(path)).then(showCopied);
  };

  useAction("copy-prompt", copyPrompt);
  useActionDispatcher();

  const submit = (body: NewAnnotation) => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
    void postAnnotation(body).then(refreshAnnotations);
  };

  const remove = (id: string) => {
    setOpenAnn(null);
    void deleteAnnotation(id).then(refreshAnnotations);
  };

  const edit = (id: string, note: string) =>
    void patchAnnotation(id, { note }).then(refreshAnnotations);

  const focusAnnotation = (id: string) => setFocus((f) => ({ id, tick: (f?.tick ?? 0) + 1 }));

  const annotateBlock = (block: Element | null) => {
    if (!block || !docRef.current?.contains(block)) return;
    const anchor = blockAnchor(block);
    if (anchor) setPending(anchor);
  };

  useAction("annotate-block", () => annotateBlock(hovered));
  useAction("delete-annotation", () => {
    if (openAnn) remove(openAnn.id);
  });

  const onDocClick = (e: MouseEvent) => {
    if (dismissRef.current || draggedRef.current) {
      dismissRef.current = false;
      draggedRef.current = false;
      return;
    }
    const target = e.target as Element;
    if (target.closest("a")) return;
    const caret = caretAt(e.clientX, e.clientY);
    if (caret) {
      const hit = rangesRef.current.find((r) => r.range.isPointInRange(caret.node, caret.offset));
      if (hit) {
        focusAnnotation(hit.id);
        setOpenAnn({ id: hit.id, rect: hit.range.getBoundingClientRect() });
        return;
      }
    }
    annotateBlock(target.closest("[data-source-line]"));
  };

  const scrollTo = (id: string) => {
    focusAnnotation(id);
    const rect = rangesRef.current.find((r) => r.id === id)?.range.getBoundingClientRect();
    if (!rect) return;
    const vh = window.innerHeight;
    let delta = 0;
    if (rect.top < vh * 0.1) delta = rect.top - vh * 0.2;
    else if (rect.bottom > vh * 0.9) delta = rect.bottom - vh * 0.8;
    if (delta) window.scrollBy({ top: delta, behavior: "smooth" });
  };

  const blockRect = pending?.block ? blockBox(pending.block) : null;
  const hoverRect = hovered?.isConnected ? blockBox(hovered) : null;
  const openAnnotation = openAnn ? annotations.find((a) => a.id === openAnn.id) : undefined;

  return (
    <>
      {hoverRect && (
        <div
          class="hover-bar"
          style={{
            left: `${hoverRect.left + window.scrollX - 12}px`,
            top: `${hoverRect.top + window.scrollY + 2}px`,
            height: `${Math.max(0, hoverRect.height - 4)}px`,
          }}
        />
      )}
      {blockRect && (
        <div
          class="block-pending"
          style={{
            left: `${blockRect.left + window.scrollX - 8}px`,
            top: `${blockRect.top + window.scrollY - 4}px`,
            width: `${blockRect.width + 16}px`,
            height: `${blockRect.height + 8}px`,
          }}
        />
      )}
      <div
        id="doc"
        class="doc"
        ref={docRef}
        onClick={onDocClick}
        dangerouslySetInnerHTML={{ __html: doc?.html ?? "" }}
      />
      <Sidebar
        annotations={annotations}
        focus={focus}
        onFocus={scrollTo}
        onDelete={remove}
        onEdit={edit}
        onGlobal={(note) => submit({ lineRange: null, anchorText: null, note })}
      />
      {copied && <div class="toast">Copied agent prompt</div>}
      {openAnn && openAnnotation && (
        <AnnotationPopover popoverRef={annPopoverRef} rect={openAnn.rect} annotation={openAnnotation} />
      )}
      {pending && (
        <Popover
          popoverRef={popoverRef}
          rect={pending.rect}
          onPick={(note) =>
            submit({ lineRange: pending.lineRange, anchorText: pending.anchorText, note })
          }
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}

const focusOnMount = (el: HTMLTextAreaElement | null) => el?.focus();

function NoteForm(props: {
  rows: number;
  placeholder?: string;
  initial?: string;
  submitLabel: string;
  class?: string;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState(props.initial ?? "");

  return (
    <form
      class={props.class}
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) props.onSubmit(note.trim());
      }}
    >
      <textarea
        rows={props.rows}
        placeholder={props.placeholder}
        value={note}
        ref={focusOnMount}
        onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
            (e.target as HTMLTextAreaElement).form?.requestSubmit();
          if (e.key === "Escape") props.onCancel();
        }}
      />
      <div class="row">
        <button type="submit" disabled={!note.trim()}>
          {props.submitLabel} <kbd>{isMac ? "⌘↩" : "Ctrl+↩"}</kbd>
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel <kbd>Esc</kbd>
        </button>
      </div>
    </form>
  );
}

function Sidebar(props: {
  annotations: Annotation[];
  focus: { id: string; tick: number } | null;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, note: string) => void;
  onGlobal: (note: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!props.focus) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-annotation-id="${CSS.escape(props.focus.id)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    el.addEventListener("animationend", () => el.classList.remove("flash"), { once: true });
  }, [props.focus]);

  useAction("annotate-document", () => setAdding(true));

  return (
    <aside class="sidebar">
      <header class="sidebar-head">
        <ActionButton id="copy-prompt" class="copy-prompt" />
        <ThemeToggle />
      </header>

      <div class="global-form">
        {adding ? (
          <NoteForm
            rows={3}
            placeholder="Note about the whole document"
            submitLabel="Add"
            onSubmit={(note) => {
              props.onGlobal(note);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <ActionButton id="annotate-document" />
        )}
      </div>

      <ul class="annotation-list" ref={listRef}>
        {props.annotations.length === 0 && (
          <li class="empty">No annotations yet. Select text, or click a block to annotate it.</li>
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
                  setEditingId(a.id);
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
              <NoteForm
                class="edit-form"
                rows={2}
                initial={a.note}
                submitLabel="Save"
                onSubmit={(note) => {
                  props.onEdit(a.id, note);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              a.note && (
                <p class="note" onDblClick={() => setEditingId(a.id)}>
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

function usePopoverPosition(ref: { current: HTMLDivElement | null }, rect: DOMRect) {
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 8 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - el.offsetWidth - 8);
    const below = rect.bottom + 8;
    const top =
      below + el.offsetHeight > window.innerHeight
        ? Math.max(8, rect.top - el.offsetHeight - 8)
        : below;
    setPos({ left, top });
    el.querySelector("textarea")?.focus();
  }, [rect]);

  return pos;
}

function AnnotationPopover(props: {
  popoverRef: { current: HTMLDivElement | null };
  rect: DOMRect;
  annotation: Annotation;
}) {
  const pos = usePopoverPosition(props.popoverRef, props.rect);

  return (
    <div class="popover" ref={props.popoverRef} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      {props.annotation.note && <p class="popover-note">{props.annotation.note}</p>}
      <div class="row">
        <ActionButton id="delete-annotation" />
      </div>
    </div>
  );
}

function Popover(props: {
  popoverRef: { current: HTMLDivElement | null };
  rect: DOMRect;
  onPick: (note: string) => void;
  onCancel: () => void;
}) {
  const pos = usePopoverPosition(props.popoverRef, props.rect);

  return (
    <div class="popover" ref={props.popoverRef} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      <NoteForm rows={2} placeholder="Note…" submitLabel="Add" onSubmit={props.onPick} onCancel={props.onCancel} />
    </div>
  );
}

render(<App />, document.getElementById("root")!);
