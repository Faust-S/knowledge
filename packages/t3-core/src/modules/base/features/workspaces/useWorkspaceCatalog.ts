/**
 * Single React hook that owns the workspace catalog in memory.
 *
 * Refresh semantics (T2-03A):
 *   - Concurrent user-initiated refresh() calls are deduplicated via
 *     `inFlightRef`.
 *   - After a successful mutation (createWorkspace) callers MUST use
 *     `refreshAfterMutation()`. That method waits for any in-flight
 *     request to finish (its snapshot may pre-date the mutation) and
 *     then unconditionally starts a fresh listWorkspaces round-trip.
 *     The mutation itself never fails because a post-mutation refresh
 *     failed — the fresh record is always returned to the caller and the
 *     refresh error is surfaced in the catalog state only.
 *
 * PROMPT 22c-1 — consumes `KernelFacade` instead of `KernelSession`
 * plus `Capabilities`. Capability checks go through
 * `kernel.hasOperation(...)`; a `null` kernel means the workspace host
 * has not yet handed one to this module and the hook stays idle.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceRecord } from "../../../../kernel-client";
import type { KernelFacade } from "../../../../workspace-contract";
import type {
  CreateWorkspaceRequest,
  WorkspaceCatalogSnapshot,
} from "./catalog-types";
import { loadWorkspaceCatalog } from "./catalog-loader";
import { generateWorkspaceId, isValidWorkspaceId } from "./workspace-id";

export interface UseWorkspaceCatalogOptions {
  kernel: KernelFacade | null;
}

export interface WorkspaceCatalogController extends WorkspaceCatalogSnapshot {
  refresh: () => Promise<void>;
  /**
   * Post-mutation catalog sync. Waits for any in-flight refresh (whose
   * response may predate the mutation) before forcing a fresh load.
   */
  refreshAfterMutation: () => Promise<void>;
  createWorkspace: (
    request: CreateWorkspaceRequest,
  ) => Promise<WorkspaceRecord>;
}


const IDLE: WorkspaceCatalogSnapshot = {
  status: "idle",
  items: [],
  error: null,
  loadedAt: null,
};

export function useWorkspaceCatalog(
  options: UseWorkspaceCatalogOptions,
): WorkspaceCatalogController {
  const { kernel } = options;
  const [snapshot, setSnapshot] = useState<WorkspaceCatalogSnapshot>(IDLE);
  const requestSeq = useRef(0);
  const kernelRef = useRef<KernelFacade | null>(kernel);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    kernelRef.current = kernel;
    requestSeq.current += 1;
    inFlightRef.current = null;
    setSnapshot(IDLE);
  }, [kernel]);

  const runOnce = useCallback(
    (localKernel: KernelFacade): Promise<void> => {
      const ticket = ++requestSeq.current;
      setSnapshot((prev) => ({
        status: "loading",
        items: prev.items,
        error: null,
        loadedAt: prev.loadedAt,
      }));
      return (async () => {
        try {
          const items = await loadWorkspaceCatalog(localKernel);
          if (ticket !== requestSeq.current || kernelRef.current !== localKernel) return;
          setSnapshot({
            status: "ready",
            items,
            error: null,
            loadedAt: Date.now(),
          });
        } catch (e) {
          if (ticket !== requestSeq.current || kernelRef.current !== localKernel) return;
          setSnapshot((prev) => ({
            status: "error",
            items: prev.items,
            error: e instanceof Error ? e.message : String(e),
            loadedAt: prev.loadedAt,
          }));
        }
      })();
    },
    [],
  );

  const runLoad = useCallback((): Promise<void> => {
    if (!kernel) return Promise.resolve();
    if (!kernel.hasOperation("t1.listWorkspaces")) {
      setSnapshot({
        status: "error",
        items: [],
        error: "t1.listWorkspaces is not granted by the kernel",
        loadedAt: null,
      });
      return Promise.resolve();
    }
    if (inFlightRef.current) return inFlightRef.current;
    const localKernel = kernel;
    const p = runOnce(localKernel).finally(() => {
      if (inFlightRef.current === p) inFlightRef.current = null;
    });
    inFlightRef.current = p;
    return p;
  }, [kernel, runOnce]);

  const refreshAfterMutation = useCallback(async (): Promise<void> => {
    if (!kernel) return;
    if (!kernel.hasOperation("t1.listWorkspaces")) return;
    // Wait for any in-flight refresh to complete — its result may
    // predate the mutation. We swallow its error: post-mutation refresh
    // has its own outcome.
    const prior = inFlightRef.current;
    if (prior) {
      try { await prior; } catch { /* handled by its own setSnapshot */ }
    }
    // Force a fresh round-trip that is NOT deduplicated with the older
    // request. Install it as the new in-flight promise so any subsequent
    // ordinary refresh() dedups against this one.
    const localKernel = kernel;
    const p = runOnce(localKernel).finally(() => {
      if (inFlightRef.current === p) inFlightRef.current = null;
    });
    inFlightRef.current = p;
    await p;
  }, [kernel, runOnce]);

  useEffect(() => {
    if (!kernel) return;
    if (!kernel.hasOperation("t1.listWorkspaces")) return;
    void runLoad();
  }, [kernel, runLoad]);

  const refresh = useCallback(async () => {
    await runLoad();
  }, [runLoad]);

  const createWorkspace = useCallback(
    async (request: CreateWorkspaceRequest): Promise<WorkspaceRecord> => {
      if (!kernel) {
        throw new Error("Kernel session is not ready");
      }
      if (!kernel.hasOperation("t1.createWorkspace")) {
        throw new Error("t1.createWorkspace is not granted by the kernel");
      }
      const profile = request.profile;
      if (!profile || typeof profile !== "string") {
        throw new Error("profile is required to create a workspace");
      }
      const workspace_id = generateWorkspaceId();
      if (!isValidWorkspaceId(workspace_id)) {
        throw new Error("Generated workspace_id failed validation");
      }
      const created = await kernel.createWorkspace({
        workspace_id,
        profile,
      });
      // Fire-and-swallow the refresh — a stale/failed catalog reload
      // must NOT convert a successful creation into a false failure.
      try {
        await refreshAfterMutation();
      } catch {
        /* refresh error already surfaced via snapshot */
      }
      return created;
    },
    [kernel, refreshAfterMutation],
  );

  return { ...snapshot, refresh, refreshAfterMutation, createWorkspace };
}
