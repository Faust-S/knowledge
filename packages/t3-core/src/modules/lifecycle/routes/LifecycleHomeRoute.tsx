/**
 * `lifecycle.home` route wrapper.
 *
 * Landing surface for the lifecycle static base. Renders a short
 * description and links to the trash surface via the RouterFacade —
 * modules never emit raw hashes.
 */
import { useWorkspaceModuleRuntime } from "../../../workspace-host/rendering/ModuleRenderContext";
import { hostRouteRefs } from "@/workspace-host/router";

export default function LifecycleHomeRoute() {
  const { context } = useWorkspaceModuleRuntime();
  return (
    <section
      aria-labelledby="lifecycle-home-title"
      className="p-4 space-y-3"
      data-testid="lifecycle-home-route"
      data-t2-ui="lifecycle"
    >
      <h2 id="lifecycle-home-title" className="text-lg font-medium text-slate-100">
        Управление жизненным циклом
      </h2>
      <p className="text-sm text-slate-300 max-w-prose">
        Здесь собраны инструменты восстановления и безвозвратного удаления
        рабочих областей. Данные не покидают ядро — все операции проходят
        через T1 Runtime Contract.
      </p>
      <button
        type="button"
        className="text-sm text-sky-300 hover:text-sky-100"
        onClick={() => context.router.navigate(hostRouteRefs.lifecycle.trash)}
        data-testid="lifecycle-open-trash"
      >
        Открыть корзину →
      </button>
    </section>
  );
}
