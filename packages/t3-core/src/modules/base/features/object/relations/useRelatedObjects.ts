/**
 * Related-object preview loader.
 *
 * T2-03D invariants:
 *   - Every change of session / workspaceId / visibleIds / enabled bumps
 *     an internal `batchGeneration`. In-flight results from an older
 *     batch cannot write into cache and cannot mutate the in-flight set
 *     of a newer batch.
 *   - Cache is keyed to session+workspace. Successful entries for the
 *     current Workspace survive visible-page changes; they're only
 *     dropped when the outer generation (session/workspace) rolls over.
 *   - Every getObject response is integrity-checked against the id
 *     requested and the current workspace. Mismatch → preview-integrity-failed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KernelFacade } from "../../../../../workspace-contract";
import { isSafeOpaqueId } from "../../../../../shell/routing";
import type { RelatedPreview } from "./relation-types";
import { NO_PREVIEW } from "./relation-types";

const MAX_CONCURRENCY = 4;

export interface UseRelatedObjectsOptions {
  kernel: KernelFacade | null;
  workspaceId: string;
  visibleIds: readonly string[];
  enabled: boolean;
}

export interface RelatedObjectsController {
  get: (objectId: string) => RelatedPreview;
  /** Test-only knob: peek at the internal concurrency high-water mark. */
  __getPeakConcurrency?: () => number;
}

export function useRelatedObjects(
  opts: UseRelatedObjectsOptions,
): RelatedObjectsController {
  const { kernel, workspaceId, visibleIds, enabled } = opts;

  const [cache, setCache] = useState<Map<string, RelatedPreview>>(
    () => new Map(),
  );
  // In-flight per current batch. Older batches keep a reference to
  // their own set and never touch the newer one.
  const inFlightRef = useRef<Set<string>>(new Set());
  const generation = useRef(0);
  const batchGeneration = useRef(0);
  const peakConcurrency = useRef(0);

  // Reset EVERYTHING when session/workspace changes.
  useEffect(() => {
    ++generation.current;
    ++batchGeneration.current;
    inFlightRef.current = new Set();
    peakConcurrency.current = 0;
    setCache(new Map());
  }, [kernel, workspaceId]);

  const runOne = useCallback(
    async (
      id: string,
      gen: number,
      batch: number,
      batchInFlight: Set<string>,
    ): Promise<void> => {
      if (!kernel) return;
      try {
        const d = await kernel.getObject(workspaceId, id);
        if (gen !== generation.current) return;
        setCache((prev) => {
          const next = new Map(prev);
          if (d == null) {
            next.set(id, {
              state: "related-object-missing",
              object: null,
              error: null,
            });
            return next;
          }
          const obj = d.object;
          const identityOk =
            obj.workspace_id === workspaceId &&
            obj.object_id === id &&
            isSafeOpaqueId(obj.object_id);
          if (!identityOk) {
            next.set(id, {
              state: "preview-integrity-failed",
              object: null,
              error:
                "Kernel returned a related object that does not match the requested identity",
            });
            return next;
          }
          next.set(id, {
            state: "preview-ready",
            object: obj,
            error: null,
          });
          return next;
        });
      } catch (e) {
        if (gen !== generation.current) return;
        setCache((prev) => {
          const next = new Map(prev);
          next.set(id, {
            state: "preview-failed",
            object: null,
            error: e instanceof Error ? e.message : String(e),
          });
          return next;
        });
      } finally {
        batchInFlight.delete(id);
      }

    },
    [kernel, workspaceId],
  );

  useEffect(() => {
    // Bump batch first so an older queue's follow-up cannot run.
    const batch = ++batchGeneration.current;
    // Reuse the persistent in-flight set — do NOT reset it on each
    // visibleIds change, or already-running requests would race with
    // new ones and blow past MAX_CONCURRENCY.
    const batchInFlight = inFlightRef.current;

    if (!enabled || !kernel) return;

    // Dedupe visible IDs, drop those already cached, in-flight, or unsafe.
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const id of visibleIds) {
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!isSafeOpaqueId(id)) continue;
      if (cache.has(id)) continue;
      if (batchInFlight.has(id)) continue;
      queue.push(id);
    }
    if (queue.length === 0) return;

    const gen = generation.current;
    let index = 0;

    const startNext = (): void => {
      // If a newer batch has taken over, stop.
      if (batch !== batchGeneration.current) return;
      while (
        batchInFlight.size < MAX_CONCURRENCY &&
        index < queue.length
      ) {
        const id = queue[index++];
        batchInFlight.add(id);
        peakConcurrency.current = Math.max(
          peakConcurrency.current,
          batchInFlight.size,
        );
        void runOne(id, gen, batch, batchInFlight).then(() => {
          if (batch === batchGeneration.current) startNext();
        });
      }
    };
    startNext();
  }, [enabled, kernel, workspaceId, visibleIds, cache, runOne]);


  const get = useCallback(
    (objectId: string): RelatedPreview =>
      cache.get(objectId) ?? {
        state: enabled ? "loading" : NO_PREVIEW.state,
        object: null,
        error: null,
      },
    [cache, enabled],
  );

  return {
    get,
    __getPeakConcurrency: () => peakConcurrency.current,
  };
}
