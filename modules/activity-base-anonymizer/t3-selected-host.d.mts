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