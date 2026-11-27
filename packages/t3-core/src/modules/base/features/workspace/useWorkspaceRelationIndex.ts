import { useEffect, useMemo, useRef, useState } from "react";
import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import type { KernelFacade } from "../../../../workspace-contract";
import {
  buildWorkspaceRelationIndex,
  loadRelationIndexSources,
  relationIndexHasDiagnostics,
  selectRelationIndexSources,
  type WorkspaceRelationIndexModel,
  type RelationIndexSourceSelection,
} from "./relation-index-model";

export type WorkspaceRelationIndexState =
  | "idle"
  | "unavailable"
  | "loading"
  | "ready"
  | "ready-with-diagnostics";

export interface WorkspaceRelationIndexController {
  state: WorkspaceRelationIndexState;
  model: WorkspaceRelationIndexModel | null;
  sourceSelection: RelationIndexSourceSelection;
}

export function useWorkspaceRelationIndex(options: {
  kernel: KernelFacade;
  workspaceId: string;
  objects: readonly ObjectRecord[];
  enabled: boolean;
  sourceQuery?: string;
  sourcePage?: number;
}): WorkspaceRelationIndexController {
  const { kernel, workspaceId, objects, enabled, sourceQuery = "", sourcePage = 0 } = options;
  const generation = useRef(0);
  const settledInputs = useRef<{
    kernel: KernelFacade;
    workspaceId: string;
    objects: readonly ObjectRecord[];
    enabled: boolean;
    sourceSelection: RelationIndexSourceSelection;
  } | null>(null);
  const [state, setState] = useState<WorkspaceRelationIndexState>("idle");
  const [model, setModel] = useState<WorkspaceRelationIndexModel | null>(null);

  const sourceSelection = useMemo(
    () => selectRelationIndexSources(objects, { workspaceId, query: sourceQuery, page: sourcePage }),
    [objects, workspaceId, sourceQuery, sourcePage],
  );

  useEffect(() => {
    const gen = ++generation.current;
    settledInputs.current = null;
    setModel(null);

    if (!enabled) {
      settledInputs.current = { kernel, workspaceId, objects, enabled, sourceSelection };
      setState("idle");
      return;
    }
    if (!kernel.hasOperation("t1.getObject")) {
      settledInputs.current = { kernel, workspaceId, objects, enabled, sourceSelection };
      setState("unavailable");
      return;
    }

    setState("loading");
    const selected = sourceSelection.objects;
    const abort = new AbortController();

    void (async () => {
      const results = await loadRelationIndexSources({
        workspaceId,
        sourceObjects: selected,
        signal: abort.signal,
        getObject: (activeWorkspaceId, objectId) =>
          kernel.getObject(activeWorkspaceId, objectId),
      });
      if (abort.signal.aborted || gen !== generation.current) return;

      const nextModel = buildWorkspaceRelationIndex({
        workspaceId,
        objects,
        sources: results,
        isTruncated: sourceSelection.isTruncated,
      });
      settledInputs.current = { kernel, workspaceId, objects, enabled, sourceSelection };
      setModel(nextModel);
      setState(
        nextModel.isTruncated || relationIndexHasDiagnostics(nextModel.diagnostics)
          ? "ready-with-diagnostics"
          : "ready",
      );
    })();

    return () => {
      // Stop queued reads as well as ignoring results already in flight.
      abort.abort();
      generation.current += 1;
    };
  }, [enabled, kernel, objects, sourceSelection, workspaceId]);

  const settled = settledInputs.current;
  const inputsMatch =
    settled !== null &&
    settled.kernel === kernel &&
    settled.workspaceId === workspaceId &&
    settled.objects === objects &&
    settled.enabled === enabled &&
    settled.sourceSelection === sourceSelection;

  if (!inputsMatch) {
    return { state: enabled ? "loading" : "idle", model: null, sourceSelection };
  }

  return { state, model, sourceSelection };
}
