import { useState } from "react";
import { useWorkspaceModuleRuntime } from "@/workspace-host/rendering/ModuleRenderContext";

/** Existing T2 Host dashboard surface: makes the D5 command discoverable.
 * The panel remains Host-owned; this card never reads raw Kernel storage.
 */
export default function LocalInferenceLauncher() {
  const { context } = useWorkspaceModuleRuntime();
  const [error, setError] = useState("");
  const canOpen = context.commands.has("iwxa.t3.local-inference.open");
  const current = context.currentWorkspace.get()?.workspace_id || null;
  return (
    <section data-testid="t3-local-inference-launcher"
      className="rounded border border-slate-700 p-3 space-y-2">
      <h3 className="font-semibold text-slate-100">Локальная модель</h3>
      <p className="text-xs text-slate-300">
        WebLLM работает на устройстве. Установка модели — только после согласия.
        Черновики сохраняются отдельно через исходный Kernel.
      </p>
      {!current && <p className="text-xs text-amber-200">
        Сначала выберите рабочую область, чтобы сохранить черновик.
      </p>}
      <button type="button" disabled={!canOpen}
        className="min-h-11 rounded border border-sky-700 px-3 py-2 text-sm text-slate-100"
        onClick={() => {
          setError("");
          void context.commands.invoke("iwxa.t3.local-inference.open")
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Не удалось открыть модель."));
        }}>
        Открыть локальную модель
      </button>
      {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
    </section>
  );
}
