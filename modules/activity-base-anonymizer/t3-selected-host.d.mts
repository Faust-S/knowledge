export const T3_SELECTED_VIEW_SCHEMA: string;
export class T3ActivityHold extends Error {code: string; constructor(code: string);}
export type T3StructuralCandidate = {
  object_type: string;
  cohort_band: string;
  observed_event_kinds: string[];
  object_local_successions: Array<{from: string; to: string; cohort_band: string; relation: string}>;
};
export type T3ActivityReview = {
  schema: string;
  status: 'HOLD' | 'STRUCTURE_PRESERVED_REVIEW_REQUIRED';
  reason_codes: string[];
  host_source: string;
  semantic_mapping: string;
  residual_risk: string;
  anonymity: 'NOT_ESTABLISHED';
  export_allowed: false;
  iwxa_package: null;
  structural_candidate: T3StructuralCandidate[] | null;
};
export function inspectSelectedT3Activity(input: {
  context: unknown;
  signedAccess: unknown;
  bindings: unknown;
  readActivityFromWorkspaceContext: Function;
}): Promise<T3ActivityReview>;

export function createTrustedT3ReviewPort(input: {
  context: unknown;
  signedAccess: unknown;
  bindings: unknown;
  readActivityFromWorkspaceContext: Function;
  subscribeOwnerInvalidation: (listener: () => void) => (() => void);
}): {
  readSelected: () => Promise<T3ActivityReview>;
  subscribeInvalidation: (listener: () => void) => (() => void);
};

// Trusted installed ORIGINAL corporate D3 owner's signed state + D2 DATA
// readback, not the Activity WebView. Raw rows never reach the renderer.
export type T3OriginalNativeSignedView = {
  status: 'D3_OWNER_READY';
  snapshot: {
    product: 'admin';
    organizationId: string;
    workspaceId: string;
    actorId: string;
    contextId: string;
    contextEpoch: number;
    d2ActivityReaderConnected: true;
  };
};
export function createTrustedOriginalT3NativeReadPort(input: {
  currentSignedView: () => Promise<T3OriginalNativeSignedView>;
  readActivityReadback: () => Promise<unknown>;
  subscribeInvalidation: (listener: () => void) => (() => void);
}): {
  readSelected: () => Promise<T3ActivityReview>;
  subscribeInvalidation: (listener: () => void) => (() => void);
};
