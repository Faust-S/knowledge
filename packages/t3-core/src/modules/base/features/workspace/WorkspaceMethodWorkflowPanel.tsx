import { useEffect,useMemo,useRef,useState } from "react";
import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import type { WorkspaceMethodCreationComparison,WorkspaceMethodRevisionSelection,WorkspaceMethodOriginComparison } from "../../../../modules/base/owners/project-process-method-comparison.mjs";
import type { WorkspaceMethodReaderSelection,WorkspaceMethodStageReader,WorkspaceMethodInputOverview,WorkspaceMethodAlternativeReceipt,
  WorkspaceMethodPublishedResultRef,WorkspaceMethodHandoffPreview,WorkspaceMethodNativeInspection,
  WorkspaceMethodOverviewStage,WorkspaceMethodMaterialEvidence,WorkspaceMethodPersonalDraftReceipt,WorkspaceMethodPersonalTaskInspection,WorkspaceMethodPersonalResultSelection,WorkspaceMethodRecoveredPersonalTask,WorkspaceMethodCorporateTaskReferenceInspection,WorkspaceMethodCorporateResultSelection } from "../../../../t3/workspace-method-stage-reader.mjs";

/** Trusted Host supplies this selection only after original source readback.
 * contextEpoch changes on subject/grant/session changes. Never derive it or
 * the exact source selection from the method draft or browser persistence. */
export type WorkspaceMethodWorkflowBinding = WorkspaceMethodReaderSelection & Readonly<{
  contextEpoch:string;reader:WorkspaceMethodStageReader;nativeRecipientLabel?:string;
  // Explicit Task selection from the original Agent surface, never inferred.
  personalTaskId?:string;
  // Explicit selection from the original signed corporate Task owner.
  corporateTaskId?:string;
  // Explicit original Agent task selections for this method, supplied by
  // trusted Host composition. No second Task catalog or latest-task guess.
  personalResultSelections?:readonly WorkspaceMethodPersonalResultSelection[];
  // Exact accepted original Admin Result selection; never an Atlas publication
  // or a latest-result guess. Host supplies the original owner selection.
  corporateResultSelections?:readonly WorkspaceMethodCorporateResultSelection[];
}>;
const button="min-h-[44px] px-3 py-1.5 rounded border border-slate-700 text-xs disabled:opacity-40";
const states:Record<WorkspaceMethodOverviewStage["state"],string>={
  INPUT_REFERENCES_VERIFIED:"Входы подтверждены",
  PREDECESSOR_RESULTS_REQUIRED:"Нужны результаты предшественников",
  MATERIAL_REVIEW_REQUIRED:"Материалы требуют проверки",
};
const actorLabels={human:"Человек",agent:"Помощник",program:"Программа"} as const;
const handoffStates:Record<string,string>={
  INPUTS_PREPARED_OWNER_SELECTION_REQUIRED:"Входы подготовлены. Выберите оригинального исполнителя.",
  PRIOR_RESULTS_OBSERVED_EXACT_BINDING_REQUIRED:"Принятые результаты найдены. Требуется точная привязка входов исполнителем.",
  PERSONAL_PRIOR_RESULTS_OBSERVED_DECLARED_INPUTS_MATCHED:"Принятые задачи предшественников и их сохранённые входы сопоставлены.",
  CORPORATE_PRIOR_RESULTS_OBSERVED_SIGNED_REFERENCES_MATCHED:"Принятые результаты и подписанные ссылки предшествующих работ сопоставлены.",
  PREDECESSOR_RESULTS_REQUIRED:"Выберите принятые результаты предшественников.",
  PREDECESSOR_RESULT_REVIEW_REQUIRED:"Редакции результатов требуют проверки.",
  MATERIAL_REVIEW_REQUIRED:"Проверьте исходные материалы.",
};
const checkLabels:Record<string,string>={
  EXACT_MATERIAL_CONTENT_AND_ASSET_BINDING:"Точная привязка содержимого и вложений",
  EXACT_PREDECESSOR_RESULT_INPUT_BINDING:"Точная привязка входов предшествующих результатов",
  ORIGINAL_PERSONAL_TASK_AND_CONTEXT_BINDING:"Оригинальная личная задача и её контекст",
  ORIGINAL_SIGNED_TASK_BINDING:"Оригинальная подписанная задача",
  CURRENT_MODEL_AND_AUTHORITY:"Модель и действующие полномочия",
  EXPLICIT_PROGRAM_OPERATION_AND_ARGUMENTS:"Выбор программы, операции и параметров",
  CURRENT_CONNECTION_AND_TOOL_APPROVAL:"Подключение и подтверждение инструмента",
  HUMAN_REVIEW_AND_ORIGINAL_RESULT_OWNER:"Решение человека и оригинальный владелец результата",
};
const draftLabels:Record<WorkspaceMethodPersonalDraftReceipt['state'],string>={
  DRAFT_CONFIRMED:"Черновик Agent сохранён. Задача не запущена.",
  DRAFT_ALREADY_PRESENT:"Тот же черновик Agent найден. Задача не запущена.",
  DRAFT_OCCUPIED:"В Agent уже есть черновик или ожидающая отправка. Существующие данные сохранены.",
  DRAFT_CHANGED:"Черновик изменился при подтверждении. Существующие данные сохранены.",
  USER_CANCELLED:"Передача отменена.",OUTCOME_UNKNOWN:"Сохранение не подтверждено. Проверьте оригинальный черновик без повторной записи.",
};
const nativeLabels={AVAILABLE:"Получатель доступен для отдельного подтверждения",RECOVER_ONLY:"Требуется восстановление существующей передачи",
  OPERATION_IN_PROGRESS:"Передача уже выполняется"} as const;
const sameRef=(a:{family:string;objectId:string;recordId:string;revision:number},b:{family:string;objectId:string;recordId:string;revision:number})=>
  a.family===b.family&&a.objectId===b.objectId&&a.recordId===b.recordId&&a.revision===b.revision;
function exactOverview(report:WorkspaceMethodInputOverview,binding:WorkspaceMethodWorkflowBinding){
  const expected=new Map(binding.expected.workRefs.map(ref=>[ref.objectId,ref]));
  return report.schema==="IWXA_T2_WORKSPACE_METHOD_INPUT_OVERVIEW_V1"&&report.workspaceId===binding.workspaceId
    &&report.projectId===binding.projectId&&sameRef(report.projectRef,binding.expected.projectRef)
    &&report.completeMethodCurrentVerified===true&&report.executionAuthority===false&&report.writeAuthorized===false
    &&report.stages.length===expected.size&&new Set(report.stages.map(row=>row.stepId)).size===expected.size
    &&new Set(report.stages.map(row=>row.workRef.objectId)).size===expected.size
    &&report.stages.every(row=>{const ref=expected.get(row.workRef.objectId);return ref&&sameRef(row.workRef,ref);});
}
function exactTaskInspection(value:WorkspaceMethodPersonalTaskInspection,binding:WorkspaceMethodWorkflowBinding,
  stage:WorkspaceMethodOverviewStage,taskId:string,digest:string){
  return /^[a-f0-9]{64}$/.test(digest)&&value.state==='ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED'
    &&value.taskId===taskId&&value.candidateDigest===digest&&value.workspaceId===binding.workspaceId
    &&value.projectId===binding.projectId&&value.stepId===stage.stepId
    &&/^(personal|AREA-[0-9a-f]{18})$/.test(value.agentWorkspaceId)
    &&Number.isSafeInteger(value.nativeSystemSourceCount)&&value.nativeSystemSourceCount>=0&&value.nativeSystemSourceCount<=2
    &&/^[a-f0-9]{64}$/.test(value.nativeSystemSourcesDigest)
    &&value.declaredDraftInputsVerified===true&&value.exactInputBindingProven===false&&value.allAssetsProven===false
    &&value.workCompleted===false&&value.resultReuseProven===false&&value.executionAuthority===false&&value.writeAuthorized===false;
}
function message(error:unknown){
  const code=error&&typeof error==="object"&&"code" in error?String(error.code):"";
  if(code==="T3_METHOD_PERSONAL_TASK_MANIFEST_INVALID")return "В принятой задаче нет проверяемого исходного состава Workflow.";
  if(code==="T3_METHOD_PERSONAL_TASK_MANIFEST_SCOPE_MISMATCH")return "Задача относится к другой работе, редакции или цепочке результатов.";
  if(code==="METHOD_PERSONAL_CHAIN_SELECTION_REQUIRED")return "Выберите принятую задачу Agent для каждой предшествующей работы.";
  if(code==="METHOD_CORPORATE_CHAIN_SELECTION_REQUIRED")return "Выберите конкретный принятый результат каждой предшествующей работы в Admin Center.";
  if(/ACCEPTED_RESULT_NOT_CURRENT|APPLICATION_TASK_BINDING_INVALID/.test(code))return "Принятый результат или его задание уже не соответствуют текущей редакции.";
  if(code==="METHOD_PERSONAL_DRAFT_CONTENT_LIMIT")return "Содержимое превышает возможности редактора Agent. Оно не было сокращено.";
  if(/ATTACHMENT_UNSUPPORTED|ACTOR_UNSUPPORTED/.test(code))return "Для этих материалов или исполнителей нужен другой оригинальный маршрут.";
  return /CHANGED|STALE|MISMATCH/.test(code)?"Исходные данные изменились. Проверьте методику и материалы заново.":
    /DENIED|PERMITTED|PERMISSION|OWNER_REQUIRED/.test(code)?"Оригинальный владелец или доступ недоступен.": "Не удалось подтвердить исходные данные.";
}
// The catalog is a presentation signal only, never proof of a current
// material or permission. A change to an observed material invalidates a
// previously verified screen; the original reader must verify it again.
function materialCatalogKey(report:WorkspaceMethodInputOverview,objects:readonly ObjectRecord[]){
  const wanted=new Set(report.materials.map(row=>row.object_id));
  return JSON.stringify(objects.filter(row=>row.workspace_id===report.workspaceId&&wanted.has(row.object_id))
    .map(row=>[row.object_id,row.schema_id,row.schema_version,row.revision,!!row.deleted,row.deleted_at??null])
    .sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}
type Detail = {kind:"handoff";value:WorkspaceMethodHandoffPreview}|{kind:"native";value:WorkspaceMethodNativeInspection}
  |{kind:"material";value:WorkspaceMethodMaterialEvidence};
function bindingKey(binding:WorkspaceMethodWorkflowBinding){
  return JSON.stringify([binding.contextEpoch,binding.workspaceId,binding.projectId,binding.expected.projectRef,
    [...binding.expected.workRefs].sort((a,b)=>a.objectId.localeCompare(b.objectId)),binding.personalTaskId??null,binding.corporateTaskId??null,
    binding.personalResultSelections===undefined?null:[...binding.personalResultSelections].sort((a,b)=>a.stepId.localeCompare(b.stepId)),
    binding.corporateResultSelections===undefined?null:[...binding.corporateResultSelections].sort((a,b)=>a.stepId.localeCompare(b.stepId))]);
}
type WorkflowPanelProps={binding:WorkspaceMethodWorkflowBinding;objects:readonly ObjectRecord[];selectedObjectIds:readonly string[]};
export function WorkspaceMethodWorkflowPanel(props:WorkflowPanelProps){
  // Key remounts on exact source identity or trusted context epoch change.
  if(!props.binding.contextEpoch)return null;
  return <WorkflowAlternativeSelection key={bindingKey(props.binding)} {...props}/>;
}
function WorkflowAlternativeSelection(props:WorkflowPanelProps){
  const {binding}=props;
  const [navigation,setNavigation]=useState<{reader:WorkspaceMethodStageReader;entries:WorkspaceMethodReaderSelection[]}|null>(null);
  const entries=navigation?.reader===binding.reader?navigation.entries:[];
  const chosen=entries.at(-1);
  const active:WorkspaceMethodWorkflowBinding=chosen?{...binding,...chosen,
    personalTaskId:undefined,corporateTaskId:undefined,
    personalResultSelections:binding.personalResultSelections===undefined?undefined:[],
    corporateResultSelections:binding.corporateResultSelections===undefined?undefined:[]}:binding;
  const open=(selection:WorkspaceMethodReaderSelection)=>{
    setNavigation({reader:binding.reader,entries:[...entries,selection]});
  };
  return <div className="min-w-0 space-y-2">
    {chosen&&<button type="button" className={button} onClick={()=>setNavigation({reader:binding.reader,entries:entries.slice(0,-1)})}>
      Вернуться к исходному проекту</button>}
    <WorkflowPanel key={bindingKey(active)} {...props} binding={active} onOpenAlternative={open}/>
  </div>;
}

const comparisonFieldLabels:Record<string,string>={
  NAME:"Название",OBJECTIVE:"Цель",TEMPLATE:"Шаблон",DOMAIN_APPLICABILITY:"Области применения",
  WORK_COMPOSITION:"Состав работ",WORK_ORDER:"Порядок работ",MATERIAL_REVISIONS:"Редакции материалов",
  ACTOR:"Участник",INSTRUCTION:"Инструкция",MATERIALS:"Материалы",DEPENDENCIES:"Зависимости",
  ADDED:"Добавлена",REMOVED:"Исключена",
};
const comparisonText=(value:unknown)=>typeof value==="string"?value:
  Array.isArray(value)&&value.every(item=>typeof item==="string")?value.join(", "):"";
function sameRevisionSelection(a:WorkspaceMethodRevisionSelection,b:WorkspaceMethodRevisionSelection){
  const refs=new Map(b.workRefs.map(ref=>[ref.objectId,ref]));
  return sameRef(a.projectRef,b.projectRef)&&a.workRefs.length===refs.size
    &&a.workRefs.length===b.workRefs.length&&new Set(a.workRefs.map(ref=>ref.objectId)).size===refs.size
    &&a.workRefs.every(ref=>{const expected=refs.get(ref.objectId);return !!expected&&sameRef(ref,expected);});
}
type MethodComparison=WorkspaceMethodCreationComparison|Exclude<WorkspaceMethodOriginComparison,{state:'NO_ALTERNATIVE_ORIGIN'}>;
function MethodCreationComparison({binding}:{binding:WorkspaceMethodWorkflowBinding}){
  const [report,setReport]=useState<MethodComparison|null>(null);
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const generation=useRef(0),reader=binding.reader;
  const currentReader=useRef(reader);currentReader.current=reader;
  useEffect(()=>{
    setReport(null);setNotice("");setBusy(false);setError("");
    return ()=>{generation.current+=1;};
  },[reader]);
  if(!reader.compareCreation&&!reader.compareOrigin)return null;
  const compare=async(mode:"creation"|"origin")=>{
    const read=mode==="creation"?reader.compareCreation:reader.compareOrigin;
    if(busy||!read)return;
    const token=++generation.current;
    const current=()=>token===generation.current&&currentReader.current===reader;
    setBusy(true);setError("");setNotice("");setReport(null);
    try{
      const value=await read({workspaceId:binding.workspaceId,projectId:binding.projectId,expected:binding.expected});
      if(!current())return;
      if(value.workspaceId!==binding.workspaceId||value.currentHeadVerified!==true
          ||value.atomicSnapshot!==false||value.writeAuthorized!==false||value.executionAuthority!==false||value.resultReuseProven!==false)
        throw Error("comparison mismatch");
      if(value.state==="NO_ALTERNATIVE_ORIGIN"){
        if(mode!=="origin"||value.projectId!==binding.projectId||value.mergeAuthorized!==false
            ||!sameRevisionSelection(value.currentSelection,binding.expected))throw Error("comparison mismatch");
        setNotice("У этой методики нет исходного проекта: она не является альтернативой.");
        return;
      }
      if(!sameRevisionSelection(value.afterSelection,binding.expected))throw Error("comparison mismatch");
      if(value.comparisonBasis==="ORIGINAL_CREATION_TO_SELECTED_CURRENT"){
        if(mode!=="creation"||value.schema!=="IWXA_T2_WORKSPACE_METHOD_REVISION_COMPARISON_V1"||value.projectId!==binding.projectId
            ||value.beforeSelection.projectRef.revision!==1||value.beforeSelection.workRefs.some(ref=>ref.revision!==1))
          throw Error("comparison mismatch");
      }else if(mode!=="origin"||value.comparisonBasis!=="ORIGINAL_ALTERNATIVE_ORIGIN_TO_SELECTED_CURRENT"
          ||value.schema!=="IWXA_T2_WORKSPACE_METHOD_ALTERNATIVE_COMPARISON_V1"||value.afterProjectId!==binding.projectId
          ||value.beforeProjectId===binding.projectId||value.origin.workspaceId!==binding.workspaceId
          ||value.origin.projectId!==value.beforeProjectId||value.originCurrentHeadVerified!==false||value.mergeAuthorized!==false
          ||!sameRevisionSelection(value.beforeSelection,value.origin))throw Error("comparison mismatch");
      setReport(value);
    }catch(err){if(current()){
      const code=err&&typeof err==="object"&&"code" in err?String(err.code):"";
      setError(code==="METHOD_CREATION_REFERENCE_UNAVAILABLE"?"Исходная редакция недоступна.":message(err));
    }}finally{if(current())setBusy(false);}
  };
  return <section aria-label="Редакции методики" className="space-y-2 rounded border border-slate-800 p-2 min-w-0">
    <div className="flex flex-wrap gap-2">
      {reader.compareCreation&&<button type="button" className={button} disabled={busy} onClick={()=>void compare("creation")}>Сравнить с исходной редакцией</button>}
      {reader.compareOrigin&&<button type="button" className={button} disabled={busy} onClick={()=>void compare("origin")}>Сравнить с исходным проектом</button>}
    </div>
    {busy&&<p role="status" className="text-xs text-slate-300">Читаем сохранённые редакции…</p>}
    {notice&&<p role="status" className="text-xs text-slate-300">{notice}</p>}
    {error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
    {report&&<div data-testid={report.comparisonBasis==="ORIGINAL_CREATION_TO_SELECTED_CURRENT"?"workflow-creation-comparison":"workflow-origin-comparison"} className="space-y-2 text-xs text-slate-200">
      <p className="font-medium">{report.comparisonBasis==="ORIGINAL_CREATION_TO_SELECTED_CURRENT"?
        "Исходная редакция 1 и выбранная редакция "+report.afterSelection.projectRef.revision:
        "Исходный проект "+report.beforeProjectId+", ред. "+report.beforeSelection.projectRef.revision+" и текущий вариант, ред. "+report.afterSelection.projectRef.revision}</p>
      <p>{report.state==="UNCHANGED"?"Изменений нет.":report.state==="INDEPENDENT_IDENTITIES"?"Содержание совпадает. Проекты независимы.":report.state==="SOURCE_REBIND_ONLY"?"Изменились ссылки на редакции.":"Обнаружены изменения методики."} Изменённых работ: {report.changedStepIds.length}. Затронуто работ: {report.affectedStepIds.length}.</p>
      {report.projectChanges.filter(item=>item.field!=="MATERIAL_REVISIONS").map(item=><div key={item.field} className="rounded border border-slate-800 p-2 break-words">
        <strong>{comparisonFieldLabels[item.field]??item.field}</strong>
        <p>Было: {comparisonText(item.before)||"Нет"}</p><p>Стало: {comparisonText(item.after)||"Нет"}</p>
      </div>)}
      {report.materialChanges.length>0&&<div className="space-y-1">
        <strong>Материалы</strong>{report.materialChanges.map(item=><p key={item.object_id} className="break-all">{item.object_id}: {item.beforeRevision??"нет"} → {item.afterRevision??"нет"}</p>)}
      </div>}
      {report.stageDetails.map(item=>{
        const diff=report.stepChanges.find(row=>row.stepId===item.stepId);
        return <div key={item.stepId} className="rounded border border-slate-800 p-2 space-y-1 break-words">
          <strong>{item.after?.name??item.before?.name??item.stepId}</strong>
          <p>{diff?.changedFields.map(field=>comparisonFieldLabels[field]??field).join(", ")}</p>
          {item.before&&<div className="text-slate-400"><p>Было: {item.before.name} · {actorLabels[item.before.actor]}</p><p className="whitespace-pre-wrap">{item.before.instruction}</p>
            <p>Материалы: {item.before.materialIds.join(", ")||"нет"}. Предшественники: {item.before.dependsOn.join(", ")||"нет"}.</p></div>}
          {item.after&&<div><p>Стало: {item.after.name} · {actorLabels[item.after.actor]}</p><p className="whitespace-pre-wrap">{item.after.instruction}</p>
            <p>Материалы: {item.after.materialIds.join(", ")||"нет"}. Предшественники: {item.after.dependsOn.join(", ")||"нет"}.</p></div>}
        </div>;
      })}
      {report.affectedStepIds.length>0&&<p className="break-words text-amber-200">Требуют проверки: {report.affectedStepIds.join(", ")}.</p>}
      <p className="text-slate-400">Сохранённые редакции не изменены. Пригодность прежних результатов и запуск работ не подтверждены.</p>
    </div>}
  </section>;
}


function MethodAlternativeAction({binding,onOpen}:{binding:WorkspaceMethodWorkflowBinding;onOpen:(selection:WorkspaceMethodReaderSelection)=>void}){
  const reader=binding.reader;
  const [receipt,setReceipt]=useState<WorkspaceMethodAlternativeReceipt|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const serial=useRef(0),liveReader=useRef(reader);liveReader.current=reader;
  useEffect(()=>{serial.current++;setReceipt(null);setBusy(false);setError("");
    return ()=>{serial.current++;};},[reader]);
  if(!reader.createAlternative||!reader.recoverAlternative)return null;
  const complete=receipt!==null&&(receipt.state==="CREATED"||receipt.state==="RECOVERED");
  const pending=receipt!==null&&["OUTCOME_UNKNOWN","RECOVERY_REQUIRED","NOT_FOUND","CONFLICT"].includes(receipt.state);
  const recoverable=receipt!==null&&(pending||receipt.state==="MATERIAL_REVIEW_REQUIRED");
  const action=async(recover:boolean)=>{
    if(busy||!reader.createAlternative||!reader.recoverAlternative||(recover&&!receipt))return;
    const token=++serial.current,current=()=>serial.current===token&&liveReader.current===reader;
    setBusy(true);setError("");
    try{
      const input={workspaceId:binding.workspaceId,projectId:binding.projectId,expected:binding.expected};
      const value=recover?await reader.recoverAlternative({...input,targetProjectId:receipt!.targetProjectId}):await reader.createAlternative(input);
      if(!current())return;
      const done=value.state==="CREATED"||value.state==="RECOVERED";
      const selected=value.selection,target=value.targetProjectId;
      const encodedWorkspace=encodeURIComponent(binding.workspaceId),encodedTarget=encodeURIComponent(target);
      if(value.workspaceId!==binding.workspaceId||value.sourceProjectId!==binding.projectId
          ||!/^project-[a-f0-9]{32}$/.test(target)||target===binding.projectId
          ||(recover&&target!==receipt!.targetProjectId)||value.executionAuthority!==false
          ||value.sourceModified!==false||value.newAuthorityGranted!==false||value.resultReuseProven!==false
          ||(done?(selected===null||selected.projectRef.family!=="iwxa.project"
            ||selected.projectRef.objectId!=="project:"+encodedWorkspace+":"+encodedTarget||selected.projectRef.revision!==1
            ||selected.workRefs.length!==binding.expected.workRefs.length
            ||new Set([selected.projectRef,...selected.workRefs].map(ref=>ref.recordId)).size!==selected.workRefs.length+1
            ||new Set(selected.workRefs.map(ref=>ref.objectId)).size!==selected.workRefs.length
            ||selected.workRefs.some(ref=>ref.family!=="iwxa.work"||ref.revision!==1||!ref.objectId.startsWith("work:"+encodedWorkspace+":"+encodedTarget+".")))
            :selected!==null))throw Error("alternative receipt mismatch");
      setReceipt(value);
    }catch(err){if(current())setError(message(err));}finally{if(current())setBusy(false);}
  };
  const labels:Record<WorkspaceMethodAlternativeReceipt["state"],string>={
    CREATED:"Независимый вариант сохранён.",RECOVERED:"Сохранённый вариант восстановлен.",
    USER_CANCELLED:"Создание отменено.",MATERIAL_REVIEW_REQUIRED:"Проверьте редакции материалов.",
    OUTCOME_UNKNOWN:"Запись не подтверждена. Проверьте существующий вариант.",
    RECOVERY_REQUIRED:"Осталась незавершённая запись варианта.",NOT_FOUND:"Запись пока не найдена. Повторная запись не выполнялась.",
    CONFLICT:"Редакции варианта изменились. Откройте его из сохранённых проектов.",
  };
  return <section aria-label="Варианты методики" className="min-w-0 space-y-2 rounded border border-slate-800 p-2">
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy||pending} onClick={()=>void action(false)}>Создать независимый вариант</button>
      {recoverable&&<button type="button" className={button} disabled={busy} onClick={()=>void action(true)}>Восстановить вариант</button>}
      {complete&&<button type="button" className={button} disabled={busy} onClick={()=>onOpen({
        workspaceId:binding.workspaceId,projectId:receipt!.targetProjectId,expected:receipt!.selection!,
      })}>Открыть вариант</button>}
    </div>
    {busy&&<p role="status" className="text-xs text-slate-300">Проверяем и сохраняем вариант…</p>}
    {error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
    {receipt&&<div data-testid="workflow-alternative-receipt" className="text-xs text-slate-300 break-words">
      <p role="status">{labels[receipt.state]}</p>
      {(complete||pending)&&<p>Проект: {receipt.targetProjectId}</p>}
    </div>}
    <p className="text-xs text-slate-400">Исходная методика сохраняется. Задачи и принятые результаты не копируются.</p>
  </section>;
}

function prerequisiteStages(report:WorkspaceMethodInputOverview,stage:WorkspaceMethodOverviewStage){
  const byId=new Map(report.stages.map(row=>[row.stepId,row]));
  const found=new Set<string>(),pending=[...stage.directPredecessorStepIds];
  while(pending.length){
    const id=pending.pop()!;
    if(id===stage.stepId)return null;
    if(found.has(id))continue;
    const row=byId.get(id);
    if(!row)return null;
    found.add(id);pending.push(...row.directPredecessorStepIds);
  }
  return found.size===stage.prerequisiteCount?report.stages.filter(row=>found.has(row.stepId)):null;
}
function WorkflowPanel({binding,objects,selectedObjectIds,onOpenAlternative}:WorkflowPanelProps&{
  onOpenAlternative:(selection:WorkspaceMethodReaderSelection)=>void;
}){
  const reader=binding.reader;
  const [overview,setOverview]=useState<{reader:WorkspaceMethodStageReader;value:WorkspaceMethodInputOverview;materialKey:string}|null>(null);
  const [focus,setFocus]=useState("");
  const [selections,setSelections]=useState<Record<string,string>>({});
  const [nativeStep,setNativeStep]=useState("");
  const [detail,setDetail]=useState<{reader:WorkspaceMethodStageReader;key:string;report:Detail}|null>(null);
  const [taskInspection,setTaskInspection]=useState<{reader:WorkspaceMethodStageReader;key:string;digest:string;value:WorkspaceMethodPersonalTaskInspection|WorkspaceMethodRecoveredPersonalTask}|null>(null);
  const [corporateInspection,setCorporateInspection]=useState<{reader:WorkspaceMethodStageReader;key:string;digest:string;value:WorkspaceMethodCorporateTaskReferenceInspection&{recoveredFromOriginalTask?:true}}|null>(null);
  const [draftAttempt,setDraftAttempt]=useState<{reader:WorkspaceMethodStageReader;key:string;digest:string;state:WorkspaceMethodPersonalDraftReceipt['state']|null}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const sequence=useRef(0),liveReader=useRef(reader),liveObjects=useRef(objects);
  liveReader.current=reader;liveObjects.current=objects;
  useEffect(()=>{sequence.current++;setOverview(null);setDetail(null);setDraftAttempt(null);setTaskInspection(null);setCorporateInspection(null);setSelections({});setFocus("");setNativeStep("");setBusy(false);setError("");
    return ()=>{sequence.current++;};},[reader]);
  const materialKey=useMemo(()=>overview?materialCatalogKey(overview.value,objects):null,[overview,objects]);
  const overviewStale=overview!==null&&materialKey!==overview.materialKey;
  useEffect(()=>{
    if(!overviewStale)return;
    sequence.current++;setOverview(null);setDetail(null);setDraftAttempt(null);setTaskInspection(null);setCorporateInspection(null);setSelections({});setNativeStep("");setFocus("");setBusy(false);
    setError("Материалы изменились. Проверьте входы заново.");
  },[overviewStale]);
  const visible=overview?.reader===reader&&!overviewStale?overview.value:null;
  const stage=visible?.stages.find(row=>row.stepId===focus)??visible?.stages[0];
  const candidates=useMemo(()=>{
    const byId=new Map(objects.map(row=>[row.object_id,row]));
    const values=new Map<string,WorkspaceMethodPublishedResultRef>();
    for(const id of selectedObjectIds){
      const row=byId.get(id);
      if(row?.workspace_id===binding.workspaceId&&row.schema_id==="iwxa.agent.accepted-result"&&row.schema_version==="1.0.0"
          &&!row.deleted&&row.deleted_at==null&&Number.isSafeInteger(row.revision)&&row.revision>0){
        const ref:WorkspaceMethodPublishedResultRef={workspace_id:row.workspace_id,object_id:row.object_id,
          schema_id:"iwxa.agent.accepted-result",revision:row.revision};
        values.set(JSON.stringify([row.object_id,row.revision]),ref);
      }
    }
    return values;
  },[objects,selectedObjectIds,binding.workspaceId]);
  const prerequisites=visible&&stage?prerequisiteStages(visible,stage):null;
  const personalChain=!!(binding.personalResultSelections!==undefined&&stage?.actor==="agent"
    &&prerequisites?.length&&prerequisites.every(row=>row.actor==="agent"));
  const prerequisiteIds=new Set(prerequisites?.map(row=>row.stepId)??[]);
  const personalResultSelections=personalChain?(binding.personalResultSelections??[]).filter(row=>prerequisiteIds.has(row.stepId)):[];
  const personalReady=personalChain&&!!reader.inspectPersonalTask&&!!reader.inspectMaterialEvidence&&!!stage
    &&stage.directPredecessorStepIds.every(id=>personalResultSelections.some(row=>row.stepId===id))
    &&new Set(personalResultSelections.map(row=>row.stepId)).size===personalResultSelections.length
    &&new Set(personalResultSelections.map(row=>row.taskId)).size===personalResultSelections.length
    &&personalResultSelections.every(row=>/^TASK-[A-Za-z0-9_-]{1,120}$/.test(row.taskId));
  const personalArgs=personalChain?{personalResultSelections}:{};
  const corporateChain=!!(binding.corporateResultSelections!==undefined&&!personalChain&&stage?.actor==="agent"
    &&prerequisites?.length&&prerequisites.every(row=>row.actor==="agent"));
  const corporateResultSelections=corporateChain?(binding.corporateResultSelections??[]).filter(row=>prerequisiteIds.has(row.stepId)):[];
  const corporateReady=corporateChain&&!!reader.inspectMaterialEvidence&&corporateResultSelections.length===prerequisiteIds.size
    &&new Set(corporateResultSelections.map(row=>row.stepId)).size===prerequisiteIds.size
    &&new Set(corporateResultSelections.map(row=>row.acceptanceId)).size===prerequisiteIds.size
    &&new Set(corporateResultSelections.map(row=>row.resultRevisionId)).size===prerequisiteIds.size
    &&corporateResultSelections.every(row=>/^[a-f0-9]{64}$/.test(row.acceptanceId)&&/^[a-f0-9]{64}$/.test(row.resultRevisionId));
  const corporateArgs=corporateChain?{corporateResultSelections}:{};
  const resultSelections=(personalChain||corporateChain?[]:stage?.directPredecessorStepIds??[]).flatMap(stepId=>{
    const reference=candidates.get(selections[stepId]??"");return reference?[{stepId,reference}]:[];
  });
  const duplicateResults=new Set(resultSelections.map(row=>row.reference.object_id)).size!==resultSelections.length;
  const candidateKey=JSON.stringify([...candidates.keys()].sort());
  useEffect(()=>{
    // Even an externally removed selection that later returns cannot
    // resurrect a pending or completed preview for the earlier selection.
    sequence.current++;setDetail(null);setDraftAttempt(null);setTaskInspection(null);setCorporateInspection(null);setSelections({});setNativeStep("");setBusy(false);
  },[candidateKey]);
  const detailKey=JSON.stringify([stage?.stepId??null,resultSelections,nativeStep,candidateKey,personalResultSelections,corporateResultSelections]);
  const liveDetailKey=useRef(detailKey);liveDetailKey.current=detailKey;
  const visibleDetail=detail?.reader===reader&&detail.key===detailKey?detail.report:null;
  const draftDigest=visibleDetail?.kind==='handoff'&&visibleDetail.value.subjectKind==='PERSONAL'
    &&visibleDetail.value.materialEvidence?.observation&&stage?.actor==='agent'&&(stage.directPredecessorStepIds.length===0||personalReady)
    &&reader.createPersonalDraft&&reader.recoverPersonalDraft?visibleDetail.value.candidateDigest:null;
  const corporateDigest=visibleDetail?.kind==='handoff'&&visibleDetail.value.subjectKind==='CORP'
    &&visibleDetail.value.materialEvidence?.observation&&stage?.actor==='agent'
    &&reader.inspectCorporateTaskReference&&typeof binding.corporateTaskId==='string'
    &&/^task:[A-Za-z0-9:-]{1,100}$/.test(binding.corporateTaskId)?visibleDetail.value.candidateDigest:null;
  const selectedCorporateTask=stage?.actor==='agent'&&!personalChain&&!binding.personalTaskId
    &&typeof binding.corporateTaskId==='string'&&/^task:[A-Za-z0-9:-]{1,100}$/.test(binding.corporateTaskId)?binding.corporateTaskId:null;
  const recoverableCorporateTask=selectedCorporateTask&&reader.recoverCorporateTaskReference
    &&!(visibleDetail?.kind==='handoff'&&visibleDetail.value.subjectKind==='PERSONAL')?selectedCorporateTask:null;
  const visibleCorporate=corporateInspection?.reader===reader&&corporateInspection.key===detailKey
    &&corporateInspection.digest===corporateDigest&&corporateInspection.value.taskId===binding.corporateTaskId?corporateInspection.value:null;
  const visibleRecoveredCorporate=corporateInspection?.reader===reader&&corporateInspection.key===detailKey
    &&corporateInspection.value.recoveredFromOriginalTask===true
    &&corporateInspection.value.taskId===recoverableCorporateTask?corporateInspection.value:null;
  const visibleAttempt=draftAttempt?.reader===reader&&draftAttempt.key===detailKey&&draftAttempt.digest===draftDigest?draftAttempt:null;
  const personalTaskId=binding.personalTaskId;
  const inspectableTask=draftDigest&&reader.inspectPersonalTask&&typeof personalTaskId==='string'
    &&/^TASK-[A-Za-z0-9_-]{1,120}$/.test(personalTaskId)&&!personalResultSelections.some(row=>row.taskId===personalTaskId)?personalTaskId:null;
  const visibleTask=taskInspection?.reader===reader&&taskInspection.key===detailKey&&taskInspection.digest===draftDigest
    &&taskInspection.value.taskId===inspectableTask?taskInspection.value:null;
  const recoverableTask=stage?.actor==='agent'&&reader.recoverPersonalTask&&typeof personalTaskId==='string'
    &&/^TASK-[A-Za-z0-9_-]{1,120}$/.test(personalTaskId)?personalTaskId:null;
  const visibleRecoveredTask=taskInspection?.reader===reader&&taskInspection.key===detailKey
    &&'recoveredFromOriginalTask' in taskInspection.value&&taskInspection.value.recoveredFromOriginalTask===true
    &&taskInspection.value.taskId===recoverableTask?taskInspection.value:null;
  const request:WorkspaceMethodReaderSelection={workspaceId:binding.workspaceId,projectId:binding.projectId,expected:binding.expected};
  function invalidateDetail(){
    sequence.current++;setDetail(null);setDraftAttempt(null);setTaskInspection(null);setCorporateInspection(null);setBusy(false);setError("");
  }
  const checkOverview=async()=>{
    const epoch=++sequence.current,startObjects=objects;
    setBusy(true);setError("");setDetail(null);setDraftAttempt(null);setTaskInspection(null);setCorporateInspection(null);setOverview(null);setSelections({});setNativeStep("");
    try{
      const report=await reader.overview(request);
      if(sequence.current!==epoch||liveReader.current!==reader)return;
      if(!exactOverview(report,binding))throw Object.assign(Error("invalid"),{code:"METHOD_SOURCE_MISMATCH"});
      const materialKey=materialCatalogKey(report,startObjects);
      if(materialKey!==materialCatalogKey(report,liveObjects.current))
        throw Object.assign(Error("changed"),{code:"METHOD_MATERIAL_CHANGED"});
      setOverview({reader,value:report,materialKey});setFocus(report.stages[0]?.stepId??"");
    }catch(err){if(sequence.current===epoch&&liveReader.current===reader)setError(message(err));}
    finally{if(sequence.current===epoch&&liveReader.current===reader)setBusy(false);}
  };
  const inspect=async(mode:"handoff"|"preview"|"recover"|"material")=>{
    if(!stage||stage.state==="MATERIAL_REVIEW_REQUIRED"||(mode!=="material"&&duplicateResults)
        ||(mode==="handoff"&&((personalChain&&!personalReady)||(corporateChain&&!corporateReady))))return;
    if((mode==="preview"||mode==="recover")&&!resultSelections.some(row=>row.stepId===nativeStep))return;
    if(mode==="material"&&typeof reader.inspectMaterialEvidence!=="function")return;
    const epoch=++sequence.current,key=detailKey;
    setBusy(true);setError("");setDetail(null);setDraftAttempt(null);setTaskInspection(null);setCorporateInspection(null);
    const stillCurrent=()=>sequence.current===epoch&&liveReader.current===reader&&liveDetailKey.current===key;
    const args={...request,stepId:stage.stepId,resultSelections};
    try{
      // Existing capability advertises original content evidence. A
      // combined handoff uses one read, not a separate cached digest.
      const contentRequested=mode==="handoff"&&typeof reader.inspectMaterialEvidence==="function";
      const report:Detail=mode==="handoff"?{kind:"handoff",value:await reader.previewHandoff(
          contentRequested?{...args,...personalArgs,...corporateArgs,includeMaterialEvidence:true}:{...args,...personalArgs})}:
        mode==="material"?{kind:"material",value:await reader.inspectMaterialEvidence!({...args,resultSelections:[]})}:
        {kind:"native",value:await (mode==="preview"?reader.previewContinuation({...args,predecessorStepId:nativeStep}):
          reader.recoverContinuation({...args,predecessorStepId:nativeStep}))};
      if(!stillCurrent())return;
      const value=report.kind==="handoff"?report.value.inspection:report.value;
      const basis=value.stageInput.basis;
      if(basis.workspaceId!==binding.workspaceId||basis.projectId!==binding.projectId||basis.stepId!==stage.stepId
          ||!sameRef(basis.stageRef,stage.workRef)||value.executionAuthority!==false||value.writeAuthorized!==false
          ||report.value.dispatchAuthorized!==false||value.stageInput.inputBasisDigest!==stage.inputBasisDigest)
        throw Object.assign(Error("invalid"),{code:"METHOD_SOURCE_MISMATCH"});
      if(report.kind==="handoff"&&contentRequested){
        const evidence=report.value.materialEvidence;
        if(report.value.materialEvidenceRequested!==true||(report.value.candidateDigest!==null
            &&(!evidence||evidence.state!=="VISIBLE_MATERIAL_CONTENT_OBSERVED"||!evidence.observation
              ||!evidence.materialEvidenceDigest||evidence.stageInput.inputBasisDigest!==value.stageInput.inputBasisDigest
              ||evidence.contentBindingProven!==false||evidence.allAssetsProven!==false
              ||evidence.dispatchAuthorized!==false||evidence.atomicSnapshot!==false)))
          throw Object.assign(Error("invalid"),{code:"METHOD_MATERIAL_EVIDENCE_MISMATCH"});
      }
      if(report.kind==="handoff"&&personalChain){
        const result=report.value,prior=result.personalResults,resolved=result.personalResultSelections;
        const direct=new Set(stage.directPredecessorStepIds);
        if(!personalReady||result.subjectKind!=="PERSONAL"||result.state!=="PERSONAL_PRIOR_RESULTS_OBSERVED_DECLARED_INPUTS_MATCHED"
            ||!/^[a-f0-9]{64}$/.test(result.candidateDigest??"")||!prior||prior.length!==direct.size
            ||new Set(prior.map(row=>row.stepId)).size!==direct.size
            ||!resolved||resolved.length!==prerequisiteIds.size
            ||new Set(resolved.map(row=>row.stepId)).size!==prerequisiteIds.size
            ||new Set(resolved.map(row=>row.taskId)).size!==prerequisiteIds.size
            ||resolved.some(row=>!prerequisiteIds.has(row.stepId)||!/^TASK-[A-Za-z0-9_-]{1,120}$/.test(row.taskId))
            ||personalResultSelections.some(row=>!resolved.some(p=>p.stepId===row.stepId&&p.taskId===row.taskId))
            ||new Set(prior.map(row=>row.acceptedTask.agentWorkspaceId)).size!==1
            ||prior.some(row=>{
              const expected=prerequisites?.find(p=>p.stepId===row.stepId);
              const selected=personalResultSelections.find(p=>p.stepId===row.stepId);
              return !direct.has(row.stepId)||!expected||!selected||!sameRef(row.canonicalWorkRef,expected.workRef)
                ||row.acceptedTask.taskId!==selected.taskId||!/^(personal|AREA-[0-9a-f]{18})$/.test(row.acceptedTask.agentWorkspaceId)
                ||![row.acceptedTask.acceptedDigest,row.acceptedTask.acceptedSummarySha256,row.acceptedTask.candidateDigest]
                  .every(hash=>/^[a-f0-9]{64}$/.test(hash));
            }))throw Object.assign(Error("invalid"),{code:"METHOD_PERSONAL_CHAIN_RESULT_MISMATCH"});
      }
      if(report.kind==="handoff"&&corporateChain){
        const result=report.value,prior=result.corporateResults,resolved=result.corporateResultSelections;
        const direct=new Set(stage.directPredecessorStepIds),hex=(v:string)=>/^[a-f0-9]{64}$/.test(v);
        if(!corporateReady||result.subjectKind!=="CORP"||result.state!=="CORPORATE_PRIOR_RESULTS_OBSERVED_SIGNED_REFERENCES_MATCHED"
          ||!hex(result.candidateDigest??"")||!prior||prior.length!==direct.size
          ||new Set(prior.map(row=>row.stepId)).size!==direct.size
          ||!resolved||resolved.length!==corporateResultSelections.length
          ||corporateResultSelections.some(row=>!resolved.some(p=>p.stepId===row.stepId&&p.acceptanceId===row.acceptanceId&&p.resultRevisionId===row.resultRevisionId))
          ||prior.some(row=>{
            const expected=prerequisites?.find(p=>p.stepId===row.stepId),selected=corporateResultSelections.find(p=>p.stepId===row.stepId);
            const accepted=row.acceptedResult,w=accepted?.workflowInput;
            return !direct.has(row.stepId)||!expected||!selected||!sameRef(row.canonicalWorkRef,expected.workRef)
              ||!accepted||accepted.acceptanceId!==selected.acceptanceId||accepted.resultRevisionId!==selected.resultRevisionId
              ||accepted.workspaceId!==binding.workspaceId||accepted.exactInputBindingProven!==false||accepted.workCompleted!==false
              ||Object.hasOwn(accepted,"result")||![accepted.packageSha256,accepted.taskRevisionId,accepted.taskPackageSha256,accepted.resultSha256].every(hex)
              ||!w||w.workspaceId!==binding.workspaceId||w.projectId!==binding.projectId||w.stepId!==row.stepId
              ||!sameRef(w.projectRef,binding.expected.projectRef)||!sameRef(w.workRef,expected.workRef);
          }))throw Object.assign(Error("invalid"),{code:"METHOD_CORPORATE_CHAIN_RESULT_MISMATCH"});
      }
      if(report.kind==="material"&&(report.value.schema!=="IWXA_T2_WORKSPACE_METHOD_MATERIAL_EVIDENCE_V1"
          ||report.value.allAssetsProven!==false||report.value.contentBindingProven!==false
          ||report.value.exactInputBindingProven!==false||report.value.atomicSnapshot!==false
          ||report.value.state!=="VISIBLE_MATERIAL_CONTENT_OBSERVED"
          ||!report.value.observation||!report.value.materialEvidenceDigest))
        throw Object.assign(Error("invalid"),{code:"METHOD_MATERIAL_EVIDENCE_MISMATCH"});
      if(report.kind==="native"&&report.value.nativeContinuation){
        const native=report.value.nativeContinuation;
        const selected=resultSelections.find(row=>row.stepId===nativeStep)?.reference;
        const ref=native.preview.reference;
        if(native.predecessorStepId!==nativeStep||!selected||ref.workspace_id!==selected.workspace_id
            ||ref.object_id!==selected.object_id||ref.schema_id!==selected.schema_id||ref.revision!==selected.revision
            ||(native.receipt&&native.receipt.operationId!==native.preview.operationId)||report.value.targetWorkBound!==false)
          throw Object.assign(Error("invalid"),{code:"METHOD_NATIVE_RECEIPT_MISMATCH"});
      }
      setDetail({reader,key,report});
    }catch(err){if(stillCurrent())setError(message(err));}
    finally{if(sequence.current===epoch&&liveReader.current===reader)setBusy(false);}
  };
  const inspectTask=async()=>{
    if(busy||!stage||!draftDigest||!inspectableTask||!reader.inspectPersonalTask)return;
    const epoch=++sequence.current,key=detailKey,digest=draftDigest,taskId=inspectableTask;
    setBusy(true);setError("");setTaskInspection(null);setCorporateInspection(null);
    const current=()=>sequence.current===epoch&&liveReader.current===reader&&liveDetailKey.current===key;
    try{
      const value=await reader.inspectPersonalTask({...request,stepId:stage.stepId,resultSelections:[],...personalArgs,
        expectedCandidateDigest:digest,taskId});
      if(!current())return;
      if(!exactTaskInspection(value,binding,stage,taskId,digest))
        throw Object.assign(Error("invalid"),{code:"METHOD_TASK_MISMATCH"});
      setTaskInspection({reader,key,digest,value});
    }catch(err){if(current())setError(message(err));}
    finally{if(current())setBusy(false);}
  };
  const inspectCorporate=async(recoverOnly=false)=>{
    if(busy||!stage||duplicateResults||stage.state==="MATERIAL_REVIEW_REQUIRED"
      ||(corporateChain?!corporateReady:resultSelections.length!==stage.directPredecessorStepIds.length))return;
    const taskId=recoverOnly?recoverableCorporateTask:selectedCorporateTask;
    if(!taskId||(recoverOnly?!reader.recoverCorporateTaskReference:
      !corporateDigest||!reader.inspectCorporateTaskReference||visibleDetail?.kind!=="handoff"))return;
    const epoch=++sequence.current,key=detailKey,digest=corporateDigest;
    const materialDigest=visibleDetail?.kind==="handoff"?visibleDetail.value.materialEvidence?.materialEvidenceDigest:null;
    setBusy(true);setError("");setCorporateInspection(null);
    const current=()=>sequence.current===epoch&&liveReader.current===reader&&liveDetailKey.current===key;
    try{
      const input={...request,stepId:stage.stepId,resultSelections,...corporateArgs,taskId};
      const value:WorkspaceMethodCorporateTaskReferenceInspection&{recoveredFromOriginalTask?:true}=recoverOnly?
        await reader.recoverCorporateTaskReference!(input):
        await reader.inspectCorporateTaskReference!({...input,expectedCandidateDigest:digest!});
      if(!current())return;
      const w=value.workflowInput;
      if(value.state!=="SIGNED_CORPORATE_TASK_CURRENT_REFERENCE_MATCHED"||value.taskId!==taskId
          ||value.declaredReferenceMatched!==true||value.exactInputBindingProven!==false||value.allAssetsProven!==false
          ||value.workCompleted!==false||value.resultReuseProven!==false||value.executionAuthority!==false||value.writeAuthorized!==false
          ||![value.taskRevisionId,value.packageSha256,w?.taskTextSha256,w?.candidateDigest,w?.materialEvidenceDigest].every(h=>typeof h==="string"&&/^[a-f0-9]{64}$/.test(h))
          ||!w||w.schema!=="IWXA_T3_WORKFLOW_INPUT_REFERENCE/1"||w.workspaceId!==binding.workspaceId||w.projectId!==binding.projectId
          ||w.stepId!==stage.stepId||!sameRef(w.projectRef,binding.expected.projectRef)||!sameRef(w.workRef,stage.workRef)
          ||w.inputBasisDigest!==stage.inputBasisDigest
          ||(recoverOnly?value.recoveredFromOriginalTask!==true:w.candidateDigest!==digest||w.materialEvidenceDigest!==materialDigest))
        throw Object.assign(Error("invalid"),{code:"METHOD_CORPORATE_TASK_REFERENCE_MISMATCH"});
      setCorporateInspection({reader,key,digest:w.candidateDigest,value});
    }catch(err){if(current())setError(message(err));}
    finally{if(current())setBusy(false);}
  };
  const recoverTask=async()=>{
    if(busy||!stage||!recoverableTask||!reader.recoverPersonalTask||!prerequisites)return;
    const epoch=++sequence.current,key=detailKey,taskId=recoverableTask;
    setBusy(true);setError("");setTaskInspection(null);setCorporateInspection(null);
    const current=()=>sequence.current===epoch&&liveReader.current===reader&&liveDetailKey.current===key;
    try{
      const value=await reader.recoverPersonalTask({...request,stepId:stage.stepId,taskId});
      if(!current())return;
      const recovered=value.personalResultSelections;
      if(!exactTaskInspection(value,binding,stage,taskId,value.candidateDigest)
          ||value.recoveredFromOriginalTask!==true||!sameRef(value.canonicalWorkRef,stage.workRef)
          ||!Array.isArray(recovered)||recovered.length!==prerequisiteIds.size
          ||new Set(recovered.map(row=>row.stepId)).size!==prerequisiteIds.size
          ||new Set(recovered.map(row=>row.taskId)).size!==prerequisiteIds.size
          ||recovered.some(row=>!prerequisiteIds.has(row.stepId)||row.taskId===taskId||!/^TASK-[A-Za-z0-9_-]{1,120}$/.test(row.taskId)))
        throw Object.assign(Error("invalid"),{code:"METHOD_TASK_MISMATCH"});
      setTaskInspection({reader,key,digest:value.candidateDigest,value});
    }catch(err){if(current())setError(message(err));}
    finally{if(current())setBusy(false);}
  };
  const saveDraft=async(recoverOnly:boolean)=>{
    if(busy||!stage||!draftDigest||!reader.createPersonalDraft||!reader.recoverPersonalDraft
        ||(recoverOnly?visibleAttempt?.state!=='OUTCOME_UNKNOWN':!!visibleAttempt))return;
    const epoch=++sequence.current,key=detailKey,digest=draftDigest;
    setBusy(true);setError("");setDraftAttempt({reader,key,digest,state:null});
    const current=()=>sequence.current===epoch&&liveReader.current===reader&&liveDetailKey.current===key;
    try{
      const args={...request,stepId:stage.stepId,resultSelections:[],...personalArgs,expectedCandidateDigest:digest};
      const receipt=await (recoverOnly?reader.recoverPersonalDraft(args):reader.createPersonalDraft(args));
      if(!current())return;
      const saved=receipt.state==='DRAFT_CONFIRMED'||receipt.state==='DRAFT_ALREADY_PRESENT';
      if(!Object.hasOwn(draftLabels,receipt.state)||receipt.candidateDigest!==digest||receipt.workspaceId!==binding.workspaceId
          ||receipt.projectId!==binding.projectId||receipt.stepId!==stage.stepId
          ||!/^(personal|AREA-[0-9a-f]{18})$/.test(receipt.agentWorkspaceId)||receipt.draftSaved!==saved
          ||(saved?!/^[a-f0-9]{64}$/.test(receipt.draftDigest??''):receipt.draftDigest!==null)
          ||receipt.taskCreated!==false||receipt.executionPerformed!==false||receipt.modelInvoked!==false
          ||receipt.allAssetsProven!==false||receipt.exactInputBindingProven!==false)
        throw Error('draft receipt mismatch');
      setDraftAttempt({reader,key,digest,state:receipt.state});
    }catch{if(current())setDraftAttempt({reader,key,digest,state:'OUTCOME_UNKNOWN'});}
    finally{if(current())setBusy(false);}
  };
  return <section aria-label="Сохранённая методика" data-testid="workspace-method-workflow" className="min-w-0 space-y-3 rounded border border-emerald-900/60 p-3">
    <div className="flex flex-wrap items-center gap-2"><div className="flex-1 min-w-0">
      <h5 className="text-sm font-semibold text-slate-100">Сохранённая методика</h5>
      <p className="text-xs text-slate-400 break-words">Проект: {binding.projectId} · ред. {binding.expected.projectRef.revision}</p>
      <p className="text-xs text-slate-400">Проверка входов и передачи результатов. Исполнение остаётся у оригинальных владельцев.</p>
    </div><button type="button" className={button} disabled={busy} onClick={()=>void checkOverview()}>Проверить входы</button></div>
    <MethodCreationComparison binding={binding}/>
    <MethodAlternativeAction binding={binding} onOpen={onOpenAlternative}/>
    {busy&&<p role="status" className="text-xs text-slate-300">Проверка оригинальных данных…</p>}
    {error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
    {visible&&<div className="space-y-3">
      <p className="text-xs text-slate-400">Снимок последней проверки. Не является разрешением на запуск.</p>
      <p className="text-xs text-slate-300">Работ: {visible.counts.total}. Входы подтверждены: {visible.counts.inputReferencesVerified}. Материалы требуют проверки: {visible.counts.materialReviewRequired}.</p>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1 max-h-80 overflow-y-auto" aria-label="Работы методики">
          {visible.stages.map(row=><button key={row.stepId} type="button" aria-pressed={stage?.stepId===row.stepId}
            onClick={()=>{invalidateDetail();setFocus(row.stepId);setSelections({});setNativeStep("");}}
            className="block min-h-[44px] w-full text-left rounded border border-slate-700 p-2 break-words">
            <span className="block text-sm text-slate-100">{row.name}</span>
            <span className="block text-xs text-slate-400">{actorLabels[row.actor]} · ред. {row.workRef.revision} · {states[row.state]}</span>
          </button>)}
        </div>
        {stage&&<div className="min-w-0 space-y-2 rounded border border-slate-800 p-2">
          <h6 className="text-sm font-semibold text-slate-100">{stage.name}</h6>
          <p className="text-xs text-slate-400">Предшествующих работ: {stage.prerequisiteCount}. {states[stage.state]}.</p>
          {stage.materialIssues.length>0&&<p className="text-xs text-amber-200 break-words">Материалы: {stage.materialIssues.join(", ")}</p>}
          {personalChain&&<div className="space-y-1" data-testid="workflow-personal-prerequisites">
            <p className="text-xs text-slate-400">Выберите принятые задачи непосредственных предшественников в Agent. Более ранние задачи будут прочитаны из сохранённой цепочки.</p>
            {prerequisites?.map(row=><p key={row.stepId} className="text-xs text-slate-300 break-words">{row.name}: {personalResultSelections.find(task=>task.stepId===row.stepId)?.taskId??(stage.directPredecessorStepIds.includes(row.stepId)?"Не выбрана":"Из сохранённой цепочки")}</p>)}
            {!personalReady&&<p className="text-xs text-amber-200">Выберите отдельную принятую задачу для каждого непосредственного предшественника. Затем подготовьте передачу.</p>}
          </div>}
          {corporateChain&&<div className="space-y-1" data-testid="workflow-corporate-prerequisites">
            <p className="text-xs text-slate-400">Выберите конкретные принятые результаты предшествующих работ в Admin Center.</p>
            {prerequisites?.map(row=>{
              const selected=corporateResultSelections.find(item=>item.stepId===row.stepId);
              return <p key={row.stepId} className="text-xs text-slate-300 break-words">
                {row.name}: {selected?<span title={selected.resultRevisionId}>Результат {selected.resultRevisionId.slice(0,12)}</span>:"Не выбран"}
              </p>;
            })}
            {!corporateReady&&<p className="text-xs text-amber-200">Нужна отдельная принятая редакция результата каждой предшествующей работы.</p>}
          </div>}
          {!personalChain&&!corporateChain&&stage.directPredecessorStepIds.length>0&&<div className="space-y-2">
            <p className="text-xs text-slate-400">Для каждого предшественника явно выберите принятый результат из материалов полотна.</p>
            {candidates.size===0&&<p className="text-xs text-slate-300">Выберите опубликованный результат на полотне.</p>}
            {stage.directPredecessorStepIds.map(stepId=><label key={stepId} className="block text-xs text-slate-300">
              Результат: {visible.stages.find(row=>row.stepId===stepId)?.name??stepId}
              <select className="block mt-1 w-full min-w-0 min-h-[44px] border border-slate-700 rounded bg-slate-950 p-2"
                value={candidates.has(selections[stepId]??"")?selections[stepId]:""}
                onChange={event=>{invalidateDetail();setSelections(old=>({...old,[stepId]:event.target.value}));}}>
                <option value="">Не выбран</option>{[...candidates].map(([key,ref])=><option key={key} value={key}>{ref.object_id} · ред. {ref.revision}</option>)}
              </select>
            </label>)}
          </div>}
          {duplicateResults&&<p role="alert" className="text-xs text-amber-200">Один результат нельзя назначить нескольким предшественникам.</p>}
          {recoverableTask&&<div className="space-y-1 border-t border-slate-800 pt-2">
            <p className="text-xs text-slate-400 break-words">Выбранная принятая задача Agent: {recoverableTask}</p>
            <button type="button" className={button} disabled={busy||stage.state==="MATERIAL_REVIEW_REQUIRED"}
              onClick={()=>void recoverTask()}>Восстановить связь с работой</button>
            {visibleRecoveredTask&&<div role="status" data-testid="workflow-personal-task-recovered" className="text-xs text-slate-200 space-y-1">
              <p>Связь с редакцией {visibleRecoveredTask.canonicalWorkRef.revision} работы восстановлена из принятой задачи. Сохранённые входы совпадают.</p>
              {visibleRecoveredTask.personalResultSelections.map(row=><p key={row.stepId} className="break-words">{visible.stages.find(work=>work.stepId===row.stepId)?.name??row.stepId}: {row.taskId}</p>)}
              <p className="text-slate-400">Выполнение работы не засчитано. Данные не изменены.</p>
            </div>}
          </div>}
          {recoverableCorporateTask&&!corporateDigest&&<div className="space-y-1 border-t border-slate-800 pt-2" data-testid="workflow-corporate-recovery">
            <p className="text-xs text-slate-400 break-words">Выбранное подписанное задание: {recoverableCorporateTask}</p>
            <button type="button" className={button}
              disabled={busy||duplicateResults||stage.state==="MATERIAL_REVIEW_REQUIRED"||(corporateChain?!corporateReady:resultSelections.length!==stage.directPredecessorStepIds.length)}
              onClick={()=>void inspectCorporate(true)}>Восстановить связь с подписанным заданием</button>
            {visibleRecoveredCorporate&&<div role="status" data-testid="workflow-corporate-reference-recovered" className="text-xs text-slate-200 space-y-1">
              <p>Подписанная ссылка восстановлена и соответствует текущей редакции работы и проверенному составу входов.</p>
              <p className="text-slate-400">Работа не засчитана выполненной. Данные не изменены.</p>
            </div>}
          </div>}
          <div className="flex flex-wrap gap-2">
            {reader.inspectMaterialEvidence&&<button type="button" className={button} disabled={busy||stage.state==="MATERIAL_REVIEW_REQUIRED"}
              onClick={()=>void inspect("material")}>Проверить содержимое и вложения</button>}
            <button type="button" className={button} disabled={busy||duplicateResults||stage.state==="MATERIAL_REVIEW_REQUIRED"||(personalChain&&!personalReady)||(corporateChain&&!corporateReady)}
              onClick={()=>void inspect("handoff")}>Подготовить передачу</button>
          </div>
          {!personalChain&&!corporateChain&&binding.nativeRecipientLabel&&stage.directPredecessorStepIds.length>0&&<div className="space-y-2">
            <label className="block text-xs text-slate-300">Предшественник для проверки передачи
              <select className="block mt-1 w-full min-h-[44px] border border-slate-700 rounded bg-slate-950 p-2"
                value={nativeStep} onChange={e=>{invalidateDetail();setNativeStep(e.target.value);}}>
                <option value="">Не выбран</option>{stage.directPredecessorStepIds.map(id=><option key={id} value={id}>{visible.stages.find(row=>row.stepId===id)?.name??id}</option>)}
              </select>
            </label>
            <p className="text-xs text-slate-400">Получатель: {binding.nativeRecipientLabel}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button} disabled={busy||duplicateResults||stage.state==="MATERIAL_REVIEW_REQUIRED"||!resultSelections.some(r=>r.stepId===nativeStep)}
                onClick={()=>void inspect("preview")}>Проверить передачу</button>
              <button type="button" className={button} disabled={busy||duplicateResults||stage.state==="MATERIAL_REVIEW_REQUIRED"||!resultSelections.some(r=>r.stepId===nativeStep)}
                onClick={()=>void inspect("recover")}>Проверить квитанцию</button>
            </div>
          </div>}
        </div>}
      </div>
      {visibleDetail?.kind==="material"&&visibleDetail.value.observation&&<div className="space-y-1 rounded border border-slate-800 p-2 text-xs" data-testid="workflow-material-evidence">
        <p className="text-slate-200">Содержимое доступных материалов и вложений прочитано повторно.</p>
        <p className="text-slate-300">Материалов: {visibleDetail.value.observation.counts.materials}. Вложений: {visibleDetail.value.observation.counts.assets}.</p>
        <p className="text-slate-400">Полнота состава и привязка содержимого к задаче требуют подтверждения оригинального владельца.</p>
      </div>}
      {visibleDetail?.kind==="handoff"&&<div className="space-y-1 rounded border border-slate-800 p-2 text-xs" data-testid="workflow-handoff-preview">
        <p className="text-slate-200">{handoffStates[visibleDetail.value.state]??"Требуется проверка оригинального владельца."}</p>
        {visibleDetail.value.candidateDigest&&<p className="text-slate-400">Состав передачи зафиксирован для проверки.</p>}
        {visibleDetail.value.materialEvidence?.observation&&<p className="text-slate-300">
          Проверено доступное содержимое: материалов {visibleDetail.value.materialEvidence.observation.counts.materials}, вложений {visibleDetail.value.materialEvidence.observation.counts.assets}.
        </p>}
        {visibleDetail.value.personalResults&&<p className="text-slate-300">Передаётся точное принятое текстовое содержимое результатов: {visibleDetail.value.personalResults.length}.</p>}
        {visibleDetail.value.personalResultSelections&&<p className="text-slate-300">Проверено предшествующих задач: {visibleDetail.value.personalResultSelections.length}.</p>}
        {visibleDetail.value.corporateResults&&<p className="text-slate-300">Подготовлено точное принятое содержимое непосредственных предшественников: {visibleDetail.value.corporateResults.length}. Передача исполнителю требует его действующего доступа.</p>}
        {visibleDetail.value.corporateResultSelections&&<p className="text-slate-300">Проверено принятых редакций предшествующих работ: {visibleDetail.value.corporateResultSelections.length}.</p>}
        {visibleDetail.value.materialEvidenceRequested&&!visibleDetail.value.materialEvidence&&
          <p className="text-slate-400">Проверка содержимого ожидает подтверждения входных ссылок и результатов предшественников.</p>}
        <p className="text-slate-300">До запуска необходимо:</p>
        <ul className="list-disc pl-4 text-slate-400">{visibleDetail.value.requiredOriginalOwnerChecks.map(key=><li key={key}>{checkLabels[key]??"Проверка оригинального владельца"}</li>)}</ul>
        <p className="text-slate-300">Подготовка передачи сама не создаёт и не запускает задачу.</p>
        {corporateDigest&&<div className="space-y-1 border-t border-slate-800 pt-2" data-testid="workflow-corporate-reference">
          <p className="text-slate-400 break-words">Выбранное подписанное задание: {binding.corporateTaskId}</p>
          <button type="button" className={button} disabled={busy} onClick={()=>void inspectCorporate()}>Сопоставить подписанное задание</button>
          {visibleCorporate&&<div role="status" data-testid="workflow-corporate-reference-match" className="text-slate-200 space-y-1">
            <p>Подписанная ссылка соответствует текущей редакции работы и проверенному составу входов.</p>
            <p className="text-slate-400">Работа не засчитана выполненной. Фактические входы исполнителя ещё требуют проверки.</p>
          </div>}
        </div>}
        {draftDigest&&<div className="space-y-1 border-t border-slate-800 pt-2" data-testid="workflow-personal-draft">
          <p className="text-slate-400">Передаются доступные текстовые входы в редактируемый черновик. Полнота вложений и запуск требуют отдельной проверки.</p>
          {!visibleAttempt&&<button type="button" className={button} disabled={busy} onClick={()=>void saveDraft(false)}>Передать в черновик Agent</button>}
          {visibleAttempt?.state&&<p role="status" className="text-slate-200">{draftLabels[visibleAttempt.state]}</p>}
          {visibleAttempt?.state==='OUTCOME_UNKNOWN'&&<button type="button" className={button} disabled={busy} onClick={()=>void saveDraft(true)}>Проверить черновик Agent</button>}
          {inspectableTask&&<div className="space-y-1 border-t border-slate-800 pt-2">
            <p className="break-words text-slate-400">Выбранная задача Agent: {inspectableTask}</p>
            <button type="button" className={button} disabled={busy} onClick={()=>void inspectTask()}>Проверить принятую задачу Agent</button>
            {visibleTask&&<p role="status" data-testid="workflow-personal-task-match" className="text-slate-200">Сохранённые входы принятой задачи совпадают. Системных источников Agent: {visibleTask.nativeSystemSourceCount}. Выполнение работы не засчитано.</p>}
          </div>}
        </div>}
      </div>}
      {visibleDetail?.kind==="native"&&<div data-testid="workflow-native-receipt" className="space-y-1 rounded border border-slate-800 p-2 text-xs">
        {visibleDetail.value.nativeContinuation?<><p className="text-slate-200">{nativeLabels[visibleDetail.value.nativeContinuation.preview.status]}</p>
          {visibleDetail.value.nativeContinuation.receipt&&<p className="text-slate-300">{visibleDetail.value.nativeContinuation.receipt.status==="OWNER_READBACK_CONFIRMED"?"Оригинальная квитанция подтверждена.":"Исход передачи пока не подтверждён."}</p>}</>:
          <p className="text-slate-300">Подтверждённый результат для передачи недоступен.</p>}
        <p className="text-slate-400">Квитанция получателя не подтверждает выполнение выбранной работы.</p>
      </div>}
    </div>}
  </section>;
}
