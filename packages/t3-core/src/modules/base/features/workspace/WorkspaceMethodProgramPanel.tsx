import {useEffect,useRef,useState} from "react";
import type {WorkspaceMethodReaderSelection,WorkspaceMethodOverviewStage,WorkspaceMethodProgramSelection,
  WorkspaceMethodProgramWorkPort,WorkspaceMethodProgramWorkPreview,WorkspaceMethodProgramWorkReceipt} from "../../../../t3/workspace-method-stage-reader.mjs";

const hex=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const exactText=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&value.trim()===value;
const area=(value:unknown)=>typeof value==="string"&&/^(personal|AREA-[a-f0-9]{18})$/.test(value);
const positive=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>0;
type Ref=WorkspaceMethodReaderSelection["expected"]["projectRef"];
function sameRef(a:Ref,b:Ref){return !!a&&!!b&&a.family===b.family&&a.objectId===b.objectId&&a.recordId===b.recordId&&a.revision===b.revision;}
function exactExpected(a:WorkspaceMethodReaderSelection["expected"],b:WorkspaceMethodReaderSelection["expected"]){
  return !!a&&sameRef(a.projectRef,b.projectRef)&&Array.isArray(a.workRefs)&&a.workRefs.length===b.workRefs.length
    &&new Set(a.workRefs.map(row=>row.objectId)).size===a.workRefs.length
    &&b.workRefs.every(row=>a.workRefs.some(item=>sameRef(item,row)));
}
export function selectedProgramWorkMatches(value:WorkspaceMethodProgramSelection,request:WorkspaceMethodReaderSelection,stage:WorkspaceMethodOverviewStage){
  const prior=value?.programResultSelections??[];
  return value?.workspaceId===request.workspaceId&&value.projectId===request.projectId&&value.stepId===stage.stepId
    &&exactExpected(value.expected,request.expected)&&Array.isArray(prior)&&prior.length===stage.directPredecessorStepIds.length
    &&new Set(prior.map(row=>row.stepId)).size===prior.length
    &&new Set(prior.map(row=>row.taskId)).size===prior.length&&new Set(prior.map(row=>row.receiptId)).size===prior.length
    &&prior.every(row=>stage.directPredecessorStepIds.includes(row.stepId)&&exactText(row.taskId,105)&&exactText(row.receiptId,104)&&hex(row.candidateDigest))
    &&exactText(value.sourceAsset?.objectId)&&exactText(value.sourceAsset?.assetId)&&positive(value.sourceAsset?.revision)
    &&exactText(value.sourceAsset?.name,255)&&exactText(value.program?.providerId,100)&&exactText(value.program?.operation,100)
    &&exactText(value.program?.connectionEpoch,256)&&typeof value.program?.trustedCodeConfirmed==="boolean";
}
export function programWorkPreviewMatches(value:WorkspaceMethodProgramWorkPreview,selection:WorkspaceMethodProgramSelection,stage:WorkspaceMethodOverviewStage){
  return value?.state==="ORIGINAL_PROGRAM_WORK_PREVIEW_READY"&&value.workspaceId===selection.workspaceId
    &&value.projectId===selection.projectId&&value.stepId===stage.stepId&&sameRef(value.projectRef,selection.expected.projectRef)
    &&sameRef(value.workRef,stage.workRef)&&hex(value.candidateDigest)&&hex(value.previewDigest)&&/^workflow-[a-f0-9]{64}$/.test(value.requestId)
    &&area(value.agentWorkspaceId)&&value.providerId===selection.program.providerId&&value.operation===selection.program.operation
    &&value.source?.objectId===selection.sourceAsset.objectId&&value.source.assetId===selection.sourceAsset.assetId
    &&value.source.revision===selection.sourceAsset.revision&&value.source.name===selection.sourceAsset.name
    &&positive(value.source.objectRevision)&&positive(value.source.bytes)&&value.source.bytes<=500000&&hex(value.source.sha256)
    &&value.nativeSource?.name===value.source.name&&positive(value.nativeSource.bytes)&&value.nativeSource.bytes<=500000&&hex(value.nativeSource.sha256)
    &&value.predecessorCount===(selection.programResultSelections??[]).length
    &&value.fleetAssignmentCount===(selection.fleetAssignments??[]).length&&value.trustedCodeConfirmed===selection.program.trustedCodeConfirmed
    &&value.taskCreated===false&&value.executionPerformed===false&&value.executionAuthority===false
    &&value.workCompleted===false&&value.finalHumanAcceptanceProven===false;
}
export function programWorkReceiptMatches(value:WorkspaceMethodProgramWorkReceipt,preview:WorkspaceMethodProgramWorkPreview){
  return !!value&&["READY_FOR_REVIEW","TASK_AVAILABLE","RECOVERY_REQUIRED"].includes(value.state)
    &&value.workspaceId===preview.workspaceId&&value.projectId===preview.projectId&&value.stepId===preview.stepId
    &&value.candidateDigest===preview.candidateDigest&&value.previewDigest===preview.previewDigest&&value.requestId===preview.requestId
    &&value.agentWorkspaceId===preview.agentWorkspaceId&&/^TASK-U01-[a-f0-9]{20}$/.test(value.taskId)
    &&typeof value.reused==="boolean"&&value.executionPerformed===false&&value.executionAuthority===false
    &&value.workCompleted===false&&value.finalHumanAcceptanceProven===false;
}
const names:Readonly<Record<string,string>>={QGIS_PROCESSING_V1:"QGIS",VALHALLA_ROUTING_V1:"Valhalla",
  ORTOOLS_ALLOCATION_V1:"OR-Tools",RUST4PM_V1:"Rust4PM",MESA_MODEL_V1:"Mesa",SIMPY_MODEL_V1:"SimPy"};
const button="min-h-[44px] px-3 py-1.5 rounded border border-slate-700 text-xs disabled:opacity-40";
type Prepared={port:WorkspaceMethodProgramWorkPort;selection:WorkspaceMethodProgramSelection;preview:WorkspaceMethodProgramWorkPreview};
type Props={port:WorkspaceMethodProgramWorkPort;request:WorkspaceMethodReaderSelection;stage:WorkspaceMethodOverviewStage};
export function WorkspaceMethodProgramPanel({port,request,stage}:Props){
  const [preparedState,setPrepared]=useState<Prepared|null>(null);
  const [receiptState,setReceipt]=useState<WorkspaceMethodProgramWorkReceipt|null>(null);
  const prepared=preparedState?.port===port?preparedState:null;
  const receipt=prepared?receiptState:null;
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [uncertain,setUncertain]=useState(false);
  const generation=useRef(0),lock=useRef(false),livePort=useRef(port);
  livePort.current=port;
  useEffect(()=>{generation.current++;lock.current=false;setPrepared(null);setReceipt(null);setBusy(false);setError("");setUncertain(false);
    return()=>{generation.current++;lock.current=false;};},[port]);
  const disabled=stage.actor!=="program"||stage.state==="MATERIAL_REVIEW_REQUIRED";
  function start(){if(lock.current||disabled)return null;lock.current=true;setBusy(true);setError("");return ++generation.current;}
  function current(token:number){return generation.current===token&&livePort.current===port;}
  function finish(token:number){if(current(token)){lock.current=false;setBusy(false);}}
  async function select(){
    const token=start();if(token===null)return;
    // No stale consent may survive a new selection or cancelled picker.
    setPrepared(null);setReceipt(null);setUncertain(false);
    try{
      const chosen=await port.selectInputs({...request,stepId:stage.stepId});
      if(!current(token)||chosen===null)return;
      if(!selectedProgramWorkMatches(chosen,request,stage))throw Error("selection mismatch");
      const selection=structuredClone(chosen);
      const preview=await port.preview(structuredClone(selection));
      if(!current(token))return;
      if(!programWorkPreviewMatches(preview,selection,stage))throw Error("preview mismatch");
      setPrepared({port,selection,preview:structuredClone(preview)});
    }catch{if(current(token))setError("Не удалось подтвердить программу и исходные материалы. Выберите их заново.");}
    finally{finish(token);}
  }
  async function prepare(){
    if(!prepared||receipt)return;
    const token=start();if(token===null)return;
    try{
      const {selection,preview}=prepared;
      const result=await port.prepare({selection:structuredClone(selection),requestId:preview.requestId,previewDigest:preview.previewDigest});
      if(!current(token))return;
      if(!programWorkReceiptMatches(result,preview))throw Error("receipt mismatch");
      setReceipt(structuredClone(result));setUncertain(false);
    }catch{if(current(token)){setUncertain(true);setError("Создание задачи не подтверждено. Повторите тот же запрос или проверьте входы заново. Новая задача не будет создаваться по тому же запросу.");}}
    finally{finish(token);}
  }
  async function open(){
    if(!receipt)return;
    const token=start();if(token===null)return;
    try{await port.openTask(structuredClone(receipt));}
    catch{if(current(token))setError("Не удалось открыть оригинальную задачу Agent.");}
    finally{finish(token);}
  }
  return <div data-testid="workflow-program-work" className="space-y-2 border-t border-slate-800 pt-2 text-xs">
    <p className="text-slate-300">Выберите установленную программу, исходный файл и результаты предшествующих работ.</p>
    <button type="button" className={button} disabled={busy||disabled} onClick={()=>void select()}>Выбрать программу и материалы</button>
    {busy&&<p role="status" className="text-slate-300">Проверка оригинального Agent…</p>}
    {error&&<p role="alert" className="text-amber-200">{error}</p>}
    {prepared&&<div data-testid="workflow-program-preview" className="space-y-1 rounded border border-slate-700 p-2">
      <p className="text-sm font-semibold text-slate-100">{names[prepared.preview.providerId]??prepared.preview.providerId}</p>
      <p className="break-words">Операция: {prepared.preview.operation}</p>
      <p className="break-words">Файл: {prepared.preview.source.name} · ред. {prepared.preview.source.revision} · {prepared.preview.source.bytes} байт</p>
      <p>Результатов предшественников: {prepared.preview.predecessorCount}. Назначений машин: {prepared.preview.fleetAssignmentCount}.</p>
      {(prepared.selection.programResultSelections??[]).map(row=><p key={row.stepId} className="break-words text-slate-400">Работа {row.stepId}: {row.taskId} · {row.receiptId}</p>)}
      {(prepared.selection.fleetAssignments??[]).map(row=><p key={row.vehicleId} className="break-words">Машина {row.vehicleId}: {row.stepId}, {row.tariff.per_kilometre} {row.tariff.cost_unit}/км, {row.tariff.per_hour} {row.tariff.cost_unit}/ч</p>)}
      {Object.keys(prepared.selection.program.parameters).length>0&&<details><summary className="cursor-pointer text-slate-400">Параметры операции</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(prepared.selection.program.parameters,null,2)}</pre></details>}
      {prepared.preview.nativeSource.sha256!==prepared.preview.source.sha256&&<p>Проверенный вычислительный вход сформирован из сохранённых результатов.</p>}
      {prepared.preview.trustedCodeConfirmed&&<p className="text-amber-200">Выбран исполняемый код. Перед запуском требуется отдельное подтверждение.</p>}
      <p className="text-slate-400">Исходные данные проверены. Создание задачи не запускает программу.</p>
      {!receipt&&<button type="button" className={button} disabled={busy||disabled} onClick={()=>void prepare()}>{uncertain?"Повторить тот же запрос":"Создать задачу Agent"}</button>}
    </div>}
    {receipt&&<div role="status" data-testid="workflow-program-task-receipt" className="space-y-1">
      <p>{receipt.state==="RECOVERY_REQUIRED"?"Задача существует, требуется восстановление в Agent.":
        receipt.state==="TASK_AVAILABLE"?"Оригинальная задача найдена.":"Задача сохранена и доступна для проверки в Agent."}</p>
      <p className="break-words text-slate-400">{receipt.taskId}</p>
      <p className="text-slate-400">Программа не запущена. Работа не засчитана выполненной.</p>
      <button type="button" className={button} disabled={busy||disabled} onClick={()=>void open()}>{receipt.state==="RECOVERY_REQUIRED"?"Открыть задачу для восстановления":"Открыть задачу Agent"}</button>
    </div>}
  </div>;
}
