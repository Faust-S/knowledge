import type {T3ActivityReview} from './t3-selected-host.mjs';
export type T3ControlActivityPort = {
  readSelected(): Promise<T3ActivityReview>;
  subscribeInvalidation(listener: () => void): () => void;
};
export function bindT3ControlActivityReview(input: {
  control: unknown;
  context: unknown;
  bindings: unknown;
  createSignedAccessHostPort: Function;
  readActivityFromWorkspaceContext: Function;
}): {port: T3ControlActivityPort; dispose(): void};