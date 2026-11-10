import { useState } from "react";
import type { KernelFacade } from "../workspace-contract";

export interface ActionBarProps {
  kernel: KernelFacade | null;
  /** A site-owned shell retains technical controls without rendering a footer. */
  asFooter?: boolean;
}

const yn = (v: boolean) => (v ? "да" : "нет");

const MODE_LABELS: Record<string, string> = {
  full: "полный",
  limited: "ограниченный",
  "read-only": "только чтение",
};

/**
 * Bottom bar with a collapsible "Технические сведения" panel.
 *
 * PROMPT 22c-1 — consumes ONLY the `KernelFacade`. Capability booleans
 * and session diagnostics are read from `kernel.hasOperation(...)` and
 * `kernel.sessionInfo` / `kernel.grantedLevels`; the raw `KernelSession`
 * and `Capabilities` maps are no longer imported by shell chrome.
 */
export function ActionBar({ kernel, asFooter = true }: ActionBarProps) {
  const [open, setOpen] = useState(false);
  if (!kernel) return null;
  const info = kernel.sessionInfo;
  const Container: "footer" | "div" = asFooter ? "footer" : "div";
  const modeLabel = MODE_LABELS[info.mode] ?? info.mode;

  const has = (op: Parameters<KernelFacade["hasOperation"]>[0]) =>
    kernel.hasOperation(op);

  return (
    <Container data-t2-ui="technical-details" data-testid="kernel-technical-details" className="border-t border-slate-800 px-3 sm:px-4 py-2 text-xs text-slate-400">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="tech-panel"
        className="min-h-[44px] px-2 py-1 rounded hover:bg-slate-800/50"
      >
        {open ? "▾" : "▸"} Технические сведения
      </button>
      {open && (
        <dl
          id="tech-panel"
          className="mt-2 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1"
        >
          <div><dt className="inline text-slate-500">Режим ядра: </dt><dd className="inline text-slate-200">{modeLabel}</dd></div>
          <div><dt className="inline text-slate-500">Уровни: </dt><dd className="inline text-slate-200">{kernel.grantedLevels.join(", ")}</dd></div>
          <div><dt className="inline text-slate-500">Contract: </dt><dd className="inline text-slate-200"><code>{info.contract_version}</code></dd></div>
          <div><dt className="inline text-slate-500">Runtime: </dt><dd className="inline text-slate-200"><code>{info.runtime_version}</code></dd></div>
          <div><dt className="inline text-slate-500">service_id: </dt><dd className="inline text-slate-200"><code>{info.service_id}</code></dd></div>
          <div><dt className="inline text-slate-500">Создание рабочей области: </dt><dd className="inline text-slate-200">{yn(has("t1.createWorkspace"))}</dd></div>
          <div><dt className="inline text-slate-500">Запись объектов: </dt><dd className="inline text-slate-200">{yn(has("t1.putObject"))}</dd></div>
          <div><dt className="inline text-slate-500">Импорт пакетов: </dt><dd className="inline text-slate-200">{yn(has("t2.importCommit"))}</dd></div>
          <div><dt className="inline text-slate-500">Восстановление: </dt><dd className="inline text-slate-200">{yn(has("t1.restoreWorkspace"))}</dd></div>
          <div><dt className="inline text-slate-500">Безвозвратное удаление: </dt><dd className="inline text-slate-200">{yn(has("t1.purgeCommit"))}</dd></div>
          <div><dt className="inline text-slate-500">Экспорт: </dt><dd className="inline text-slate-200">{yn(has("t2.exportPackage"))}</dd></div>
        </dl>
      )}
    </Container>
  );
}
