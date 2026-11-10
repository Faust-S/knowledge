import type { ReactNode } from "react";

export function BaseRouteFrame(props: {
  title: string;
  requireKernel?: boolean;
  kernelReady?: boolean;
  children: ReactNode;
}) {
  const kernelReady = props.kernelReady ?? true;
  return (
    <section aria-labelledby="main-title" className="p-4 space-y-4">
      <h2 id="main-title" className="text-lg font-medium text-slate-100">
        {props.title}
      </h2>
      {props.requireKernel !== false && !kernelReady ? (
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
      ) : (
        props.children
      )}
    </section>
  );
}

export function OperationNotGrantedNotice({ label }: { label: string }) {
  return (
    <p
      role="status"
      data-testid="operation-not-granted"
      className="text-sm text-slate-400"
    >
      Операция «{label}» не предоставлена ядром в текущем режиме.
    </p>
  );
}
