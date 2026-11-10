import type {
  CommitObjectGraphInput,
  CommitObjectGraphReceipt,
  IWXAClient,
} from "./index";
import {
  ATOMIC_GRAPH_CONTRACT_VERSION,
  ATOMIC_GRAPH_OPERATION,
} from "./index";

export type AtomicGraphUnavailableReason =
  | "CONTRACT_VERSION_MISMATCH"
  | "OPERATION_NOT_GRANTED"
  | "RUNTIME_SURFACE_MISSING";

export type AtomicGraphNegotiation =
  | {
      available: true;
      contractVersion: typeof ATOMIC_GRAPH_CONTRACT_VERSION;
      operation: typeof ATOMIC_GRAPH_OPERATION;
    }
  | {
      available: false;
      reason: AtomicGraphUnavailableReason;
      expectedContractVersion: typeof ATOMIC_GRAPH_CONTRACT_VERSION;
      operation: typeof ATOMIC_GRAPH_OPERATION;
    };

type RuntimeLike = {
  contract_version?: unknown;
  granted_operations?: readonly string[] | unknown;
  t1?: { commitObjectGraph?: unknown } | unknown;
};

function runtimeMethod(client: RuntimeLike): unknown {
  const t1 = client.t1;
  if (!t1 || typeof t1 !== "object") return undefined;
  return (t1 as { commitObjectGraph?: unknown }).commitObjectGraph;
}

/**
 * Successor three-part negotiation.
 *
 * Availability requires the exact successor contract, an explicit operation
 * grant and a real Kernel method. Runtime 1.2.0, grant-only declarations and
 * method-only shims all remain unavailable.
 */
export function negotiateAtomicGraph(
  client: RuntimeLike,
): AtomicGraphNegotiation {
  if (client.contract_version !== ATOMIC_GRAPH_CONTRACT_VERSION) {
    return {
      available: false,
      reason: "CONTRACT_VERSION_MISMATCH",
      expectedContractVersion: ATOMIC_GRAPH_CONTRACT_VERSION,
      operation: ATOMIC_GRAPH_OPERATION,
    };
  }
  const operations = Array.isArray(client.granted_operations)
    ? client.granted_operations
    : [];
  if (!operations.includes(ATOMIC_GRAPH_OPERATION)) {
    return {
      available: false,
      reason: "OPERATION_NOT_GRANTED",
      expectedContractVersion: ATOMIC_GRAPH_CONTRACT_VERSION,
      operation: ATOMIC_GRAPH_OPERATION,
    };
  }
  if (typeof runtimeMethod(client) !== "function") {
    return {
      available: false,
      reason: "RUNTIME_SURFACE_MISSING",
      expectedContractVersion: ATOMIC_GRAPH_CONTRACT_VERSION,
      operation: ATOMIC_GRAPH_OPERATION,
    };
  }
  return {
    available: true,
    contractVersion: ATOMIC_GRAPH_CONTRACT_VERSION,
    operation: ATOMIC_GRAPH_OPERATION,
  };
}

export class AtomicGraphUnavailableError extends Error {
  constructor(
    public readonly reason: AtomicGraphUnavailableReason,
  ) {
    super(`atomic graph operation unavailable: ${reason}`);
    this.name = "AtomicGraphUnavailableError";
  }
}

/**
 * Successor pass-through. It never reconstructs atomicity from existing
 * Runtime 1.2.0 methods and never catches a Kernel failure as partial success.
 */
export function commitObjectGraph(
  client: RuntimeLike,
  input: CommitObjectGraphInput,
): Promise<CommitObjectGraphReceipt> {
  const negotiation = negotiateAtomicGraph(client);
  if (!negotiation.available) {
    throw new AtomicGraphUnavailableError(negotiation.reason);
  }
  const method = runtimeMethod(client) as IWXAClient["t1"]["commitObjectGraph"];
  return method.call(
    (client as IWXAClient).t1,
    input,
  );
}
