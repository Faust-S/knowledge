/**
 * Non-accepted Runtime Contract 1.3.0 candidate types.
 *
 * This folder is deliberately NOT the active Runtime snapshot.
 * Runtime 1.2.0 remains immutable and authoritative until a qualified
 * Kernel successor is implemented and accepted.
 */

export * from "../runtime-1.2.0/public-api";

import type {
  EventRecord,
  IWXAClient,
  ObjectRecord,
  RelationRecord,
  T1Surface,
} from "../runtime-1.2.0/public-api";

export const ATOMIC_GRAPH_OPERATION = "t1.commitObjectGraph" as const;
export const ATOMIC_GRAPH_CONTRACT_VERSION = "1.3.0" as const;

export type AtomicGraphOperationId = typeof ATOMIC_GRAPH_OPERATION;

export type CommitObjectGraphInput = {
  workspace_id: string;
  idempotency_key: string;
  object: {
    object_id: string;
    schema_id: string;
    schema_version: string;
    data: unknown;
    extensions?: Record<string, unknown>;
    base_revision?: number;
  };
  relation_puts?: Array<{
    relation_id: string;
    from_object_id: string;
    to_object_id: string;
    kind: string;
  }>;
  relation_deletes?: Array<{
    relation_id: string;
  }>;
  event: {
    event_type: string;
    payload?: unknown;
  };
};

export type CommitObjectGraphReceipt = {
  transaction_id: string;
  workspace_id: string;
  object: ObjectRecord;
  relations_put: RelationRecord[];
  relation_ids_deleted: string[];
  event: EventRecord;
  deduplicated: boolean;
};

export type T1Surface13Candidate = T1Surface & {
  commitObjectGraph(
    input: CommitObjectGraphInput,
  ): Promise<CommitObjectGraphReceipt>;
};

/**
 * Candidate-only client shape used for negotiation tests and future
 * successor binding. It is not accepted by the current loader.
 */
export type IWXAClient13Candidate = Omit<
  IWXAClient,
  "contract_version" | "t1"
> & {
  contract_version: typeof ATOMIC_GRAPH_CONTRACT_VERSION;
  t1: T1Surface13Candidate;
};
