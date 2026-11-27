/**
 * ModuleRouteNotFound (PROMPT 20 §1).
 *
 * Rendered when the current Host route match has no active route
 * contribution — e.g. deep link into a disabled module.
 */

export type RouteUnavailableReason = "unavailable" | "forbidden" | "module-error";

export interface ModuleRouteNotFoundProps {
  routeRefId?: string;
  reason?: RouteUnavailableReason;
}

export function ModuleRouteNotFound(props: ModuleRouteNotFoundProps) {
  const reason = props.reason ?? "unavailable";
  const title = reason === "forbidden" ? "Недостаточно полномочий"
    : reason === "module-error" ? "Ошибка в модуле" : "Раздел недоступен";
  return (
    <div
      role={reason === "unavailable" ? "status" : "alert"}
      data-route-unavailable-reason={reason}
      data-testid="module-route-not-found"
      className="p-4 text-sm text-slate-400 space-y-1"
    >
      <p className="font-medium text-slate-200">{title}</p>
      <p>
        {reason === "forbidden" ? "Текущая сессия не предоставляет необходимые полномочия."
          : reason === "module-error" ? "Модуль не смог подготовить раздел. Подробности доступны в диагностике."
          : "Маршрут не существует или не активирован в текущей конфигурации рабочей области."}
        {props.routeRefId ? ` (${props.routeRefId})` : ""}
      </p>
    </div>
  );
}
