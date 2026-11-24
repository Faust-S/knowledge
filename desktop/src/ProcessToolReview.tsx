import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {readR4pmResultBytes,R4PM_RESULT_MAX_BYTES,compareR4pmReviews,buildR4pmComparisonExample,
 type R4pmReview,type R4pmComparison}
 from '../../modules/activity-base-anonymizer/r4pm-result-review.mjs';
const LIMIT=8;
const DIFF={BOTH:'В обеих выборках',BASELINE_ONLY:'Только в первой',COMPARISON_ONLY:'Только во второй',UNCHANGED:'Без отличий',CHANGED:'Отличается'};
const value=(n:number|null)=>n===null?'Нет записи':String(n);
const signed=(n:number|null)=>n===null?'Не вычисляется':n>0?'+'+n:String(n);
const SCOPE={OCEL_EVENT_COUNT:'Количество событий OCEL',CASE_CENTRIC_DFG:'Граф непосредственно следующих операций',
 OBJECT_CENTRIC_DFG:'Графы по типам объектов'};
const TOPOLOGY={NO_RECORDED_ACTIVITY:'Нет зарегистрированных операций',CYCLE_IN_TOOL_GRAPH:'Цикл в графе инструмента',
 LINEAR_TOOL_GRAPH:'Линейный граф инструмента',NONLINEAR_TOOL_GRAPH:'Нелинейный граф инструмента'};
export function ProcessToolReview(){
 const input=useRef<HTMLInputElement>(null),secondInput=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [review,setReview]=useState<R4pmReview|null>(null),[problem,setProblem]=useState('');
 const [busy,setBusy]=useState(false),[group,setGroup]=useState(0),[page,setPage]=useState(0);
 const [chosen,setChosen]=useState(''),[edgePage,setEdgePage]=useState(0);
 const [comparison,setComparison]=useState<R4pmComparison|null>(null),[compareGroup,setCompareGroup]=useState(0);
 const [diffPage,setDiffPage]=useState(0),[diffOnly,setDiffOnly]=useState(true),[diffMode,setDiffMode]=useState<'transitions'|'activities'>('transitions');
 const [example,setExample]=useState(false),[comparisonExample,setComparisonExample]=useState(false);
 const clear=()=>{generation.current++;setReview(null);setProblem('');setBusy(false);
  setGroup(0);setPage(0);setChosen('');setEdgePage(0);setComparison(null);setCompareGroup(0);setDiffPage(0);
  setDiffOnly(true);setDiffMode('transitions');setExample(false);setComparisonExample(false);
  if(input.current)input.current.value='';if(secondInput.current)secondInput.current.value='';};
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
 async function loadComparison(event:ChangeEvent<HTMLInputElement>){
  const file=event.target.files?.[0];event.target.value='';if(!file||!review)return;
  const token=++generation.current;setBusy(true);setProblem('');setComparison(null);setCompareGroup(0);setDiffPage(0);setComparisonExample(false);
  try{
   if(!file.size||file.size>R4PM_RESULT_MAX_BYTES)throw {code:'R4PM_RESULT_FILE_LIMIT'};
   const next=readR4pmResultBytes(new Uint8Array(await file.arrayBuffer()));
   const compared=compareR4pmReviews(review,next);
   if(token===generation.current)setComparison(compared);
  }catch(error){if(token===generation.current){const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
   setProblem(code==='R4PM_COMPARISON_SCOPE_MISMATCH'?'Для сравнения необходима та же операция Rust4PM.':'Не удалось прочитать второй результат Rust4PM 0.6.2.');}}
  finally{if(token===generation.current)setBusy(false);}
 }
 function openExample(){clear();const [a,b]=buildR4pmComparisonExample();setReview(a);setComparison(compareR4pmReviews(a,b));setExample(true);setComparisonExample(true);}
 const g=review?.graphs[group],nodes=g?.activities??[],node=nodes.find(n=>n.id===chosen);
 const label=(id:string)=>nodes.find(n=>n.id===id)?.label??'';
 const pageCount=Math.max(1,Math.ceil(nodes.length/LIMIT));
 const adjacent=g&&node?g.transitions.filter(e=>e.from===node.id||e.to===node.id):[];
 const edgePages=Math.max(1,Math.ceil(adjacent.length/LIMIT));
 const cg=comparison?.graphs[compareGroup];
 const differences=(cg?.[diffMode]??[]).filter(n=>!diffOnly||n.status!=='UNCHANGED');
 const diffPages=Math.max(1,Math.ceil(differences.length/LIMIT));
 return <div className="activity-domain-review">
  <section className="activity-v7-card">
   <h2>Результаты Process Mining</h2>
   <p>Откройте JSON-результат Rust4PM 0.6.2. Поддерживаются подсчёт событий OCEL, DFG журнала XES и OC-DFG с отдельным графом каждого типа объектов.</p>
   <div className="activity-v7-actions">
    <input ref={input} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Выбрать результат Rust4PM" onChange={load}/>
    <button className="activity-v7-primary" disabled={busy} onClick={()=>input.current?.click()}>Выбрать результат JSON</button>
    <button onClick={openExample} disabled={busy}>Открыть пример сравнения</button>
    <button disabled={!busy&&!review&&!problem} onClick={clear}>Очистить результат</button>
   </div>
   <p className="activity-v7-note">Файл анализируется локально. Названия остаются в текущем окне, данные не сохраняются и не отправляются. Локальная копия не подтверждает происхождение из Agent.</p>
  </section>
  {busy?<p role="status">Читается результат…</p>:null}
  {problem?<div role="alert" className="activity-v7-note hold">{problem}</div>:null}
  {review?<section className="activity-v7-card" aria-label="Результат Process Mining">
   <h2>{SCOPE[review.scope]}</h2>
   <p>Rust4PM {review.version} · {review.operation}{example?' · условный пример, не запуск инструмента':''}</p>
   <div className="activity-v7-actions"><input ref={secondInput} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Выбрать второй результат Rust4PM" onChange={loadComparison}/>
    <button disabled={busy} onClick={()=>secondInput.current?.click()}>Сравнить со вторым результатом</button></div>
   {review.event_count!==null?<div className="activity-v7-stats"><div><strong>{review.event_count}</strong><span>Событий по результату инструмента</span></div></div>:null}
   {review.graphs.length>0?<label className="activity-domain-label">Граф
    <select value={group} aria-label="Выбрать граф результата" onChange={e=>{setGroup(Number(e.target.value));setPage(0);setChosen('');setEdgePage(0);}}>
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
     aria-pressed={chosen===n.id} onClick={()=>{setChosen(n.id);setEdgePage(0);}}>{n.label}
     <span>{n.occurrences} вхождений{n.start?' · начало':''}{n.end?' · конец':''}</span></button>)}</div>
   <div className="activity-v7-actions"><button disabled={page===0} onClick={()=>{setPage(p=>p-1);setChosen('');setEdgePage(0);}}>Назад</button>
    <span>Страница {page+1} из {pageCount}</span><button disabled={page+1>=pageCount} onClick={()=>{setPage(p=>p+1);setChosen('');setEdgePage(0);}}>Далее</button></div>
   {node?<div className="activity-domain-group"><h3>{node.label}</h3>
    <p>Входящие и исходящие переходы по выбранному графу:</p>
    <div className="activity-domain-ops">{adjacent.slice(edgePage*LIMIT,(edgePage+1)*LIMIT).map(e=>
      <div key={e.from+':'+e.to} className="activity-domain-op"><strong>{label(e.from)} → {label(e.to)}</strong><span>{e.occurrences} вхождений</span></div>)}</div>
    {edgePages>1?<div className="activity-v7-actions"><button disabled={edgePage===0} onClick={()=>setEdgePage(p=>p-1)}>Назад по переходам</button><span>{edgePage+1} из {edgePages}</span><button disabled={edgePage+1>=edgePages} onClick={()=>setEdgePage(p=>p+1)}>Далее по переходам</button></div>:null}
   </div>:null}</>:null}
   <div className="activity-v7-note hold">Это результат анализа инструмента, а не доказательство исполнения. Полные траектории, причинность и применимость не подтверждены. Анонимность не установлена, выпуск .iwxa закрыт.</div>
  </section>:null}
  {comparison?<section className="activity-v7-card" aria-label="Сравнение результатов Process Mining">
   <h2>Сравнение двух выборок</h2>
   <p>Первая: {example?'условный пример':'локальный файл'}. Вторая: {comparisonExample?'условный пример':'локальный файл'}.</p>
   <p className="activity-v7-note">Сопоставлены только точные названия операций и типы объектов. Сопоставимость выборок, полнота событий, причины различий и изменение эффективности не установлены. Отсутствие записи не заменяется нулём.</p>
   {comparison.event_count?<p>События: {value(comparison.event_count.baseline)} / {value(comparison.event_count.comparison)} · Разность: {signed(comparison.event_count.delta)}</p>:null}
   {comparison.graphs.length?<label className="activity-domain-label">Тип объекта для сравнения<select value={compareGroup} aria-label="Тип объекта для сравнения" onChange={e=>{setCompareGroup(Number(e.target.value));setDiffPage(0);}}>{comparison.graphs.map((x,i)=><option key={x.id} value={i}>{x.object_type??'Журнал XES'}</option>)}</select></label>:null}
   {cg?<><p>{DIFF[cg.presence]}</p><p>Вхождения операций: {value(cg.baseline_activity_occurrences)} / {value(cg.comparison_activity_occurrences)} · Вхождения переходов: {value(cg.baseline_transition_occurrences)} / {value(cg.comparison_transition_occurrences)}</p>
    {cg.presence==='BOTH'?<><p>{'Отличия операций: '+cg.activity_differences+' · Отличия переходов: '+cg.transition_differences}</p>
     <div className="activity-v7-actions"><button aria-pressed={diffMode==='activities'} onClick={()=>{setDiffMode('activities');setDiffPage(0);}}>Операции</button><button aria-pressed={diffMode==='transitions'} onClick={()=>{setDiffMode('transitions');setDiffPage(0);}}>Переходы</button><button aria-pressed={diffOnly} onClick={()=>{setDiffOnly(v=>!v);setDiffPage(0);}}>Только отличия</button></div>
     <div className="activity-domain-ops">{differences.slice(diffPage*LIMIT,(diffPage+1)*LIMIT).map((n,i)=><div key={diffPage*LIMIT+i} className="activity-domain-op"><strong>{'label' in n?n.label:n.from+' → '+n.to}</strong><span>{DIFF[n.status]} · Первая: {value(n.baseline)} · Вторая: {value(n.comparison)} · Разность: {signed(n.delta)}</span>{'label' in n?<span>Начало: {n.baseline_start===null?'нет записи':n.baseline_start?'да':'нет'} / {n.comparison_start===null?'нет записи':n.comparison_start?'да':'нет'} · Конец: {n.baseline_end===null?'нет записи':n.baseline_end?'да':'нет'} / {n.comparison_end===null?'нет записи':n.comparison_end?'да':'нет'}</span>:null}</div>)}</div>
     {!differences.length?<p>Нет записей с выбранным признаком.</p>:null}
     {diffPages>1?<div className="activity-v7-actions"><button disabled={diffPage===0} onClick={()=>setDiffPage(p=>p-1)}>Предыдущие отличия</button><span>{diffPage+1} из {diffPages}</span><button disabled={diffPage+1>=diffPages} onClick={()=>setDiffPage(p=>p+1)}>Следующие отличия</button></div>:null}</>:<p>Граф отсутствует в одной выборке; разность не вычисляется.</p>}
   </>:null}
  </section>:null}
 </div>;
}
