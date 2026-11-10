/**
 * Runtime surface guard for the kernel adapter.
 *
 * Every adapter method MUST call `requireOperation(session, op, method)`
 * before dispatching. There are three deterministic outcomes:
 *
 *   1. `op` is NOT present in `session.granted_operations`
 *      → OperationNotGrantedError. The kernel has not authorised the
 *        caller to use this operation regardless of tier presence.
 *
 *   2. `op` IS granted but the runtime surface does not expose a
 *      corresponding function
 *      → RuntimeSurfaceIncompatibleError. The kernel reports an
 *        operation it cannot actually perform — a contract violation
 *        the adapter refuses to paper over.
 *
 *   3. Both hold → returns void; the adapter dispatches unchanged
 *      arguments to the runtime and returns unchanged results.
 *
 * Messages are technical and deterministic: they name the operation
 * string. They are NEVER user-facing text; the shell must translate
 * them into a diagnosed error before rendering.
 */

import type { KernelSession } from "../types";

export class OperationNotGrantedError extends Error {
  constructor(public readonly operation: string) {
    super(`operation not granted: ${operation}`);
    this.name = "OperationNotGrantedError";
  }
}

export class RuntimeSurfaceIncompatibleError extends Error {
  constructor(public readonly operation: string) {
    super(`runtime surface missing method for operation: ${operation}`);
    this.name = "RuntimeSurfaceIncompatibleError";
  }
}

export function requireOperation(
  session: KernelSession,
  operation: string,
  method: unknown,
): void {
  const ops = session.granted_operations ?? [];
  if (!ops.includes(operation)) {
    throw new OperationNotGrantedError(operation);
  }
  if (typeof method !== "function") {
    throw new RuntimeSurfaceIncompatibleError(operation);
  }
}
