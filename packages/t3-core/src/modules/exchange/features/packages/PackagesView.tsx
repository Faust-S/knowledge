import { useEffect, useRef, useState } from "react";
import type {
  CommandsFacade,
  KernelFacade,
} from "@/workspace-contract";
import { ExportView } from "./ExportView";
import { ImportView, type InstalledPwaFileHandle } from "./ImportView";
import type { PackagesTab } from "../../types";
import type { createTrustedAgeExchange } from "../../../../t3/index.mjs";

export interface PackagesViewProps {
  kernel: KernelFacade;
  /** PROMPT 32 §1 — commands facade forwarded to Import for catalog refresh. */
  commands: CommandsFacade;
  initialTab: PackagesTab;
  exportScopeId: string | null;
  protectedExchange?: ReturnType<typeof createTrustedAgeExchange> | null;
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
  protectedExchange = null,
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
  const [pwaFileHandle, setPwaFileHandle] = useState<InstalledPwaFileHandle | null>(null);
  const [pwaLaunchError, setPwaLaunchError] = useState<string | null>(null);
  const osLaunchSeen = useRef(false);
  // Browser File Handling API is optional. Chromium delivers opaque file
  // handles to an installed PWA; nothing is read until the user clicks
  // the canonical ImportView preview. Browsers without it keep the chooser.
  useEffect(() => {
    const queue = (window as unknown as {
      launchQueue?: {setConsumer: (consumer: (params: {files?: readonly unknown[]}) => void) => void}
    }).launchQueue;
    if (!queue || !canImport) return;
    let mounted = true;
    queue.setConsumer(({files}) => {
      if (!mounted || !Array.isArray(files) || files.length === 0) return;
      // Chromium may deliver an already-queued OS launch synchronously
      // during effect registration. The normal initialTab effect must not
      // reset this explicit file-open action back to Export.
      osLaunchSeen.current = true;
      setTab("import");
      setPwaFileHandle(null);
      if (files.length !== 1) {
        setPwaLaunchError("Откройте один файл .iwxa за раз.");
        return;
      }
      const handle = files[0] as Partial<InstalledPwaFileHandle> | null;
      if (!handle || handle.kind !== "file" ||
          typeof handle.name !== "string" ||
          !handle.name.toLowerCase().endsWith(".iwxa") ||
          typeof handle.getFile !== "function") {
        setPwaLaunchError("Система передала файл неподдерживаемого типа. Выберите .iwxa.");
        return;
      }
      setPwaLaunchError(null);
      setPwaFileHandle(handle as InstalledPwaFileHandle);
    });
    return () => {mounted = false;};
  }, [canImport]);

  useEffect(() => {
    if (!osLaunchSeen.current) setTab(resolveTab(initialTab));
  }, [initialTab, canExport, canImport]);

  return (
    <div className="space-y-4" data-testid="packages-view">
      {pwaLaunchError && <p role="alert"
        data-testid="import-pwa-launch-error" className="text-sm text-amber-300">
        {pwaLaunchError}
      </p>}
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
          <ExportView kernel={kernel} scopedWorkspaceId={exportScopeId}
             protectedExchange={protectedExchange} />
        ) : (
          <ImportView kernel={kernel} commands={commands}
            pwaFileHandle={pwaFileHandle} protectedExchange={protectedExchange} />
        )}
      </div>
    </div>
  );
}
