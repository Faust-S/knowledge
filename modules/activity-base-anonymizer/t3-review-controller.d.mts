import type {T3ActivityReview} from './t3-selected-host.mjs';
export type T3ReviewState = {
  status: 'READY_TO_READ' | 'READING' | 'REVIEW' | 'HOLD';
  review: T3ActivityReview | null;
  code?: string;
};
export type T3ReviewHost = {
  context: {
    kernel: unknown;
    currentWorkspace: {
      get: () => {workspace_id?: string} | null;
      subscribe: (callback: () => void) => () => void;
    };
  };
  signedAccess: unknown;
  bindings: unknown;
  readActivityFromWorkspaceContext: Function;
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