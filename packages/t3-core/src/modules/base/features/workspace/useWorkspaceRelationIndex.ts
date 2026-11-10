import { useEffect, useMemo, useRef, useState } from "react";
import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import type { KernelFacade } from "../../../../workspace-contract";
import {
  buildWorkspaceRelationIndex,
  loadRelationIndexSources,
  relationIndexHasDiagnostics,
  selectRelationIndexSources,
  type WorkspaceRelationIndexModel,
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
}

export function useWorkspaceRelationIndex(options: {
  kernel: KernelFacade;
  workspaceId: string;
  objects: readonly ObjectRecord[];
  enabled: boolean;
}): WorkspaceRelationIndexController {
  const { kernel, workspaceId, objects, enabled } = options;
  const generation = useRef(0);
  const settledInputs = useRef<{
    kernel: KernelFacade;
    workspaceId: string;
    objects: readonly ObjectRecord[];
    enabled: boolean;
  } | null>(null);
  const [state, setState] = useState<WorkspaceRelationIndexState>("idle");
  const [model, setModel] = useState<WorkspaceRelationIndexModel | null>(null);

  const sourceSelection = useMemo(
    () => selectRelationIndexSources(objects),
    [objects],
  );

  useEffect(() => {
    const gen = ++generation.current;
    settledInputs.current = null;
    setModel(null);

    if (!enabled) {
      settledInputs.current = { kernel, workspaceId, objects, enabled };
      setState("idle");
      return;
    }
    if (!kernel.hasOperation("t1.getObject")) {
      settledInputs.current = { kernel, workspaceId, objects, enabled };
      setState("unavailable");
      return;
    }

    setState("loading");
    const selected = sourceSelection.objects;

    void (async () => {
      const results = await loadRelationIndexSources({
        workspaceId,
        sourceObjects: selected,
        getObject: (activeWorkspaceId, objectId) =>
          kernel.getObject(activeWorkspaceId, objectId),
      });
      if (gen !== generation.current) return;

      const nextModel = buildWorkspaceRelationIndex({
        workspaceId,
        objects,
        sources: results,
        isTruncated: sourceSelection.isTruncated,
      });
      settledInputs.current = { kernel, workspaceId, objects, enabled };
      setModel(nextModel);
      setState(
        nextModel.isTruncated || relationIndexHasDiagnostics(nextModel.diagnostics)
          ? "ready-with-diagnostics"
          : "ready",
      );
    })();

    return () => {
      // Generation guard above makes every stale completion inert.
      generation.current += 1;
    };
  }, [enabled, kernel, objects, sourceSelection, workspaceId]);

  const settled = settledInputs.current;
  const inputsMatch =
    settled !== null &&
    settled.kernel === kernel &&
    settled.workspaceId === workspaceId &&
    settled.objects === objects &&
    settled.enabled === enabled;

  if (!inputsMatch) {
    return { state: enabled ? "loading" : "idle", model: null };
  }

  return { state, model };
}
