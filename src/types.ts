export type AnnotationType = "comment" | "replace" | "delete" | "global";

export type AnnotationStatus = "open" | "stale";

export interface Annotation {
  id: string;
  type: AnnotationType;
  /** 1-based inclusive source lines. Null for type "global". */
  lineRange: [number, number] | null;
  /** Exact selected source-adjacent text; re-anchoring matches against this. Null for "global". */
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
  type: AnnotationType;
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
