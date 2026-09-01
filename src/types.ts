import type { ActionId } from "./actions.ts";
import type { Theme } from "./themes.ts";

export type { Theme };

export type AnnotationStatus = "open" | "stale";

/** Settings merged over app defaults; the server injects this into index.html as window.__MDNOTE_CONFIG__. */
export interface ResolvedConfig {
  theme: Theme;
  lineNumbers: boolean;
  /** A band one text line tall behind the line under the pointer: the reading ruler. */
  readingLine: boolean;
  /** Full map, one entry per action; null means unbound. */
  keybindings: Record<ActionId, string | null>;
}

/** Body of PATCH /api/settings: the keys the UI writes back to settings.json. */
export type SettingsPatch = Partial<Pick<ResolvedConfig, "theme" | "readingLine">>;

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
  /** An in-progress note whose form was interrupted (blur, reload, tab close).
   *  Hidden from the sidebar, `comments`, and submit envelopes; cleared on save. */
  draft?: true;
  /** Review round the annotation was first delivered in (submit stamps it);
   *  absent until delivered, then never restamped. */
  round?: number;
}

export interface Sidecar {
  version: 1;
  annotations: Annotation[];
  /** Highest review round ever submitted for this file. Lives outside the
   *  annotations so clearing them can't reset round numbering. */
  lastRound?: number;
}

/** Body of PATCH /annotations/:id. `draft: false` promotes a draft to a saved annotation. */
export interface AnnotationPatch {
  note: string;
  draft?: false;
}

/** Body of POST /annotations. Server assigns id, createdAt, status. */
export interface NewAnnotation {
  lineRange: [number, number] | null;
  anchorText: string | null;
  note: string;
  block?: true;
  draft?: true;
}

/** What `mdnote wait` prints on submit. Empty annotations = approved as-is. */
export interface ReviewEnvelope {
  path: string;
  submittedAt: string;
  annotations: Annotation[];
}

export interface DocResponse {
  /** Absolute path of the file under review. */
  path: string;
  /** Raw Markdown source. */
  source: string;
  /** Rendered HTML with data-source-line stamps. */
  html: string;
}
