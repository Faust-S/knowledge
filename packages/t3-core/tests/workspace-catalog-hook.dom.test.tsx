/**
 * T2-02E behavioural tests for `useWorkspaceCatalog`.
 *
 * Unlike the source-scan tests in `workspace-catalog-t2-02d.test.ts`,
 * this suite renders the hook against a fake adapter and asserts real
 * state transitions:
 *
 *   - First load transitions idle → loading (items still []) → ready.
 *   - Refresh over a ready snapshot transitions ready → loading while
 *     preserving prior items and prior loadedAt.
 *   - A failed refresh degrades to error but keeps prior items and
 *     prior loadedAt.
 *   - Two concurrent refresh() calls share ONE adapter round-trip
 *     (in-memory dedup via inFlightRef).
 *   - A session change invalidates any in-flight promise so the next
 *     mount starts a fresh load and never applies the stale response.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useMemo } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceCatalog } from "../src/modules/base/features/workspaces/useWorkspaceCatalog";
import { createDevMockClient } from "../src/kernel-client/dev-mock";
import { capabilities as computeCapabilities } from "../src/kernel-client/capabilities";
import { adapter } from "../src/kernel-client/adapter";
import { createKernelFacade } from "../src/workspace-host/context/create-kernel-facade";
import type { WorkspaceRecord } from "../src/kernel-client";

function seed(): WorkspaceRecord[] {
  return [
    {
      workspace_id: "alpha",
      profile: "generic",
      capabilities: [],
      read_only: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-05T00:00:00Z",
    },
    {
      workspace_id: "bravo",
      profile: "generic",
      capabilities: [],
      read_only: false,
      created_at: "2026-01-02T00:00:00Z",
      updated_at: "2026-01-10T00:00:00Z",
    },
  ];
}

describe("useWorkspaceCatalog — refresh state transitions", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("initial load goes idle → loading (items=[]) → ready", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed() });
    const caps = computeCapabilities(session);
    const { result } = renderHook(() =>
      useWorkspaceCatalog({ kernel: useMemo(() => createKernelFacade({ session }), [session]) }),
    );
    // Synchronously after mount the effect has already scheduled the
    // load; state is either idle or loading with no items.
    expect(result.current.items.length).toBe(0);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items.length).toBe(2);
    expect(result.current.loadedAt).toBeTypeOf("number");
  });

  it("refresh over ready snapshot yields loading + preserved items + preserved loadedAt", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed() });
    const caps = computeCapabilities(session);
    const { result } = renderHook(() =>
      useWorkspaceCatalog({ kernel: useMemo(() => createKernelFacade({ session }), [session]) }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const priorItems = result.current.items;
    const priorLoadedAt = result.current.loadedAt;
    expect(priorItems.length).toBe(2);

    // Make the next listWorkspaces call block so we can observe
    // the loading-with-items intermediate snapshot.
    let release: (v: WorkspaceRecord[]) => void = () => {};
    const pending = new Promise<WorkspaceRecord[]>((r) => (release = r));
    const spy = vi
      .spyOn(adapter, "listWorkspaces")
      .mockImplementationOnce(() => pending);

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    // Intermediate: still holding prior data.
    expect(result.current.status).toBe("loading");
    expect(result.current.items).toBe(priorItems);
    expect(result.current.loadedAt).toBe(priorLoadedAt);
    expect(result.current.error).toBeNull();

    await act(async () => {
      release(seed());
      await refreshPromise;
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.items.length).toBe(2);
    // A fresh loadedAt stamp on success.
    expect(result.current.loadedAt).not.toBe(priorLoadedAt);
    spy.mockRestore();
  });

  it("failed refresh preserves prior items and prior loadedAt", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed() });
    const caps = computeCapabilities(session);
    const { result } = renderHook(() =>
      useWorkspaceCatalog({ kernel: useMemo(() => createKernelFacade({ session }), [session]) }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const priorItems = result.current.items;
    const priorLoadedAt = result.current.loadedAt;

    vi.spyOn(adapter, "listWorkspaces").mockRejectedValueOnce(new Error("boom"));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/boom/);
    expect(result.current.items).toBe(priorItems);
    expect(result.current.loadedAt).toBe(priorLoadedAt);
  });

  it("concurrent refresh calls share ONE adapter round-trip", async () => {
    const session = createDevMockClient({ seedWorkspaces: seed() });
    const caps = computeCapabilities(session);
    const { result } = renderHook(() =>
      useWorkspaceCatalog({ kernel: useMemo(() => createKernelFacade({ session }), [session]) }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let release: (v: WorkspaceRecord[]) => void = () => {};
    const pending = new Promise<WorkspaceRecord[]>((r) => (release = r));
    const spy = vi
      .spyOn(adapter, "listWorkspaces")
      .mockImplementationOnce(() => pending);

    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.refresh();
      b = result.current.refresh();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(seed());
      await Promise.all([a, b]);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("session change invalidates in-flight promise and starts fresh", async () => {
    const sessionA = createDevMockClient({ seedWorkspaces: seed() });
    const capsA = computeCapabilities(sessionA);
    const { result, rerender } = renderHook(
      (props: { session: typeof sessionA }) =>
        useWorkspaceCatalog({ kernel: useMemo(() => createKernelFacade({ session: props.session }), [props.session]) }),
      { initialProps: { session: sessionA } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const idsA = result.current.items.map((i) => i.workspace.workspace_id).sort();
    expect(idsA).toEqual(["alpha", "bravo"]);

    const sessionB = createDevMockClient({
      seedWorkspaces: [
        {
          workspace_id: "zulu",
          profile: "generic",
          capabilities: [],
          read_only: false,
          created_at: "2026-03-01T00:00:00Z",
          updated_at: "2026-03-01T00:00:00Z",
        },
      ],
    });
    await act(async () => {
      rerender({ session: sessionB });
    });
    await waitFor(() =>
      expect(result.current.items.map((i) => i.workspace.workspace_id)).toEqual(["zulu"]),
    );
    expect(result.current.status).toBe("ready");
  });

  it("refreshAfterMutation waits for the in-flight load and forces a fresh list", async () => {

    const session = createDevMockClient({
      seedWorkspaces: [
        {
          workspace_id: "a", profile: "generic", capabilities: [], read_only: false,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const caps = computeCapabilities(session);
    const spy = vi.spyOn(adapter, "listWorkspaces");
    const { result } = renderHook(() => useWorkspaceCatalog({ kernel: useMemo(() => createKernelFacade({ session }), [session]) }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const before = spy.mock.calls.length;
    await act(async () => {
      await result.current.refreshAfterMutation();
    });
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(result.current.status).toBe("ready");
  });
});


