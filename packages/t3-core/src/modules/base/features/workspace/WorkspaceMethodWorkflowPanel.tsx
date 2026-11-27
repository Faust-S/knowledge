import { useEffect,useMemo,useRef,useState } from "react";
import type { ObjectRecord } from "../../../../kernel-client/contracts/runtime-1.3.0";
import type { WorkspaceMethodReaderSelection,WorkspaceMethodStageReader,WorkspaceMethodInputOverview,
  WorkspaceMethodPublishedResultRef,WorkspaceMethodHandoffPreview,WorkspaceMethodNativeInspection,
  WorkspaceMethodOverviewStage,WorkspaceMethodMaterialEvidence,WorkspaceMethodPersonalDraftReceipt } from "../../../../t3/workspace-method-stage-reader.mjs";

/** Trusted Host supplies this selection only after original source readback.
 * contextEpoch changes on subject/grant/session changes. Never derive it or
 * the exact source selection from the method draft or browser persistence. */
export type WorkspaceMethodWorkflowBinding = WorkspaceMethodReaderSelection & Readonly<{
  contextEpoch:string;reader:WorkspaceMethodStageReader;nativeRecipientLabel?:string;
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
function message(error:unknown){
  const code=error&&typeof error==="object"&&"code" in error?String(error.code):"";
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
    [...binding.expected.workRefs].sort((a,b)=>a.objectId.localeCompare(b.objectId))]);
}
export function WorkspaceMethodWorkflowPanel(props:{
  binding:WorkspaceMethodWorkflowBinding;objects:readonly ObjectRecord[];selectedObjectIds:readonly string[];
}){
  // Key remounts on exact source identity or trusted context epoch change.
  if(!props.binding.contextEpoch)return null;
  return <WorkflowPanel key={bindingKey(props.binding)} {...props}/>;
}
function WorkflowPanel({binding,objects,selectedObjectIds}:{
  binding:WorkspaceMethodWorkflowBinding;objects:readonly ObjectRecord[];selectedObjectIds:readonly string[];
}){
  const reader=binding.reader;
  const [overview,setOverview]=useState<{reader:WorkspaceMethodStageReader;value:WorkspaceMethodInputOverview;materialKey:string}|null>(null);
  const [focus,setFocus]=useState("");
  const [selections,setSelections]=useState<Record<string,string>>({});
  const [nativeStep,setNativeStep]=useState("");
  const [detail,setDetail]=useState<{reader:WorkspaceMethodStageReader;key:string;report:Detail}|null>(null);
  const [draftAttempt,setDraftAttempt]=useState<{reader:WorkspaceMethodStageReader;key:string;digest:string;state:WorkspaceMethodPersonalDraftReceipt['state']|null}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const sequence=useRef(0),liveReader=useRef(reader),liveObjects=useRef(objects);
  liveReader.current=reader;liveObjects.current=objects;
  useEffect(()=>{sequence.current++;setOverview(null);setDetail(null);setDraftAttempt(null);setSelections({});setFocus("");setNativeStep("");setBusy(false);setError("");
    return ()=>{sequence.current++;};},[reader]);
  const materialKey=useMemo(()=>overview?materialCatalogKey(overview.value,objects):null,[overview,objects]);
  const overviewStale=overview!==null&&materialKey!==overview.materialKey;
  useEffect(()=>{
    if(!overviewStale)return;
    sequence.current++;setOverview(null);setDetail(null);setDraftAttempt(null);setSelections({});setNativeStep("");setFocus("");setBusy(false);
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
  const resultSelections=(stage?.directPredecessorStepIds??[]).flatMap(stepId=>{
    const reference=candidates.get(selections[stepId]??"");return reference?[{stepId,reference}]:[];
  });
  const duplicateResults=new Set(resultSelections.map(row=>row.reference.object_id)).size!==resultSelections.length;
  const candidateKey=JSON.stringify([...candidates.keys()].sort());
  useEffect(()=>{
    // Even an externally removed selection that later returns cannot
    // resurrect a pending or completed preview for the earlier selection.
    sequence.current++;setDetail(null);setDraftAttempt(null);setSelections({});setNativeStep("");setBusy(false);
  },[candidateKey]);
  const detailKey=JSON.stringify([stage?.stepId??null,resultSelections,nativeStep,candidateKey]);
  const liveDetailKey=useRef(detailKey);liveDetailKey.current=detailKey;
  const visibleDetail=detail?.reader===reader&&detail.key===detailKey?detail.report:null;
  const draftDigest=visibleDetail?.kind==='handoff'&&visibleDetail.value.subjectKind==='PERSONAL'
    &&visibleDetail.value.materialEvidence?.observation&&stage?.actor==='agent'&&stage.directPredecessorStepIds.length===0
    &&reader.createPersonalDraft&&reader.recoverPersonalDraft?visibleDetail.value.candidateDigest:null;
  const visibleAttempt=draftAttempt?.reader===reader&&draftAttempt.key===detailKey&&draftAttempt.digest===draftDigest?draftAttempt:null;
  const request:WorkspaceMethodReaderSelection={workspaceId:binding.workspaceId,projectId:binding.projectId,expected:binding.expected};
  function invalidateDetail(){
    sequence.current++;setDetail(null);setDraftAttempt(null);setBusy(false);setError("");
  }
  const checkOverview=async()=>{
    const epoch=++sequence.current,startObjects=objects;
    setBusy(true);setError("");setDetail(null);setDraftAttempt(null);setOverview(null);setSelections({});setNativeStep("");
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
    if(!stage||stage.state==="MATERIAL_REVIEW_REQUIRED"||(mode!=="material"&&duplicateResults))return;
    if((mode==="preview"||mode==="recover")&&!resultSelections.some(row=>row.stepId===nativeStep))return;
    if(mode==="material"&&typeof reader.inspectMaterialEvidence!=="function")return;
    const epoch=++sequence.current,key=detailKey;
    setBusy(true);setError("");setDetail(null);setDraftAttempt(null);
    const stillCurrent=()=>sequence.current===epoch&&liveReader.current===reader&&liveDetailKey.current===key;
    const args={...request,stepId:stage.stepId,resultSelections};
    try{
      // Existing capability advertises original content evidence. A
      // combined handoff uses one read, not a separate cached digest.
      const contentRequested=mode==="handoff"&&typeof reader.inspectMaterialEvidence==="function";
      const report:Detail=mode==="handoff"?{kind:"handoff",value:await reader.previewHandoff(
          contentRequested?{...args,includeMaterialEvidence:true}:args)}:
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
  const saveDraft=async(recoverOnly:boolean)=>{
    if(busy||!stage||!draftDigest||!reader.createPersonalDraft||!reader.recoverPersonalDraft
        ||(recoverOnly?visibleAttempt?.state!=='OUTCOME_UNKNOWN':!!visibleAttempt))return;
    const epoch=++sequence.current,key=detailKey,digest=draftDigest;
    setBusy(true);setError("");setDraftAttempt({reader,key,digest,state:null});
    const current=()=>sequence.current===epoch&&liveReader.current===reader&&liveDetailKey.current===key;
    try{
      const args={...request,stepId:stage.stepId,resultSelections:[],expectedCandidateDigest:digest};
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
          {stage.directPredecessorStepIds.length>0&&<div className="space-y-2">
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
          <div className="flex flex-wrap gap-2">
            {reader.inspectMaterialEvidence&&<button type="button" className={button} disabled={busy||stage.state==="MATERIAL_REVIEW_REQUIRED"}
              onClick={()=>void inspect("material")}>Проверить содержимое и вложения</button>}
            <button type="button" className={button} disabled={busy||duplicateResults||stage.state==="MATERIAL_REVIEW_REQUIRED"}
              onClick={()=>void inspect("handoff")}>Подготовить передачу</button>
          </div>
          {binding.nativeRecipientLabel&&stage.directPredecessorStepIds.length>0&&<div className="space-y-2">
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
        {visibleDetail.value.materialEvidenceRequested&&!visibleDetail.value.materialEvidence&&
          <p className="text-slate-400">Проверка содержимого ожидает подтверждения входных ссылок и результатов предшественников.</p>}
        <p className="text-slate-300">До запуска необходимо:</p>
        <ul className="list-disc pl-4 text-slate-400">{visibleDetail.value.requiredOriginalOwnerChecks.map(key=><li key={key}>{checkLabels[key]??"Проверка оригинального владельца"}</li>)}</ul>
        <p className="text-slate-300">Задача не создана. Запуск не выполнялся.</p>
        {draftDigest&&<div className="space-y-1 border-t border-slate-800 pt-2" data-testid="workflow-personal-draft">
          <p className="text-slate-400">Передаются доступные текстовые входы в редактируемый черновик. Полнота вложений и запуск требуют отдельной проверки.</p>
          {!visibleAttempt&&<button type="button" className={button} disabled={busy} onClick={()=>void saveDraft(false)}>Передать в черновик Agent</button>}
          {visibleAttempt?.state&&<p role="status" className="text-slate-200">{draftLabels[visibleAttempt.state]}</p>}
          {visibleAttempt?.state==='OUTCOME_UNKNOWN'&&<button type="button" className={button} disabled={busy} onClick={()=>void saveDraft(true)}>Проверить черновик Agent</button>}
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
