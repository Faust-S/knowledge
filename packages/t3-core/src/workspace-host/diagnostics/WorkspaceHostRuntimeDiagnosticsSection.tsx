/**
 * WorkspaceHostRuntimeDiagnostics — dedicated section for
 * ConfigurationDiagnosticsPanel (PROMPT 19 §8).
 *
 * Shows Host Runtime status, per-module state, composition and
 * activation diagnostics.
 */

import { useWorkspaceHostRuntime } from "../runtime";

export function WorkspaceHostRuntimeDiagnosticsSection() {
  const state = useWorkspaceHostRuntime();

  const status = state.status;
  const statusOK = status === "ready";
  const modules =
    state.status === "ready" ? state.runtime.moduleSnapshot : [];
  const diag =
    state.status === "ready"
      ? state.runtime.diagnostics
      : state.status === "error"
        ? state.diagnostics
        : { composition: [], modules: [] };
  const activeRoutes =
    state.status === "ready" ? state.runtime.router.registry.listActive() : [];

  return (
    <details
      data-testid="workspace-host-runtime-diagnostics"
      className="border border-slate-800 rounded p-3 text-xs text-slate-300 space-y-2"
    >
      <summary className="cursor-pointer text-slate-200 font-medium min-h-6">
        Workspace Host Runtime
      </summary>
      <div className="mt-2 space-y-1">
        <div className="flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-2 rounded-full ${
              statusOK ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          <span className="font-mono text-slate-400">status</span>
          <span className="text-slate-300">{status}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-slate-500"
          />
          <span className="font-mono text-slate-400">active routes</span>
          <span className="text-slate-300">{activeRoutes.length}</span>
        </div>
        <div>
          <span className="font-mono text-slate-400">modules:</span>
          <ul className="ml-4 mt-1 space-y-0.5">
            {modules.map((m) => (
              <li key={m.moduleId} className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className={`inline-block h-2 w-2 rounded-full ${
                    m.status === "activated"
                      ? "bg-emerald-400"
                      : m.status === "planned" || m.status === "disabled"
                        ? "bg-slate-500"
                        : "bg-amber-400"
                  }`}
                />
                <span className="font-mono text-slate-300">{m.moduleId}</span>
                <span className="text-slate-400">{m.status}</span>
              </li>
            ))}
            {modules.length === 0 ? (
              <li className="text-slate-500">— нет —</li>
            ) : null}
          </ul>
        </div>
      </div>
      {diag.composition.length + diag.modules.length > 0 ? (
        <details
          className="mt-2"
          data-testid="workspace-host-runtime-diagnostics-technical"
        >
          <summary className="cursor-pointer text-slate-400">
            Диагностика ({diag.composition.length + diag.modules.length})
          </summary>
          <ul className="mt-1 space-y-1 list-disc list-inside">
            {diag.composition.map((d, i) => (
              <li key={`c-${i}`}>
                <span className="font-mono text-slate-400">{d.code}</span>:{" "}
                {d.message}
              </li>
            ))}
            {diag.modules.map((d, i) => (
              <li key={`m-${i}`}>
                <span className="font-mono text-slate-400">{d.code}</span>:{" "}
                {d.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </details>
  );
}
