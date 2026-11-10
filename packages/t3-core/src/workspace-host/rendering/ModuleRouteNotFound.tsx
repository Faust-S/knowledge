/**
 * ModuleRouteNotFound (PROMPT 20 §1).
 *
 * Rendered when the current Host route match has no active route
 * contribution — e.g. deep link into a disabled module.
 */

export interface ModuleRouteNotFoundProps {
  routeRefId?: string;
}

export function ModuleRouteNotFound(props: ModuleRouteNotFoundProps) {
  return (
    <div
      role="status"
      data-testid="module-route-not-found"
      className="p-4 text-sm text-slate-400 space-y-1"
    >
      <p className="font-medium text-slate-200">Раздел недоступен</p>
      <p>
        Модуль, обслуживающий этот раздел
        {props.routeRefId ? ` (${props.routeRefId})` : ""}, не активирован в
        текущей конфигурации рабочей области.
      </p>
    </div>
  );
}
