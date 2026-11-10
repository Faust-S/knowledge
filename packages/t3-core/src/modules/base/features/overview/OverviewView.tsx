import { useMemo, useRef, useState } from "react";
import type { KernelFacade } from "@/workspace-contract";
import type { WorkspaceProfileId } from "../../../../config/domain-config";
import type { WorkspaceProfileDefinition } from "../../../../profiles/definition";
import type { WorkspaceCatalogController } from "../workspaces/useWorkspaceCatalog";
import { CreateWorkspaceDialog } from "../workspaces/CreateWorkspaceDialog";
import { CatalogErrorNotice } from "../workspaces/CatalogErrorNotice";
import {
  compareWorkspaceDatesDesc,
  compareWorkspaceIds,
  formatWorkspaceDate,
  maxUpdatedAt,
} from "../workspaces/workspace-format";

export interface OverviewViewProps {
  catalog: WorkspaceCatalogController;
  kernel: KernelFacade;
  activeProfileId: WorkspaceProfileId;
  profileDefinition: WorkspaceProfileDefinition;
  profileFallback: boolean;
  onOpenWorkspace: (id: string) => void;
  onOpenWorkspacesList: () => void;
  onOpenImport: () => void;
  onOpenExport: () => void;
}

export function OverviewView({
  catalog,
  kernel,
  activeProfileId,
  profileDefinition,
  profileFallback,
  onOpenWorkspace,
  onOpenWorkspacesList,
  onOpenImport,
  onOpenExport,
}: OverviewViewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);

  void activeProfileId;

  const canCreateWorkspace = kernel.hasOperation("t1.createWorkspace");
  const canCreate = canCreateWorkspace && !profileFallback;
  const canImport =
    kernel.hasOperation("t2.importPreview") &&
    kernel.hasOperation("t2.importCommit") &&
    kernel.hasOperation("t2.importCancel");
  const canExport = kernel.hasOperation("t2.exportPackage");
  const canList = kernel.hasOperation("t1.listWorkspaces");

  const items = catalog.items;

  const stats = useMemo(() => {
    const readOnly = items.filter((i) => i.workspace.read_only).length;
    const lastUpdated = maxUpdatedAt(items.map((i) => i.workspace));
    return {
      total: items.length,
      readOnly,
      lastUpdated,
    };
  }, [items]);

  const recent = useMemo(() => {
    return [...items]
      .sort((a, b) => {
        const d = compareWorkspaceDatesDesc(a.workspace.updated_at, b.workspace.updated_at);
        return d !== 0 ? d : compareWorkspaceIds(a.workspace.workspace_id, b.workspace.workspace_id);
      })
      .slice(0, 4);
  }, [items]);

  const cancelCreateDialog = () => {
    setDialogOpen(false);
    requestAnimationFrame(() => {
      openBtnRef.current?.focus();
    });
  };

  const createAndOpenWorkspace = async () => {
    const created = await catalog.createWorkspace({ profile: activeProfileId });
    setDialogOpen(false);
    onOpenWorkspace(created.workspace_id);
  };

  const hasItems = items.length > 0;
  const initialLoading = catalog.status === "loading" && !hasItems;
  const refreshing = catalog.status === "loading" && hasItems;
  const blockingError = catalog.status === "error" && !hasItems;
  const inlineError = catalog.status === "error" && hasItems;

  return (
    <div className="space-y-6" data-testid="overview-view" data-t2-ui="overview">
      <header data-t2-ui="section-heading" className="space-y-2">
        <h3 className="text-base font-medium text-slate-100">{profileDefinition.label}</h3>
        <p className="text-sm text-slate-300">{profileDefinition.description}</p>
        <p className="text-xs text-slate-500">
          Рабочие данные находятся в локальном пространстве домена и передаются
          между совместимыми сервисами через пакеты IWXA.
        </p>
      </header>

      {inlineError && (
        <CatalogErrorNotice
          mode="inline"
          message={catalog.error ?? ""}
          onRetry={() => void catalog.refresh()}
        />
      )}

      {blockingError ? (
        <CatalogErrorNotice
          mode="blocking"
          message={catalog.error ?? ""}
          onRetry={() => void catalog.refresh()}
        />
      ) : initialLoading ? (
        <p role="status" className="text-sm text-slate-400">Загрузка сводки…</p>
      ) : (
        <>
          {canList && (
            <section aria-labelledby="overview-kpis-title" className="space-y-2">
              <h4 id="overview-kpis-title" className="text-xs uppercase tracking-wide text-slate-500">
                Сводные показатели
                {refreshing && (
                  <span className="ml-2 normal-case tracking-normal text-slate-400" role="status">
                    · обновление…
                  </span>
                )}
              </h4>
              <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <KpiCard label="Рабочих областей" value={String(stats.total)} />
                <KpiCard label="Только чтение" value={String(stats.readOnly)} />
                <KpiCard
                  label="Последнее изменение"
                  value={stats.lastUpdated ? formatWorkspaceDate(stats.lastUpdated) : "Нет данных"}
                />
              </dl>
            </section>
          )}

          <section aria-labelledby="overview-actions-title" className="space-y-2">
            <h4 id="overview-actions-title" className="text-xs uppercase tracking-wide text-slate-500">
              Быстрые действия
            </h4>
            <div className="flex flex-wrap gap-2" aria-live="polite">
              {canCreate && (
                <button
                  ref={openBtnRef}
                  data-t2-ui="primary-action"
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  className="px-3 py-1.5 text-xs rounded bg-emerald-800 hover:bg-emerald-700 min-h-[44px]"
                  data-testid="new-workspace-toggle"
                >
                  Новая рабочая область
                </button>
              )}
              {canImport && (
                <button
                  type="button"
                  onClick={onOpenImport}
                  className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
                >
                  Импортировать пакет
                </button>
              )}
              {canExport && (
                <button
                  type="button"
                  onClick={onOpenExport}
                  className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
                >
                  Экспортировать данные
                </button>
              )}
              {canList && (
                <button
                  type="button"
                  onClick={onOpenWorkspacesList}
                  className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
                >
                  Открыть каталог
                </button>
              )}
              {refreshing && (
                <span
                  role="status"
                  data-testid="workspace-refreshing-status"
                  className="text-xs text-slate-400 self-center"
                >
                  Обновление…
                </span>
              )}
            </div>
            {profileFallback && canCreateWorkspace && (
              <p role="status" className="text-xs text-amber-300">
                Создание временно недоступно: профиль домена загружен в резервном режиме.
                Существующие данные можно просматривать и экспортировать.
              </p>
            )}
          </section>


          {canList && items.length === 0 ? (
            <EmptyOverview canCreate={canCreate} canImport={canImport} onCreate={() => setDialogOpen(true)} onImport={onOpenImport} />
          ) : canList && (
            <section aria-labelledby="overview-recent-title" className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h4 id="overview-recent-title" className="text-xs uppercase tracking-wide text-slate-500">
                  Последние рабочие области
                </h4>
                <button
                  type="button"
                  onClick={onOpenWorkspacesList}
                  className="text-xs text-slate-300 hover:text-slate-100 min-h-[24px]"
                >
                  Все рабочие области
                </button>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {recent.map((item) => {
                  const w = item.workspace;
                  return (
                    <li
                      key={w.workspace_id}
                      className="p-3 border border-slate-800 rounded bg-slate-900/40 flex flex-col gap-2"
                      data-t2-ui="card"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h5 className="text-sm font-medium text-slate-100 truncate">{w.workspace_id}</h5>
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          {w.profile}
                        </span>
                        {w.read_only && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200">
                            Только чтение
                          </span>
                        )}
                      </div>
                      <dl className="text-xs text-slate-400 grid grid-cols-2 gap-x-2">
                        <dt>Обновлено</dt>
                        <dd className="text-slate-200">{formatWorkspaceDate(w.updated_at)}</dd>
                      </dl>
                      <button
                        type="button"
                        onClick={() => onOpenWorkspace(w.workspace_id)}
                        className="mt-auto self-start px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
                      >
                        Открыть
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      <CreateWorkspaceDialog
        open={dialogOpen}
        profileLabel={profileDefinition.label}
        disabled={!canCreate}
        onCancel={cancelCreateDialog}
        onCreate={createAndOpenWorkspace}

      />
    </div>
  );
}

function KpiCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div data-t2-ui="card" className="p-3 border border-slate-800 rounded bg-slate-900/40">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-medium text-slate-100">{value}</div>
      {note && <div className="text-[10px] text-slate-500 mt-0.5">{note}</div>}
    </div>
  );
}

function EmptyOverview({
  canCreate,
  canImport,
  onCreate,
  onImport,
}: {
  canCreate: boolean;
  canImport: boolean;
  onCreate: () => void;
  onImport: () => void;
}) {
  const noActions = !canCreate && !canImport;
  return (
    <div data-t2-ui="card" className="p-6 border border-slate-800 rounded text-sm text-slate-300 space-y-3" data-testid="overview-empty">
      <h4 className="text-base font-medium text-slate-100">Рабочих областей пока нет</h4>
      <p className="text-slate-400">
        Создайте пустую рабочую область для текущего профиля
        или импортируйте существующий пакет .iwxa.
      </p>
      {noActions ? (
        <p className="text-xs text-amber-300">
          Текущий режим ядра разрешает только ограниченный доступ.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canCreate && (
            <button
              type="button"
              onClick={onCreate}
              data-t2-ui="primary-action"
              className="px-3 py-1.5 text-xs rounded bg-emerald-800 hover:bg-emerald-700 min-h-[44px]"
            >
              Создать рабочую область
            </button>
          )}
          {canImport && (
            <button
              type="button"
              onClick={onImport}
              className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
            >
              Импортировать пакет
            </button>
          )}
        </div>
      )}
    </div>
  );
}
