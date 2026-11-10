import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EventRecord,
  ObjectRecord,
  WorkspaceRecord,
} from "../../../../kernel-client/contracts/runtime-1.3.0";
import type { WorkspaceProfileDefinition } from "../../../../profiles/definition";
import type { CommandsFacade } from "../../../../workspace-contract";
import { formatWorkspaceDate } from "../workspaces/workspace-format";
import {
  RICH_WORKSPACE_RECEIPTS_BOUNDARY,
  RICH_WORKSPACE_WINDOW_SIZE,
  buildRichWorkspaceComparePreview,
  buildRichWorkspaceQueues,
  buildRichWorkspaceWindow,
} from "./rich-workspace-derived.mjs";
import {
  buildRichWorkspaceReadModel,
  queryRichWorkspaceObjects,
} from "./rich-workspace-read-model";
import {
  invokePreparedWorkspaceOwnerCommand,
  prepareWorkspaceOwnerCommand,
  preparedWorkspaceOwnerCommandIsCurrent,
  type PreparedWorkspaceOwnerCommand,
} from "./rich-workspace-command-preflight";
import {
  WORKSPACE_VIEW_STATE_COMMANDS,
  buildPersistedWorkspaceSavedViewId,
  projectWorkspacePersistedViews,
  workspaceViewStateCommandAvailability,
} from "./workspace-persisted-view-state.mjs";
import { classifyWorkspacePersistedViewMutationError } from "./workspace-persisted-view-conflict.mjs";

type WorkspaceMode = "browse" | "queues" | "compare" | "receipts";
type WorkingView = {
  id: string;
  title: string;
  logicalAreaId: string | null;
  query: string;
};

export function RichWorkspaceReadModel(props: {
  workspace: WorkspaceRecord;
  objects: readonly ObjectRecord[];
  events: readonly EventRecord[];
  profileDefinition: WorkspaceProfileDefinition;
  eventsAvailable?: boolean;
  commands?: CommandsFacade;
  onRefreshObjects?: () => Promise<void>;
  onOpenObject: (workspaceId: string, objectId: string) => void;
}) {
  const { workspace, objects, events, profileDefinition, eventsAvailable = true, commands, onRefreshObjects, onOpenObject } = props;
  const model = useMemo(
    () => buildRichWorkspaceReadModel({ workspace, objects, events, profileDefinition }),
    [events, objects, profileDefinition, workspace],
  );
  const [query, setQuery] = useState("");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>("browse");
  const [windowOffset, setWindowOffset] = useState(0);
  const [detailState, setDetailState] = useState<{ workspaceId: string; objectId: string | null }>({
    workspaceId: workspace.workspace_id,
    objectId: null,
  });
  const [selectionState, setSelectionState] = useState<{ workspaceId: string; ids: string[] }>({
    workspaceId: workspace.workspace_id,
    ids: [],
  });
  const [workingViewState, setWorkingViewState] = useState<{
    workspaceId: string;
    nextId: number;
    views: WorkingView[];
  }>({ workspaceId: workspace.workspace_id, nextId: 1, views: [] });
  const [workingViewTitleState, setWorkingViewTitleState] = useState<{ workspaceId: string; value: string }>({
    workspaceId: workspace.workspace_id,
    value: "",
  });
  const [persistedViewBusy, setPersistedViewBusy] = useState<string | null>(null);
  const [persistedViewError, setPersistedViewError] = useState<string | null>(null);
  const [preparedCommandState, setPreparedCommandState] = useState<{
    workspaceId: string;
    command: PreparedWorkspaceOwnerCommand | null;
  }>({ workspaceId: workspace.workspace_id, command: null });
  const [ownerCommandBusy, setOwnerCommandBusy] = useState(false);
  const [ownerCommandError, setOwnerCommandError] = useState<string | null>(null);
  const [ownerCommandCompleted, setOwnerCommandCompleted] = useState<string | null>(null);
  const workspaceMutationGeneration = useRef(0);

  useEffect(() => {
    workspaceMutationGeneration.current += 1;
    setPersistedViewBusy(null);
    setPersistedViewError(null);
    setOwnerCommandBusy(false);
    setOwnerCommandError(null);
    setOwnerCommandCompleted(null);
    setPreparedCommandState({ workspaceId: workspace.workspace_id, command: null });
    return () => {
      workspaceMutationGeneration.current += 1;
    };
  }, [workspace.workspace_id]);

  const selectedObjectIds = selectionState.workspaceId === workspace.workspace_id ? selectionState.ids : [];
  const selectedDetailId = detailState.workspaceId === workspace.workspace_id ? detailState.objectId : null;
  const workingViews = workingViewState.workspaceId === workspace.workspace_id ? workingViewState.views : [];
  const workingViewTitle =
    workingViewTitleState.workspaceId === workspace.workspace_id ? workingViewTitleState.value : "";

  const persistedViews = useMemo(
    () => projectWorkspacePersistedViews({
      workspaceId: workspace.workspace_id,
      profileId: profileDefinition.id,
      objects: [...objects],
    }),
    [objects, profileDefinition.id, workspace.workspace_id],
  );
  const viewStateAvailability = workspaceViewStateCommandAvailability(commands);
  const ownerCommandDescriptors = profileDefinition.objectOwnerCommands ?? [];
  const preparedCommand =
    preparedCommandState.workspaceId === workspace.workspace_id ? preparedCommandState.command : null;
  const currentPreparedDescriptor = preparedCommand
    ? (profileDefinition.objectOwnerCommands ?? []).find((descriptor) => descriptor.id === preparedCommand.descriptorId) ?? null
    : null;
  const ownerCommandPreflights = useMemo(
    () => ownerCommandDescriptors.map((descriptor) => ({
      descriptor,
      preflight: prepareWorkspaceOwnerCommand({
        descriptor,
        workspaceId: workspace.workspace_id,
        objects,
        selectedObjectIds,
        commands,
      }),
    })),
    [commands, objects, ownerCommandDescriptors, selectedObjectIds, workspace.workspace_id],
  );
  const preparedCommandCurrent = preparedCommand && currentPreparedDescriptor
    ? preparedWorkspaceOwnerCommandIsCurrent({
        prepared: preparedCommand,
        descriptor: currentPreparedDescriptor,
        workspaceId: workspace.workspace_id,
        objects,
        selectedObjectIds,
      })
    : false;

  const results = useMemo(
    () =>
      queryRichWorkspaceObjects({
        workspaceId: workspace.workspace_id,
        objects,
        logicalAreas: model.logicalAreas,
        query,
        logicalAreaId: areaId,
      }),
    [areaId, model.logicalAreas, objects, query, workspace.workspace_id],
  );
  const windowed = useMemo(
    () => buildRichWorkspaceWindow(results, windowOffset, RICH_WORKSPACE_WINDOW_SIZE),
    [results, windowOffset],
  );
  const queues = useMemo(
    () => buildRichWorkspaceQueues({ workspaceId: workspace.workspace_id, objects: results }),
    [results, workspace.workspace_id],
  );
  const comparePreview = useMemo(
    () =>
      buildRichWorkspaceComparePreview({
        workspaceId: workspace.workspace_id,
        objects,
        selectedObjectIds,
      }),
    [objects, selectedObjectIds, workspace.workspace_id],
  );
  const selectedDetail = useMemo(
    () =>
      selectedDetailId
        ? objects.find(
            (object) => object.workspace_id === workspace.workspace_id && object.object_id === selectedDetailId,
          ) ?? null
        : null,
    [objects, selectedDetailId, workspace.workspace_id],
  );

  const resetTransientSelection = () => {
    setSelectionState({ workspaceId: workspace.workspace_id, ids: [] });
    setDetailState({ workspaceId: workspace.workspace_id, objectId: null });
    setPreparedCommandState({ workspaceId: workspace.workspace_id, command: null });
    setOwnerCommandError(null);
    setOwnerCommandCompleted(null);
  };
  const applyArea = (nextAreaId: string | null) => {
    setAreaId(nextAreaId);
    setWindowOffset(0);
    resetTransientSelection();
  };
  const applyQuery = (value: string) => {
    setQuery(value);
    setWindowOffset(0);
    resetTransientSelection();
  };
  const toggleSelectedObject = (objectId: string) => {
    setSelectionState((current) => {
      const ids = current.workspaceId === workspace.workspace_id ? current.ids : [];
      if (ids.includes(objectId)) {
        return { workspaceId: workspace.workspace_id, ids: ids.filter((id) => id !== objectId) };
      }
      return { workspaceId: workspace.workspace_id, ids: [...ids, objectId] };
    });
    setPreparedCommandState({ workspaceId: workspace.workspace_id, command: null });
    setOwnerCommandError(null);
    setOwnerCommandCompleted(null);
  };
  const applyWorkingView = (view: Pick<WorkingView, "logicalAreaId" | "query">) => {
    setAreaId(view.logicalAreaId);
    setQuery(view.query);
    setWindowOffset(0);
    setMode("browse");
    resetTransientSelection();
  };
  const createWorkingView = () => {
    const title = workingViewTitle.trim();
    if (!title) return;
    setWorkingViewState((current) => {
      const currentState =
        current.workspaceId === workspace.workspace_id
          ? current
          : { workspaceId: workspace.workspace_id, nextId: 1, views: [] as WorkingView[] };
      const view: WorkingView = {
        id: `session-view:${currentState.nextId}`,
        title,
        logicalAreaId: areaId,
        query: query.trim(),
      };
      return {
        workspaceId: workspace.workspace_id,
        nextId: currentState.nextId + 1,
        views: [...currentState.views, view],
      };
    });
    setWorkingViewTitleState({ workspaceId: workspace.workspace_id, value: "" });
  };
  const removeWorkingView = (viewId: string) => {
    setWorkingViewState((current) => {
      if (current.workspaceId !== workspace.workspace_id) {
        return { workspaceId: workspace.workspace_id, nextId: 1, views: [] };
      }
      return { ...current, views: current.views.filter((view) => view.id !== viewId) };
    });
  };

  const refreshAfterViewStateMutation = async () => {
    if (onRefreshObjects) await onRefreshObjects();
  };
  const persistCurrentView = async () => {
    const title = workingViewTitle.trim();
    if (!title || !commands || !viewStateAvailability.save) return;
    const viewId = buildPersistedWorkspaceSavedViewId({
      workspaceId: workspace.workspace_id,
      profileId: profileDefinition.id,
      name: title,
    });
    const existing = persistedViews.views.find((view) => view.viewId === viewId);
    const mutationGeneration = workspaceMutationGeneration.current;
    setPersistedViewBusy(`save:${viewId}`);
    setPersistedViewError(null);
    try {
      await commands.invoke(WORKSPACE_VIEW_STATE_COMMANDS.save, {
        workspaceId: workspace.workspace_id,
        viewId,
        name: title,
        profileId: profileDefinition.id,
        logicalAreaId: areaId,
        query: query.trim(),
        baseRevision: existing?.baseRevision ?? 0,
      });
      if (mutationGeneration !== workspaceMutationGeneration.current) return;
      setWorkingViewTitleState({ workspaceId: workspace.workspace_id, value: "" });
      await refreshAfterViewStateMutation();
      if (mutationGeneration !== workspaceMutationGeneration.current) return;
    } catch (error) {
      if (mutationGeneration !== workspaceMutationGeneration.current) return;
      const classification = classifyWorkspacePersistedViewMutationError(error);
      if (classification.kind === "REVISION_CONFLICT") {
        try {
          await refreshAfterViewStateMutation();
          if (mutationGeneration !== workspaceMutationGeneration.current) return;
          setPersistedViewError("Сохранённое представление изменилось в другой операции. Данные обновлены; проверьте актуальное состояние и повторите действие явно.");
        } catch (refreshError) {
          setPersistedViewError(`Конфликт версии; автоматический повтор запрещён. Не удалось обновить данные: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
        }
      } else {
        setPersistedViewError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mutationGeneration === workspaceMutationGeneration.current) {
        setPersistedViewBusy(null);
      }
    }
  };
  const prepareOwnerCommand = (command: PreparedWorkspaceOwnerCommand) => {
    setPreparedCommandState({ workspaceId: workspace.workspace_id, command });
    setOwnerCommandError(null);
    setOwnerCommandCompleted(null);
  };
  const executePreparedOwnerCommand = async () => {
    if (!commands || !preparedCommand || !currentPreparedDescriptor || !preparedCommandCurrent || ownerCommandBusy) return;
    const mutationGeneration = workspaceMutationGeneration.current;
    setOwnerCommandBusy(true);
    setOwnerCommandError(null);
    setOwnerCommandCompleted(null);
    try {
      await invokePreparedWorkspaceOwnerCommand({
        commands,
        prepared: preparedCommand,
        descriptor: currentPreparedDescriptor,
        workspaceId: workspace.workspace_id,
        objects,
        selectedObjectIds,
      });
      if (mutationGeneration !== workspaceMutationGeneration.current) return;
      setOwnerCommandCompleted(preparedCommand.label);
      setPreparedCommandState({ workspaceId: workspace.workspace_id, command: null });
      if (onRefreshObjects) await onRefreshObjects();
      if (mutationGeneration !== workspaceMutationGeneration.current) return;
    } catch (error) {
      if (mutationGeneration === workspaceMutationGeneration.current) {
        setOwnerCommandError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mutationGeneration === workspaceMutationGeneration.current) {
        setOwnerCommandBusy(false);
      }
    }
  };

  const deletePersistedView = async (viewId: string, baseRevision: number) => {
    if (!commands || !viewStateAvailability.delete) return;
    const mutationGeneration = workspaceMutationGeneration.current;
    setPersistedViewBusy(`delete:${viewId}`);
    setPersistedViewError(null);
    try {
      await commands.invoke(WORKSPACE_VIEW_STATE_COMMANDS.delete, {
        workspaceId: workspace.workspace_id,
        viewId,
        baseRevision,
      });
      if (mutationGeneration !== workspaceMutationGeneration.current) return;
      await refreshAfterViewStateMutation();
      if (mutationGeneration !== workspaceMutationGeneration.current) return;
    } catch (error) {
      if (mutationGeneration !== workspaceMutationGeneration.current) return;
      const classification = classifyWorkspacePersistedViewMutationError(error);
      if (classification.kind === "REVISION_CONFLICT") {
        try {
          await refreshAfterViewStateMutation();
          if (mutationGeneration !== workspaceMutationGeneration.current) return;
          setPersistedViewError("Сохранённое представление изменилось в другой операции. Данные обновлены; проверьте актуальное состояние и повторите действие явно.");
        } catch (refreshError) {
          setPersistedViewError(`Конфликт версии; автоматический повтор запрещён. Не удалось обновить данные: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
        }
      } else {
        setPersistedViewError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mutationGeneration === workspaceMutationGeneration.current) {
        setPersistedViewBusy(null);
      }
    }
  };

  return (
    <section
      aria-labelledby="rich-workspace-title"
      className="space-y-4 border border-slate-800 rounded p-4 bg-slate-950/30"
      data-testid="rich-workspace-read-model"
    >
      <header className="space-y-1">
        <h4 id="rich-workspace-title" className="text-sm font-medium text-slate-100">Единая рабочая область</h4>
        <p className="text-xs text-slate-400">
          Один Workspace · logical areas, bounded master/detail, рабочие виды и история без нового business write path.
        </p>
      </header>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs text-slate-400" data-testid="rich-workspace-metadata">
        <dt>Workspace</dt><dd className="text-slate-200 break-all"><code>{model.workspaceId}</code></dd>
        <dt>Профиль</dt><dd className="text-slate-200 break-all"><code>{model.profileId}</code></dd>
        <dt>Объектов</dt><dd className="text-slate-200">{model.metadata.objectCount}</dd>
        <dt>Событий</dt><dd className="text-slate-200">{model.metadata.eventCount}</dd>
      </dl>

      <div className="grid gap-2 sm:grid-cols-3" data-testid="rich-workspace-dashboard">
        <div className="border border-slate-800 rounded p-2 text-xs"><span className="block text-slate-500">Текущий срез</span><strong className="text-slate-200">{results.length} объектов</strong></div>
        <div className="border border-slate-800 rounded p-2 text-xs"><span className="block text-slate-500">Логических очередей</span><strong className="text-slate-200">{queues.length}</strong></div>
        <div className="border border-slate-800 rounded p-2 text-xs"><span className="block text-slate-500">Object selection</span><strong className="text-slate-200">{selectedObjectIds.length}</strong></div>
      </div>

      <div className="space-y-2" data-testid="rich-workspace-logical-areas">
        <h5 className="text-xs font-medium text-slate-200">Логические области</h5>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Фильтр по логической области">
          <button type="button" aria-pressed={areaId === null} onClick={() => applyArea(null)} className="px-3 py-1.5 text-xs rounded bg-slate-800 min-h-[44px]">Все</button>
          {model.logicalAreas.map((area) => (
            <button key={area.id} type="button" aria-pressed={areaId === area.id} onClick={() => applyArea(area.id)} className="px-3 py-1.5 text-xs rounded bg-slate-800 min-h-[44px]" data-testid="rich-workspace-area">
              {area.title} · {area.objectCount}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2" data-testid="rich-workspace-omnibar">
        <label className="block text-xs text-slate-300" htmlFor="rich-workspace-query">Поиск по ID и типу объекта</label>
        <input id="rich-workspace-query" aria-label="Поиск по ID и типу объекта" value={query} onChange={(event) => applyQuery(event.target.value)} placeholder="object_id или schema_id" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 min-h-[44px]" />
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Режим рабочей области" data-testid="rich-workspace-modes">
        {([["browse", "Объекты"], ["queues", "Очереди"], ["compare", "Сравнение"], ["receipts", "Receipts"]] as const).map(([value, title]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className="px-3 py-1.5 text-xs rounded border border-slate-700 min-h-[44px]">{title}</button>
        ))}
      </nav>

      {mode === "browse" ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]" data-testid="rich-workspace-master-detail">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span data-testid="rich-workspace-window-status">{windowed.total === 0 ? "0 из 0" : `${windowed.start}–${windowed.end} из ${windowed.total}`}</span>
              <span>· окно до {windowed.size}</span>
              <span className="ml-auto flex gap-1">
                <button type="button" disabled={!windowed.hasPrevious} onClick={() => setWindowOffset(Math.max(0, windowed.offset - windowed.size))} className="px-3 py-1.5 rounded border border-slate-700 min-h-[44px] disabled:opacity-40">Назад</button>
                <button type="button" disabled={!windowed.hasNext} onClick={() => setWindowOffset(windowed.offset + windowed.size)} className="px-3 py-1.5 rounded border border-slate-700 min-h-[44px] disabled:opacity-40">Далее</button>
              </span>
            </div>
            {windowed.items.length === 0 ? (
              <p className="text-xs text-slate-500" role="status">Совпадений нет.</p>
            ) : (
              <ul className="divide-y divide-slate-800 border border-slate-800 rounded">
                {windowed.items.map((object) => {
                  const checked = selectedObjectIds.includes(object.object_id);
                  return (
                    <li key={object.object_id} className="p-2 flex flex-wrap items-center gap-2 text-xs" data-testid="rich-workspace-master-item">
                      <label className="flex items-center gap-1 text-slate-500"><input type="checkbox" checked={checked} onChange={() => toggleSelectedObject(object.object_id)} aria-label={`Выбрать ${object.object_id}`} />select</label>
                      <button type="button" onClick={() => setDetailState({ workspaceId: workspace.workspace_id, objectId: object.object_id })} className="min-w-0 flex-1 text-left" aria-label={`Показать детали ${object.object_id}`}>
                        <code className="block break-all text-slate-200">{object.object_id}</code><span className="text-slate-500">{object.schema_id} · rev {object.revision}</span>
                      </button>
                      <button type="button" onClick={() => onOpenObject(workspace.workspace_id, object.object_id)} className="px-3 py-1.5 rounded bg-slate-800 min-h-[44px]">Открыть</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <aside className="border border-slate-800 rounded p-3 text-xs space-y-2" data-testid="rich-workspace-detail">
            <h5 className="font-medium text-slate-200">Детали canonical object</h5>
            {selectedDetail ? (
              <>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-slate-500">
                  <dt>object_id</dt><dd className="text-slate-200 break-all"><code>{selectedDetail.object_id}</code></dd>
                  <dt>schema_id</dt><dd className="text-slate-200 break-all"><code>{selectedDetail.schema_id}</code></dd>
                  <dt>workspace_id</dt><dd className="text-slate-200 break-all"><code>{selectedDetail.workspace_id}</code></dd>
                  <dt>revision</dt><dd className="text-slate-200">{selectedDetail.revision}</dd>
                </dl>
                <button type="button" onClick={() => onOpenObject(workspace.workspace_id, selectedDetail.object_id)} className="px-3 py-1.5 rounded bg-slate-800 min-h-[44px]">Открыть объект</button>
              </>
            ) : <p className="text-slate-500">Выберите объект в master-списке. Детальная панель не создаёт отдельную копию данных.</p>}
          </aside>
        </div>
      ) : null}

      {ownerCommandDescriptors.length > 0 ? (
        <div className="border border-slate-800 rounded p-3 space-y-2 text-xs" data-testid="rich-workspace-owner-commands">
          <div>
            <h5 className="font-medium text-slate-200">Команды выбранных объектов</h5>
            <p className="text-[11px] text-slate-500">
              T2.5 P2: сначала metadata-only preflight по exact revision, затем отдельное явное выполнение через owner CommandRegistry.
            </p>
          </div>
          <ul className="space-y-1">
            {ownerCommandPreflights.map(({ descriptor, preflight }) => (
              <li key={descriptor.id} className="flex flex-wrap items-center gap-2 border border-slate-800 rounded p-2">
                <span className="text-slate-200">{descriptor.label}</span>
                <code className="text-[11px] text-slate-500">{preflight.status}</code>
                <button
                  type="button"
                  disabled={preflight.status !== "READY" || ownerCommandBusy}
                  onClick={() => preflight.status === "READY" && prepareOwnerCommand(preflight.prepared)}
                  className="ml-auto px-3 py-1.5 rounded border border-slate-700 min-h-[44px] disabled:opacity-40"
                  aria-label={`Подготовить команду ${descriptor.label}`}
                >
                  Подготовить
                </button>
              </li>
            ))}
          </ul>
          {preparedCommand ? (
            <div className="border border-emerald-900/50 rounded p-2 space-y-2" data-testid="rich-workspace-prepared-owner-command">
              <p className="text-slate-300">
                Подготовлено: <strong>{preparedCommand.label}</strong> · {preparedCommand.draft.objects.length} object(s).
              </p>
              {!preparedCommandCurrent ? (
                <p className="text-amber-200" role="status">Подготовленная команда устарела после изменения Workspace/selection/revision.</p>
              ) : (
                <button
                  type="button"
                  disabled={ownerCommandBusy}
                  onClick={() => void executePreparedOwnerCommand()}
                  className="px-3 py-1.5 rounded bg-emerald-800 min-h-[44px] disabled:opacity-40"
                  aria-label={`Выполнить подготовленную команду ${preparedCommand.label}`}
                >
                  {ownerCommandBusy ? "Выполняется…" : "Выполнить явно"}
                </button>
              )}
            </div>
          ) : null}
          {ownerCommandError ? <p role="alert" className="text-rose-200">{ownerCommandError}</p> : null}
          {ownerCommandCompleted ? <p role="status" className="text-emerald-200">Команда выполнена через owner path: {ownerCommandCompleted}.</p> : null}
        </div>
      ) : null}

      {mode === "queues" ? (
        <div className="space-y-2" data-testid="rich-workspace-queues">
          <div><h5 className="text-xs font-medium text-slate-200">Логические очереди</h5><p className="text-[11px] text-slate-500">Только derived grouping по schema_id текущего среза. Очереди не являются persisted объектами и не владеют write path.</p></div>
          {queues.length === 0 ? <p className="text-xs text-slate-500" role="status">В текущем срезе очередей нет.</p> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {queues.map((queue) => (
                <li key={queue.id} className="border border-slate-800 rounded p-3 text-xs space-y-2">
                  <div className="flex items-baseline gap-2"><code className="text-slate-200 break-all">{queue.schemaId}</code><span className="ml-auto text-slate-500">{queue.objectCount}</span></div>
                  <p className="text-[11px] text-slate-500 break-all">{queue.objectIds.slice(0, 6).join(", ")}{queue.objectIds.length > 6 ? " …" : ""}</p>
                  <button type="button" onClick={() => { applyQuery(queue.schemaId); setMode("browse"); }} className="px-3 py-1.5 rounded border border-slate-700 min-h-[44px]">Показать в списке</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {mode === "compare" ? (
        <div className="space-y-2" data-testid="rich-workspace-compare">
          <div><h5 className="text-xs font-medium text-slate-200">Сравнение метаданных</h5><p className="text-[11px] text-slate-500">Preview доступен только для ровно двух canonical objects. Payload, merge и write-операции не выполняются.</p></div>
          {comparePreview.status !== "READY" ? (
            <p className="text-xs text-slate-500" role="status">Выберите ровно два объекта в режиме «Объекты». Сейчас выбрано: {comparePreview.selectedCount}.</p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-xs border-collapse"><thead><tr className="text-left text-slate-500"><th className="p-2 border border-slate-800">Поле</th>{comparePreview.items.map((item) => <th key={item.objectId} className="p-2 border border-slate-800 break-all"><code>{item.objectId}</code></th>)}</tr></thead><tbody>
              {([["schema_id", comparePreview.items.map((item) => item.schemaId)], ["workspace_id", comparePreview.items.map((item) => item.workspaceId)], ["revision", comparePreview.items.map((item) => String(item.revision))]] as const).map(([label, values]) => (
                <tr key={label}><th className="p-2 border border-slate-800 text-left text-slate-500">{label}</th>{values.map((value, index) => <td key={`${label}:${index}`} className="p-2 border border-slate-800 text-slate-200 break-all"><code>{value}</code></td>)}</tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      ) : null}

      {mode === "receipts" ? (
        <div className="border border-amber-900/60 rounded p-3 space-y-1 text-xs" data-testid="rich-workspace-receipts-boundary">
          <h5 className="font-medium text-amber-200">Receipts недоступны в global view</h5>
          <p className="text-slate-500">Fail-closed: текущий canonical runtime не объявляет глобальный receipt index/support. Rich Workspace не строит его из локальных предположений.</p>
          <code className="block text-[11px] text-slate-500">{RICH_WORKSPACE_RECEIPTS_BOUNDARY.status}</code>
        </div>
      ) : null}

      <div className="space-y-3" data-testid="rich-workspace-saved-view-previews">
        <div className="space-y-1"><h5 className="text-xs font-medium text-slate-200">Представления</h5><p className="text-[11px] text-slate-500">Профильные представления можно применять сразу. Persisted Saved View остаётся у существующего owner; эти рабочие виды живут только в памяти текущей вкладки.</p></div>
        <div className="grid gap-2 sm:grid-cols-2">
          {model.savedViewPreviews.map((view) => (
            <button key={view.id} type="button" onClick={() => applyWorkingView({ logicalAreaId: view.logicalAreaId, query: "" })} aria-label={`Открыть профильное представление ${view.id}`} className="min-h-[44px] border border-slate-800 rounded p-2 text-left text-xs" data-testid="rich-workspace-profile-view">
              <span className="block text-slate-200">{view.title}</span><span className="block text-[11px] text-slate-500">{view.objectIds.length} объектов · открыть вид</span>
            </button>
          ))}
        </div>
        <div className="border border-slate-800 rounded p-3 space-y-2" data-testid="rich-workspace-working-views">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[14rem] text-xs text-slate-300">Название рабочего вида<input value={workingViewTitle} onChange={(event) => setWorkingViewTitleState({ workspaceId: workspace.workspace_id, value: event.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 min-h-[44px]" placeholder="Например: Заметки по текущему поиску" /></label>
            <button type="button" disabled={!workingViewTitle.trim()} onClick={createWorkingView} className="px-3 py-1.5 text-xs rounded bg-slate-800 min-h-[44px] disabled:opacity-40">Вид на эту вкладку</button>
            {viewStateAvailability.save && <button type="button" disabled={!workingViewTitle.trim() || persistedViewBusy !== null} onClick={() => void persistCurrentView()} className="px-3 py-1.5 text-xs rounded bg-emerald-800 min-h-[44px] disabled:opacity-40">Сохранить в Workspace</button>}
          </div>
          <p className="text-[11px] text-slate-500">Текущий снимок: область {areaId ?? "все"}; поиск {query.trim() ? `«${query.trim()}»` : "без поиска"}. Локальный вид живёт только в текущей вкладке; persisted вид проходит через owner command.</p>
          {persistedViewError && <p role="alert" className="text-xs text-rose-200" data-testid="rich-workspace-persisted-view-error">Не удалось изменить сохранённое представление: {persistedViewError}</p>}
          {persistedViews.views.length > 0 && (
            <div className="space-y-1" data-testid="rich-workspace-persisted-views">
              <h6 className="text-xs font-medium text-slate-200">Сохранённые в Workspace</h6>
              <ul className="space-y-1">{persistedViews.views.map((view) => (
                <li key={view.viewId} className="flex flex-wrap items-center gap-2 border border-emerald-900/50 rounded p-2 text-xs" data-testid="rich-workspace-persisted-view">
                  <span className="text-slate-200">{view.title}</span><span className="text-[11px] text-slate-500">область {view.logicalAreaId ?? "все"}{view.query ? ` · поиск «${view.query}»` : ""}</span>
                  <span className="ml-auto flex gap-1"><button type="button" onClick={() => applyWorkingView(view)} className="px-3 py-1.5 rounded bg-slate-800 min-h-[44px]" aria-label={`Применить сохранённый вид ${view.title}`}>Применить</button>{viewStateAvailability.delete && <button type="button" disabled={persistedViewBusy !== null} onClick={() => void deletePersistedView(view.viewId, view.baseRevision)} className="px-3 py-1.5 rounded border border-slate-700 min-h-[44px] disabled:opacity-40" aria-label={`Удалить сохранённый вид ${view.title}`}>Удалить</button>}</span>
                </li>
              ))}</ul>
            </div>
          )}
          {persistedViews.rejected > 0 && <p role="status" className="text-[11px] text-amber-200">Некорректные internal view-state records скрыты: {persistedViews.rejected}.</p>}
          {workingViews.length === 0 ? <p className="text-xs text-slate-500" role="status">Рабочих видов в этой сессии пока нет.</p> : (
            <ul className="space-y-1">{workingViews.map((view) => (
              <li key={view.id} className="flex flex-wrap items-center gap-2 border border-slate-800 rounded p-2 text-xs" data-testid="rich-workspace-working-view">
                <span className="text-slate-200">{view.title}</span><span className="text-[11px] text-slate-500">область {view.logicalAreaId ?? "все"}{view.query ? ` · поиск «${view.query}»` : ""}</span>
                <span className="ml-auto flex gap-1"><button type="button" onClick={() => applyWorkingView(view)} className="px-3 py-1.5 rounded bg-slate-800 min-h-[44px]" aria-label={`Применить рабочий вид ${view.title}`}>Применить</button><button type="button" onClick={() => removeWorkingView(view.id)} className="px-3 py-1.5 rounded border border-slate-700 min-h-[44px]" aria-label={`Удалить рабочий вид ${view.title}`}>Удалить</button></span>
              </li>
            ))}</ul>
          )}
        </div>
      </div>

      <div className="space-y-2" data-testid="rich-workspace-timeline">
        <div className="flex flex-wrap items-baseline gap-2"><h5 className="text-xs font-medium text-slate-200">Лента событий</h5><span className="text-[11px] text-amber-200">Порядок показа не является семантическим порядком событий.</span></div>
        <p className="text-[11px] text-slate-500">Runtime 1.2 не предоставляет отдельные effective-time / knowledge-time; они не подменяются occurred_at.</p>
        {!eventsAvailable ? <p className="text-xs text-slate-500" role="status">События не предоставлены ядром в текущем режиме.</p> : model.timeline.length === 0 ? <p className="text-xs text-slate-500">Событий нет.</p> : (
          <ul className="divide-y divide-slate-800 border border-slate-800 rounded">
            {model.timeline.map((event) => (
              <li key={event.eventId} className="p-2 text-xs space-y-1" data-testid="rich-workspace-event">
                <div className="flex flex-wrap gap-2"><code className="text-slate-200">{event.eventType}</code><span className="ml-auto text-slate-500">{formatWorkspaceDate(event.occurredAt)}</span></div>
                <div className="text-[11px] text-slate-500 break-all">event <code>{event.eventId}</code> · service <code>{event.serviceId}</code>{event.objectId ? <> · object <code>{event.objectId}</code></> : null}</div>
                {(event.causationId || event.correlationId) && <div className="text-[11px] text-slate-500 break-all">{event.causationId ? <>causation <code>{event.causationId}</code></> : null}{event.causationId && event.correlationId ? " · " : null}{event.correlationId ? <>correlation <code>{event.correlationId}</code></> : null}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(model.rejectedObjectCount > 0 || model.rejectedEventCount > 0) && <p role="status" className="text-xs text-amber-200" data-testid="rich-workspace-rejected-inputs">Часть входных записей исключена из-за нарушения Workspace/ID границ: objects {model.rejectedObjectCount}, events {model.rejectedEventCount}.</p>}
    </section>
  );
}
