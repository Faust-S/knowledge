import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {readR4pmResultBytes,R4PM_RESULT_MAX_BYTES,type R4pmReview}
 from '../../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const LIMIT=8;
const SCOPE={OCEL_EVENT_COUNT:'Количество событий OCEL',CASE_CENTRIC_DFG:'Граф непосредственно следующих операций',
 OBJECT_CENTRIC_DFG:'Графы по типам объектов'};
const TOPOLOGY={NO_RECORDED_ACTIVITY:'Нет зарегистрированных операций',CYCLE_IN_TOOL_GRAPH:'Цикл в графе инструмента',
 LINEAR_TOOL_GRAPH:'Линейный граф инструмента',NONLINEAR_TOOL_GRAPH:'Нелинейный граф инструмента'};
export function ProcessToolReview(){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [review,setReview]=useState<R4pmReview|null>(null),[problem,setProblem]=useState('');
 const [busy,setBusy]=useState(false),[group,setGroup]=useState(0),[page,setPage]=useState(0);
 const [chosen,setChosen]=useState('');
 const clear=()=>{generation.current++;setReview(null);setProblem('');setBusy(false);
  setGroup(0);setPage(0);setChosen('');if(input.current)input.current.value='';};
 useEffect(()=>()=>{generation.current++;},[]);
 async function load(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  clear();const token=generation.current;setBusy(true);
  try{
   if(!file.size||file.size>R4PM_RESULT_MAX_BYTES)throw {code:'R4PM_RESULT_FILE_LIMIT'};
   const value=readR4pmResultBytes(new Uint8Array(await file.arrayBuffer()));
   if(token===generation.current)setReview(value);
  }catch(error){
   if(token===generation.current){
    const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
    setProblem(code==='R4PM_RESULT_FILE_LIMIT'?'Допустим один JSON-файл до 8 МБ.':
      'Не удалось подтвердить поддерживаемую структуру результата Rust4PM 0.6.2.');
   }
  }finally{if(token===generation.current)setBusy(false);}
 }
 const g=review?.graphs[group],nodes=g?.activities??[],node=nodes.find(n=>n.id===chosen);
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
    <select value={group} aria-label="Выбрать граф результата" onChange={e=>{setGroup(Number(e.target.value));setPage(0);setChosen('');}}>
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
   <div className="activity-v7-note hold">Это результат анализа инструмента, а не доказательство исполнения. Полные траектории, причинность и применимость не подтверждены. Анонимность не установлена, выпуск .iwxa закрыт.</div>
  </section>:null}
 </div>;
}
