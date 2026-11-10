/**
 * ModuleRouteLoading (PROMPT 20 §1).
 *
 * Suspense fallback for a lazily-loaded module route component.
 * Host-owned — no module code, no kernel access.
 */

export function ModuleRouteLoading({ presentation = "host" }: { presentation?: "host" | "product" }) {
  if (presentation === "product") return (
    <div role="status" aria-live="polite" data-testid="module-route-loading" data-t2-ui="product-loading" className="p-4 text-sm">Подготовка рабочей области…</div>
  );
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="module-route-loading"
      className="p-4 text-sm text-slate-400"
    >
      Загрузка модуля…
    </div>
  );
}
