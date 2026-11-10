/**
 * Object detail surface.
 *
 * Rules (see T2-03C spec):
 *   - Load order is Summary → Profile activation → Object → (Events).
 *     is requested.
 *   - Renderer resolution is (workspace.profile, schema_id) — never the
 *     domain profile.
 *   - Unknown types get UnknownObjectDetail; JSON is never auto-opened.
 *   - Relations show incoming/outgoing separately, paginated at 10; the
 *     preview loader is dedup + concurrency-bounded and never recurses.
 *   - History failures do NOT hide the object.
 *   - No mutation controls anywhere.
 */
import { useMemo } from "react";
import type {
  ObjectRecord,
  WorkspaceRecord,
} from "../../../../kernel-client";
import type { KernelFacade } from "../../../../workspace-contract";
import type { WorkspaceProfileDefinition } from "../../../../profiles/definition";
import type { ViewerRegistry } from "../../../../workspace-host/registries/ViewerRegistry";
import type { OperationId } from "../../../../kernel-client";
import { HostViewer } from "../../../../workspace-host/rendering/HostViewer";
import { formatWorkspaceDate } from "../workspaces/workspace-format";
import { useObjectDetail } from "./useObjectDetail";
import { LazyJsonDetails } from "./LazyJsonDetails";
import { UnknownObjectDetail } from "./UnknownObjectDetail";
import { filterObjectEvents } from "./object-history";
import { RelationList } from "./relations/RelationList";

export interface ObjectViewProps {
  kernel: KernelFacade;
  viewerRegistry?:ViewerRegistry; grantedOperations?:readonly OperationId[]; activeCapabilities?:readonly string[];
  workspaceId: string;
  objectId: string;
  onBack: () => void;
  onOpenObject: (workspaceId: string, objectId: string) => void;
}

export function ObjectView(props: ObjectViewProps) {
  const { kernel, workspaceId, objectId, onBack, onOpenObject } = props;

  const controller = useObjectDetail({
    kernel,
    workspaceId,
    objectId,
  });

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="text-xs text-slate-400 hover:text-slate-200 min-h-[44px]"
    >
      ← К рабочей области
    </button>
  );

  const {
    status, workspace, workspaceError,
    profile, detail, objectError,
    eventsStatus, events, eventsError,
    refreshObject,
  } = controller;

  // ---- Guard states ------------------------------------------------------
  if (status === "workspace-unavailable") {
    return (
      <div className="space-y-3" data-testid="object-view-workspace-unavailable">
        {backButton}
        <p role="status" className="text-sm text-slate-400">
          Сведения о рабочей области не предоставлены ядром в текущем режиме.
        </p>
      </div>
    );
  }
  if (status === "workspace-not-found") {
    return (
      <div className="space-y-3" data-testid="object-view-workspace-not-found">
        {backButton}
        <p role="status" className="text-sm text-slate-400">
          Рабочая область не найдена в текущей сессии.
        </p>
      </div>
    );
  }
  if (status === "object-unavailable") {
    return (
      <div className="space-y-3" data-testid="object-view-object-unavailable">
        {backButton}
        <p role="status" className="text-sm text-slate-400">
          Просмотр объекта не предоставлен ядром в текущем режиме.
        </p>
      </div>
    );
  }
  if (status === "workspace-error") {
    return (
      <div className="space-y-3" data-testid="object-view-workspace-error">
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
  if (status === "profile-error") {
    return (
      <div className="space-y-3" data-testid="object-view-profile-error" data-surface="profile-activation-error">
        {backButton}
        <div className="border border-rose-800/60 rounded p-4 space-y-2">
          <p role="alert" className="text-sm text-rose-200">
            Не удалось активировать представление профиля рабочей области.
          </p>
          <p className="text-xs text-slate-400">Объект не запрашивался.</p>
          {profile.error && (
            <details className="text-[11px] text-slate-500">
              <summary className="cursor-pointer">Техническая ошибка</summary>
              <pre className="whitespace-pre-wrap break-all">{profile.error}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }
  if (status === "loading-workspace" || status === "idle") {
    return (
      <div className="space-y-3">
        {backButton}
        <p className="text-sm text-slate-500">Загрузка рабочей области…</p>
      </div>
    );
  }
  if (status === "loading-object") {
    return (
      <div className="space-y-3">
        {backButton}
        <p className="text-sm text-slate-500">Загрузка объекта…</p>
      </div>
    );
  }
  if (status === "not-found") {
    return (
      <div className="space-y-3" data-testid="object-view-not-found">
        {backButton}
        <div className="border border-slate-800 rounded p-4 space-y-2">
          <h3 className="text-sm font-semibold text-slate-100">
            Объект не найден
          </h3>
          <p className="text-xs text-slate-400">
            Он мог быть удалён, отсутствовать в этой рабочей области или быть
            недоступным в текущем режиме ядра.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-2 px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
          >
            Вернуться к рабочей области
          </button>
        </div>
      </div>
    );
  }
  if (status === "object-error") {
    return (
      <div className="space-y-3" data-testid="object-view-object-error">
        {backButton}
        <div className="border border-rose-800/60 rounded p-4 space-y-2">
          <p role="alert" className="text-sm text-rose-200">
            Не удалось загрузить объект.
          </p>
          <button
            type="button"
            onClick={() => { void refreshObject(); }}
            className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]"
          >
            Повторить
          </button>
          {objectError && (
            <details className="text-[11px] text-slate-500">
              <summary className="cursor-pointer">Техническая ошибка</summary>
              <pre className="whitespace-pre-wrap break-all">{objectError}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  // status === "ready"  → detail + workspace + profile.definition
  if (!detail || !workspace || !profile.definition) {
    // Defensive: `ready` implies all three are present, but never crash.
    return (
      <div className="space-y-3">
        {backButton}
        <p className="text-sm text-slate-500">Загрузка объекта…</p>
      </div>
    );
  }

  return (
    <ReadyObjectSurface
      backButton={backButton}
      kernel={kernel}
      workspaceId={workspaceId}
      objectId={objectId}
      workspace={workspace}
      profileDefinition={profile.definition}
      object={detail.object}
      viewerRegistry={props.viewerRegistry} grantedOperations={props.grantedOperations} activeCapabilities={props.activeCapabilities}
      outgoing={detail.relations.outgoing}
      incoming={detail.relations.incoming}
      eventsStatus={eventsStatus}
      events={events}
      eventsError={eventsError}
      onOpenObject={onOpenObject}
    />
  );
}

// ---------------------------------------------------------------------------

interface ReadySurfaceProps {
  backButton: React.ReactNode;
  kernel: KernelFacade;
  workspaceId: string;
  objectId: string;
  workspace: WorkspaceRecord;
  profileDefinition: WorkspaceProfileDefinition;
  object: ObjectRecord;
  viewerRegistry?:ViewerRegistry; grantedOperations?:readonly OperationId[]; activeCapabilities?:readonly string[];
  outgoing: readonly import("../../../../kernel-client").RelationRecord[];
  incoming: readonly import("../../../../kernel-client").RelationRecord[];
  eventsStatus: import("./object-detail-types").EventsStatus;
  events: readonly import("../../../../kernel-client").EventRecord[];
  eventsError: string | null;
  onOpenObject: (workspaceId: string, objectId: string) => void;
}

function ReadyObjectSurface(props: ReadySurfaceProps) {
  const {
    backButton, kernel,
    workspaceId, objectId, workspace, profileDefinition, object,
    outgoing, incoming, eventsStatus, events, eventsError, onOpenObject,
    viewerRegistry, grantedOperations, activeCapabilities,
  } = props;

  const selected=viewerRegistry?.resolve({profileId:profileDefinition.id,schemaId:object.schema_id,schemaVersion:object.schema_version,surface:"detail"},grantedOperations,activeCapabilities);
  const rendererLabel=selected?.entry.contribution.label ?? "Исходные данные";

  const historyEvents = useMemo(
    () => filterObjectEvents(events, workspaceId, objectId),
    [events, workspaceId, objectId],
  );

  const readOnlyLabel = workspace.read_only
    ? "Только чтение"
    : "Доступно для изменений";

  return (
    <div className="space-y-5" data-testid="object-view">
      {backButton}

      {/* --- Header ----------------------------------------------------- */}
      <header className="space-y-2">
        <div className="flex items-center flex-wrap gap-2">
          <span
            className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-slate-800 text-slate-200"
            data-testid="object-renderer-label"
          >
            {rendererLabel}
          </span>
          <span
            className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-slate-300"
            data-testid="object-profile-label"
          >
            {profileDefinition.label}
          </span>
          <span
            className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-slate-300"
            data-testid="object-read-only-badge"
          >
            {readOnlyLabel}
          </span>
        </div>

        <dl className="text-[11px] text-slate-400 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5">
          <dt>Тип</dt>
          <dd className="text-slate-200 break-all"><code>{object.schema_id}</code></dd>
          <dt>Ревизия</dt>
          <dd className="text-slate-200">{object.revision}</dd>
          <dt>Обновлено</dt>
          <dd className="text-slate-200">{formatWorkspaceDate(object.updated_at)}</dd>
          <dt>Создано</dt>
          <dd className="text-slate-200">{formatWorkspaceDate(object.created_at)}</dd>
        </dl>

        <p className="text-[11px] text-slate-500 break-all">
          Объект · <code>{object.object_id}</code>
        </p>
      </header>

      {/* --- Renderer body --------------------------------------------- */}
      <section
        aria-labelledby="obj-body"
        className="border border-slate-800 rounded p-3"
      >
        <h4 id="obj-body" className="sr-only">Содержимое объекта</h4>
        {viewerRegistry ? <HostViewer registry={viewerRegistry} profileId={profileDefinition.id} schemaId={object.schema_id} schemaVersion={object.schema_version} surface="detail" data={object.data} grantedOperations={grantedOperations} activeCapabilities={activeCapabilities} fallback={<UnknownObjectDetail object={object} profileLabel={profileDefinition.label}/>} /> : <UnknownObjectDetail object={object} profileLabel={profileDefinition.label}/>}
      </section>

      {/* --- Relations ------------------------------------------------- */}
      <section aria-labelledby="obj-relations" className="space-y-4">
        <h4 id="obj-relations" className="text-sm font-medium text-slate-200">
          Связи
        </h4>
        <RelationList
          direction="outgoing"
          relations={outgoing}
          workspaceId={workspaceId}
          currentObjectId={object.object_id}
          kernel={kernel}
          profileId={profileDefinition.id}
          viewerRegistry={viewerRegistry} grantedOperations={grantedOperations} activeCapabilities={activeCapabilities}
          previewsEnabled={kernel.hasOperation("t1.getObject")}
          onOpen={onOpenObject}
        />
        <RelationList
          direction="incoming"
          relations={incoming}
          workspaceId={workspaceId}
          currentObjectId={object.object_id}
          kernel={kernel}
          profileId={profileDefinition.id}
          viewerRegistry={viewerRegistry} grantedOperations={grantedOperations} activeCapabilities={activeCapabilities}
          previewsEnabled={kernel.hasOperation("t1.getObject")}
          onOpen={onOpenObject}
        />
      </section>

      {/* --- History --------------------------------------------------- */}
      {eventsStatus !== "unavailable" && (
        <section aria-labelledby="obj-history" className="space-y-2">
          <h4 id="obj-history" className="text-sm font-medium text-slate-200">
            История объекта
          </h4>
          {eventsStatus === "error" ? (
            <p
              role="status"
              className="text-xs text-amber-200 border border-amber-800/60 rounded p-2"
              data-testid="object-history-unavailable"
            >
              История объекта временно недоступна.
              {eventsError && (
                <> <span className="text-slate-500 break-all">({eventsError})</span></>
              )}
            </p>
          ) : eventsStatus === "loading" ? (
            <p className="text-xs text-slate-500">Загрузка событий…</p>
          ) : historyEvents.length === 0 ? (
            <p className="text-xs text-slate-500">
              Событий по этому объекту нет.
            </p>
          ) : (
            <ul
              className="text-xs border border-slate-800 rounded divide-y divide-slate-800"
              data-testid="object-history-list"
            >
              {historyEvents.map((e) => (
                <li key={e.event_id} className="p-2 space-y-1">
                  <div>
                    <span className="text-slate-300">{e.event_type}</span>
                    <span className="text-slate-500">
                      {" "}· {e.service_id} · {formatWorkspaceDate(e.occurred_at)}
                    </span>
                  </div>
                  <LazyJsonDetails
                    summary="Показать технические данные события"
                    value={e.payload}
                    testId={`object-event-payload-${e.event_id}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* --- Technical details ---------------------------------------- */}
      <details
        className="border border-slate-800 rounded"
        data-testid="object-technical"
      >
        <summary className="cursor-pointer text-sm text-slate-300 px-3 py-2 min-h-[44px] flex items-center">
          Технические сведения
        </summary>
        <dl className="text-xs text-slate-400 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 px-3 pb-3">
          <dt>workspace_id</dt>
          <dd className="text-slate-200 break-all"><code>{object.workspace_id}</code></dd>
          <dt>object_id</dt>
          <dd className="text-slate-200 break-all"><code>{object.object_id}</code></dd>
          <dt>schema_id</dt>
          <dd className="text-slate-200 break-all"><code>{object.schema_id}</code></dd>
          <dt>schema_version</dt>
          <dd className="text-slate-200"><code>{object.schema_version}</code></dd>
          <dt>revision</dt>
          <dd className="text-slate-200"><code>{object.revision}</code></dd>
          <dt>created_by_service</dt>
          <dd className="text-slate-200 break-all"><code>{object.created_by_service}</code></dd>
          <dt>updated_by_service</dt>
          <dd className="text-slate-200 break-all"><code>{object.updated_by_service}</code></dd>
          <dt>created_at</dt>
          <dd className="text-slate-200 break-all"><code>{object.created_at}</code></dd>
          <dt>updated_at</dt>
          <dd className="text-slate-200 break-all"><code>{object.updated_at}</code></dd>
          <dt>deleted</dt>
          <dd className="text-slate-200">{String(object.deleted)}</dd>
          <dt>deleted_at</dt>
          <dd className="text-slate-200 break-all">{object.deleted_at ?? "—"}</dd>
        </dl>
      </details>

      {object.extensions && Object.keys(object.extensions).length > 0 && (
        <LazyJsonDetails
          summary="Расширения объекта"
          value={object.extensions}
          testId="object-extensions"
        />
      )}
    </div>
  );
}
