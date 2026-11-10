import { useEffect, useState } from "react";
import type {
  CommandsFacade,
  KernelFacade,
} from "@/workspace-contract";
import { ExportView } from "./ExportView";
import { ImportView } from "./ImportView";
import type { PackagesTab } from "../../types";

export interface PackagesViewProps {
  kernel: KernelFacade;
  /** PROMPT 32 §1 — commands facade forwarded to Import for catalog refresh. */
  commands: CommandsFacade;
  initialTab: PackagesTab;
  exportScopeId: string | null;
}

/**
 * "Перенос данных" — unified export/import surface. The chosen tab is
 * memory-only per browser tab and is NEVER placed in the URL. The parent
 * (AppShell) guarantees that PackagesView is not mounted when both
 * export and import capabilities are absent.
 */
export function PackagesView({
  kernel,
  commands,
  initialTab,
  exportScopeId,
}: PackagesViewProps) {
  const canExport =
    kernel.hasOperation("t2.exportPreview") || kernel.hasOperation("t2.exportPackage");
  const canImport =
    kernel.hasOperation("t2.importPreview") || kernel.hasOperation("t2.importCommit");

  const resolveTab = (hint: PackagesTab): PackagesTab => {
    if (hint === "export") {
      if (canExport) return "export";
      if (canImport) return "import";
    } else {
      if (canImport) return "import";
      if (canExport) return "export";
    }
    return hint;
  };

  const [tab, setTab] = useState<PackagesTab>(() => resolveTab(initialTab));

  useEffect(() => {
    setTab(resolveTab(initialTab));
  }, [initialTab, canExport, canImport]);

  return (
    <div className="space-y-4" data-testid="packages-view">
      <div role="tablist" aria-label="Перенос данных" className="flex gap-1 border-b border-slate-800">
        {(["export", "import"] as PackagesTab[]).map((t) => {
          const label = t === "export" ? "Экспортировать" : "Импортировать";
          const enabled = t === "export" ? canExport : canImport;
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`packages-panel-${t}`}
              id={`packages-tab-${t}`}
              disabled={!enabled}
              onClick={() => setTab(t)}
              data-testid={`packages-tab-${t}`}
              className={`px-3 py-2 text-sm min-h-[44px] border-b-2 -mb-px ${
                active ? "border-slate-100 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`packages-panel-${tab}`}
        aria-labelledby={`packages-tab-${tab}`}
      >
        {tab === "export" ? (
          <ExportView kernel={kernel} scopedWorkspaceId={exportScopeId} />
        ) : (
          <ImportView kernel={kernel} commands={commands} />
        )}
      </div>
    </div>
  );
}
