import type {T3ActivityReview} from './t3-selected-host.mjs';
export type T3ControlActivityPort = {
  readSelected(): Promise<T3ActivityReview>;
  subscribeInvalidation(listener: () => void): () => void;
  stageSelected?: () => Promise<{
    status: 'OWNER_REVIEW_DRAFT'; readback: true; export_allowed: false;
  }>;
};
export type T3ControlActivityBinding = {
  readonly port: T3ControlActivityPort;
  dispose(): void;
};
export function bindT3ControlActivityReview(input: {
  control: unknown;
  context: unknown;
  bindings: unknown;
  createSignedAccessHostPort?: Function;
  readActivityFromWorkspaceContext: Function;
  derivation?: unknown;
}): T3ControlActivityBinding;
/** Original T3 signed Control, exactly one Host-side invalidation stream. */
export function openOriginalT3ActivityReviewHost(input: {
  control: unknown;
  context: unknown;
  /** Original T2 KernelFacade, not a subject-bound ModuleContext.kernel. */
  originalKernel: unknown;
  bindings: unknown;
  readActivityFromWorkspaceContext: Function;
  createSubjectKernelBinding: Function;
  subscribeExistingInvalidation?: (listener: () => void) => () => void;
}): Promise<T3ControlActivityBinding>;
