import type {
  CommitObjectGraphInput,
  CommitObjectGraphReceipt,
  IWXAClient13Candidate,
} from "./index";
import {
  ATOMIC_GRAPH_CONTRACT_VERSION,
  ATOMIC_GRAPH_OPERATION,
} from "./index";

export type AtomicGraphCandidateUnavailableReason =
  | "CONTRACT_VERSION_MISMATCH"
  | "OPERATION_NOT_GRANTED"
  | "RUNTIME_SURFACE_MISSING";

export type AtomicGraphCandidateNegotiation =
  | {
      available: true;
      contractVersion: typeof ATOMIC_GRAPH_CONTRACT_VERSION;
      operation: typeof ATOMIC_GRAPH_OPERATION;
    }
  | {
      available: false;
      reason: AtomicGraphCandidateUnavailableReason;
      expectedContractVersion: typeof ATOMIC_GRAPH_CONTRACT_VERSION;
      operation: typeof ATOMIC_GRAPH_OPERATION;
    };

type CandidateLike = {
  contract_version?: unknown;
  granted_operations?: readonly string[] | unknown;
  t1?: { commitObjectGraph?: unknown } | unknown;
};

function candidateMethod(client: CandidateLike): unknown {
  const t1 = client.t1;
  if (!t1 || typeof t1 !== "object") return undefined;
  return (t1 as { commitObjectGraph?: unknown }).commitObjectGraph;
}

/**
 * Candidate-only three-part negotiation.
 *
 * Availability requires the exact successor contract, an explicit operation
 * grant and a real Kernel method. Runtime 1.2.0, grant-only declarations and
 * method-only shims all remain unavailable.
 */
export function negotiateAtomicGraphCandidate(
  client: CandidateLike,
): AtomicGraphCandidateNegotiation {
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
  if (typeof candidateMethod(client) !== "function") {
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

export class AtomicGraphCandidateUnavailableError extends Error {
  constructor(
    public readonly reason: AtomicGraphCandidateUnavailableReason,
  ) {
    super(`atomic graph candidate unavailable: ${reason}`);
    this.name = "AtomicGraphCandidateUnavailableError";
  }
}

/**
 * Candidate-only pass-through. It never reconstructs atomicity from existing
 * Runtime 1.2.0 methods and never catches a Kernel failure as partial success.
 */
export function commitObjectGraphCandidate(
  client: CandidateLike,
  input: CommitObjectGraphInput,
): Promise<CommitObjectGraphReceipt> {
  const negotiation = negotiateAtomicGraphCandidate(client);
  if (!negotiation.available) {
    throw new AtomicGraphCandidateUnavailableError(negotiation.reason);
  }
  const method = candidateMethod(client) as IWXAClient13Candidate["t1"]["commitObjectGraph"];
  return method.call(
    (client as IWXAClient13Candidate).t1,
    input,
  );
}
