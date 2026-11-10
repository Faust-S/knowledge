import type { KernelState, KernelStatus as KernelStatusId } from "../kernel-client";

export interface KernelStatusProps {
  state: KernelState;
  onRetry: () => void;
}

const LABELS: Record<KernelStatusId, string> = {
  loading: "Подключение к ядру…",
  ready: "Ядро готово",
  limited: "Ядро: ограниченный режим",
  "read-only": "Ядро: только чтение",
  "update-required": "Требуется обновление",
  "config-invalid": "Настройки некорректны",
  "kernel-unavailable": "Ядро недоступно",
};

const TONE: Record<KernelStatusId, string> = {
  loading: "bg-amber-500/20 text-amber-300",
  ready: "bg-emerald-500/20 text-emerald-300",
  limited: "bg-amber-500/20 text-amber-300",
  "read-only": "bg-amber-500/20 text-amber-300",
  "update-required": "bg-red-500/20 text-red-300",
  "config-invalid": "bg-red-500/20 text-red-300",
  "kernel-unavailable": "bg-red-500/20 text-red-300",
};

export function KernelStatus({ state, onRetry }: KernelStatusProps) {
  const isError =
    state.status === "kernel-unavailable" ||
    state.status === "update-required" ||
    state.status === "config-invalid";
  const reason = "error" in state ? state.error.message : undefined;

  return (
    <div className="flex flex-col items-end gap-2">
      <span
        className={`text-xs px-3 py-1 rounded-full ${TONE[state.status]}`}
        title={reason ?? LABELS[state.status]}
      >
        {LABELS[state.status]}
      </span>
      {isError && (
        <div className="flex gap-2 text-xs">
          <button
            onClick={onRetry}
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 min-h-[44px]"
          >
            Повторить
          </button>
        </div>
      )}
      {reason && isError && (
        <p className="text-[11px] opacity-60 max-w-xs text-right">{reason}</p>
      )}
    </div>
  );
}
