/**
 * Profile-driven catalog view of a single Workspace.
 *
 * The profile of the WORKSPACE (not the domain) drives sections,
 * renderers and labels. Domain-level profile definition is intentionally
 * NOT accepted as a prop.
 */
import { useEffect, useMemo, useState } from "react";
import type { CommandsFacade, KernelFacade } from "../../../../workspace-contract";
import type { OperationId } from "../../../../kernel-client";
import type { ViewerRegistry } from "../../../../workspace-host/registries/ViewerRegistry";
import { useWorkspaceContent } from "./useWorkspaceContent";
import { buildWorkspaceObjectSections } from "./object-sections";
import { ObjectSectionNav } from "./ObjectSectionNav";
import { ObjectCatalogToolbar } from "./ObjectCatalogToolbar";
import { ObjectPreviewCard } from "./ObjectPreviewCard";
import { WorkspaceRelationIndex } from "./WorkspaceRelationIndex";
import { RichWorkspaceReadModel } from "./RichWorkspaceReadModel";
import { isWorkspaceViewStateObjectRecord } from "./workspace-view-state-boundary.mjs";
import {
  filterObjectsByQuery,
  sortObjects,
  paginate,
  pickInitialSectionId,
  OBJECT_CATALOG_PAGE_SIZE,
  type ObjectCatalogSortId,
} from "./workspace-catalog-model";
import {
  formatWorkspaceDate,
  compareWorkspaceDatesDesc,
} from "../workspaces/workspace-format";

export interface WorkspaceViewProps {
  kernel: KernelFacade;
  viewerRegistry?:ViewerRegistry;grantedOperations?:readonly OperationId[];activeCapabilities?:readonly string[];
  /** Optional to keep older test harnesses that omit the facade working. */
  commands?: CommandsFacade;
  workspaceId: string;
  currentShellServiceId: string;
  onOpenObject: (workspaceId: string, objectId: string) => void;
  onExportThis: (workspaceId: string) => void;
  onBack: () => void;
}

const SENSITIVITY_LABELS: Record<string, string> = {
  standard: "обычный",
  public: "публичный",
  personal: "личный",
  sensitive: "чувствительный",
  restricted: "ограниченный",
};

export function WorkspaceView(props: WorkspaceViewProps) {
  const { kernel, commands, workspaceId, currentShellServiceId, onOpenObject, onExportThis, onBack } = props;
  const content = useWorkspaceContent({ kernel, workspaceId });
  const {
    workspaceState, workspace, workspaceError,
    profile,
    objectsState, objects, objectsError, objectIntegrityWarnings,
    eventsState, events, eventsError, eventIntegrityWarnings,
    refreshObjects,
  } = content;

  const rawProfileForGuard = workspace?.profile ?? null;
  const profileMatchesWorkspace =
    rawProfileForGuard !== null &&
    profile.requestedProfile === rawProfileForGuard;

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="text-xs text-slate-400 hover:text-slate-200 min-h-[44px]"
    >
      ← К рабочим областям
    </button>
  );

  // ----- Workspace record unavailable (kernel did not grant t1.getWorkspace)
  if (workspaceState === "unavailable") {
    return (
      <div className="space-y-3" data-testid="workspace-record-unavailable">
        {backButton}
        <p role="status" className="text-sm text-slate-400">
          Сведения о рабочей области не предоставлены ядром в текущем режиме.
        </p>
      </div>
    );
  }

  // ----- Workspace not found (t1.getWorkspace returned null) --------------
  if (workspaceState === "not-found") {
    return (
      <div className="space-y-3" data-testid="workspace-record-not-found">
        {backButton}
        <p role="status" className="text-sm text-slate-400">
          Рабочая область не найдена в текущей сессии.
        </p>
      </div>
    );
  }

  // ----- Workspace record load error --------------------------------------
  if (workspaceState === "error") {
    return (
      <div className="space-y-3" data-testid="workspace-record-error">
        {backButton}
        <p role="alert" className="text-sm text-rose-200">
          Не удалось получить сведения о рабочей области.
        </p>
        {workspaceError && (
          <details className="text-[11px] text-slate-500">
            <summary className="cursor-pointer">Технические детали</summary>
            <pre className="whitespace-pre-wrap break-all">{workspaceError}</pre>
          </details>
        )}
      </div>
    );
  }

  // ----- Profile activation error ----------------------------------------
  if (profileMatchesWorkspace && profile.status === "error") {
    return (
      <div className="space-y-3" data-testid="workspace-profile-error" data-surface="profile-activation-error">
        {backButton}
        <div className="border border-rose-800/60 rounded p-4 space-y-2">
          <p role="alert" className="text-sm text-rose-200">
            Не удалось активировать представление профиля рабочей области.
          </p>
          <p className="text-xs text-slate-400">Содержимое не запрашивалось.</p>
          {profile.error && (
            <details className="text-[11px] text-slate-500">
              <summary className="cursor-pointer">Техническая ошибка</summary>
              <pre className="whitespace-pre-wrap break-all">{profile.error}</pre>
            </details>
          )}
          {kernel.hasOperation("t2.exportPackage") && (
            <button
              type="button"
              onClick={() => onExportThis(workspaceId)}
              className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
              data-testid="workspace-export-action"
            >
              Экспортировать рабочую область
            </button>
          )}
        </div>
      </div>
    );
  }

  // ----- Workspace record / profile still loading -----------------------
  if (
    !workspace ||
    workspaceState !== "ready" ||
    !profileMatchesWorkspace ||
    profile.status === "loading" ||
    profile.status === "idle"
  ) {
    return (
      <div className="space-y-3">
        {backButton}
        <p className="text-sm text-slate-500" data-testid="workspace-profile-loading">
          Подготовка представления профиля…
        </p>
      </div>
    );
  }

  const ws = workspace;
  const rawProfile = ws.profile;
  const activeProfileId = profile.definition?.id ?? "generic";
  const activeProfileLabel = profile.definition?.label ?? "Профиль";
  const isFallback = profile.status === "fallback";

  const sensitivityLabels = (ws.capabilities ?? [])
    .filter((c: string) => c.startsWith("sensitivity:"))
    .map((c: string) => {
      const key = c.split(":")[1] ?? "standard";
      return SENSITIVITY_LABELS[key] ?? key;
    });

  // Baseline 1.2 — WorkspaceRecord carries no pre-computed counts.
  // Prompt 04 §10 allows deriving counts inside an OPEN workspace from
  // the shell's own listObjects / listEventsSince responses; nothing is
  // fabricated when those axes have not (yet) succeeded.
  const objectsCount = objectsState === "ready" ? objects.filter((object) => !isWorkspaceViewStateObjectRecord(object)).length : null;
  const eventsCount = eventsState === "ready" ? events.length : null;
  const lastEventAt =
    eventsState === "ready" && events.length > 0
      ? events.reduce(
          (acc, e) => (acc && acc > e.occurred_at ? acc : e.occurred_at),
          "" as string,
        ) || null
      : null;

  return (
    <WorkspaceCatalogSurface
      workspaceId={workspaceId}
      backButton={backButton}
      onExportThis={onExportThis}
      onOpenObject={onOpenObject}
      onBack={onBack}
      kernel={kernel}
      viewerRegistry={props.viewerRegistry} grantedOperations={props.grantedOperations} activeCapabilities={props.activeCapabilities}
      commands={commands}
      ws={ws}
      rawProfile={rawProfile}
      activeProfileId={activeProfileId}
      activeProfileLabel={activeProfileLabel}
      isFallback={isFallback}
      sensitivityLabels={sensitivityLabels}
      counts={{ objects: objectsCount, events: eventsCount, relations: null }}
      lastEventAt={lastEventAt}
      objectsState={objectsState}
      objects={objects}
      objectsError={objectsError}
      objectIntegrityWarnings={objectIntegrityWarnings}
      refreshObjects={refreshObjects}
      eventsState={eventsState}
      events={events}
      eventsError={eventsError}
      eventIntegrityWarnings={eventIntegrityWarnings}
      profileDefinition={profile.definition}
      currentShellServiceId={currentShellServiceId}
    />
  );
}

interface CatalogSurfaceProps {
  workspaceId: string;
  backButton: React.ReactNode;
  onExportThis: (id: string) => void;
  onOpenObject: (workspaceId: string, objectId: string) => void;
  onBack: () => void;
  kernel: KernelFacade;
  viewerRegistry?:ViewerRegistry;grantedOperations?:readonly OperationId[];activeCapabilities?:readonly string[];
  commands?: CommandsFacade;
  ws: import("../../../../kernel-client").WorkspaceRecord;
  rawProfile: string;
  activeProfileId: import("../../../../config/domain-config").WorkspaceProfileId;
  activeProfileLabel: string;
  isFallback: boolean;
  sensitivityLabels: readonly string[];
  counts: { objects: number | null; events: number | null; relations: number | null };
  lastEventAt: string | null;
  objectsState: import("./content-types").LoadState;
  objects: readonly import("../../../../kernel-client").ObjectRecord[];
  objectsError: string | null;
  objectIntegrityWarnings: readonly import("./content-types").ObjectIntegrityWarning[];
  refreshObjects: () => Promise<void>;
  eventsState: import("./content-types").LoadState;
  events: readonly import("../../../../kernel-client").EventRecord[];
  eventsError: string | null;
  eventIntegrityWarnings: readonly import("./content-types").EventIntegrityWarning[];
  profileDefinition: import("../../../../profiles/definition").WorkspaceProfileDefinition | null;
  currentShellServiceId: string;
}

function WorkspaceCatalogSurface(props: CatalogSurfaceProps) {
  const {
    workspaceId, backButton, onExportThis, onOpenObject, onBack, kernel, commands,
    ws, rawProfile, activeProfileId, activeProfileLabel, isFallback,
    sensitivityLabels, counts, lastEventAt,
    objectsState, objects, objectsError, objectIntegrityWarnings, refreshObjects,
    eventsState, events, eventsError, eventIntegrityWarnings,
    profileDefinition, currentShellServiceId,
    viewerRegistry,grantedOperations,activeCapabilities,
  } = props;

  const businessObjects = useMemo(
    () => objects.filter((object) => !isWorkspaceViewStateObjectRecord(object)),
    [objects],
  );

  const sections = useMemo(
    () =>
      profileDefinition
        ? buildWorkspaceObjectSections(profileDefinition, businessObjects)
        : [],
    [profileDefinition, businessObjects],
  );

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ObjectCatalogSortId>("updated");
  const [page, setPage] = useState(0);

  // T2-03D — never carry filters between Workspaces / profile switches.
  useEffect(() => {
    setActiveSectionId(null);
    setQuery("");
    setSort("updated");
    setPage(0);
  }, [workspaceId, activeProfileId]);


  // Initialise / reconcile active section as sections mutate.
  useEffect(() => {
    if (sections.length === 0) {
      setActiveSectionId(null);
      return;
    }
    setActiveSectionId((prev) => {
      if (prev && sections.some((s) => s.id === prev)) return prev;
      return pickInitialSectionId(sections);
    });
  }, [sections]);

  const activeSection =
    sections.find((s) => s.id === activeSectionId) ?? sections[0] ?? null;

  const filteredSorted = useMemo(() => {
    if (!activeSection) return [];
    const filtered = filterObjectsByQuery(activeSection.objects, query);
    return sortObjects(filtered, sort);
  }, [activeSection, query, sort]);

  const pagination = paginate(filteredSorted, page, OBJECT_CATALOG_PAGE_SIZE);
  const normalizedPage = pagination.normalizedPage;

  const changeSection = (id: string) => {
    setActiveSectionId(id);
    setQuery("");
    setPage(0);
  };
  const changeQuery = (v: string) => { setQuery(v); setPage(0); };
  const changeSort = (v: ObjectCatalogSortId) => { setSort(v); setPage(0); };

  const readOnlyLabel = ws.read_only ? "Только чтение" : "Доступно для изменений";

  return (
    <div className="space-y-5" data-testid="workspace-view">
      {backButton}

      <header className="space-y-2">
        <div className="flex items-center flex-wrap gap-2">
          <span
            className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-slate-800 text-slate-200"
            data-testid="active-profile-label"
          >
            {activeProfileLabel}
          </span>
          <span
            className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-slate-300"
            data-testid="workspace-read-only-badge"
          >
            {readOnlyLabel}
          </span>
          {sensitivityLabels.map((s) => (
            <span
              key={s}
              className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-slate-300"
            >
              {s}
            </span>
          ))}
        </div>
        <h3 className="text-base font-semibold text-slate-100 break-all">
          {ws.workspace_id}
        </h3>

        {isFallback && (
          <p
            role="status"
            data-testid="workspace-profile-fallback"
            className="text-xs text-amber-200 border border-amber-800/60 rounded p-2"
          >
            Профиль «{rawProfile}» не распознан этой версией Workspace.
            Содержимое показано в универсальном режиме без изменения исходных данных.
          </p>
        )}

        <dl className="text-xs text-slate-400 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5">
          <dt>Создано</dt><dd className="text-slate-200">{formatWorkspaceDate(ws.created_at)}</dd>
          <dt>Обновлено</dt><dd className="text-slate-200">{formatWorkspaceDate(ws.updated_at)}</dd>
          <dt>Объектов</dt><dd className="text-slate-200">{counts.objects ?? "—"}</dd>
          <dt>Событий</dt><dd className="text-slate-200">{counts.events ?? "—"}</dd>
          <dt>Связей</dt><dd className="text-slate-200">{counts.relations ?? "—"}</dd>
          <dt>Последняя активность</dt>
          <dd className="text-slate-200">{formatWorkspaceDate(lastEventAt)}</dd>
        </dl>

        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-slate-500 min-h-[44px] flex items-center">
            Технические сведения
          </summary>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-400">
            <dt>current_shell_service_id</dt><dd className="text-slate-200 break-all"><code>{currentShellServiceId}</code></dd>
            <dt>workspace_id</dt><dd className="text-slate-200 break-all"><code>{ws.workspace_id}</code></dd>
            <dt>raw profile</dt><dd className="text-slate-200 break-all"><code>{rawProfile}</code></dd>
            <dt>active profile</dt><dd className="text-slate-200 break-all"><code>{activeProfileId}</code></dd>
            <dt>created_at</dt><dd className="text-slate-200 break-all"><code>{ws.created_at}</code></dd>
            <dt>updated_at</dt><dd className="text-slate-200 break-all"><code>{ws.updated_at}</code></dd>
            {lastEventAt && (
              <>
                <dt>последнее событие</dt>
                <dd className="text-slate-200 break-all"><code>{lastEventAt}</code></dd>
              </>
            )}
          </dl>
        </details>

        <div className="flex flex-wrap gap-2">
          {kernel.hasOperation("t2.exportPackage") && (
            <button
              type="button"
              onClick={() => onExportThis(workspaceId)}
              className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
              data-testid="workspace-export-action"
            >
              Экспортировать рабочую область
            </button>
          )}
          {!ws.read_only && commands?.has("lifecycle.soft-delete-workspace") && (
            <SoftDeleteAction
              workspaceId={workspaceId}
              commands={commands}
              onDeleted={onBack}
            />
          )}
        </div>
      </header>

      {/* Objects surface */}
      <section aria-labelledby="ws-objects" className="space-y-3">
        <h4 id="ws-objects" className="text-sm font-medium text-slate-200">
          Содержимое
        </h4>

        {objectIntegrityWarnings.length > 0 && (
          <p
            role="status"
            data-testid="workspace-object-integrity-warning"
            className="text-xs text-amber-200 border border-amber-800/60 rounded p-2"
          >
            Некоторые записи не показаны из-за нарушения идентификаторов
            или области принадлежности.
          </p>
        )}

        {objectsState === "unavailable" ? (
          <p role="status" className="text-sm text-slate-400" data-testid="objects-unavailable">
            Список объектов не предоставлен ядром в текущем режиме.
          </p>
        ) : objectsState === "error" ? (
          <div className="space-y-2" data-testid="objects-error">
            <p role="alert" className="text-sm text-rose-200">
              Не удалось загрузить объекты рабочей области.
            </p>
            <button
              type="button"
              onClick={() => { void refreshObjects(); }}
              className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
            >
              Повторить
            </button>
            {objectsError && (
              <details className="text-[11px] text-slate-500">
                <summary className="cursor-pointer min-h-[24px]">Технические детали</summary>
                <pre className="whitespace-pre-wrap break-all">{objectsError}</pre>
              </details>
            )}
          </div>
        ) : objectsState === "loading" && businessObjects.length === 0 ? (
          <p className="text-sm text-slate-500">Загрузка объектов…</p>
        ) : businessObjects.length === 0 ? (
          <p className="text-sm text-slate-400" data-testid="workspace-empty">
            В этой рабочей области пока нет объектов. Они появятся после работы
            в совместимых сервисах или импорта пакета .iwxa.
          </p>
        ) : (
          <>
            {sections.length > 0 && (
              <ObjectSectionNav
                sections={sections}
                activeId={activeSection?.id ?? null}
                onSelect={changeSection}
              />
            )}
            {activeSection && (
              <div
                role="tabpanel"
                id={`section-panel-${activeSection.id}`}
                aria-labelledby={`section-tab-${activeSection.id}`}
                className="space-y-3"
              >
                <ObjectCatalogToolbar
                  query={query}
                  onQueryChange={changeQuery}
                  sort={sort}
                  onSortChange={changeSort}
                />

                {activeSection.objects.length === 0 ? (
                  <div
                    className="border border-slate-800 rounded p-4 text-sm text-slate-400"
                    data-testid="section-empty"
                  >
                    <p className="font-medium text-slate-200">{activeSection.emptyTitle}</p>
                    <p className="text-xs mt-1">{activeSection.emptyDescription}</p>
                  </div>
                ) : filteredSorted.length === 0 ? (
                  <div
                    className="border border-slate-800 rounded p-4 text-sm text-slate-400 space-y-2"
                    data-testid="search-empty"
                  >
                    <p>По заданным условиям объекты не найдены.</p>
                    <button
                      type="button"
                      onClick={() => { setQuery(""); setSort("updated"); setPage(0); }}
                      className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
                    >
                      Сбросить поиск и сортировку
                    </button>
                  </div>
                ) : (
                  <>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {pagination.pageItems.map((o) => (
                        <li key={`${o.workspace_id}:${o.object_id}`}>
                          <ObjectPreviewCard
                             viewerRegistry={viewerRegistry} grantedOperations={grantedOperations} activeCapabilities={activeCapabilities}
                            profileId={activeProfileId}
                            object={o}
                            onOpen={onOpenObject}
                          />
                        </li>
                      ))}
                    </ul>
                    <nav
                      aria-label="Постраничная навигация по объектам"
                      className="flex items-center gap-2 text-xs text-slate-400"
                    >
                      <span>
                        Показано {pagination.startIndex}–{pagination.endIndex} из {pagination.total}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPage(Math.max(0, normalizedPage - 1))}
                          disabled={normalizedPage === 0}
                          className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40 min-h-[44px]"
                        >
                          Назад
                        </button>
                        <span>Стр. {normalizedPage + 1} / {pagination.totalPages}</span>
                        <button
                          type="button"
                          onClick={() => setPage(Math.min(pagination.totalPages - 1, normalizedPage + 1))}
                          disabled={normalizedPage >= pagination.totalPages - 1}
                          className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40 min-h-[44px]"
                        >
                          Вперёд
                        </button>
                      </span>
                    </nav>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {objectsState === "ready" && profileDefinition && (
        <RichWorkspaceReadModel
          workspace={ws}
          objects={objects}
          events={eventsState === "ready" ? events : []}
          eventsAvailable={eventsState === "ready"}
          profileDefinition={profileDefinition}
          commands={commands}
          onRefreshObjects={refreshObjects}
          onOpenObject={onOpenObject}
        />
      )}

      <WorkspaceRelationIndex
        kernel={kernel}
        workspaceId={workspaceId}
        objects={businessObjects}
        enabled={objectsState === "ready"}
        onOpenObject={onOpenObject}
      />

      {/* Recent activity — only when kernel granted the capability */}
      {eventsState !== "unavailable" && (
        <section aria-labelledby="ws-events" className="space-y-2">
          <h4 id="ws-events" className="text-sm font-medium text-slate-200">
            Последняя активность
          </h4>
          {eventIntegrityWarnings.length > 0 && (
            <p role="status" data-testid="workspace-event-integrity-warning" className="text-xs text-amber-200 border border-amber-800/60 rounded p-2">
              Некоторые события исключены из readback из-за нарушения идентификаторов, области Workspace или временных данных.
            </p>
          )}
          {eventsState === "error" ? (
            <p role="alert" className="text-xs text-rose-200" data-testid="events-error">
              Не удалось загрузить события. {eventsError}
            </p>
          ) : eventsState === "loading" && events.length === 0 ? (
            <p className="text-xs text-slate-500" data-testid="events-loading">
              Загрузка событий…
            </p>
          ) : eventsState === "ready" && events.length === 0 ? (
            <p className="text-xs text-slate-500" data-testid="events-empty">
              Событий нет.
            </p>
          ) : (
            <ul className="text-xs border border-slate-800 rounded divide-y divide-slate-800" data-testid="events-list">
              {[...events]
                .sort((a, b) => compareWorkspaceDatesDesc(a.occurred_at, b.occurred_at))
                .slice(0, 8)
                .map((e) => (
                  <li key={e.event_id} className="p-2 flex flex-wrap gap-1">
                    <span className="text-slate-300"><code>{e.event_type}</code></span>
                    <span className="text-slate-500 ml-auto">
                      {formatWorkspaceDate(e.occurred_at)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function SoftDeleteAction({
  workspaceId,
  commands,
  onDeleted,
}: {
  workspaceId: string;
  commands: CommandsFacade;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // PROMPT 33 §7 — soft-delete flows through the lifecycle command
      // exclusively. The open Workspace view never calls
      // ctx.kernel.softDeleteWorkspace directly.
      await commands.invoke("lifecycle.soft-delete-workspace", { workspaceId });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        className="px-3 py-1.5 text-xs rounded bg-rose-900/60 hover:bg-rose-800/70 text-rose-100 disabled:opacity-40 min-h-[44px]"
        data-testid="workspace-soft-delete-action"
      >
        {busy ? "Перемещение…" : "В корзину"}
      </button>
      {error && (
        <p role="alert" className="text-[11px] text-rose-200" data-testid="workspace-soft-delete-error">
          Не удалось переместить в корзину: {error}
        </p>
      )}
    </div>
  );
}
