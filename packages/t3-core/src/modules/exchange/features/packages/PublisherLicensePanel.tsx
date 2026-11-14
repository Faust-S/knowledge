import {useEffect,useRef,useState} from "react";
import type {
  createTrustedPublisherHandoff,T3PublisherHandoffKind,
  T3PublisherHandoffPreview,T3PublisherHandoffResult,
} from "../../../../t3/index.mjs";

const MAX_BYTES=4*1024*1024;
type PublisherPort=ReturnType<typeof createTrustedPublisherHandoff>;

export function PublisherLicensePanel({handoff}:{handoff:PublisherPort}){
  const [kind,setKind]=useState<T3PublisherHandoffKind>("LICENSE");
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState<T3PublisherHandoffPreview|null>(null);
  const [result,setResult]=useState<T3PublisherHandoffResult|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [attempted,setAttempted]=useState(false);
  const jobRef=useRef(false);
  const generation=useRef(0);
  useEffect(()=>()=>{
    generation.current++;
    jobRef.current=false;
  },[handoff]);

  const reset=()=>{
    generation.current++;
    setPreview(null);
    setResult(null);
    setError(null);
    setAttempted(false);
  };
  const selectKind=(next:T3PublisherHandoffKind)=>{
    if(jobRef.current)return;
    reset();setKind(next);setFile(null);
  };
  const selectFile=(next:File|null)=>{
    if(jobRef.current)return;
    reset();setFile(next);
  };
  const readBytes=async()=>{
    if(!file||!file.name.toLowerCase().endsWith(".iwxa")||
      file.size<4||file.size>MAX_BYTES)
      throw Error("Нужен исходный пакет Publisher .iwxa размером не более 4 МиБ.");
    return new Uint8Array(await file.arrayBuffer());
  };
  const execute=async(action:"preview"|"admit"|"recover")=>{
    if(jobRef.current||!file)return;
    if(action==="admit"&&(!preview||attempted||preview.status!=="VERIFIED_PENDING_CONSENT"))return;
    jobRef.current=true;
    setBusy(true);
    setError(null);
    const ticket=++generation.current;
    try{
      const archiveBytes=await readBytes();
      if(ticket!==generation.current)return;
      const input={kind,archiveBytes};
      if(action==="preview"){
        const response=await handoff.preview(input);
        if(ticket===generation.current){setPreview(response);setResult(null);}
      }else if(action==="admit"){
        // May be COMMITTED when the ACK is lost. Block a second apply.
        setAttempted(true);
        const response=await handoff.admit({...input,previewDigest:preview!.previewDigest});
        if(ticket===generation.current){
          setResult(response);
          if(response.status==="USER_CANCELLED")setAttempted(false);
        }
      }else{
        const response=await handoff.recover(input);
        if(ticket===generation.current){setResult(response);setAttempted(true);}
      }
    }catch(e){
      if(ticket===generation.current){
        setError(e instanceof Error?e.message:"Владелец Publisher недоступен.");
        if(action==="admit")setAttempted(true);
      }
    }finally{
      jobRef.current=false;
      if(ticket===generation.current)setBusy(false);
    }
  };
  return <section aria-label="Лицензии Publisher"
    data-testid="t3-publisher-license-panel"
    className="space-y-3 border border-slate-700 rounded p-3">
    <h3 className="text-sm font-semibold text-slate-100">
      Лицензии Publisher и подписанные статусы
    </h3>
    <p className="text-xs text-slate-400">
      Только для подключённого установленного владельца Publisher.
      Лицензия на функции программы не предоставляет прав на чужие данные.
      Подлинность проверяется по заранее установленным ключам издателя,
      а отзыв сохраняется штатным владельцем.
    </p>
    <label className="flex items-center gap-2 text-xs text-slate-300">
      Вид пакета
      <select value={kind} onChange={e=>selectKind(e.target.value as T3PublisherHandoffKind)}
        disabled={busy} data-testid="publisher-package-kind"
        className="border border-slate-700 rounded bg-slate-900 p-2">
        <option value="LICENSE">Лицензия</option>
        <option value="STATUS">Статус, отзыв или продление</option>
      </select>
    </label>
    <input type="file" accept=".iwxa" disabled={busy}
      aria-label="Выберите подписанный пакет Publisher .iwxa"
      data-testid="publisher-package-file"
      onChange={e=>{
        const next=e.currentTarget.files?.[0]??null;
        e.currentTarget.value="";
        selectFile(next);
      }} className="text-xs"/>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!file||busy}
        onClick={()=>void execute("preview")} data-testid="publisher-package-preview"
        className="px-3 py-2 min-h-[44px] text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40">
        Проверить подпись и получателя
      </button>
      <button type="button" disabled={!preview||busy||attempted||
        preview.status!=="VERIFIED_PENDING_CONSENT"}
        onClick={()=>void execute("admit")} data-testid="publisher-package-admit"
        className="px-3 py-2 min-h-[44px] text-xs rounded bg-emerald-900/70 hover:bg-emerald-900 disabled:opacity-40">
        Подтвердить применение
      </button>
      <button type="button" disabled={!file||busy}
        onClick={()=>void execute("recover")} data-testid="publisher-package-recover"
        className="px-3 py-2 min-h-[44px] text-xs rounded border border-slate-700 disabled:opacity-40">
        Проверить ранее сохранённое
      </button>
    </div>
    {preview&&<dl data-testid="publisher-package-inspection"
      className="text-xs text-slate-400 grid grid-cols-[minmax(5rem,auto)_1fr] gap-2">
      <dt>Пакет</dt><dd className="text-slate-300 break-all">{preview.packageSha256}</dd>
      <dt>Издатель</dt><dd className="text-slate-300 break-all">{preview.publisherId}</dd>
      <dt>Получатель</dt><dd className="text-slate-300 break-all">{preview.holderId}</dd>
      <dt>Операция</dt><dd className="text-slate-300 break-all">{preview.operationId}</dd>
      {preview.licenseId&&<><dt>Лицензия</dt><dd className="text-slate-300">{preview.licenseId}</dd></>}
      {preview.sequence!==null&&<><dt>Последовательность</dt><dd className="text-slate-300">{preview.sequence}</dd></>}
      {preview.targetStatus&&<><dt>Подписанный статус</dt><dd className="text-slate-300">{preview.targetStatus}</dd></>}
      <dt>Решение</dt><dd className="text-slate-300">
        {preview.status==="RECOVER_ONLY"
          ?"Только восстановление квитанции"
          :"Подпись подтверждена владельцем, ожидается решение пользователя"}
      </dd>
    </dl>}
    {result&&<p role="status" data-testid="publisher-package-result"
      className="text-xs text-slate-200">
      {result.status==="ORIGINAL_HOLDER_READBACK_CONFIRMED"
        ? "Исходный владелец подтвердил сохранение и повторное чтение. Доступ к данным не предоставлялся."
        :result.status==="USER_CANCELLED"
          ?"Применение отменено."
          :"Результат применения неизвестен. Повторная запись заблокирована, используйте проверку сохранения."}
      {result.operationId&&<span className="block break-all text-slate-400">
        Операция: {result.operationId}
      </span>}
    </p>}
    {error&&<p role="alert" data-testid="publisher-package-error"
      className="text-xs text-rose-200">{error}</p>}
  </section>;
}
