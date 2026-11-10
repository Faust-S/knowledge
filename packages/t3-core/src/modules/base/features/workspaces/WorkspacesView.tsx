import { useMemo, useRef, useState } from "react";
import type { CommandsFacade, KernelFacade } from "@/workspace-contract";
import type { WorkspaceProfileId } from "../../../../config/domain-config";
import type { WorkspaceProfileDefinition } from "../../../../profiles/definition";
import type { WorkspaceCatalogController } from "./useWorkspaceCatalog";
import { WorkspaceCard } from "./WorkspaceCard";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { CatalogErrorNotice } from "./CatalogErrorNotice";
import {
  compareWorkspaceDatesDesc,
  compareWorkspaceIds,
} from "./workspace-format";

export interface WorkspacesViewProps {
  catalog: WorkspaceCatalogController;
  kernel: KernelFacade;
  commands: CommandsFacade;
  activeProfileId: WorkspaceProfileId;
  profileDefinition: WorkspaceProfileDefinition;
  profileFallback: boolean;
  onOpenWorkspace: (id: string) => void;
  onExportWorkspace: (id: string) => void;
  onOpenImport: () => void;
}

type ProfileFilter = "all" | "current" | "others";
type ModeFilter = "all" | "writable" | "readonly";
type SortMode = "updated" | "created" | "id";

export function WorkspacesView({
  catalog,
  kernel,
  commands,
  activeProfileId,
  profileDefinition,
  profileFallback,
  onOpenWorkspace,
  onExportWorkspace,
  onOpenImport,
}: WorkspacesViewProps) {
  const [query, setQuery] = useState("");
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [sort, setSort] = useState<SortMode>("updated");
  const [dialogOpen, setDialogOpen] = useState(false);
  const openBtnRef = useRef<HTMLButtonElement | null>(null);

  const canCreateWorkspace = kernel.hasOperation("t1.createWorkspace");
  const canListWorkspaces = kernel.hasOperation("t1.listWorkspaces");
  const canCreate = canCreateWorkspace && !profileFallback;
  // Composite `canImportFlow`: preview + commit + cancel all granted.
  const canImport =
    kernel.hasOperation("t2.importPreview") &&
    kernel.hasOperation("t2.importCommit") &&
    kernel.hasOperation("t2.importCancel");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = catalog.items.filter((i) =>
      !q || i.workspace.workspace_id.toLowerCase().includes(q),
    );
    if (profileFilter === "current") {
      out = out.filter((i) => i.workspace.profile === activeProfileId);
    } else if (profileFilter === "others") {
      out = out.filter((i) => i.workspace.profile !== activeProfileId);
    }
    if (modeFilter === "writable") {
      out = out.filter((i) => !i.workspace.read_only);
    } else if (modeFilter === "readonly") {
      out = out.filter((i) => i.workspace.read_only);
    }
    return [...out].sort((a, b) => {
      if (sort === "id") {
        return compareWorkspaceIds(a.workspace.workspace_id, b.workspace.workspace_id);
      }
      if (sort === "created") {
        const d = compareWorkspaceDatesDesc(a.workspace.created_at, b.workspace.created_at);
        return d !== 0 ? d : compareWorkspaceIds(a.workspace.workspace_id, b.workspace.workspace_id);
      }
      const d = compareWorkspaceDatesDesc(a.workspace.updated_at, b.workspace.updated_at);
      return d !== 0 ? d : compareWorkspaceIds(a.workspace.workspace_id, b.workspace.workspace_id);
    });
  }, [catalog.items, query, profileFilter, modeFilter, sort, activeProfileId]);

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

  if (!canListWorkspaces) {
    return (
      <p role="status" className="text-sm text-slate-400">
        Список рабочих областей не предоставлен ядром в текущем режиме.
      </p>
    );
  }

  const hasItems = catalog.items.length > 0;
  const initialLoading = catalog.status === "loading" && !hasItems;
  const refreshing = catalog.status === "loading" && hasItems;
  const blockingError = catalog.status === "error" && !hasItems;
  const inlineError = catalog.status === "error" && hasItems;

  return (
    <div className="space-y-4" data-testid="workspaces-view">
      <header className="space-y-1">
        <p className="text-sm text-slate-300">
          Каталог рабочих областей текущего домена. Поиск и фильтры работают
          локально по уже загруженному списку.
        </p>
        <p
          className="text-xs text-slate-500"
          aria-live="polite"
          data-testid="workspaces-count"
        >
          Найдено: {filtered.length} из {catalog.items.length}
        </p>
        {refreshing && (
          <p
            role="status"
            data-testid="workspace-refreshing-status"
            className="text-xs text-slate-400"
          >
            Обновление…
          </p>
        )}
      </header>


      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder="Найти по идентификатору"
          aria-label="Поиск рабочих областей по идентификатору"
          className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded min-h-[44px] flex-1 min-w-[160px]"
        />
        <select
          aria-label="Фильтр по профилю"
          value={profileFilter}
          onChange={(e) => setProfileFilter(e.target.value as ProfileFilter)}
          className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded min-h-[44px]"
        >
          <option value="all">Все профили</option>
          <option value="current">Текущий профиль</option>
          <option value="others">Другие профили</option>
        </select>
        <select
          aria-label="Режим доступа"
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value as ModeFilter)}
          className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded min-h-[44px]"
        >
          <option value="all">Любой режим</option>
          <option value="writable">Доступно для изменений</option>
          <option value="readonly">Только чтение</option>
        </select>
        <select
          aria-label="Сортировка"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded min-h-[44px]"
        >
          <option value="updated">Недавно обновлённые</option>
          <option value="created">Сначала созданные недавно</option>
          <option value="id">По идентификатору</option>
        </select>
        <button
          type="button"
          onClick={() => void catalog.refresh()}
          disabled={catalog.status === "loading"}
          className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 min-h-[44px]"
          aria-label="Обновить список рабочих областей"
          data-testid="workspaces-refresh"
        >
          {refreshing ? "Обновление…" : "Обновить"}
        </button>
        {canCreate && (
          <button
            ref={openBtnRef}
            type="button"
            onClick={() => setDialogOpen(true)}
            className="ml-auto px-3 py-1.5 text-xs rounded bg-emerald-800 hover:bg-emerald-700 min-h-[44px]"
            data-testid="new-workspace-toggle"
          >
            Новая рабочая область
          </button>
        )}
      </div>

      {profileFallback && canCreateWorkspace && (
        <p role="status" className="text-xs text-amber-300 border border-amber-800/60 rounded p-2">
          Создание временно недоступно: профиль домена загружен в резервном режиме.
          Существующие данные можно просматривать и экспортировать.
        </p>
      )}


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
        <p className="text-sm text-slate-400" role="status">Загрузка каталога…</p>
      ) : !hasItems ? (
        <EmptyCatalog
          canCreate={canCreate}
          canImport={canImport}
          onCreate={() => setDialogOpen(true)}
          onImport={onOpenImport}
        />
      ) : filtered.length === 0 ? (
        <div className="p-4 border border-slate-800 rounded text-sm text-slate-400 space-y-2">
          <p>По заданным условиям ничего не найдено.</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setProfileFilter("all");
              setModeFilter("all");
            }}
            className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
            data-testid="reset-filters"
          >
            Сбросить фильтры
          </button>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <WorkspaceCard
              key={item.workspace.workspace_id}
              item={item}
              activeProfileId={activeProfileId}
              activeProfileLabel={profileDefinition.label}
              kernel={kernel}
              commands={commands}
              onOpen={onOpenWorkspace}
              onExport={onExportWorkspace}
            />
          ))}
        </ul>
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

function EmptyCatalog({
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
    <div
      className="p-6 border border-slate-800 rounded text-sm text-slate-300 space-y-3"
      data-testid="workspaces-empty"
    >
      <h3 className="text-base font-medium text-slate-100">Рабочих областей пока нет</h3>
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
              data-testid="workspaces-empty-import"
            >
              Импортировать пакет
            </button>
          )}
        </div>
      )}
    </div>
  );
}
