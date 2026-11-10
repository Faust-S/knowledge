/**
 * Small notice for catalog load/refresh errors.
 *
 * Two visual modes:
 *   - "blocking" — the catalog has no items to show, so the error takes
 *     over the surface with a Retry action;
 *   - "inline" — a stale list is still visible, so the error is a
 *     dismissable strip above the list without hiding data.
 */
export interface CatalogErrorNoticeProps {
  mode: "blocking" | "inline";
  message: string;
  onRetry: () => void;
}

export function CatalogErrorNotice({ mode, message, onRetry }: CatalogErrorNoticeProps) {
  const heading =
    mode === "blocking"
      ? "Не удалось загрузить список рабочих областей."
      : "Не удалось обновить список — показаны данные последней успешной загрузки.";
  return (
    <div
      role="alert"
      data-testid={mode === "blocking" ? "catalog-error-blocking" : "catalog-error-inline"}
      className="text-xs text-red-300 border border-red-900/60 rounded p-2 space-y-2"
    >
      <p>{heading}</p>
      <details className="text-red-400">
        <summary className="cursor-pointer">Технические детали</summary>
        <pre className="whitespace-pre-wrap">{message}</pre>
      </details>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
      >
        Повторить
      </button>
    </div>
  );
}
