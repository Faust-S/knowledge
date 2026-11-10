import { BaseRouteFrame } from "./route-shell";

export default function BaseDiagnosticsRoute() {
  return (
    <BaseRouteFrame title="Диагностика" requireKernel={false}>
      <p className="text-sm text-slate-500">
        Диагностика хостинга отображается в нижней панели оболочки.
      </p>
    </BaseRouteFrame>
  );
}
