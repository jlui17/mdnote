import { render, type RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type {
  Annotation,
  AnnotationPatch,
  AnnotationStatus,
  DocResponse,
  NewAnnotation,
  Theme,
} from "../src/types.ts";
import {
  ACTIONS,
  ActionButton,
  bindingFor,
  formatKeybinding,
  isMac,
  runAction,
  useAction,
  useActionDispatcher,
  type ActionId,
} from "./actions.tsx";
import {
  blockAnchor,
  caretAt,
  findBlock,
  findRange,
  selectionAnchor,
  type SelectionAnchor,
} from "./anchor-dom.ts";
import { createHoverController, type HoverController } from "./hover.ts";

const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 300;

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
    <button type="button" class="btn-icon" title={`Theme: ${mode}`} onClick={cycle}>
      {THEME_ICON[mode]}
    </button>
  );
}

function IconButton(props: { id: ActionId; glyph: string }) {
  const kb = bindingFor(props.id);
  const title = ACTIONS[props.id].label + (kb ? ` (${formatKeybinding(kb)})` : "");
  return (
    <button type="button" class="btn-icon" title={title} onClick={() => runAction(props.id)}>
      {props.glyph}
    </button>
  );
}


/** Block box extended to the parent list's left edge, covering markers, which render outside the li box. */
function blockBox(el: Element): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  const li =
    el.tagName === "LI"
      ? el
      : el.parentElement?.tagName === "LI" && el.parentElement.firstElementChild === el
        ? el.parentElement
        : null;
  if (!li) return r;
  const list = li.parentElement?.getBoundingClientRect();
  const left = list ? Math.min(r.left, list.left) : r.left;
  return { left, top: r.top, width: r.right - left, height: r.height };
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `el`'s block box in page coordinates, grown by the halo every block box wears. */
function paddedBox(el: Element): Box {
  const r = blockBox(el);
  return {
    left: r.left + window.scrollX - 8,
    top: r.top + window.scrollY - 4,
    width: r.width + 16,
    height: r.height + 8,
  };
}

/** Boxes are `pointer-events: none` chrome, so click and hover both resolve them by coordinate. */
function boxAt<T extends { box: Box }>(boxes: T[], pageX: number, pageY: number): T | undefined {
  return boxes.find(
    ({ box }) =>
      pageX >= box.left &&
      pageX <= box.left + box.width &&
      pageY >= box.top &&
      pageY <= box.top + box.height,
  );
}

function viewportRect(b: Box): DOMRect {
  return new DOMRect(b.left - window.scrollX, b.top - window.scrollY, b.width, b.height);
}

function boxStyle(b: Box) {
  return {
    left: `${b.left}px`,
    top: `${b.top}px`,
    width: `${b.width}px`,
    height: `${b.height}px`,
  };
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
      if (!a.anchorText || a.block) continue;
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

/** Block annotations paint a box, not a text highlight; the box is chrome outside
 *  #doc, so it is measured from the block element and re-measured whenever the
 *  layout can have moved (doc reload, resize). */
function useBlockBoxes(
  docRef: RefObject<HTMLDivElement>,
  annotations: Annotation[],
  docHtml: string | undefined,
) {
  const blocksRef = useRef<{ id: string; el: Element; status: AnnotationStatus }[]>([]);
  const [boxes, setBoxes] = useState<{ id: string; status: AnnotationStatus; box: Box }[]>([]);

  const measure = () =>
    setBoxes(blocksRef.current.map((b) => ({ id: b.id, status: b.status, box: paddedBox(b.el) })));

  useLayoutEffect(() => {
    const container = docRef.current;
    blocksRef.current = [];
    for (const a of container ? annotations : []) {
      if (!a.block || !a.anchorText) continue;
      const el = findBlock(container!, a.anchorText, a.lineRange);
      if (el) blocksRef.current.push({ id: a.id, el, status: a.status });
    }
    measure();
  }, [annotations, docHtml]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return { boxes, blocksRef };
}

function useDocEvents(args: {
  docRef: RefObject<HTMLDivElement>;
  popoverRef: RefObject<HTMLDivElement>;
  annPopoverRef: RefObject<HTMLDivElement>;
  setPending: (p: SelectionAnchor | null) => void;
  setOpenAnn: (a: null) => void;
  setHovered: (el: Element | null) => void;
  pinnedRef: { current: boolean };
  openIfBlockAnnotatedRef: { current: (block: Element) => boolean };
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
      // Ticket 02's whole-block drag promotion can land on a block that already
      // has a note; open it pinned instead of stacking a duplicate.
      if (anchor?.block && args.openIfBlockAnnotatedRef.current(anchor.block)) {
        window.getSelection()?.removeAllRanges();
        args.setPending(null);
        return;
      }
      args.setPending(anchor);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (inPopover(e.target)) return;
      dismissRef.current =
        args.popoverRef.current !== null ||
        (args.annPopoverRef.current !== null && args.pinnedRef.current);
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

/** `pinned`: opened by a click or an edit, so mouse-out leaves it alone. */
type OpenAnn = { id: string; rect: DOMRect; editing: boolean; pinned: boolean };

/** Resting on an annotation opens its popover; the pointer may cross the gap into the popover. */
function useHoverPreview(args: {
  rangesRef: RefObject<{ id: string; range: Range }[]>;
  boxesRef: RefObject<{ id: string; box: Box }[]>;
  annPopoverRef: RefObject<HTMLDivElement>;
  pinnedRef: { current: boolean };
  formOpenRef: { current: boolean };
  setOpenAnn: (update: (a: OpenAnn | null) => OpenAnn | null) => void;
}) {
  const ref = useRef<HoverController<{ id: string; rect: DOMRect }> | null>(null);

  useEffect(() => {
    const ctl = createHoverController<{ id: string; rect: DOMRect }>({
      openDelay: HOVER_OPEN_MS,
      closeDelay: HOVER_CLOSE_MS,
      keyOf: (t) => t.id,
      onOpen: (t) => args.setOpenAnn(() => ({ ...t, editing: false, pinned: false })),
      onClose: () => args.setOpenAnn((a) => (a && !a.pinned ? null : a)),
    });
    ref.current = ctl;

    let frame = 0;
    let at: { x: number; y: number; target: EventTarget | null } | null = null;
    const sample = () => {
      frame = 0;
      if (!at) return;
      if (args.formOpenRef.current) return ctl.cancel();
      if (args.annPopoverRef.current?.contains(at.target as Node)) return ctl.keepOpen();
      if (args.pinnedRef.current) return ctl.cancel();
      const caret = caretAt(at.x, at.y);
      const hit =
        caret && args.rangesRef.current?.find((r) => r.range.isPointInRange(caret.node, caret.offset));
      if (hit) return ctl.enter({ id: hit.id, rect: hit.range.getBoundingClientRect() });
      const inBox = boxAt(args.boxesRef.current ?? [], at.x + window.scrollX, at.y + window.scrollY);
      if (inBox) ctl.enter({ id: inBox.id, rect: viewportRect(inBox.box) });
      else ctl.leave();
    };
    const onMouseMove = (e: MouseEvent) => {
      at = { x: e.clientX, y: e.clientY, target: e.target };
      if (!frame) frame = requestAnimationFrame(sample);
    };

    document.addEventListener("mousemove", onMouseMove);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      if (frame) cancelAnimationFrame(frame);
      ctl.cancel();
    };
  }, []);

  return ref;
}

function useToast(ms: number): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const show = (m: string) => {
    setMessage(m);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), ms);
  };

  return [message, show];
}

function App() {
  const [pending, setPending] = useState<SelectionAnchor | null>(null);
  const [openAnn, setOpenAnn] = useState<OpenAnn | null>(null);
  const [hovered, setHovered] = useState<Element | null>(null);
  const [focus, setFocus] = useState<{ id: string; tick: number } | null>(null);
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [toast, showToast] = useToast(2000);

  const docRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const annPopoverRef = useRef<HTMLDivElement>(null);

  const { doc, annotations, refreshAnnotations } = useDocSync(() => {
    setPending(null);
    setOpenAnn(null);
  });
  const rangesRef = useHighlights(docRef, annotations, doc?.html, pending, focus);
  const { boxes: blockBoxes, blocksRef: blockAnnotationsRef } = useBlockBoxes(
    docRef,
    annotations,
    doc?.html,
  );
  const pinnedRef = useRef(false);
  pinnedRef.current = openAnn?.pinned ?? false;
  const formOpenRef = useRef(false);
  formOpenRef.current = pending !== null;
  const boxesRef = useRef(blockBoxes);
  boxesRef.current = blockBoxes;

  const focusAnnotation = (id: string) => setFocus((f) => ({ id, tick: (f?.tick ?? 0) + 1 }));

  /** True (and pops the pinned popover) when `block` already carries a `block: true`
   *  annotation — the duplicate-stacking guard shared by click, `c`, and drag promotion. */
  const openIfBlockAnnotated = (block: Element): boolean => {
    const existingId = blockAnnotationsRef.current.find((b) => b.el === block)?.id;
    if (!existingId) return false;
    focusAnnotation(existingId);
    const box = blockBoxes.find((b) => b.id === existingId)?.box;
    setOpenAnn({
      id: existingId,
      rect: box ? viewportRect(box) : block.getBoundingClientRect(),
      editing: false,
      pinned: true,
    });
    return true;
  };
  const openIfBlockAnnotatedRef = useRef(openIfBlockAnnotated);
  openIfBlockAnnotatedRef.current = openIfBlockAnnotated;

  const { dismissRef, draggedRef } = useDocEvents({
    docRef,
    popoverRef,
    annPopoverRef,
    setPending,
    setOpenAnn,
    setHovered,
    pinnedRef,
    openIfBlockAnnotatedRef,
  });
  const hoverRef = useHoverPreview({
    rangesRef,
    boxesRef,
    annPopoverRef,
    pinnedRef,
    formOpenRef,
    setOpenAnn,
  });

  useEffect(() => {
    if (!openAnn) hoverRef.current?.cancel();
  }, [openAnn]);

  const copyPrompt = () => {
    const path = doc?.path;
    if (!path) return;
    void copyText(agentPrompt(path)).then(() => showToast("Copied agent prompt"));
  };

  const copyMarkdown = () => {
    const source = doc?.source;
    if (source == null) return;
    void copyText(source).then(() => showToast("Copied markdown"));
  };

  useAction("copy-prompt", copyPrompt);
  useAction("copy-markdown", copyMarkdown);
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

  const annotateBlock = (block: Element | null) => {
    if (!block || !docRef.current?.contains(block)) return;
    if (openIfBlockAnnotated(block)) return;
    const anchor = blockAnchor(block);
    if (anchor) setPending(anchor);
  };

  useAction("annotate-block", () => annotateBlock(hovered));

  // Target resolution for e/d: hovered sidebar entry, else the open doc popover,
  // else the last-clicked (focused) entry. What the pointer is on beats the
  // stale focus a hover-opened popover leaves untouched.
  const entryTarget = (id: string | null | undefined) =>
    id && annotations.some((a) => a.id === id) ? id : null;
  const sidebarTarget = entryTarget(hoveredEntryId) ?? (openAnn ? null : entryTarget(focus?.id));

  useAction("edit-annotation", () => {
    if (sidebarTarget) {
      setEditingEntryId(sidebarTarget);
      return;
    }
    if (openAnn) setOpenAnn({ ...openAnn, editing: true, pinned: true });
  });
  useAction("delete-annotation", () => {
    if (sidebarTarget) {
      remove(sidebarTarget);
      return;
    }
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
        setOpenAnn({
          id: hit.id,
          rect: hit.range.getBoundingClientRect(),
          editing: false,
          pinned: true,
        });
        return;
      }
    }
    const inBox = boxAt(blockBoxes, e.pageX, e.pageY);
    if (inBox) {
      focusAnnotation(inBox.id);
      setOpenAnn({ id: inBox.id, rect: viewportRect(inBox.box), editing: false, pinned: true });
      return;
    }
    annotateBlock(target.closest("[data-source-line]"));
  };

  const scrollTo = (id: string) => {
    focusAnnotation(id);
    const box = blockBoxes.find((b) => b.id === id)?.box;
    const rect = box
      ? viewportRect(box)
      : rangesRef.current.find((r) => r.id === id)?.range.getBoundingClientRect();
    if (!rect) return;
    const vh = window.innerHeight;
    let delta = 0;
    if (rect.top < vh * 0.1) delta = rect.top - vh * 0.2;
    else if (rect.bottom > vh * 0.9) delta = rect.bottom - vh * 0.8;
    if (delta) window.scrollBy({ top: delta, behavior: "smooth" });
  };

  const blockRect = pending?.block ? paddedBox(pending.block) : null;
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
      {blockBoxes.map(({ id, status, box }) => (
        <div key={id} class={`block-box ${status}`} style={boxStyle(box)} />
      ))}
      {blockRect && <div class="block-pending" style={boxStyle(blockRect)} />}
      <div
        id="doc"
        class="doc"
        ref={docRef}
        onClick={onDocClick}
        dangerouslySetInnerHTML={{ __html: doc?.html ?? "" }}
      />
      <Sidebar
        path={doc?.path}
        annotations={annotations}
        focus={focus}
        onFocus={scrollTo}
        onDelete={remove}
        onEdit={edit}
        onGlobal={(note) => submit({ lineRange: null, anchorText: null, note })}
        onHoverEntry={setHoveredEntryId}
        editingId={editingEntryId}
        onEditingChange={setEditingEntryId}
      />
      {toast && <div class="toast">{toast}</div>}
      {openAnn && openAnnotation && (
        <AnnotationPopover
          popoverRef={annPopoverRef}
          rect={openAnn.rect}
          annotation={openAnnotation}
          editing={openAnn.editing}
          onEdit={(note) => {
            edit(openAnnotation.id, note);
            setOpenAnn(null);
          }}
          onCancelEdit={() => setOpenAnn({ ...openAnn, editing: false })}
        />
      )}
      {pending && (
        <Popover
          popoverRef={popoverRef}
          rect={pending.rect}
          onPick={(note) =>
            submit({
              lineRange: pending.lineRange,
              anchorText: pending.anchorText,
              note,
              ...(pending.block ? { block: true as const } : {}),
            })
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
  path?: string;
  annotations: Annotation[];
  focus: { id: string; tick: number } | null;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, note: string) => void;
  onGlobal: (note: string) => void;
  onHoverEntry: (id: string | null) => void;
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const { editingId, onEditingChange } = props;
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

  const addKb = bindingFor("annotate-document");
  const name = props.path?.split("/").pop() ?? "";
  const count = props.annotations.length;

  const globalForm = adding && (
    <div class="global-form">
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
    </div>
  );

  return (
    <aside class="sidebar">
      <header class="sb-head">
        <div class="sb-title">
          <span class="sb-file" title={props.path}>
            {name}
          </span>
          <span class="sb-count">
            {count} {count === 1 ? "note" : "notes"}
          </span>
        </div>
        <div class="sb-tools">
          <IconButton id="copy-markdown" glyph="⧉" />
          <ThemeToggle />
        </div>
      </header>

      <div class="sb-body">
        {!adding && (
          <button type="button" class="btn-primary add-global" onClick={() => setAdding(true)}>
            + General note
            {addKb && <kbd>{formatKeybinding(addKb)}</kbd>}
          </button>
        )}
        {globalForm}

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
            onMouseEnter={() => props.onHoverEntry(a.id)}
            onMouseLeave={() => props.onHoverEntry(null)}
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
                  onEditingChange(a.id);
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
                  onEditingChange(null);
                }}
                onCancel={() => onEditingChange(null)}
              />
            ) : (
              a.note && (
                <p class="note" onDblClick={() => onEditingChange(a.id)}>
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
      </div>

      <footer class="sb-foot">
        <ActionButton id="copy-prompt" class="btn-secondary" />
      </footer>
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
  editing: boolean;
  onEdit: (note: string) => void;
  onCancelEdit: () => void;
}) {
  const pos = usePopoverPosition(props.popoverRef, props.rect);

  return (
    <div class="popover" ref={props.popoverRef} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      {props.editing ? (
        <NoteForm
          rows={2}
          initial={props.annotation.note}
          submitLabel="Save"
          onSubmit={props.onEdit}
          onCancel={props.onCancelEdit}
        />
      ) : (
        <>
          {props.annotation.note && <p class="popover-note">{props.annotation.note}</p>}
          <div class="row">
            <ActionButton id="edit-annotation" label="Edit" />
            <ActionButton id="delete-annotation" label="Delete" />
          </div>
        </>
      )}
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
