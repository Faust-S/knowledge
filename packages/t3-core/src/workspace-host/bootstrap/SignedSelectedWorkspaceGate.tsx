/**
 * Signed first-run in the single original T2 Host. Neither the route nor a
 * user-entered ID can select a corporate Workspace. Only the original
 * Control-selected signed create port can supply its exact Workspace ID.
 */
import {useCallback,useEffect,useRef,useState,type ReactNode} from "react";
import type {KernelFacade} from "@/workspace-contract";
import type {CreateWorkspaceHostRuntimeInput} from "@/workspace-host/runtime";

type SignedResolver=CreateWorkspaceHostRuntimeInput["signedKernelAccess"];
type Phase="checking"|"ready"|"missing"|"denied";
interface Inspection {kernel:KernelFacade|null;phase:Phase}
const denied=(code:string)=>Object.assign(new Error(code),{code});
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;

export function SignedSelectedWorkspaceGate({
  required,kernel,profile,signedKernelAccess,trustedSelectedContext,children,
}:{
  required:boolean;
  kernel:KernelFacade|null;
  profile?:string;
  signedKernelAccess?:SignedResolver;
  trustedSelectedContext?: (operation:string)=>Promise<{
    kind:"CORP";workspace_id:string;resource:string;
  }|null>;
  children:ReactNode;
}){
  const [inspection,setInspection]=useState<Inspection>({kernel:null,phase:"checking"});
  const [retry,setRetry]=useState(0);
  const [busy,setBusy]=useState(false);
  const [createError,setCreateError]=useState<string|null>(null);
  const generation=useRef(0),running=useRef(false);

  useEffect(()=>{
    const ticket=++generation.current;
    if(!required||!kernel)return;
    setInspection({kernel,phase:"checking"});
    setCreateError(null);
    // The signed facade never enumerates all original T2 workspaces.
    // It executes signed getWorkspace JIT for the selected subject alone.
    void kernel.listWorkspaces({include_deleted:false}).then(rows=>{
      if(ticket!==generation.current)return;
      if(!Array.isArray(rows)||rows.length>1||
         rows.some(row=>!row||typeof row.workspace_id!=="string")){
        setInspection({kernel,phase:"denied"});return;
      }
      setInspection({kernel,phase:rows.length===1&&!rows[0].deleted_at
        ? "ready":"missing"});
    }).catch(()=>{
      if(ticket===generation.current)setInspection({kernel,phase:"denied"});
    });
    return ()=>{generation.current++;};
  },[required,kernel,retry]);

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
              kind?:unknown;workspace_id?:unknown;resource?:unknown}|null;
          })();
      if(!context)throw denied("T3_D1_WORKSPACE_CREATE_GRANT_REQUIRED");
      const selected=context?.workspace_id;
      if(context?.kind!=="CORP"||typeof selected!=="string"||
         !ID.test(selected)||context.resource!==selected)
        throw denied("T3_D1_CREATE_CONTEXT_NOT_TRUSTED");
      if(!profile||!kernel.hasOperation("t1.createWorkspace"))
        throw denied("T3_D1_KERNEL_CREATE_UNAVAILABLE");
      // Stable Admin-selected ID handles uncertain write acknowledgement.
      // Re-read before any write, never create another Workspace ID.
      const previous=await kernel.getWorkspace(selected);
      if(previous){
        if(previous.deleted_at||previous.profile!==profile)
          throw denied("T3_D1_WORKSPACE_READBACK_MISMATCH");
      }else{
        let uncertain:unknown=null;
        try{
          const receipt=await kernel.createWorkspace({workspace_id:selected,profile});
          if(!receipt||receipt.workspace_id!==selected||receipt.profile!==profile)
            throw denied("T3_D1_WORKSPACE_RECEIPT_MISMATCH");
        }catch(e){uncertain=e;}
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
      setInspection({kernel,phase:"ready"});
    }catch(e){
      if(ticket!==generation.current)return;
      const code=e&&typeof e==="object"&&"code" in e?String(e.code):"";
      setCreateError(code==="T3_D1_WORKSPACE_CREATE_GRANT_REQUIRED"
        ? "Администратор не выдал отдельное подписанное право создания Workspace. Запросите его в Control и откройте Workspace заново."
        : "Не удалось подтвердить создание в исходном Kernel. Проверьте полномочия и нажмите «Проверить повторно». Новая область автоматически не создаётся.");
    }finally{
      running.current=false;
      if(ticket===generation.current)setBusy(false);
    }
  },[required,kernel,signedKernelAccess,trustedSelectedContext,profile,phase]);

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
              ? "Для выбранной организации пока нет рабочей области в исходном Kernel. При наличии отдельного разрешения её можно создать здесь."
              : "Control не подтвердил чтение выбранной Workspace. Проверьте организацию и её полномочия в локальном Control."}
          </p>
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
        </>
      )}
    </section>
  );
}
