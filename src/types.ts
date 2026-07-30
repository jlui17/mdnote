export type AnnotationStatus = "open" | "stale";

export interface Annotation {
  id: string;
  /** 1-based inclusive source lines. Null for a doc-wide note. */
  lineRange: [number, number] | null;
  /** Exact selected source-adjacent text; re-anchoring matches against this. Null for a doc-wide note. */
  anchorText: string | null;
  note: string;
  createdAt: string;
  status: AnnotationStatus;
}

export interface Sidecar {
  version: 1;
  annotations: Annotation[];
}

/** Body of POST /annotations. Server assigns id, createdAt, status. */
export interface NewAnnotation {
  lineRange: [number, number] | null;
  anchorText: string | null;
  note: string;
}

export interface DocResponse {
  /** Absolute path of the file under review. */
  path: string;
  /** Raw Markdown source. */
  source: string;
  /** Rendered HTML with data-source-line stamps. */
  html: string;
}
