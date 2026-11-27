import { useMemo, useState } from "react";
import type { ObjectRecord } from "../../../../kernel-client";
import {
  captureWorkspaceMethodMaterials,
  inspectWorkspaceMethodMaterials,
  analyseWorkspaceMethodMaterialImpact,
  prepareWorkspaceMethodPreview,
  reuseWorkspaceMethodPreview,
  WORKSPACE_METHOD_MAX_STEPS,
  type WorkspaceMethodActor,
  type WorkspaceMethodDraft,
  type WorkspaceMethodStep,
  type WorkspaceMethodPreview,
  type WorkspaceMethodStageImpact,
} from "./workspace-project-method.mjs";

const field = "mt-1 block w-full min-w-0 rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-100 min-h-[44px]";
const button = "px-3 py-1.5 min-h-[44px] rounded border border-slate-700 text-xs disabled:opacity-40";
const actorLabels: Record<WorkspaceMethodActor,string> = {
  human: "Человек", agent: "Помощник", program: "Программа",
};
const errorLabels: Record<string,string> = {
  METHOD_FIELD_INVALID: "Заполните название, цель и названия этапов. Проверьте допустимую длину полей.",
  METHOD_ID_INVALID: "Некорректный идентификатор проекта или этапа.",
  METHOD_ID_UNAVAILABLE: "Не удалось выделить идентификатор черновика.",
  METHOD_SELECTION_INVALID: "Повторяющиеся или слишком многочисленные ссылки.",
  METHOD_ACTOR_INVALID: "Неизвестный участник этапа.",
  METHOD_STEP_LIMIT: "Методика должна содержать от 1 до 64 этапов.",
  METHOD_DUPLICATE_STEP: "Повторяется идентификатор этапа.",
  METHOD_DEPENDENCY_INVALID: "Предшествующий этап отсутствует или ссылается на себя.",
  METHOD_DEPENDENCY_CYCLE: "Обнаружен цикл зависимостей. Измените предшествующие этапы.",
  METHOD_MATERIAL_REVIEW_REQUIRED: "Редакции материалов изменились или недоступны. Проверьте полотно и явно примите актуальный набор.",
  METHOD_MATERIAL_UNBOUND: "У этапа есть материал вне текущего набора. Уберите ссылку или добавьте материал на полотно.",
  METHOD_PREVIEW_INVALID: "Эта структура не соответствует поддерживаемому предпросмотру методики.",
  VIEW_STATE_PRESENTATION_INVALID: "Некорректный набор материалов.",
  VIEW_STATE_SELECTION_CHANGED: "Материал не доступен в актуальной редакции.",
};
function message(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return errorLabels[code] ?? "Проверьте структуру и исходные материалы.";
}

export function WorkspaceMethodEditor(props: {
  workspaceId: string;
  draft: WorkspaceMethodDraft;
  objects: readonly ObjectRecord[];
  selectedObjectIds: readonly string[];
  selectionNeedsReview: boolean;
  onChange: (draft: WorkspaceMethodDraft) => void;
}) {
  const { draft, objects, workspaceId, selectedObjectIds, selectionNeedsReview, onChange } = props;
  const [focus, setFocus] = useState(draft.steps[0]?.id ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reuseText, setReuseText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const current = draft.steps.find(step => step.id === focus) ?? draft.steps[0];
  const byId = useMemo(() => new Map(draft.steps.map(step => [step.id,step])), [draft.steps]);
  const pins = useMemo(() => new Map(draft.materials.map(ref => [ref.object_id,ref])), [draft.materials]);
  const materialStatus = useMemo(() => {
    try { return inspectWorkspaceMethodMaterials({workspaceId,objects,materials:draft.materials}); }
    catch { return null; }
  }, [workspaceId,objects,draft.materials]);
  const impact = useMemo(() => {
    if (!previewOpen) return null;
    try { return analyseWorkspaceMethodMaterialImpact({workspaceId,objects,draft}); }
    catch { return null; }
  }, [previewOpen,workspaceId,objects,draft]);
  const plan = useMemo(() => {
    if (!previewOpen) return null;
    try {
      return { result: prepareWorkspaceMethodPreview({workspaceId,objects,draft}), error: "" };
    } catch (err) {
      return { result: null, error: message(err) };
    }
  }, [previewOpen,workspaceId,objects,draft]);
  const update = (patch: Partial<WorkspaceMethodDraft>) => {
    onChange({...draft,...patch}); setError(""); setNotice("");
  };
  const updateStep = (step: WorkspaceMethodStep, patch: Partial<WorkspaceMethodStep>) =>
    update({steps: draft.steps.map(item => item.id === step.id ? {...item,...patch} : item)});
  const addStep = () => {
    if (draft.steps.length >= WORKSPACE_METHOD_MAX_STEPS) return;
    let n = 1;
    while (byId.has("step-"+n)) n += 1;
    const id = "step-"+n;
    update({steps:[...draft.steps,{id,name:"",actor:"human",instruction:"",dependsOn:[],materialIds:[]}]});
    setFocus(id);
  };
  const moveStep = (stepId: string, delta: -1|1) => {
    const steps = [...draft.steps], at = steps.findIndex(step => step.id === stepId), next = at+delta;
    if (at < 0 || next < 0 || next >= steps.length) return;
    [steps[at],steps[next]] = [steps[next],steps[at]];
    update({steps});
  };
  const removeStep = (stepId: string) => {
    if (draft.steps.length <= 1 || draft.steps.some(step => step.dependsOn.includes(stepId))) return;
    const steps = draft.steps.filter(step => step.id !== stepId);
    update({steps}); setFocus(steps[0]?.id ?? "");
  };
  const capture = () => {
    if (selectionNeedsReview) return;
    try {
      const materials = captureWorkspaceMethodMaterials({workspaceId,objects,selectedObjectIds});
      update({materials});
    } catch (err) { setError(message(err)); }
  };
  const reuseStructure = (preview: unknown) => {
    try {
      const replacement = reuseWorkspaceMethodPreview({workspaceId,preview});
      onChange(replacement); setFocus(replacement.steps[0]?.id ?? "");
      setReuseText(""); setPreviewOpen(false); setError("");
      setNotice("Подготовлена новая работа по той же структуре. Материалы необходимо выбрать заново.");
    } catch (err) { setError(message(err)); setNotice(""); }
  };
  const reuse = () => {
    if (!reuseText.trim() || reuseText.length > 2_000_000) return;
    try { reuseStructure(JSON.parse(reuseText)); }
    catch (err) { setError(message(err)); }
  };
  const reuseCurrent = (preview: WorkspaceMethodPreview) => reuseStructure(preview);
  const impactLabels: Record<WorkspaceMethodStageImpact["state"],string> = {
    MATERIAL_REVIEW_REQUIRED: "Изменились материалы",
    DEPENDENCY_REVIEW_REQUIRED: "Затронуты предшественники",
    NO_DECLARED_MATERIAL_CHANGE: "По заданным связям изменений нет",
  };
  const canDelete = current && draft.steps.length > 1 && !draft.steps.some(step => step.dependsOn.includes(current.id));
  const currentIndex = current ? draft.steps.findIndex(step => step.id === current.id) : -1;
  return <section className="space-y-3 rounded border border-emerald-900/60 p-3 min-w-0" aria-label="Методика работы" data-testid="workspace-method-editor">
    <div>
      <h5 className="text-sm font-semibold text-slate-100">Методика работы</h5>
      <p className="text-xs text-slate-400">Спроектируйте последовательность этапов и свяжите их с материалами полотна. Это черновик проекта в текущей сессии, не запущенная задача. Сохранение и запуск работ требуют исходного владельца Project/Process или Agent.</p>
    </div>
    <div className="grid gap-2 lg:grid-cols-2">
      <label className="text-xs text-slate-300">Название проекта<input value={draft.name} maxLength={240} className={field}
        onChange={event => update({name:event.target.value})} /></label>
      <label className="text-xs text-slate-300">Области применения (через запятую)<input value={draft.domainApplicability.join(",")} maxLength={1000} className={field}
        onChange={event => update({domainApplicability:event.target.value.split(",")})} /></label>
    </div>
    <label className="block text-xs text-slate-300">Цель работы<textarea rows={2} value={draft.objective} maxLength={4000} className={field}
      onChange={event => update({objective:event.target.value})} /></label>
    <div className="flex flex-wrap items-center gap-2 border border-slate-800 p-2 rounded">
      <div className="flex-1 min-w-0"><p className="text-xs text-slate-200">Материалы методики: {draft.materials.length}</p>
        <p className="text-xs text-slate-400">Выбрано на полотне: {selectedObjectIds.length}. Привязки фиксируют редакции; содержимое не копируется.</p></div>
      <button type="button" className={button} disabled={selectionNeedsReview} onClick={capture}>Принять текущий выбор полотна</button>
    </div>
    {materialStatus && materialStatus.some(item=>item.state!=="CURRENT") && <div className="space-y-1 rounded border border-amber-900/60 p-2" data-testid="workspace-method-material-changes">
      <p role="status" className="text-xs text-amber-200">Материалы требуют проверки. Сохранённые редакции не заменены автоматически.</p>
      <ul className="space-y-1 max-h-40 overflow-y-auto">{materialStatus.filter(item=>item.state!=="CURRENT").map(item=><li key={item.object_id} className="text-xs break-all">
        {item.object_id} · ред. {item.revision} {item.state==="CHANGED" ? "→ "+item.currentRevision : "· недоступен"}
      </li>)}</ul>
    </div>}
    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
      <div className="min-w-0 space-y-2">
        <div className="flex items-center flex-wrap gap-2">
          <h6 className="mr-auto text-xs font-medium text-slate-200">Этапы · {draft.steps.length}</h6>
          <button type="button" className={button} disabled={draft.steps.length >= WORKSPACE_METHOD_MAX_STEPS} onClick={addStep}>Добавить этап</button>
        </div>
        <ol className="space-y-1 max-h-[350px] overflow-y-auto" aria-label="Этапы методики">
          {draft.steps.map((step,i) => <li key={step.id}>
            <button type="button" aria-pressed={step.id === current?.id} onClick={() => setFocus(step.id)}
              className={`w-full text-left p-2 rounded border min-h-[44px] ${step.id===current?.id?"border-emerald-600":"border-slate-800"}`}>
              <span className="block text-xs text-slate-100 break-words">{i+1}. {step.name || "Новый этап"}</span>
              <span className="text-[11px] text-slate-400">{actorLabels[step.actor]} · предшественников {step.dependsOn.length}</span>
            </button>
          </li>)}
        </ol>
      </div>
      {current && <div className="space-y-2 min-w-0 rounded border border-slate-800 p-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={currentIndex===0} onClick={()=>moveStep(current.id,-1)}>Выше</button>
          <button type="button" className={button} disabled={currentIndex===draft.steps.length-1} onClick={()=>moveStep(current.id,1)}>Ниже</button>
          <button type="button" className={button} disabled={!canDelete} onClick={()=>removeStep(current.id)}>Удалить этап</button>
        </div>
        {!canDelete && <p className="text-[11px] text-slate-400">Нельзя удалить последний этап или этап, на который ссылаются другие.</p>}
        <label className="block text-xs text-slate-300">Название этапа<input value={current.name} maxLength={240} className={field}
          onChange={event=>updateStep(current,{name:event.target.value})} /></label>
        <label className="block text-xs text-slate-300">Предполагаемый участник<select value={current.actor} className={field}
          onChange={event=>updateStep(current,{actor:event.target.value as WorkspaceMethodActor})}>
          {Object.entries(actorLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="block text-xs text-slate-300">Что сделать и получить<textarea value={current.instruction} rows={3} maxLength={8000} className={field}
          onChange={event=>updateStep(current,{instruction:event.target.value})}/></label>
        <div className="space-y-1">
          <h6 className="text-xs text-slate-200">Предшествующие этапы</h6>
          <p className="text-[11px] text-slate-400">Порядок в списке не создаёт зависимости. Здесь задаются связи «завершение → начало».</p>
          {current.dependsOn.map(id=><div key={id} className="flex flex-wrap items-center gap-1 text-xs">
            <span className="flex-1 break-words">{byId.get(id)?.name || id}</span>
            <button type="button" className={button} aria-label={"Убрать зависимость "+id}
              onClick={()=>updateStep(current,{dependsOn:current.dependsOn.filter(value=>value!==id)})}>Убрать</button>
          </div>)}
          <select aria-label="Добавить предшествующий этап" value="" className={field} onChange={event=>{
            const id=event.target.value;
            if(id && id!==current.id && !current.dependsOn.includes(id) && byId.has(id)) updateStep(current,{dependsOn:[...current.dependsOn,id]});
          }}><option value="">Добавить зависимость</option>
            {draft.steps.filter(step=>step.id!==current.id&&!current.dependsOn.includes(step.id)).map(step=><option key={step.id} value={step.id}>{step.name||step.id}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <h6 className="text-xs text-slate-200">Материалы этапа</h6>
          {current.materialIds.map(id=><div key={id} className="flex items-center flex-wrap gap-1 text-xs">
            <span className="flex-1 break-all">{id} · {pins.has(id)?"ред. "+pins.get(id)?.revision:"вне текущего набора"}</span>
            <button type="button" className={button} aria-label={"Убрать материал этапа "+id}
              onClick={()=>updateStep(current,{materialIds:current.materialIds.filter(value=>value!==id)})}>Убрать</button>
          </div>)}
          <select aria-label="Добавить материал этапа" value="" className={field} onChange={event=>{
            const id=event.target.value;
            if(id&&pins.has(id)&&!current.materialIds.includes(id)) updateStep(current,{materialIds:[...current.materialIds,id]});
          }}><option value="">Добавить материал</option>
            {draft.materials.filter(ref=>!current.materialIds.includes(ref.object_id)).map(ref=><option key={ref.object_id} value={ref.object_id}>{ref.object_id} · ред. {ref.revision}</option>)}
          </select>
        </div>
      </div>}
    </div>
    <button type="button" className={button+" bg-emerald-900/40"} onClick={()=>setPreviewOpen(true)}>Проверить структуру</button>
    {notice && <p role="status" className="text-xs text-emerald-200">{notice}</p>}
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
    {impact?.requiresReview && <div className="space-y-2 border border-amber-900/60 p-2 rounded" data-testid="workspace-method-impact">
      <h6 className="text-xs font-medium text-slate-200">Влияние изменения материалов</h6>
      <ul className="space-y-1 max-h-72 overflow-y-auto">{impact.steps.map(item=><li key={item.stepId} className="text-xs rounded border border-slate-800 p-2">
        <strong className="block break-words">{byId.get(item.stepId)?.name || item.stepId}</strong>
        <span className={item.state==="NO_DECLARED_MATERIAL_CHANGE" ? "text-slate-400" : "text-amber-200"}>{impactLabels[item.state]}</span>
        {item.materialIds.length>0 && <p className="text-[11px] break-all">Материалы: {item.materialIds.join(", ")}</p>}
        {item.predecessorIds.length>0 && <p className="text-[11px] break-words">Предшественники: {item.predecessorIds.map(id=>byId.get(id)?.name||id).join(", ")}</p>}
      </li>)}</ul>
      {impact.unassignedIssues.length>0 && <p className="text-xs text-amber-200 break-all">Изменённые материалы без указанных связей с этапами: {impact.unassignedIssues.join(", ")}.</p>}
      <p className="text-[11px] text-slate-400">Это проверка объявленных связей. Пригодность прежних результатов и право запуска не подтверждены.</p>
    </div>}
    {plan && (plan.result ? <div className="space-y-2" data-testid="workspace-method-preview">
      <p role="status" className="text-sm text-emerald-200">Структура проверена. Проект не сохранён и не запущен.</p>
      <p className="text-xs text-slate-400">Группы ниже отражают только заданные зависимости, а не расписание или разрешение исполнения.</p>
      <ol className="space-y-1">{plan.result.waves.map((wave,index)=><li key={index} className="rounded border border-slate-800 p-2 text-xs">
        <strong className="block text-slate-300">Группа {index+1}</strong>
        <span className="break-words">{wave.map(id=>byId.get(id)?.name||id).join(" · ")}</span>
      </li>)}</ol>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={()=>reuseCurrent(plan.result!.preview)}>Новая работа по этой методике</button>
        <p className="text-[11px] text-slate-400">Заменяет текущий черновик новой работой без старых привязок материалов.</p>
      </div>
      <details><summary className="text-xs cursor-pointer text-slate-300 min-h-[44px]">Исходный предпросмотр проекта для повторного использования</summary>
        <p className="text-xs text-slate-400">Это существующий формат предпросмотра Project/Process, не пакет .iwxa и не разрешение записи. Скопируйте текст, чтобы сохранить его для согласования.</p>
        <textarea aria-label="Предпросмотр проекта" value={JSON.stringify(plan.result.preview,null,2)} readOnly rows={6} className={field+" font-mono text-xs"} />
      </details>
    </div> : <p role="alert" className="text-xs text-rose-200" data-testid="workspace-method-invalid">{plan.error}</p>)}
    <details className="space-y-2">
      <summary className="cursor-pointer text-xs text-slate-300 min-h-[44px]">Повторно использовать методику</summary>
      <p className="text-xs text-slate-400">Вставьте ранее подготовленный предпросмотр. Структура заменит текущий черновик; будет выделен новый ID проекта, старые ссылки на материалы не переносятся.</p>
      <textarea aria-label="Структура прежней методики" value={reuseText} rows={3} maxLength={2_000_000} className={field}
        onChange={event=>setReuseText(event.target.value)} />
      <button type="button" className={button} disabled={!reuseText.trim()} onClick={reuse}>Заменить черновик структурой</button>
    </details>
  </section>;
}
