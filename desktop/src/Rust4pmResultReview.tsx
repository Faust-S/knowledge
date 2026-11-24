import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {reviewRust4pmResult,buildRust4pmReviewExample,R4PM_MAX_BYTES,type Rust4pmResultReview as Review}
 from '../../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const PAGE_SIZE=8;
const ERROR_TEXT:Record<string,string>={
 R4PM_ENGINE_VERSION_UNSUPPORTED:'Поддерживается исходный результат Rust4PM 0.6.2.',
 R4PM_FLOW_BALANCE_INVALID:'Частоты операций, переходов и границы траекторий не согласованы.',
 R4PM_DISCONNECTED_FLOW:'Есть фрагмент графа без связи с началом или концом траектории.',
 R4PM_GRAPH_LIMIT:'Размер графа превышает текущие пределы просмотра.',
 R4PM_VARIANT_DFG_MISMATCH:'Полные варианты траекторий не согласованы с частотами графа.',
 R4PM_VARIANT_LIMIT:'Размер набора траекторий превышает текущие пределы просмотра.',
 R4PM_FILE_LIMIT:'Выберите один JSON-файл объёмом до 8 МБ.'
};
export function Rust4pmResultReview(){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [result,setResult]=useState<Review|null>(null),[source,setSource]=useState(''),[problem,setProblem]=useState('');
 const [busy,setBusy]=useState(false),[group,setGroup]=useState(0),[page,setPage]=useState(0);
 const [tab,setTab]=useState<'edges'|'activities'|'variants'>('edges');
 useEffect(()=>()=>{generation.current++},[]);
 const reset=()=>{generation.current++;setResult(null);setSource('');setProblem('');setGroup(0);setPage(0);setTab('edges');setBusy(false);if(input.current)input.current.value=''};
 function apply(raw:unknown,label:string,token:number){
  if(token!==generation.current)return;
  const reviewed=reviewRust4pmResult(raw);
  if(token!==generation.current)return;
  setResult(reviewed);setSource(label);setGroup(0);setPage(0);
 }
 function fail(error:unknown,token:number){
  if(token!==generation.current)return;
  const code=error&&typeof error==='object'&&'code' in error?String(error.code):'R4PM_FILE_INVALID';
  setResult(null);setProblem(ERROR_TEXT[code]??'Не удалось прочитать корректный результат Rust4PM.');
 }
 async function onFile(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  reset();const token=generation.current;setBusy(true);
  try{
   if(file.size>R4PM_MAX_BYTES)throw {code:'R4PM_FILE_LIMIT'};
   const raw:unknown=JSON.parse(await file.text());
   apply(raw,'Локальный результат',token);
  }catch(err){fail(err,token)}finally{if(token===generation.current)setBusy(false)}
 }
 function example(){reset();const token=generation.current;try{apply(buildRust4pmReviewExample(),'Встроенный пример результата',token)}catch(err){fail(err,token)}}
 const selected=result?.graphs[group],size=tab==='edges'?(selected?.transitions.length??0):tab==='variants'?(selected?.variants?.length??0):(selected?.activities.length??0);
 const pages=Math.max(1,Math.ceil(size/PAGE_SIZE));
 return <div className="activity-domain-review">
  <section className="activity-v7-card">
   <h2>Результаты Process Mining</h2>
   <p>Откройте JSON-результат операции Rust4PM 0.6.2, полученный в Agent или локальном аналитическом инструменте. Activity показывает частоты действий, прямые переходы и границы траекторий.</p>
   <div className="activity-v7-actions">
    <input type="file" ref={input} accept=".json,application/json" className="visually-hidden" onChange={onFile} aria-label="Выбрать результат Rust4PM JSON"/>
    <button className="activity-v7-primary" disabled={busy} onClick={()=>input.current?.click()}>Открыть результат JSON</button>
    <button disabled={busy} onClick={example}>Открыть пример Rust4PM</button>
    <button disabled={!busy&&!result&&!problem} onClick={reset}>Очистить результат анализа</button>
   </div>
   <div className="activity-v7-note">Локальная выборка не является подключением Workspace. Названия и частоты остаются в этом окне; исходная Task и её полномочия здесь не подтверждены.</div>
  </section>
  {busy?<p role="status">Читается результат анализа…</p>:null}
  {problem?<div role="alert" className="activity-v7-note hold">{problem}</div>:null}
  {result?<section className="activity-v7-card" aria-label="Результат внешнего анализа">
   <h2>Исследование результата</h2>
   <p>{source} · Rust4PM {result.version} · {result.operation}</p>
   {result.unique_event_count!==null?<p role="status">Событий по данным инструмента: {result.unique_event_count}</p>:<>
    <p role="status">Графов: {result.graphs.length}</p>
    {result.graphs.length>0?<label className="activity-domain-label">Объектная перспектива
     <select aria-label="Объектная перспектива Rust4PM" value={group} onChange={e=>{setGroup(Number(e.target.value));setPage(0)}}>
      {result.graphs.map((g,i)=><option key={g.id} value={i}>{g.object_type??'Граф событий'}</option>)}
     </select></label>:<p>Инструмент не вернул ни одной объектной перспективы.</p>}
    {selected?<div className="activity-domain-group">
     <div className="activity-v7-stats">
      <div><strong>{selected.activities.length}</strong><span>Видов действий</span></div>
      <div><strong>{selected.transitions.length}</strong><span>Видов переходов</span></div>
      <div><strong>{selected.derived_nonempty_trace_count}</strong><span>Непустых траекторий по балансу</span></div>
     </div>
     <p>Вхождений действий: {selected.activity_occurrences}. Вхождений переходов: {selected.transition_occurrences}. Самопереходов: {selected.self_loop_count}.</p>
     {selected.variant_summary?<p role="status">Вариантов: {selected.variant_summary.variant_count} · Объектов: {selected.variant_summary.reported_object_count} · Без событий: {selected.variant_summary.empty_trace_count}. Частоты вариантов согласованы с графом.</p>:null}
     <div className="activity-v7-actions">
      <button aria-pressed={tab==='edges'} onClick={()=>{setTab('edges');setPage(0)}}>Прямые переходы</button>
      <button aria-pressed={tab==='activities'} onClick={()=>{setTab('activities');setPage(0)}}>Действия и границы</button>
      {selected.variants?<button aria-pressed={tab==='variants'} onClick={()=>{setTab('variants');setPage(0)}}>Полные варианты</button>:null}
     </div>
     <div className="activity-domain-ops">
      {tab==='edges'?selected.transitions.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(e=><div className="activity-domain-op" key={JSON.stringify([e.from,e.to])}>
       <strong>{e.from} → {e.to}</strong><span>Вхождений: {e.occurrences}{e.from===e.to?' · Самопереход':''}</span></div>):
       tab==='variants'?selected.variants?.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map((v,i)=><div className="activity-domain-op" key={page*PAGE_SIZE+i}>
        <strong>Вариант {page*PAGE_SIZE+i+1} · Объектов: {v.object_occurrences}</strong><span>Действий: {v.sequence.length}</span>
        {v.sequence.length?<details><summary>Последовательность действий</summary><ol>{v.sequence.map((name,j)=><li key={j}>{name}</li>)}</ol></details>:<span>Нет зарегистрированных событий</span>}</div>):
       selected.activities.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(a=><div className="activity-domain-op" key={a.name}>
        <strong>{a.name}</strong><span>Вхождений: {a.occurrences}</span><span>Начал: {a.derived_trace_starts} · Окончаний: {a.derived_trace_ends} (по балансу)</span></div>)}
     </div>
     {!size?<p>В выбранной перспективе нет записей этого вида.</p>:null}
     <div className="activity-v7-actions"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Назад</button><span>Страница {page+1} из {pages}</span><button disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>Далее</button></div>
    </div>:null}
    <div className="activity-v7-note">Частоты разных объектных перспектив не суммируются: одно событие может относиться к нескольким объектам. {result.full_trace_variants==='REPORTED_BY_TOOL'?'Полные варианты получены из результата инструмента, а не восстановлены из графа. Согласование частот не доказывает исходную историю.':'DFG не содержит полных траекторий.'} Причинная связь не установлена.</div>
   </>}
   <div className="activity-v7-note hold">Источник и физическое исполнение не подтверждены. Выпуск .iwxa закрыт.</div>
  </section>:null}
 </div>;
}
