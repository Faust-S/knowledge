import {useEffect,useRef,useState} from "react";
import type {KernelFacade} from "@/workspace-contract";
import {readOriginalCompanyWorkspace,type CompanyWorkspaceReadback as Readback} from "../../../../t3/company-workspace-readback.mjs";
const labels={TASK:"Поручение",DRAFT:"Черновик",DOCUMENT:"Документ",RESULT:"Результат",HISTORY:"История"} as const;

// Read only the selected original T2 Workspace. This is a view of the
// existing records, not a separate inbox or a manager acceptance receipt.
export function CompanyWorkspaceReadback({kernel,workspaceId}:{kernel:KernelFacade;workspaceId:string|null}){
  const generation=useRef(0);
  const [data,setData]=useState<Readback|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(false);
  const [page,setPage]=useState(0);
  useEffect(()=>{
    generation.current++;
    setData(null);setBusy(false);setError(false);setPage(0);
    return ()=>{generation.current++};
  },[kernel,workspaceId]);
  const refresh=async()=>{
    const ticket=++generation.current;
    setBusy(true);setError(false);setData(null);setPage(0);
    try{
      const active=(await kernel.listWorkspaces({include_deleted:false})).filter(w=>!w.deleted_at);
      if(active.length!==1||(workspaceId&&active[0].workspace_id!==workspaceId))throw Error("WORKSPACE_SCOPE");
      const result=await readOriginalCompanyWorkspace({kernel,workspaceId:active[0].workspace_id});
      if(ticket===generation.current)setData(result);
    }catch{if(ticket===generation.current)setError(true)}
    finally{if(ticket===generation.current)setBusy(false)}
  };
  const size=20,total=data?.records.length??0;
  return <section className="space-y-3 border-t border-slate-800 pt-3" aria-label="Рабочие записи организации">
    <h3 className="text-sm font-semibold text-slate-200">Рабочие записи организации</h3>
    <p className="text-xs text-slate-400">Чтение поручений, документов и результатов из исходной Workspace.
      Наличие записи не означает принятие подписанного результата руководителем.</p>
    <button type="button" disabled={busy} onClick={()=>void refresh()} className="px-3 py-2 rounded border border-slate-700 text-xs min-h-11">Прочитать рабочие записи</button>
    {busy&&<p role="status">Чтение исходной Workspace...</p>}
    {error&&<p role="alert" className="text-xs text-amber-300">Не удалось подтвердить рабочие записи и их исходные события. Запись не выполнялась.</p>}
    {data&&<div className="space-y-2">
      <p role="status" className="text-xs text-slate-300">{`Подтверждены рабочие записи: ${total}`}</p>
      {data.records.slice(page*size,(page+1)*size).map(row=>
        <details key={row.objectId} className="border border-slate-800 rounded p-2">
          <summary className="text-sm cursor-pointer break-words">{labels[row.kind]}: {row.taskId}</summary>
          <p className="text-xs text-slate-400 break-all">Исполнитель: {row.executorId}. Редакция: {row.taskRevisionId}</p>
          <p className="text-xs text-slate-400 break-all">SHA-256: {row.sha256}</p>
          <pre className="whitespace-pre-wrap break-words text-sm text-slate-200">{row.text}</pre>
        </details>)}
      {total>size&&<div className="flex items-center gap-2 text-xs">
        <button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Назад</button>
        <span>{page+1} / {Math.ceil(total/size)}</span>
        <button disabled={(page+1)*size>=total} onClick={()=>setPage(p=>p+1)}>Далее</button>
      </div>}
    </div>}
  </section>
}
