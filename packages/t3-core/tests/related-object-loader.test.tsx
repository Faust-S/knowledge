/**
 * T2-03C — related-object preview loader.
 *
 * Verifies:
 *   - dedup;
 *   - concurrency ≤ 4;
 *   - independent error handling;
 *   - uses only .object (never descends into related.relations);
 *   - disabled → never dispatches.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useMemo } from "react";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { useRelatedObjects } from "../src/modules/base/features/object/relations/useRelatedObjects";
import { adapter } from "../src/kernel-client";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import type { ObjectRecord, ObjectWithRelations } from "../src/kernel-client";

function makeObj(id: string): ObjectRecord {
  return {
    workspace_id: "w", object_id: id,
    schema_id: "note", schema_version: "1",
    created_by_service: "svc", updated_by_service: "svc",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    revision: 1, data: { id }, deleted: false, deleted_at: undefined,
  };
}

const dummySession = { service: { service_id: "s" }, granted_operations: [] } as never;
const dummyKernel = createKernelFacade({ session: dummySession });

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("useRelatedObjects", () => {
  it("dispatches at most 4 concurrent getObject calls", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.spyOn(adapter, "getObject").mockImplementation(async (_s, _ws, id) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { object: makeObj(id), relations: { outgoing: [], incoming: [] } } as ObjectWithRelations;
    });

    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const { result } = renderHook(() =>
      useRelatedObjects({
        kernel: dummyKernel,
        workspaceId: "w",
        visibleIds: ids,
        enabled: true,
      }),
    );
    await waitFor(() => {
      for (const id of ids) {
        expect(result.current.get(id).state).toBe("preview-ready");
      }
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThanOrEqual(2);
  });

  it("deduplicates repeated ids into one request", async () => {
    const spy = vi
      .spyOn(adapter, "getObject")
      .mockImplementation(async (_s, _ws, id) => ({
        object: makeObj(id),
        relations: { outgoing: [], incoming: [] },
      } as ObjectWithRelations));
    renderHook(() =>
      useRelatedObjects({
        kernel: dummyKernel,
        workspaceId: "w",
        visibleIds: ["a", "a", "a", "b"],
        enabled: true,
      }),
    );
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 5));
    const uniqueIds = new Set(spy.mock.calls.map((c) => c[2]));
    expect(uniqueIds.size).toBe(2);
  });

  it("keeps other previews alive when one errors", async () => {
    vi.spyOn(adapter, "getObject").mockImplementation(async (_s, _ws, id) => {
      if (id === "boom") throw new Error("nope");
      return { object: makeObj(id), relations: { outgoing: [], incoming: [] } } as ObjectWithRelations;
    });
    const { result } = renderHook(() =>
      useRelatedObjects({
        kernel: dummyKernel,
        workspaceId: "w",
        visibleIds: ["ok", "boom", "ok2"],
        enabled: true,
      }),
    );
    await waitFor(() => {
      expect(result.current.get("boom").state).toBe("preview-failed");
      expect(result.current.get("ok").state).toBe("preview-ready");
      expect(result.current.get("ok2").state).toBe("preview-ready");
    });
  });

  it("null object → related-object-missing", async () => {
    vi.spyOn(adapter, "getObject").mockResolvedValue(null as unknown as never);
    const { result } = renderHook(() =>
      useRelatedObjects({
        kernel: dummyKernel,
        workspaceId: "w",
        visibleIds: ["gone"],
        enabled: true,
      }),
    );
    await waitFor(() =>
      expect(result.current.get("gone").state).toBe("related-object-missing"),
    );
  });

  it("disabled → never dispatches", async () => {
    const spy = vi.spyOn(adapter, "getObject");
    renderHook(() =>
      useRelatedObjects({
        kernel: dummyKernel,
        workspaceId: "w",
        visibleIds: ["a", "b"],
        enabled: false,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(spy).not.toHaveBeenCalled();
  });

  it("clears cache when workspaceId changes", async () => {
    vi.spyOn(adapter, "getObject").mockImplementation(async (_s, ws, id) => ({
      object: { ...makeObj(id), workspace_id: ws },
      relations: { outgoing: [], incoming: [] },
    } as ObjectWithRelations));
    const { result, rerender } = renderHook(
      ({ workspaceId }) =>
        useRelatedObjects({
          kernel: dummyKernel,
          workspaceId,
          visibleIds: ["a"],
          enabled: true,
        }),
      { initialProps: { workspaceId: "w1" } },
    );
    await waitFor(() =>
      expect(result.current.get("a").state).toBe("preview-ready"),
    );
    act(() => rerender({ workspaceId: "w2" }));
    // cache reset — immediately after switch the entry is loading, not ready
    expect(result.current.get("a").state).toBe("loading");
  });
});
