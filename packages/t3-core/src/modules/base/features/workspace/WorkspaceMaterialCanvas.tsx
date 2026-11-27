import { useEffect, useMemo, useState } from "react";
import type { ObjectRecord, OperationId } from "../../../../kernel-client";
import type { KernelFacade } from "../../../../workspace-contract";
import type { ViewerRegistry } from "../../../../workspace-host/registries/ViewerRegistry";
import { HostViewer } from "../../../../workspace-host/rendering/HostViewer";
import { checkCanvasMaterialDetail } from "../object/object-integrity";
import { UnknownObjectPreview } from "./UnknownObjectPreview";
import { buildRichWorkspaceWindow } from "./rich-workspace-derived.mjs";
import { queryRichWorkspaceObjects } from "./rich-workspace-read-model";
import {
  projectWorkspaceCanvasMaterials,
  type WorkspaceCanvasLayout,
} from "./workspace-persisted-view-state.mjs";

const PAGE_SIZE = 6;
const PICKER_SIZE = 8;
const buttonClass = "px-3 py-1.5 rounded border border-slate-700 min-h-[44px] text-xs disabled:opacity-40";

interface ViewerContext {
  kernel?: KernelFacade;
  viewerRegistry?: ViewerRegistry;
  profileId: string;
  grantedOperations?: readonly OperationId[];
  activeCapabilities?: readonly string[];
}

type DetailRead = {
  kernel: KernelFacade;
  record: ObjectRecord;
  state: "ready";
} | {
  kernel: KernelFacade;
  record: ObjectRecord;
  state: "unavailable" | "changed";
};

function CanvasMaterialContent(props: ViewerContext & { object: ObjectRecord; detailed: boolean }) {
  const { object, detailed, kernel, viewerRegistry, profileId, grantedOperations, activeCapabilities } = props;
  const [read, setRead] = useState<DetailRead | null>(null);
  const canDetail = detailed && Boolean(kernel?.hasOperation("t1.getObject") &&
    viewerRegistry?.canResolve({ profileId, schemaId: object.schema_id,
      schemaVersion: object.schema_version, surface: "detail" }, grantedOperations, activeCapabilities));
  useEffect(() => {
    let current = true;
    setRead(null);
    if (!canDetail || !kernel) return;
    // The existing scoped kernel is the only source of a full object.
    // Do not promote the listObjects preview payload to a detail payload.
    void (async () => {
      try {
        const detail = await kernel.getObject(object.workspace_id, object.object_id);
        if (!current) return;
        if (!detail) {
          setRead({ kernel, record: object, state: "unavailable" });
        } else if (checkCanvasMaterialDetail(detail, object)) {
          setRead({ kernel, record: detail.object, state: "ready" });
        } else {
          setRead({ kernel, record: object, state: "changed" });
        }
      } catch {
        if (current) setRead({ kernel, record: object, state: "unavailable" });
      }
    })();
    return () => { current = false; };
  }, [canDetail, kernel, object]);

  const fallback = <UnknownObjectPreview object={object} />;
  const preview = viewerRegistry ? <HostViewer registry={viewerRegistry} profileId={profileId}
    schemaId={object.schema_id} schemaVersion={object.schema_version} surface="preview"
    data={object.data} grantedOperations={grantedOperations} activeCapabilities={activeCapabilities}
    fallback={fallback} allowRaw={false} /> : fallback;
  if (!detailed) return preview;
  if (!canDetail || !kernel || !viewerRegistry) {
    return <div className="space-y-2"><p role="status" className="text-xs text-slate-400">Подробное представление недоступно. Показан разрешённый краткий вид.</p>{preview}</div>;
  }
  // Check synchronously too: a late response cannot be displayed in a changed
  // session, workspace, object, revision or schema before effect cleanup.
  const admitted = read?.kernel === kernel && read.record.workspace_id === object.workspace_id
    && read.record.object_id === object.object_id && read.record.revision === object.revision
    && read.record.schema_id === object.schema_id && read.record.schema_version === object.schema_version
    ? read : null;
  if (!admitted) return <p role="status" className="text-xs text-slate-400">Загрузка материала…</p>;
  if (admitted.state !== "ready") {
    return <p role="status" className="text-xs text-amber-200">{admitted.state === "changed"
      ? "Материал изменился или не совпадает с выбранной редакцией. Обновите рабочую область."
      : "Материал недоступен для подробного чтения."}</p>;
  }
  return <HostViewer registry={viewerRegistry} profileId={profileId}
    schemaId={admitted.record.schema_id} schemaVersion={admitted.record.schema_version} surface="detail"
    data={admitted.record.data} grantedOperations={grantedOperations} activeCapabilities={activeCapabilities}
    fallback={fallback} allowRaw={false} />;
}

export function WorkspaceMaterialCanvas(props: ViewerContext & {
  workspaceId: string;
  objects: readonly ObjectRecord[];
  selectedObjectIds: readonly string[];
  layout: WorkspaceCanvasLayout;
  focusedObjectId?: string | null;
  onFocus?: (objectId: string) => void;
  editable: boolean;
  onLayout: (layout: WorkspaceCanvasLayout) => void;
  onAdd: (objectId: string) => void;
  onRemove: (objectId: string) => void;
  onMove: (objectId: string, direction: -1 | 1) => void;
  onOpenObject: (workspaceId: string, objectId: string) => void;
  onRefreshObjects?: () => Promise<void>;
}) {
  const { workspaceId, objects, selectedObjectIds, layout, editable } = props;
  const [offset, setOffset] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerOffset, setPickerOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const projection = useMemo(() => projectWorkspaceCanvasMaterials({
    workspaceId, objects, selectedObjectIds,
  }), [workspaceId, objects, selectedObjectIds]);
  const page = buildRichWorkspaceWindow(projection.items, offset, PAGE_SIZE);
  const selected = useMemo(() => new Set(selectedObjectIds), [selectedObjectIds]);
  const candidates = useMemo(() => pickerOpen ? queryRichWorkspaceObjects({
    workspaceId, objects, logicalAreas: [], logicalAreaId: null, query: pickerQuery,
  }).filter((object) => !selected.has(object.object_id)) : [], [workspaceId, objects, pickerOpen, pickerQuery, selected]);
  const picker = buildRichWorkspaceWindow(candidates, pickerOffset, PICKER_SIZE);
  const toggle = (ids: readonly string[], id: string) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
  const canEdit = editable && projection.status === "READY" && projection.unavailableCount === 0;
  const refresh = async () => {
    if (!props.onRefreshObjects || refreshing) return;
    setRefreshing(true); setRefreshError(false);
    try { await props.onRefreshObjects(); }
    catch { setRefreshError(true); }
    finally { setRefreshing(false); }
  };
  return <section className="space-y-3 min-w-0" data-testid="workspace-material-canvas" aria-label="Полотно материалов">
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-auto min-w-0">
        <h5 className="text-sm font-semibold text-slate-100">Полотно материалов</h5>
        <p className="text-xs text-slate-400">Выбрано {selectedObjectIds.length}. Содержимое открывается через штатные представления.</p>
      </div>
      <button type="button" className={buttonClass} aria-pressed={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}>Добавить материалы</button>
      {([1, 2] as const).map(columns => <button key={columns} type="button" className={buttonClass}
        disabled={!canEdit} aria-pressed={layout.columns === columns}
        onClick={() => props.onLayout({...layout, columns})}>{columns === 1 ? "Одна колонка" : "Две колонки"}</button>)}
      {props.onRefreshObjects && <button type="button" className={buttonClass} disabled={refreshing} onClick={() => void refresh()}>Обновить материалы</button>}
    </div>
    {refreshError && <p role="alert" className="text-xs text-rose-200">Не удалось обновить материалы.</p>}
    {pickerOpen && <div className="space-y-2 border border-slate-700 rounded p-3" data-testid="workspace-canvas-picker">
      <label className="block text-xs text-slate-300">Поиск материала по ID или типу
        <input className="block w-full bg-slate-950 border border-slate-700 rounded p-2 min-h-[44px]"
          value={pickerQuery} onChange={event => { setPickerQuery(event.target.value); setPickerOffset(0); }} />
      </label>
      {picker.items.length === 0 ? <p className="text-xs text-slate-400">Нет дополнительных материалов.</p> :
        <ul className="space-y-1">{picker.items.map(object => <li key={object.object_id} className="flex flex-wrap gap-2 items-center">
          <span className="flex-1 min-w-0 break-all text-xs">{object.object_id} · {object.schema_id} · рев. {object.revision}</span>
          <button type="button" className={buttonClass} disabled={!canEdit || selectedObjectIds.length >= 256}
            aria-label={`Добавить на полотно ${object.object_id}`} onClick={() => props.onAdd(object.object_id)}>Добавить</button>
        </li>)}</ul>}
      <div className="flex items-center flex-wrap gap-2 text-xs">
        <button type="button" className={buttonClass} disabled={!picker.hasPrevious} onClick={() => setPickerOffset(Math.max(0, picker.offset - picker.size))}>Назад к материалам</button>
        <span>{picker.start}–{picker.end} из {picker.total}</span>
        <button type="button" className={buttonClass} disabled={!picker.hasNext} onClick={() => setPickerOffset(picker.offset + picker.size)}>Следующие материалы</button>
      </div>
    </div>}
    {projection.status !== "READY" && <p role="alert" className="text-xs text-amber-200">Проверьте выбор: полотно поддерживает до 256 различных материалов. Измените выбор в режиме «Объекты».</p>}
    {projection.unavailableCount > 0 && <p role="alert" className="text-xs text-amber-200">Недоступно материалов: {projection.unavailableCount}. Обновите выбор перед изменением полотна.</p>}
    {projection.status === "READY" && selectedObjectIds.length === 0 && <p className="text-sm text-slate-400">Добавьте материалы из текущей рабочей области. Исполняемая задача не требуется.</p>}
    <div className={layout.columns === 2 ? "grid grid-cols-1 xl:grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}>
      {page.items.map(object => {
        const id = object.object_id, index = selectedObjectIds.indexOf(id), detailed = layout.detailed.includes(id), wide = layout.wide.includes(id);
        const focused = props.focusedObjectId === id;
        return <article key={JSON.stringify([workspaceId,id,object.revision])}
          data-testid="workspace-canvas-material" data-object-id={id} data-revision={object.revision}
          data-focused={focused}
          className={`min-w-0 border rounded p-3 space-y-2 ${focused ? "border-emerald-500" : "border-slate-700"} ${layout.columns === 2 && wide ? "xl:col-span-2" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-xs text-slate-200 break-all flex-1 min-w-0">{id}</strong>
            <span className="text-xs text-slate-400">{object.schema_id} · рев. {object.revision}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {props.onFocus && <button type="button" className={buttonClass} disabled={!canEdit} aria-pressed={focused}
              aria-label={`Выделить материал ${id}`} onClick={() => props.onFocus?.(id)}>{focused ? "Снять фокус" : "Выделить"}</button>}
            <button type="button" className={buttonClass} disabled={!canEdit || index === 0} aria-label={`Переместить выше ${id}`} onClick={() => props.onMove(id, -1)}>Выше</button>
            <button type="button" className={buttonClass} disabled={!canEdit || index === selectedObjectIds.length - 1} aria-label={`Переместить ниже ${id}`} onClick={() => props.onMove(id, 1)}>Ниже</button>
            <button type="button" className={buttonClass} disabled={!canEdit} aria-pressed={detailed}
              aria-label={`Подробный вид ${id}`} onClick={() => props.onLayout({...layout,detailed:toggle(layout.detailed,id)})}>{detailed ? "Кратко" : "Подробнее"}</button>
            {layout.columns === 2 && <button type="button" className={buttonClass} disabled={!canEdit} aria-pressed={wide}
              aria-label={`Широкая панель ${id}`} onClick={() => props.onLayout({...layout,wide:toggle(layout.wide,id)})}>{wide ? "В колонку" : "На всю ширину"}</button>}
            <button type="button" className={buttonClass} disabled={!canEdit} aria-label={`Убрать с полотна ${id}`} onClick={() => props.onRemove(id)}>Убрать</button>
          </div>
          <CanvasMaterialContent object={object} detailed={detailed} kernel={props.kernel}
            viewerRegistry={props.viewerRegistry} profileId={props.profileId}
            grantedOperations={props.grantedOperations} activeCapabilities={props.activeCapabilities} />
          <button type="button" className={buttonClass} onClick={() => props.onOpenObject(workspaceId,id)}>Открыть объект</button>
        </article>;
      })}
    </div>
    {page.total > PAGE_SIZE && <nav aria-label="Страницы полотна" className="flex items-center flex-wrap gap-2 text-xs">
      <button type="button" className={buttonClass} disabled={!page.hasPrevious} onClick={() => setOffset(Math.max(0, page.offset-page.size))}>Предыдущая страница</button>
      <span>{page.start}–{page.end} из {page.total}</span>
      <button type="button" className={buttonClass} disabled={!page.hasNext} onClick={() => setOffset(page.offset+page.size)}>Следующая страница</button>
    </nav>}
  </section>;
}
