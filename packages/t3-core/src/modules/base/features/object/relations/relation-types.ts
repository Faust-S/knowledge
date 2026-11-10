/**
 * Types for the relation panels and related-object preview loader.
 */
import type {
  ObjectRecord,
  RelationRecord,
} from "../../../../../kernel-client";

export type RelationDirection = "outgoing" | "incoming";

export type RelationValidity =
  | "valid"
  | "unsafe-id"
  | "cross-workspace"
  | "endpoint-mismatch";

export interface DecoratedRelation {
  relation: RelationRecord;
  direction: RelationDirection;
  /** Object id at the OTHER end of the relation. */
  relatedObjectId: string;
  validity: RelationValidity;
}

export type PreviewLoadState =
  | "idle"
  | "loading"
  | "preview-ready"
  | "preview-unavailable"
  | "preview-failed"
  | "preview-integrity-failed"
  | "related-object-missing";

export interface RelatedPreview {
  state: PreviewLoadState;
  object: ObjectRecord | null;
  error: string | null;
}

export const NO_PREVIEW: RelatedPreview = Object.freeze({
  state: "preview-unavailable",
  object: null,
  error: null,
});
