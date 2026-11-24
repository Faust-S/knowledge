import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {readR4pmResultBytes,compareR4pmOcelSource,R4PM_RESULT_MAX_BYTES,type R4pmReview,type R4pmOcelSourceReview}
 from '../../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const LIMIT=8;
const SCOPE={OCEL_EVENT_COUNT:'Количество событий OCEL',CASE_CENTRIC_DFG:'Граф непосредственно следующих операций',
 OBJECT_CENTRIC_DFG:'Графы по типам объектов'};
const TOPOLOGY={NO_RECORDED_ACTIVITY:'Нет зарегистрированных операций',CYCLE_IN_TOOL_GRAPH:'Цикл в графе инструмента',
 LINEAR_TOOL_GRAPH:'Линейный граф инструмента',NONLINEAR_TOOL_GRAPH:'Нелинейный граф инструмента'};
export function ProcessToolReview(){
 const input=useRef<HTMLInputElement>(null),sourceInput=useRef<HTMLInputElement>(null),generation=useRef(0);
 const resultBytes=useRef<Uint8Array|null>(null);
 const [audit,setAudit]=useState<R4pmOcelSourceReview|null>(null),[sourceProblem,setSourceProblem]=useState('');
 const [sourceBusy,setSourceBusy]=useState(false),[variantPage,setVariantPage]=useState(0),[variantIndex,setVariantIndex]=useState<number|null>(null),[stepPage,setStepPage]=useState(0);
 const [review,setReview]=useState<R4pmReview|null>(null),[problem,setProblem]=useState('');
 const [busy,setBusy]=useState(false),[group,setGroup]=useState(0),[page,setPage]=useState(0);
 const [chosen,setChosen]=useState('');
 const clear=()=>{generation.current++;setReview(null);setProblem('');setBusy(false);
  resultBytes.current=null;setAudit(null);setSourceProblem('');setSourceBusy(false);
  setVariantPage(0);setVariantIndex(null);setStepPage(0);
  setGroup(0);setPage(0);setChosen('');if(input.current)input.current.value='';
  if(sourceInput.current)sourceInput.current.value='';};
 useEffect(()=>()=>{generation.current++;},[]);
 async function load(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  clear();const token=generation.current;setBusy(true);
  try{
   if(!file.size||file.size>R4PM_RESULT_MAX_BYTES)throw {code:'R4PM_RESULT_FILE_LIMIT'};
   const bytes=new Uint8Array(await file.arrayBuffer()),value=readR4pmResultBytes(bytes);
   if(token===generation.current){resultBytes.current=bytes;setReview(value);}
  }catch(error){
   if(token===generation.current){
    const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
    setProblem(code==='R4PM_RESULT_FILE_LIMIT'?'Допустим один JSON-файл до 8 МБ.':
      'Не удалось подтвердить поддерживаемую структуру результата Rust4PM 0.6.2.');
   }
  }finally{if(token===generation.current)setBusy(false);}
 }
 async function loadSource(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';
  const bytes=resultBytes.current;if(!file||!bytes)return;
  const token=++generation.current;
  setAudit(null);setSourceProblem('');setVariantPage(0);setVariantIndex(null);setStepPage(0);setSourceBusy(true);
  try{
   if(!file.size||bytes.length+file.size>R4PM_RESULT_MAX_BYTES)throw {code:'R4PM_SOURCE_PAIR_LIMIT'};
   const value=compareR4pmOcelSource(bytes,new Uint8Array(await file.arrayBuffer()));
   if(token===generation.current)setAudit(value);
  }catch(error){
   if(token===generation.current){
    const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
    setSourceProblem(code==='R4PM_SOURCE_PAIR_LIMIT'?'Два файла вместе должны занимать не более 8 МБ.':
      code==='R4PM_SOURCE_AMBIGUOUS_EVENT_ORDER'?'В журнале есть одинаковые моменты событий одного объекта. Порядок не подтверждён.':
      code.includes('MISMATCH')?'Частоты, типы объектов или переходы графа не совпадают с выбранным журналом.':
      'Не удалось сопоставить исходный OCEL в поддерживаемом профиле.');
   }
  }finally{if(token===generation.current)setSourceBusy(false);}
 }
 const g=review?.graphs[group],nodes=g?.activities??[],node=nodes.find(n=>n.id===chosen);
 const auditedGroup=audit?.groups.find(x=>x.object_type===g?.object_type);
 const variant=variantIndex===null?null:auditedGroup?.variants[variantIndex];
 const label=(id:string)=>nodes.find(n=>n.id===id)?.label??'';
 const pageCount=Math.max(1,Math.ceil(nodes.length/LIMIT));
 return <div className="activity-domain-review">
  <section className="activity-v7-card">
   <h2>Результаты Process Mining</h2>
   <p>Откройте JSON-результат Rust4PM 0.6.2. Поддерживаются подсчёт событий OCEL, DFG журнала XES и OC-DFG с отдельным графом каждого типа объектов.</p>
   <div className="activity-v7-actions">
    <input ref={input} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Выбрать результат Rust4PM" onChange={load}/>
    <button className="activity-v7-primary" disabled={busy} onClick={()=>input.current?.click()}>Выбрать результат JSON</button>
    <button disabled={!busy&&!review&&!problem} onClick={clear}>Очистить результат</button>
   </div>
   <p className="activity-v7-note">Файл анализируется локально. Названия остаются в текущем окне, данные не сохраняются и не отправляются. Локальная копия не подтверждает происхождение из Agent.</p>
  </section>
  {busy?<p role="status">Читается результат…</p>:null}
  {problem?<div role="alert" className="activity-v7-note hold">{problem}</div>:null}
  {review?<section className="activity-v7-card" aria-label="Результат Process Mining">
   <h2>{SCOPE[review.scope]}</h2>
   <p>Rust4PM {review.version} · {review.operation}</p>
   {review.event_count!==null?<div className="activity-v7-stats"><div><strong>{review.event_count}</strong><span>Событий по результату инструмента</span></div></div>:null}
   {review.graphs.length>0?<label className="activity-domain-label">Граф
    <select value={group} aria-label="Выбрать граф результата" onChange={e=>{setGroup(Number(e.target.value));setPage(0);setChosen('');setVariantPage(0);setVariantIndex(null);setStepPage(0);}}>
     {review.graphs.map((graph,i)=><option key={graph.id} value={i}>{graph.object_type??'Журнал XES'}</option>)}
    </select></label>:null}
   {g?<><div className="activity-v7-stats">
    <div><strong>{nodes.length}</strong><span>Классы операций</span></div>
    <div><strong>{g.activity_occurrences}</strong><span>Вхождения операций</span></div>
    <div><strong>{g.transition_occurrences}</strong><span>Вхождения переходов</span></div>
   </div>
   <p>{TOPOLOGY[g.topology]}. Частоты относятся к выбранному графу, не к уникальным хозяйственным исполнениям.</p>
   <div className="activity-domain-ops">{nodes.slice(page*LIMIT,(page+1)*LIMIT).map(n=>
    <button key={n.id} className={'activity-v7-choice '+(chosen===n.id?'selected':'')}
     aria-pressed={chosen===n.id} onClick={()=>setChosen(n.id)}>{n.label}
     <span>{n.occurrences} вхождений{n.start?' · начало':''}{n.end?' · конец':''}</span></button>)}</div>
   <div className="activity-v7-actions"><button disabled={page===0} onClick={()=>{setPage(p=>p-1);setChosen('');}}>Назад</button>
    <span>Страница {page+1} из {pageCount}</span><button disabled={page+1>=pageCount} onClick={()=>{setPage(p=>p+1);setChosen('');}}>Далее</button></div>
   {node?<div className="activity-domain-group"><h3>{node.label}</h3>
    <p>Входящие и исходящие переходы по выбранному графу:</p>
    <div className="activity-domain-ops">{g.transitions.filter(e=>e.from===node.id||e.to===node.id).map(e=>
      <div key={e.from+':'+e.to} className="activity-domain-op"><strong>{label(e.from)} → {label(e.to)}</strong><span>{e.occurrences} вхождений</span></div>)}</div>
   </div>:null}</>:null}
   {review.scope!=='CASE_CENTRIC_DFG'?<div className="activity-domain-group">
    <h3>Сопоставление с исходным OCEL</h3>
    <p>Выберите журнал отдельно. Совпадение частот не доказывает происхождение файлов. Траектории читаются из событий, а не строятся из рёбер DFG.</p>
    <input ref={sourceInput} type="file" accept=".json,.jsonocel,application/json" className="visually-hidden"
     aria-label="Файл исходного журнала OCEL" onChange={loadSource}/>
    <div className="activity-v7-actions"><button disabled={sourceBusy} onClick={()=>sourceInput.current?.click()}>
     {audit?'Заменить исходный OCEL':'Выбрать исходный OCEL'}</button></div>
    {sourceBusy?<p role="status">Сверяются частоты журнала…</p>:null}
    {sourceProblem?<p role="alert" className="activity-v7-note hold">{sourceProblem}</p>:null}
    {audit?<><h3>{audit.status==='LOCAL_GRAPH_COUNTS_MATCH'?'Частоты графа совпадают с журналом':'Число событий совпадает с журналом'}</h3>
     <p role="status" aria-label={'Событий: '+audit.event_count+' · Объектов: '+audit.object_count+' · Общих событий: '+audit.shared_event_count}>
      {'Событий: '+audit.event_count+' · Объектов: '+audit.object_count+' · Общих событий: '+audit.shared_event_count}</p>
     <p>Заявленных связей объектов: {audit.object_link_count}. Они не превращаются в зависимости процесса.</p>
     {auditedGroup?<><p>{auditedGroup.objects_with_events} из {auditedGroup.object_count} объектов имеют события.</p>
      <h3>Полные траектории выбранного журнала</h3>
      <p>Варианты сохраняют названия событий и типы связанных объектов с их ролями. Частота относится к объектам, не к независимым хозяйственным исполнениям.</p>
      <div className="activity-domain-ops">{auditedGroup.variants.slice(variantPage*LIMIT,(variantPage+1)*LIMIT).map((v,i)=>
       <button key={i} className={'activity-v7-choice '+(variantIndex===variantPage*LIMIT+i?'selected':'')}
        aria-pressed={variantIndex===variantPage*LIMIT+i} onClick={()=>{setVariantIndex(variantPage*LIMIT+i);setStepPage(0);}}>
        {'Траектория '+(variantPage*LIMIT+i+1)+' · '+v.count+' объектов'}
        <span>{v.steps.slice(0,5).map(s=>s.activity).join(' → ')}{v.steps.length>5?' …':''}</span></button>)}</div>
      {auditedGroup.variants.length>LIMIT?<div className="activity-v7-actions">
       <button disabled={variantPage===0} onClick={()=>{setVariantPage(x=>x-1);setVariantIndex(null);}}>Предыдущие траектории</button>
       <button disabled={(variantPage+1)*LIMIT>=auditedGroup.variants.length} onClick={()=>{setVariantPage(x=>x+1);setVariantIndex(null);}}>Следующие траектории</button></div>:null}
      {variant?<div className="activity-domain-ops"><h3>События траектории ({variant.steps.length})</h3>
       {variant.steps.slice(stepPage*LIMIT,(stepPage+1)*LIMIT).map((s,i)=><div key={i} className="activity-domain-op">
        <strong>{stepPage*LIMIT+i+1}. {s.activity}</strong><span>Роль объекта: {s.qualifier}</span>
        {s.related.length?<span>Другие объекты: {s.related.map(([t,q])=>t+' ('+q+')').join(', ')}</span>:null}</div>)}
       {variant.steps.length>LIMIT?<div className="activity-v7-actions">
        <button disabled={stepPage===0} onClick={()=>setStepPage(x=>x-1)}>Предыдущие события</button>
        <button disabled={(stepPage+1)*LIMIT>=variant.steps.length} onClick={()=>setStepPage(x=>x+1)}>Следующие события</button></div>:null}</div>:null}
     </>:null}</>:null}
   </div>:null}
   <div className="activity-v7-note hold">Это результат анализа инструмента и выбранных локальных записей, а не доказательство исполнения. Причинность, применимость и анонимность не подтверждены, выпуск .iwxa закрыт.</div>
  </section>:null}
 </div>;
}
