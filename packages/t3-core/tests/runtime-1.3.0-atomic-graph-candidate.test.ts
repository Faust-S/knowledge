import { describe, expect, it, vi } from "vitest";
import {
  ATOMIC_GRAPH_CONTRACT_VERSION,
  ATOMIC_GRAPH_OPERATION,
  type CommitObjectGraphInput,
} from "../src/kernel-client/contracts/runtime-1.3.0-candidate";
import {
  AtomicGraphCandidateUnavailableError,
  commitObjectGraphCandidate,
  negotiateAtomicGraphCandidate,
} from "../src/kernel-client/contracts/runtime-1.3.0-candidate/atomic-graph-negotiation";

const input: CommitObjectGraphInput = {
  workspace_id: "w",
  idempotency_key: "idem-1",
  object: {
    object_id: "o",
    schema_id: "result",
    schema_version: "1.0.0",
    data: { ok: true },
  },
  relation_puts: [
    {
      relation_id: "r",
      from_object_id: "o",
      to_object_id: "existing",
      kind: "derived-from",
    },
  ],
  event: { event_type: "result.graph.committed" },
};

describe("Runtime 1.3 atomic graph candidate negotiation", () => {
  it("rejects Runtime 1.2 even if a same-named method is injected", () => {
    const method = vi.fn();
    expect(negotiateAtomicGraphCandidate({
      contract_version: "1.2.0",
      granted_operations: [ATOMIC_GRAPH_OPERATION],
      t1: { commitObjectGraph: method },
    })).toMatchObject({
      available: false,
      reason: "CONTRACT_VERSION_MISMATCH",
    });
  });

  it("rejects 1.3 when the operation is not granted", () => {
    expect(negotiateAtomicGraphCandidate({
      contract_version: ATOMIC_GRAPH_CONTRACT_VERSION,
      granted_operations: [],
      t1: { commitObjectGraph: vi.fn() },
    })).toMatchObject({
      available: false,
      reason: "OPERATION_NOT_GRANTED",
    });
  });

  it("rejects grant-only declarations without a real Kernel method", () => {
    expect(negotiateAtomicGraphCandidate({
      contract_version: ATOMIC_GRAPH_CONTRACT_VERSION,
      granted_operations: [ATOMIC_GRAPH_OPERATION],
      t1: {},
    })).toMatchObject({
      available: false,
      reason: "RUNTIME_SURFACE_MISSING",
    });
  });

  it("dispatches the exact input once when all three successor gates hold", async () => {
    const receipt = {
      transaction_id: "tx",
      workspace_id: "w",
      object: { object_id: "o" },
      relations_put: [{ relation_id: "r" }],
      relation_ids_deleted: [],
      event: { event_id: "e" },
      deduplicated: false,
    };
    const method = vi.fn(async (value) => {
      expect(value).toBe(input);
      return receipt;
    });
    const client = {
      contract_version: ATOMIC_GRAPH_CONTRACT_VERSION,
      granted_operations: [ATOMIC_GRAPH_OPERATION],
      t1: { commitObjectGraph: method },
    };
    await expect(commitObjectGraphCandidate(client, input)).resolves.toBe(receipt);
    expect(method).toHaveBeenCalledTimes(1);
  });

  it("never emulates atomicity with putObject/putRelation", () => {
    const putObject = vi.fn();
    const putRelation = vi.fn();
    expect(() => commitObjectGraphCandidate({
      contract_version: "1.2.0",
      granted_operations: ["t1.putObject", "t1.putRelation"],
      t1: { putObject, putRelation },
    } as never, input)).toThrow(AtomicGraphCandidateUnavailableError);
    expect(putObject).not.toHaveBeenCalled();
    expect(putRelation).not.toHaveBeenCalled();
  });
});
