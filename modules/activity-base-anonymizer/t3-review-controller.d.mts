import type {T3ActivityReview} from './t3-selected-host.mjs';
export type T3ReviewState = {
  status: 'READY_TO_READ' | 'READING' | 'REVIEW' | 'HOLD';
  review: T3ActivityReview | null;
  code?: string;
};
// Only these two capabilities are visible to the React/Tauri renderer.
// The original T3 Kernel/Access objects remain exclusively in trusted Host.
export type T3ReviewHost = {
  readSelected: () => Promise<T3ActivityReview>;
  subscribeInvalidation: (callback: () => void) => () => void;
};
export function createT3ReviewController(input: {
  host: T3ReviewHost;
  onUpdate: (state: T3ReviewState) => void;
}): {
  readSelected: () => Promise<{status: 'DETACHED' | 'INVALIDATED' | 'REVIEW' | 'HOLD'}>;
  reset: () => void;
  dispose: () => void;
};