import type {T3ActivityReview} from './t3-selected-host.mjs';
export type T3ReviewState = {
  status: 'READY_TO_READ' | 'READING' | 'REVIEW' | 'STAGING' | 'STAGED' | 'HOLD';
  review: T3ActivityReview | null;
  code?: string;
};
// Read and invalidation are mandatory; a third owner-local save capability is
// optional, explicit, and never carries T3 Kernel/Access into the renderer.
// The original T3 Kernel/Access objects remain exclusively in trusted Host.
export type T3ReviewHost = {
  readSelected: () => Promise<T3ActivityReview>;
  subscribeInvalidation: (callback: () => void) => () => void;
  stageSelected?: () => Promise<{
    status: 'OWNER_REVIEW_DRAFT'; readback: true; export_allowed: false;
  }>;
};
export function createT3ReviewController(input: {
  host: T3ReviewHost;
  onUpdate: (state: T3ReviewState) => void;
}): {
  readSelected: () => Promise<{status: 'DETACHED' | 'INVALIDATED' | 'REVIEW' | 'HOLD'}>;
  stageSelected: () => Promise<{
    status: 'DETACHED' | 'INVALIDATED' | 'UNAVAILABLE' | 'STAGED' | 'HOLD';
  }>;
  reset: () => void;
  dispose: () => void;
};