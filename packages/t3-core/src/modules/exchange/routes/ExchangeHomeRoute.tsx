import { useWorkspaceModuleRuntime } from "../../../workspace-host/rendering/ModuleRenderContext";
import { PackagesView } from "../features/packages/PackagesView";

/**
 * `exchange.home` route wrapper (PROMPT 25, rewired PROMPT 29 §5, §8,
 * PROMPT 32 §1). The commands facade is forwarded directly — no
 * intermediate refresh callback is created here.
 */

export default function ExchangeHomeRoute() {
  const { context } = useWorkspaceModuleRuntime();
  const kernel = context.kernel;

  if (!kernel) {
    return (
      <section data-t2-ui="exchange" aria-labelledby="main-title" className="p-4 space-y-4">
        <h2 id="main-title" className="text-lg font-medium text-slate-100">
          Перенос данных
        </h2>
        <div
          role="status"
          aria-live="polite"
          data-testid="kernel-unavailable-panel"
          className="text-sm text-amber-200 border border-amber-800/60 rounded p-3 space-y-1"
        >
          <p className="font-medium">Ядро недоступно.</p>
          <p className="text-xs text-amber-300">
            Экспорт .iwxa невозможен без ядра. Не очищайте данные браузера — это может привести
            к безвозвратной потере рабочих областей; дождитесь восстановления связи с ядром.
          </p>
        </div>
      </section>
    );
  }
  const allowed =
    kernel.hasOperation("t2.exportPreview") ||
    kernel.hasOperation("t2.exportPackage") ||
    kernel.hasOperation("t2.confirmExport") ||
    kernel.hasOperation("t2.importPreview") ||
    kernel.hasOperation("t2.importCommit") ||
    kernel.hasOperation("t2.importCancel");
  return (
    <section data-t2-ui="exchange" aria-labelledby="main-title" className="p-4 space-y-4" data-testid="exchange-home-route">
      <h2 id="main-title" className="text-lg font-medium text-slate-100">
        Перенос данных
      </h2>
      {allowed ? (
        <PackagesView
          kernel={context.kernel}
          commands={context.commands}
          initialTab="export"
          exportScopeId={null}
        />
      ) : (
        <p
          role="status"
          data-testid="operation-not-granted"
          className="text-sm text-slate-400"
        >
          Операция «Перенос данных» не предоставлена ядром в текущем режиме.
        </p>
      )}
    </section>
  );
}
