import type { ActionId } from "./actions.ts";

export type AnnotationStatus = "open" | "stale";

export type Theme = "light" | "dark" | "system";

/** Settings merged over app defaults; the server injects this into index.html as window.__MDNOTE_CONFIG__. */
export interface ResolvedConfig {
  theme: Theme;
  /** Full map, one entry per action; null means unbound. */
  keybindings: Record<ActionId, string | null>;
}

/** Contents of the global lock naming the running server. */
export interface ServerLock {
  host: string;
  port: number;
  pid: number;
}

export interface Annotation {
  id: string;
  /** 1-based inclusive source lines. Null for a doc-wide note. */
  lineRange: [number, number] | null;
  /** Exact selected source-adjacent text; re-anchoring matches against this. Null for a doc-wide note. */
  anchorText: string | null;
  note: string;
  createdAt: string;
  status: AnnotationStatus;
  /** Set when the annotation came from a whole-block gesture; presentation paints a
   *  block box instead of a text highlight. Absent on text-selection annotations. */
  block?: true;
}

export interface Sidecar {
  version: 1;
  annotations: Annotation[];
}

/** Body of PATCH /annotations/:id. */
export interface AnnotationPatch {
  note: string;
}

/** Body of POST /annotations. Server assigns id, createdAt, status. */
export interface NewAnnotation {
  lineRange: [number, number] | null;
  anchorText: string | null;
  note: string;
  block?: true;
}

export interface DocResponse {
  /** Absolute path of the file under review. */
  path: string;
  /** Raw Markdown source. */
  source: string;
  /** Rendered HTML with data-source-line stamps. */
  html: string;
}
