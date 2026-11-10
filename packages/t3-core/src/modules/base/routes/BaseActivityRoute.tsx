import { useWorkspaceModuleRuntime } from "../../../workspace-host/rendering/ModuleRenderContext";
import { HistoryView } from "../features/history/HistoryView";
import { BaseRouteFrame, OperationNotGrantedNotice } from "./route-shell";

export default function BaseActivityRoute() {
  const { context } = useWorkspaceModuleRuntime();
  const kernel = context.kernel;
  return (
    <BaseRouteFrame title="Активность" kernelReady={!!kernel}>
      {kernel && (
        kernel.hasOperation("t1.listEventsSince") ? (
          <HistoryView kernel={kernel} />
        ) : (
          <OperationNotGrantedNotice label="Активность" />
        )
      )}
    </BaseRouteFrame>
  );
}
