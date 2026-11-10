import { useEffect, useMemo, useState } from "react";
import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import type { KernelFacade } from "../../../../workspace-contract";
import {
  buildProjectProcessResultFocusOptions,
  buildProjectProcessResultOverview,
  focusProjectProcessResultEntries,
  projectWorkspaceRelationIndex,
  type RelationIndexPreset,
} from "./relation-index-model";
import {
  buildProjectProcessResultContext,
  type ProjectProcessResultContextGroupId,
} from "./project-process-context";
import { buildProjectProcessResultConnectivity } from "./project-process-connectivity";
import { findProjectProcessResultShortestPath } from "./project-process-path";
import { useWorkspaceRelationIndex } from "./useWorkspaceRelationIndex";

const PRESETS: readonly { id: RelationIndexPreset; label: string }[] = [
  { id: "all", label: "Все связи" },
  { id: "cross-schema", label: "Между разными типами" },
  { id: "same-schema", label: "Внутри одного типа" },
  { id: "project-process-result", label: "Проект / процесс / результат" },
];

const CONTEXT_GROUP_LABELS: Record<ProjectProcessResultContextGroupId, string> = {
  projects: "Проекты",
  tasks: "Задачи",
  processes: "Процессы и кейсы",
  results: "Результаты",
  actions: "Действия",
  routes: "Маршруты",
};

export function WorkspaceRelationIndex(props: {
  kernel: KernelFacade;
  workspaceId: string;
  objects: readonly ObjectRecord[];
  enabled: boolean;
  onOpenObject: (workspaceId: string, objectId: string) => void;
}) {
  const { kernel, workspaceId, objects, enabled, onOpenObject } = props;
  const controller = useWorkspaceRelationIndex({ kernel, workspaceId, objects, enabled });
  const [preset, setPreset] = useState<RelationIndexPreset>("all");
  const [kind, setKind] = useState("");
  const [focusedObjectId, setFocusedObjectId] = useState("");
  const [focusHistory, setFocusHistory] = useState<string[]>([]);
  const [pathTargetObjectId, setPathTargetObjectId] = useState("");

  useEffect(() => {
    setPreset("all");
    setKind("");
    setFocusedObjectId("");
    setFocusHistory([]);
    setPathTargetObjectId("");
  }, [workspaceId]);

  useEffect(() => {
    if (kind && controller.model && !controller.model.relationKinds.includes(kind)) {
      setKind("");
    }
  }, [controller.model, kind]);

  const activeKind = controller.model?.relationKinds.includes(kind) ? kind : "";
  const projected = useMemo(
    () =>
      controller.model
        ? projectWorkspaceRelationIndex(controller.model.entries, preset, activeKind || null)
        : [],
    [controller.model, activeKind, preset],
  );

  const focusOptions = useMemo(
    () =>
      preset === "project-process-result"
        ? buildProjectProcessResultFocusOptions(projected, objects)
        : [],
    [objects, preset, projected],
  );

  useEffect(() => {
    if (preset !== "project-process-result") {
      setFocusedObjectId("");
      setFocusHistory([]);
      setPathTargetObjectId("");
      return;
    }
    if (
      focusedObjectId &&
      !focusOptions.some((option) => option.objectId === focusedObjectId)
    ) {
      setFocusedObjectId("");
      setFocusHistory([]);
      setPathTargetObjectId("");
    }
    if (
      pathTargetObjectId &&
      !focusOptions.some((option) => option.objectId === pathTargetObjectId)
    ) {
      setPathTargetObjectId("");
    }
  }, [focusOptions, focusedObjectId, pathTargetObjectId, preset]);

  const chooseFocusedObject = (objectId: string) => {
    setFocusedObjectId(objectId);
    setFocusHistory([]);
    if (!objectId) setPathTargetObjectId("");
  };

  const focusContextObject = (objectId: string) => {
    if (!focusedObjectId || objectId === focusedObjectId) return;
    setFocusHistory((history) => [...history, focusedObjectId]);
    setFocusedObjectId(objectId);
  };

  const restorePreviousFocus = () => {
    setFocusHistory((history) => {
      const previous = history.at(-1);
      if (!previous) return history;
      setFocusedObjectId(previous);
      return history.slice(0, -1);
    });
  };

  const visible = useMemo(
    () =>
      preset === "project-process-result"
        ? focusProjectProcessResultEntries(projected, focusedObjectId || null)
        : projected,
    [focusedObjectId, preset, projected],
  );

  const projectProcessOverview = useMemo(
    () =>
      preset === "project-process-result"
        ? buildProjectProcessResultOverview(projected, objects)
        : null,
    [objects, preset, projected],
  );

  const projectProcessConnectivity = useMemo(
    () =>
      preset === "project-process-result"
        ? buildProjectProcessResultConnectivity(projected, objects, focusedObjectId || null)
        : null,
    [focusedObjectId, objects, preset, projected],
  );

  const focusedObject = useMemo(
    () =>
      focusedObjectId
        ? focusOptions.find((option) => option.objectId === focusedObjectId) ?? null
        : null,
    [focusOptions, focusedObjectId],
  );

  const focusedContext = useMemo(
    () =>
      preset === "project-process-result"
        ? buildProjectProcessResultContext(projected, objects, focusedObjectId || null)
        : null,
    [focusedObjectId, objects, preset, projected],
  );

  const focusedPath = useMemo(
    () =>
      preset === "project-process-result" && focusedObjectId && pathTargetObjectId
        ? findProjectProcessResultShortestPath(projected, objects, focusedObjectId, pathTargetObjectId)
        : null,
    [focusedObjectId, objects, pathTargetObjectId, preset, projected],
  );

  if (!enabled || controller.state === "idle") return null;
  if (controller.state === "unavailable") {
    return <section aria-labelledby="ws-relation-index" className="space-y-2" data-testid="workspace-relation-index-unavailable"><h4 id="ws-relation-index" className="text-sm font-medium text-slate-200">Индекс связей</h4><p className="text-xs text-slate-500">Детали связей не предоставлены ядром в текущем режиме.</p></section>;
  }
  if (controller.state === "loading" || !controller.model) {
    return <section aria-labelledby="ws-relation-index" className="space-y-2" data-testid="workspace-relation-index-loading"><h4 id="ws-relation-index" className="text-sm font-medium text-slate-200">Индекс связей</h4><p className="text-xs text-slate-500">Построение индекса связей…</p></section>;
  }

  const { model } = controller;
  const diagnosticTotal = Object.values(model.diagnostics).reduce((sum, value) => sum + value, 0);

  return (
    <section aria-labelledby="ws-relation-index" className="space-y-3" data-testid="workspace-relation-index">
      <div className="flex flex-wrap items-baseline gap-2"><h4 id="ws-relation-index" className="text-sm font-medium text-slate-200">Индекс связей</h4><span className="text-xs text-slate-500" data-testid="workspace-relation-index-count">{model.entries.length} проверенных связей</span></div>
      {(model.isTruncated || diagnosticTotal > 0) && <div className="text-xs text-amber-200 border border-amber-800/60 rounded p-2 space-y-1" data-testid="workspace-relation-index-diagnostics">{model.isTruncated && <p>Индекс частичный: обработаны первые 100 объектов по стабильному идентификатору.</p>}{model.diagnostics.sourceLoadFailures > 0 && <p>Ошибок чтения источников: {model.diagnostics.sourceLoadFailures}</p>}{model.diagnostics.sourceMissing > 0 && <p>Отсутствующих источников: {model.diagnostics.sourceMissing}</p>}{model.diagnostics.sourceIdentityMismatches > 0 && <p>Несовпадений идентичности источника: {model.diagnostics.sourceIdentityMismatches}</p>}{model.diagnostics.rejectedRelations > 0 && <p>Отклонённых небезопасных/несогласованных связей: {model.diagnostics.rejectedRelations}</p>}{model.diagnostics.relationIdConflicts > 0 && <p>Конфликтующих relation_id: {model.diagnostics.relationIdConflicts}</p>}</div>}
      <div className="flex flex-wrap gap-2 items-center" aria-label="Производные представления связей">{PRESETS.map((item) => <button key={item.id} type="button" aria-pressed={preset === item.id} onClick={() => setPreset(item.id)} className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 min-h-[44px]" data-testid={`relation-index-preset-${item.id}`}>{item.label}</button>)}<label className="text-xs text-slate-400 flex items-center gap-2">Тип связи<select value={activeKind} onChange={(event) => setKind(event.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 min-h-[44px]" data-testid="relation-index-kind-filter"><option value="">Все</option>{model.relationKinds.map((relationKind) => <option key={relationKind} value={relationKind}>{relationKind}</option>)}</select></label></div>

      {preset === "project-process-result" && projectProcessOverview && projectProcessConnectivity && (
        <div className="border border-slate-800 rounded p-3 space-y-3" data-testid="relation-index-project-process-overview">
          <div className="flex flex-wrap gap-3 text-xs text-slate-300"><span>{projectProcessOverview.objectCount} объектов в контуре</span><span>{projectProcessOverview.edgeCount} canonical связей</span><span>{projectProcessOverview.connectedObjectCount} связанных</span><span>{projectProcessOverview.isolatedObjectCount} без canonical связей</span></div>
          <div className="flex flex-wrap gap-3 text-[11px] text-slate-400" data-testid="relation-index-project-process-connectivity-summary"><span>{projectProcessConnectivity.componentCount} structural component</span><span>{projectProcessConnectivity.connectedObjectCount} объектов в многовершинных компонентах</span><span>{projectProcessConnectivity.isolatedObjectCount} singleton-компонент</span></div>
          {projectProcessOverview.schemaCounts.length > 0 && <ul className="flex flex-wrap gap-1" aria-label="Типы объектов в контуре">{projectProcessOverview.schemaCounts.map((item) => <li key={item.schemaId} className="text-[11px] px-2 py-1 rounded bg-slate-900 text-slate-400"><code>{item.schemaId}</code> · {item.objectCount}</li>)}</ul>}
          {focusOptions.length > 0 && <label className="text-xs text-slate-400 flex flex-wrap items-center gap-2">Фокус на объекте<select value={focusedObjectId} onChange={(event) => chooseFocusedObject(event.target.value)} className="min-w-0 max-w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 min-h-[44px]" data-testid="relation-index-project-process-focus"><option value="">Весь контур</option>{focusOptions.map((option) => <option key={option.objectId} value={option.objectId}>{option.schemaId} · {option.objectId}</option>)}</select></label>}

          {focusedObject && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-[11px] text-slate-400" data-testid="relation-index-project-process-focus-summary"><span><code>{focusedObject.schemaId}</code></span><span>{focusedObject.incomingEdgeCount} входящих</span><span>{focusedObject.outgoingEdgeCount} исходящих</span><span>{focusedObject.neighborCount} соседних объектов</span><button type="button" onClick={() => onOpenObject(workspaceId, focusedObject.objectId)} className="underline underline-offset-2 hover:text-slate-200 min-h-[44px]" data-testid="relation-index-project-process-open-focus">Открыть объект</button>{focusHistory.length > 0 && <button type="button" onClick={restorePreviousFocus} className="underline underline-offset-2 hover:text-slate-200 min-h-[44px]" data-testid="relation-index-project-process-focus-back">← Назад по графу</button>}</div>

              {projectProcessConnectivity.focusedObjectId && <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 border border-slate-800 rounded p-2" data-testid="relation-index-project-process-focused-connectivity"><span>{projectProcessConnectivity.focusedComponentObjectCount} объектов в structural component</span><span>{projectProcessConnectivity.focusedReachableObjectCount} достижимых других объектов</span><span>{projectProcessConnectivity.outsideFocusedComponentObjectCount} объектов вне компоненты</span></div>}

              <div className="border border-slate-800 rounded p-3 space-y-2 bg-slate-950/30" data-testid="relation-index-project-process-path">
                <label className="text-xs text-slate-400 flex flex-wrap items-center gap-2">Кратчайший canonical-путь к<select value={pathTargetObjectId} onChange={(event) => setPathTargetObjectId(event.target.value)} className="min-w-0 max-w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 min-h-[44px]" data-testid="relation-index-project-process-path-target"><option value="">Выберите целевой объект</option>{focusOptions.map((option) => <option key={option.objectId} value={option.objectId}>{option.schemaId} · {option.objectId}</option>)}</select></label>
                {pathTargetObjectId && focusedPath && (
                  <div className="space-y-2" data-testid="relation-index-project-process-path-result">
                    <div className="text-[11px] text-slate-400">{focusedPath.hops.length} переходов · {focusedPath.objectIds.length} объектов</div>
                    <div className="flex flex-wrap items-center gap-1" aria-label="Объекты кратчайшего canonical-пути">
                      {focusedPath.objectIds.map((objectId, index) => (
                        <span key={`${objectId}-${index}`} className="inline-flex items-center gap-1">
                          {index > 0 && <span aria-hidden="true" className="text-slate-600">→</span>}
                          <button type="button" onClick={() => focusContextObject(objectId)} className="underline underline-offset-2 hover:text-slate-200 min-h-[44px] text-[11px]" data-testid="relation-index-project-process-focus-path-object"><code>{objectId}</code></button>
                        </span>
                      ))}
                    </div>
                    {focusedPath.hops.length > 0 ? (
                      <ol className="space-y-1" data-testid="relation-index-project-process-path-hops">
                        {focusedPath.hops.map((hop, index) => {
                          const storedFromObjectId = hop.relationDirection === "forward" ? hop.fromObjectId : hop.toObjectId;
                          const storedToObjectId = hop.relationDirection === "forward" ? hop.toObjectId : hop.fromObjectId;
                          return (
                            <li key={`${hop.relationId}-${index}`} className="border border-slate-800 rounded p-2 text-[11px] text-slate-400">
                              <div><span className="text-slate-200">{index + 1}.</span> <code>{hop.relationKind}</code> · <code>{hop.relationId}</code></div>
                              <div>RelationRecord: <code>{storedFromObjectId}</code> → <code>{storedToObjectId}</code></div>
                              <div>Обход: {hop.relationDirection === "forward" ? "по направлению записи" : "против направления записи"}</div>
                            </li>
                          );
                        })}
                      </ol>
                    ) : <p className="text-[11px] text-slate-500">Целевой объект совпадает с текущим фокусом; переходы не требуются.</p>}
                  </div>
                )}
                {pathTargetObjectId && !focusedPath && <p className="text-[11px] text-slate-500" data-testid="relation-index-project-process-no-path">Между выбранными объектами нет canonical-пути в текущем видимом графе.</p>}
                <p className="text-[11px] text-slate-500">Достижимость в графе не означает порядок исполнения, зависимость, причинность или workflow-state.</p>
              </div>

              {focusedContext && <div className="border border-slate-800 rounded p-3 space-y-3 bg-slate-950/30" data-testid="relation-index-project-process-context"><div className="flex flex-wrap gap-3 text-[11px] text-slate-400"><span className="font-medium text-slate-300">Контекст объекта</span><span>рев. {focusedContext.revision}</span><span>обновлён <time dateTime={focusedContext.updatedAt}>{focusedContext.updatedAt}</time></span><span>{focusedContext.relationCount} canonical связей</span></div>{focusedContext.groups.length > 0 ? <div className="grid gap-3 lg:grid-cols-2" data-testid="relation-index-project-process-context-groups">{focusedContext.groups.map((group) => <section key={group.id} className="space-y-1" data-context-group={group.id}><h5 className="text-xs font-medium text-slate-300">{CONTEXT_GROUP_LABELS[group.id]} · {group.items.length}</h5><ul className="space-y-1">{group.items.map((item) => <li key={item.relationId} className="border border-slate-800 rounded p-2 text-[11px]"><div className="text-slate-200 break-all"><code>{item.neighborSchemaId}</code> · <code>{item.neighborObjectId}</code></div><div className="text-slate-500">{item.direction === "incoming" ? "← входящая" : "→ исходящая"} · {item.relationKind} · рев. {item.neighborRevision}</div><div className="flex flex-wrap gap-2 mt-1"><button type="button" onClick={() => focusContextObject(item.neighborObjectId)} className="underline underline-offset-2 hover:text-slate-200 min-h-[44px]" data-testid="relation-index-project-process-focus-context-object">Сфокусироваться</button><button type="button" onClick={() => onOpenObject(workspaceId, item.neighborObjectId)} className="underline underline-offset-2 hover:text-slate-200 min-h-[44px]" data-testid="relation-index-project-process-open-context-object">Открыть</button></div></li>)}</ul></section>)}</div> : <p className="text-[11px] text-slate-500" data-testid="relation-index-project-process-no-context">У выбранного объекта нет canonical-связей с объектами этого контура.</p>}</div>}
            </div>
          )}
          <p className="text-[11px] text-slate-500" data-testid="relation-index-project-process-boundary">Только уже существующие canonical RelationRecord между объявленными типами проекта, задачи, процесса/кейса и результата. Structural components описывают только связность canonical-графа и не являются стадиями процесса, execution groups, зависимостями, причинностью или workflow-state. Payload-поля не превращаются в связи автоматически.</p>
        </div>
      )}

      {visible.length === 0 ? <p className="text-xs text-slate-500" data-testid="workspace-relation-index-empty">Для выбранного представления связей нет.</p> : <ul className="divide-y divide-slate-800 border border-slate-800 rounded" data-testid="workspace-relation-index-list">{visible.map((entry) => <li key={entry.relation.relation_id} className="p-3 text-xs space-y-2"><div className="flex flex-wrap gap-2 text-slate-400"><span className="uppercase tracking-wide text-slate-200">{entry.relation.kind}</span><code className="break-all">{entry.relation.relation_id}</code></div><div className="grid sm:grid-cols-[1fr_auto_1fr] gap-2 items-center"><button type="button" onClick={() => onOpenObject(workspaceId, entry.relation.from_object_id)} className="text-left border border-slate-800 rounded p-2 hover:bg-slate-900 min-h-[44px]" data-testid="relation-index-open-from"><code className="break-all">{entry.relation.from_object_id}</code><span className="block text-slate-500">{entry.fromSchemaId}</span></button><span aria-hidden="true" className="text-slate-500">→</span><button type="button" onClick={() => onOpenObject(workspaceId, entry.relation.to_object_id)} className="text-left border border-slate-800 rounded p-2 hover:bg-slate-900 min-h-[44px]" data-testid="relation-index-open-to"><code className="break-all">{entry.relation.to_object_id}</code><span className="block text-slate-500">{entry.toSchemaId}</span></button></div></li>)}</ul>}
    </section>
  );
}
