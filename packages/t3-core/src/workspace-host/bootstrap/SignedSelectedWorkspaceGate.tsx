/**
 * Signed first-run in the single original T2 Host. Neither the route nor a
 * user-entered ID can select a corporate Workspace. Only the original
 * Control-selected signed create port can supply its exact Workspace ID.
 */
import {useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import type {CommandsFacade,KernelFacade} from "@/workspace-contract";
import type {CreateWorkspaceHostRuntimeInput} from "@/workspace-host/runtime";
import type {createTrustedAgeExchange,createTrustedPublisherHandoff}
  from "@/t3/index.mjs";
import {ImportView} from "@/modules/exchange/features/packages/ImportView";
import {PublisherLicensePanel} from "@/modules/exchange/features/packages/PublisherLicensePanel";

type SignedResolver=CreateWorkspaceHostRuntimeInput["signedKernelAccess"];
type Phase="checking"|"ready"|"missing"|"denied";
type FirstRunStage="READ_CONTEXT"|"READ_KERNEL"|"VERIFY_RECORD"|"LIST_KERNEL";
type SelectedScope=Readonly<{kind:"CORP"|"PERSONAL";workspace_id:string;resource:string;organization_id:string|null}>;
type Inspection={kernel:KernelFacade|null;phase:Phase;scope?:SelectedScope;
  failure?:{stage:FirstRunStage;code:string}};
function failureCode(error:unknown):string {
  // Only bounded original protocol codes. Never expose a path, bearer, key,
  // exception text or other subject data on the installed UI surface.
  const code=(error as {code?:unknown}|null)?.code;
  return typeof code==="string"&&
    (/^T3_[A-Z0-9_]{3,96}$/.test(code)||
      ["WORKSPACE_NOT_FOUND","PERMISSION_DENIED","OPERATION_NOT_GRANTED","KERNEL_UNAVAILABLE"].includes(code))
    ?code:"T3_D1_SELECTED_WORKSPACE_UNVERIFIED";
}
function selectedScope(value:{kind?:unknown;workspace_id?:unknown;resource?:unknown;
  organization_id?:unknown}|null|undefined):SelectedScope|null{
  if((value?.kind!=="CORP"&&value?.kind!=="PERSONAL")||
     typeof value.workspace_id!=="string"||!ID.test(value.workspace_id)||
     value.resource!==value.workspace_id||
     (value.kind==="PERSONAL"?value.organization_id!==null:
       typeof value.organization_id!=="string"||!ID.test(value.organization_id)))return null;
  return Object.freeze({kind:value.kind,workspace_id:value.workspace_id,resource:value.workspace_id,
    organization_id:value.organization_id as string|null});
}
const sameScope=(left:SelectedScope,right:SelectedScope)=>
  left.kind===right.kind&&left.organization_id===right.organization_id&&
  left.workspace_id===right.workspace_id&&left.resource===right.resource;
type FirstRunExchange=Readonly<{
  kernel:KernelFacade;
  commands:CommandsFacade;
  protectedExchange:ReturnType<typeof createTrustedAgeExchange>|null;
  publisherHandoff:ReturnType<typeof createTrustedPublisherHandoff>|null;
}>;
const denied=(code:string)=>Object.assign(new Error(code),{code});
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
// Original T2 Runtime 1.3.0 may report a genuinely missing Workspace as
// null or with its typed WORKSPACE_NOT_FOUND code. ONLY that exact pre-write
// absence allows the existing signed first-run UI to offer an independent
// create ACTION. No permission denial, revoked grant or lost-write ACK is
// reclassified as missing, and the original signed Kernel stays authoritative.
async function readSelectedBeforeWrite(kernel:KernelFacade,workspaceId:string){
  try{return await kernel.getWorkspace(workspaceId);}
  catch(error){
    if((error as {code?:unknown}|null)?.code==="WORKSPACE_NOT_FOUND")return null;
    throw error;
  }
}

export function SignedSelectedWorkspaceGate({
  required,kernel,profile,signedKernelAccess,trustedSelectedContext,
  autoCreateSignedCorporate=true,firstRunExchange=null,children,
}:{
  required:boolean;
  kernel:KernelFacade|null;
  profile?:string;
  autoCreateSignedCorporate?:boolean;
  signedKernelAccess?:SignedResolver;
  trustedSelectedContext?: (operation:string)=>Promise<{
    kind:"CORP"|"PERSONAL";workspace_id:string;resource:string;
    organization_id?:string|null;
  }|null>;
  firstRunExchange?:FirstRunExchange|null;
  children:ReactNode;
}){
  const [inspection,setInspection]=useState<Inspection>({kernel:null,phase:"checking"});
  const [retry,setRetry]=useState(0);
  const [busy,setBusy]=useState(false);
  const [createError,setCreateError]=useState<string|null>(null);
  const generation=useRef(0),running=useRef(false);
  const attemptedSignedCreate=useRef(new WeakMap<KernelFacade,Set<string>>());

  useEffect(()=>{
    const ticket=++generation.current;
    if(!required||!kernel)return;
    setInspection({kernel,phase:"checking"});
    setCreateError(null);
    // The installed original Control has no generic listWorkspaces grant.
    // Its signed getWorkspace context selects ONE exact Workspace ID.
    // Do not enumerate other organizations as a first-run prerequisite.
    let stage:FirstRunStage=trustedSelectedContext?"READ_CONTEXT":"LIST_KERNEL";
    void (async()=>{
      if(trustedSelectedContext){
        const context=selectedScope(await trustedSelectedContext("getWorkspace"));
        if(!context)throw denied("T3_D1_SELECTED_CONTEXT_NOT_TRUSTED");
        if(ticket!==generation.current)return;
        const selected=context.workspace_id;
        stage="READ_KERNEL";
        const original=await readSelectedBeforeWrite(kernel,selected);
        if(ticket!==generation.current)return;
        stage="VERIFY_RECORD";
        if(original&&(original.workspace_id!==selected||
            original.deleted_at||Boolean(profile&&original.profile!==profile)))
          throw denied("T3_D1_WORKSPACE_READBACK_MISMATCH");
        setInspection({kernel,phase:original?"ready":"missing",scope:context});
        return;
      }
      // Other existing signed Hosts keep their original bounded discovery.
      const rows=await kernel.listWorkspaces({include_deleted:false});
      if(ticket!==generation.current)return;
      if(!Array.isArray(rows)||rows.length>1||
         rows.some(row=>!row||typeof row.workspace_id!=="string")){
        throw denied("T3_D1_WORKSPACE_LIST_UNVERIFIED");
      }
      setInspection({kernel,phase:rows.length===1&&!rows[0].deleted_at
        ? "ready":"missing"});
    })().catch(error=>{
      if(ticket===generation.current)setInspection({kernel,phase:"denied",failure:{stage,code:failureCode(error)}});
    });
    return ()=>{generation.current++;};
  },[required,kernel,retry,trustedSelectedContext,profile]);

  const phase=kernel&&inspection.kernel===kernel?inspection.phase:"checking";
  const refresh=useCallback(()=>setRetry(n=>n+1),[]);
  const create=useCallback(async()=>{
    if(!required||!kernel||(!signedKernelAccess&&!trustedSelectedContext)||
       running.current||phase!=="missing")return;
    const ticket=generation.current;
    running.current=true;setBusy(true);setCreateError(null);
    try{
      // Authority lives only in the original Control AccessRegistry.
      // Resolving a port does not grant a right; the actual createWorkspace
      // call below still performs JIT through the signed KernelFacade.
      const context=trustedSelectedContext
        ? await trustedSelectedContext("createWorkspace")
        : await (async()=>{
            const port=typeof signedKernelAccess==="function"
              ? await signedKernelAccess("createWorkspace"):signedKernelAccess;
            if(!port)return null;
            return await port.currentContext() as {
              kind?:unknown;workspace_id?:unknown;resource?:unknown;
              organization_id?:unknown}|null;
          })();
      if(!context)throw denied("T3_D1_WORKSPACE_CREATE_GRANT_REQUIRED");
      const scope=selectedScope(context);
      if(!scope)throw denied("T3_D1_CREATE_CONTEXT_NOT_TRUSTED");
      if(ticket!==generation.current)return;
      if(trustedSelectedContext&&(!inspection.scope||!sameScope(inspection.scope,scope)))
        throw denied("T3_D1_CREATE_SCOPE_CHANGED");
      const selected=scope.workspace_id;
      if(!profile||!kernel.hasOperation("t1.createWorkspace"))
        throw denied("T3_D1_KERNEL_CREATE_UNAVAILABLE");
      // Stable Admin-selected ID handles uncertain write acknowledgement.
      // Re-read before any write, never create another Workspace ID.
      const previous=await readSelectedBeforeWrite(kernel,selected);
      if(ticket!==generation.current)return;
      if(previous){
        if(previous.workspace_id!==selected||previous.deleted_at||previous.profile!==profile)
          throw denied("T3_D1_WORKSPACE_READBACK_MISMATCH");
      }else{
        let uncertain:unknown=null;
        try{
          const receipt=await kernel.createWorkspace({workspace_id:selected,profile});
          if(!receipt||receipt.workspace_id!==selected||receipt.profile!==profile)
            throw denied("T3_D1_WORKSPACE_RECEIPT_MISMATCH");
        }catch(e){uncertain=e;}
        if(ticket!==generation.current)return;
        const observed=await kernel.getWorkspace(selected);
        if(!observed){
          if(uncertain)throw uncertain;
          throw denied("T3_D1_WORKSPACE_READBACK_MISSING");
        }
        if(observed.workspace_id!==selected||observed.deleted_at||
           observed.profile!==profile)
          throw denied("T3_D1_WORKSPACE_READBACK_MISMATCH");
      }
      if(ticket!==generation.current)return;
      setInspection({kernel,phase:"ready",scope});
    }catch(e){
      if(ticket!==generation.current)return;
      const code=failureCode(e);
      setCreateError(code==="T3_D1_WORKSPACE_CREATE_GRANT_REQUIRED"
        ? "Администратор не выдал отдельное подписанное право создания Workspace. Запросите его в Control и откройте Workspace заново."
        : code==="T3_D1_CREATE_SCOPE_CHANGED"
          ? "Выбранная область изменилась. Проверьте её повторно. Создание не выполнялось."
          : "Не удалось подтвердить создание в исходном Kernel. Проверьте полномочия и нажмите «Проверить повторно». Новая область автоматически не создаётся. ("+code+")");
    }finally{
      running.current=false;
      if(ticket===generation.current)setBusy(false);
    }
  },[required,kernel,signedKernelAccess,trustedSelectedContext,profile,phase,inspection.scope]);

  // The employee's original signed company key opens/creates its one T2
  // Workspace. No second manual create action is required when the ORIGINAL
  // Control issued the distinct workspace.create right. PERSONAL/generic
  // hosts retain their original explicit first-run UI.
  useEffect(()=>{
    if(!autoCreateSignedCorporate||!required||!kernel||
       phase!=="missing"||!profile||!trustedSelectedContext||
       !kernel.hasOperation("t1.createWorkspace"))return;
    let active=true;
    const ticket=generation.current;
    void (async()=>{
      const context=selectedScope(await trustedSelectedContext("createWorkspace"));
      if(!active||ticket!==generation.current||context?.kind!=="CORP")return;
      if(!inspection.scope||!sameScope(inspection.scope,context)){
        setCreateError("Выбранная область изменилась. Проверьте её повторно. Создание не выполнялось.");
        return;
      }
      const key=[context.organization_id,context.workspace_id,profile].join("\u0000");
      let seen=attemptedSignedCreate.current.get(kernel);
      if(!seen){seen=new Set<string>();attemptedSignedCreate.current.set(kernel,seen);}
      if(seen.has(key))return;
      seen.add(key);
      await create(); // Existing signed JIT, same original Kernel, cold readback
    })().catch(()=>{}); // No unsigned fallback and no unobserved retry
    return ()=>{active=false;};
  },[autoCreateSignedCorporate,required,kernel,phase,profile,
      trustedSelectedContext,create,inspection.scope]);

  if(!required)return <>{children}</>;
  if(phase==="ready")return <>{children}</>;
  return (
    <section aria-live="polite" data-testid="t3-d1-selected-workspace-gate"
      className="mx-auto max-w-xl p-6 space-y-3">
      {phase==="checking" ? (
        <p role="status">Проверяем выбранную подписанную Workspace через Control…</p>
      ):(
        <>
          <h2 className="font-semibold">Подписанная Workspace недоступна</h2>
          <p role="alert" data-testid="t3-d1-selected-workspace-message">
            {phase==="missing"
              ? "Для выбранного профиля пока нет рабочей области в исходном Kernel. При наличии отдельного разрешения её можно создать здесь."
              : "Control не подтвердил чтение выбранной Workspace. Проверьте профиль и его полномочия в локальном Control."}
          </p>
          {phase==="denied"&&inspection.failure&&<p data-testid="t3-d1-selected-workspace-diagnostic"
            className="text-xs text-slate-300">IWXA: {inspection.failure.stage}: {inspection.failure.code}</p>}
          {createError&&<p role="alert" data-testid="t3-d1-create-workspace-error"
            className="text-sm text-amber-300">{createError}</p>}
          {phase==="missing"&&(signedKernelAccess||trustedSelectedContext)&&
            kernel?.hasOperation("t1.createWorkspace")&&(
            <button type="button" data-testid="t3-d1-create-selected-workspace"
              onClick={()=>void create()} disabled={busy}
              className="rounded border px-3 py-2 text-sm disabled:opacity-50">
              {busy?"Создаём и проверяем…":"Создать выбранную Workspace"}
            </button>
          )}
          <button type="button" onClick={refresh} disabled={busy}
            className="rounded border px-3 py-2 text-sm disabled:opacity-50">
            Проверить повторно
          </button>
          {firstRunExchange && (firstRunExchange.publisherHandoff ||
            (firstRunExchange.protectedExchange?.canOpen === true &&
              firstRunExchange.kernel.hasOperation("t2.importPreview"))) && (
            <section data-testid="t3-d7-first-run-exchange"
              aria-label="Лицензия и восстановление"
              className="space-y-3 border border-slate-700 rounded p-3">
              <h3 className="text-sm font-semibold">Лицензия и восстановление</h3>
              <p className="text-xs text-slate-300">
                Эти действия выполняются исходными владельцами установленной
                программы. Они не предоставляют доступ к рабочим данным
                без отдельного подписанного разрешения.
              </p>
              {firstRunExchange.publisherHandoff && (
                <PublisherLicensePanel handoff={firstRunExchange.publisherHandoff}/>
              )}
              {firstRunExchange.protectedExchange?.canOpen === true &&
                firstRunExchange.kernel.hasOperation("t2.importPreview") && (
                  <ImportView kernel={firstRunExchange.kernel}
                    commands={firstRunExchange.commands}
                    protectedExchange={firstRunExchange.protectedExchange}/>
                )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
