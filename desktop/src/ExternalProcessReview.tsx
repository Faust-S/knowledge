import {useEffect,useRef,useState,type ChangeEvent} from 'react';
import {reviewExternalOcDfg,type ExternalOcDfgReview} from '../../modules/activity-base-anonymizer/ocel2-evidence.mjs';

const LIMIT=8*1024*1024,PAGE=8;
const ERRORS:Record<string,string>={
 OCDFG_MODEL_INVALID:'Выберите нативный JSON объектно-центрического графа Rust4PM.',
 OCDFG_OBJECT_SCOPE_MISMATCH:'В графе и журнале различаются типы объектов.',
 OCDFG_TYPE_GRAPH_INVALID:'Неподдерживаемая структура графа одного типа объектов.',
 OCDFG_COUNTS_INVALID:'Частоты графа имеют недопустимые значения или названия.',
 OCDFG_EDGE_LIMIT:'Превышен предел числа переходов.',
 OCDFG_EDGE_INVALID:'Переход не соответствует классам событий или частотам.',
 OCDFG_EDGE_DUPLICATE:'Граф содержит повторяющиеся переходы.',
 OCDFG_FLOW_COUNTS_INCONSISTENT:'Входы, выходы и частоты переходов не согласуются.',
 OCDFG_ACTIVITY_COUNT_MISMATCH:'Частоты событий графа не совпадают с выбранным журналом.',
 OCDFG_TRACE_COUNT_MISMATCH:'Число начальных и конечных событий не совпадает с объектными траекториями.',
 OCDFG_ENDPOINT_COUNT_MISMATCH:'Начало или окончание траекторий отличается от журнала.',
 OCDFG_EDGE_COUNT_MISMATCH:'Прямые переходы или их частоты отличаются от журнала.',
 OCDFG_REVIEW_LINK_LIMIT:'В выборке более 20 000 связей событий с объектами.',
 OCDFG_REVIEW_OUTPUT_LIMIT:'Результат превышает допустимый объём локальной проверки.',
 FILE_LIMIT:'Выберите два JSON-файла общим объёмом до 8 МБ.',
 FILE_INVALID:'Файл не является корректным JSON UTF-8.'
};
const REASONS:Record<string,string>={
 AMBIGUOUS_SAME_TIME_OBJECT_EVENTS:'Есть события одного объекта с одинаковым временем.',
 RARE_OBJECT_TRACE_TOPOLOGY:'Редкие варианты требуют проверки риска раскрытия.',
 UNOBSERVED_OBJECTS:'В журнале есть объекты без событий.',
 O2O_DEPENDENCY_REQUIRES_RISK_REVIEW:'Объектные связи требуют проверки риска.',
 EXTERNAL_POPULATION_REIDENTIFICATION_UNMEASURED:'Риск связывания с внешними данными не измерен.',
 T3_AUTHORITY_AND_OBJECT_BINDINGS_UNVERIFIED:'Полномочия и связи с выбранной Workspace не подтверждены.'
};
const parseFile=async(file:File):Promise<unknown>=>{
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));}
 catch{throw {code:'FILE_INVALID'};}
};
function Pager({page,total,setPage,label}:{page:number;total:number;setPage:(n:number)=>void;label:string}){
 const pages=Math.max(1,Math.ceil(total/PAGE));
 return <div className="activity-v7-actions">
  <button aria-label={label+': назад'} disabled={page===0} onClick={()=>setPage(page-1)}>Назад</button>
  <span>{page+1} / {pages}</span>
  <button aria-label={label+': далее'} disabled={page+1>=pages} onClick={()=>setPage(page+1)}>Далее</button>
 </div>;
}
export function ExternalProcessReview(){
 const sourceInput=useRef<HTMLInputElement>(null),modelInput=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [source,setSource]=useState<File|null>(null),[model,setModel]=useState<File|null>(null);
 const [result,setResult]=useState<ExternalOcDfgReview|null>(null),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false);
 const [type,setType]=useState(0),[variant,setVariant]=useState(0),[edgePage,setEdgePage]=useState(0),[stepPage,setStepPage]=useState(0),[activityPage,setActivityPage]=useState(0);
 useEffect(()=>()=>{generation.current++;},[]);
 const invalidate=()=>{generation.current++;setBusy(false);setResult(null);setProblem('');setType(0);setVariant(0);setEdgePage(0);setStepPage(0);setActivityPage(0);};
 const choose=(event:ChangeEvent<HTMLInputElement>,kind:'source'|'model')=>{
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  invalidate();
  if(file.size>LIMIT){if(kind==='source')setSource(null);else setModel(null);setProblem(ERRORS.FILE_LIMIT);return;}
  if(kind==='source')setSource(file);else setModel(file);
 };
 const clear=()=>{invalidate();setSource(null);setModel(null);};
 async function compare(){
  invalidate();const token=generation.current;
  if(!source||!model||source.size+model.size>LIMIT){setProblem(ERRORS.FILE_LIMIT);return;}
  setBusy(true);
  try{
   const log=await parseFile(source);if(token!==generation.current)return;
   const graph=await parseFile(model);if(token!==generation.current)return;
   const view=await reviewExternalOcDfg(log,graph);if(token!==generation.current)return;
   setResult(view);
  }catch(error){
   if(token!==generation.current)return;
   const code=error&&typeof error==='object'&&'code' in error?String(error.code):'FILE_INVALID';
   setProblem(ERRORS[code]??'Журнал или модель не соответствуют поддерживаемому профилю. Проверьте связи, типы и время событий.');
  }finally{if(token===generation.current)setBusy(false);}
 }
 const view=result?.object_views[type],selected=view?.variants[variant];
 return <div className="activity-domain-review">
  <section className="activity-v7-card">
   <h2>Проверка внешней модели процесса</h2>
   <p>Выберите исходный журнал OCEL 2.0 JSON и нативный результат объектно-центрического анализа Rust4PM. Activity проверит их соответствие, не заменяя инструмент моделирования.</p>
   <div className="activity-v7-actions">
    <input ref={sourceInput} type="file" className="visually-hidden" accept=".json,.jsonocel,application/json" aria-label="Исходный журнал OCEL" onChange={e=>choose(e,'source')}/>
    <input ref={modelInput} type="file" className="visually-hidden" accept=".json,application/json" aria-label="Нативный граф OC-DFG" onChange={e=>choose(e,'model')}/>
    <button onClick={()=>sourceInput.current?.click()}>Выбрать журнал OCEL</button>
    <button onClick={()=>modelInput.current?.click()}>Выбрать граф OC-DFG</button>
    <button className="activity-v7-primary" disabled={!source||!model||busy} onClick={()=>void compare()}>Сопоставить модель и журнал</button>
    <button disabled={!source&&!model&&!result&&!problem&&!busy} onClick={clear}>Очистить выборку</button>
   </div>
   <p role="status">Журнал: {source?'выбран':'не выбран'} · Граф: {model?'выбран':'не выбран'}</p>
   <div className="activity-v7-note">Локальная проверка двух файлов не является подписанным чтением Workspace. Имена действий и типов объектов видны только в этой карточке. Выборка очищается при выходе из раздела.</div>
  </section>
  {busy?<p role="status">Сопоставляется модель с журналом…</p>:null}
  {problem?<div role="alert" className="activity-v7-note hold">{problem}</div>:null}
  {result?<section className="activity-v7-card" aria-label="Сопоставление внешней модели">
   <h2>{result.status==='MATCHED_LOCAL_MODEL'?'Структура совпадает с журналом':'Порядок части событий не установлен'}</h2>
   <div className="activity-v7-stats">
    {[[result.object_count,'Объектов'],[result.event_count,'Событий'],[result.shared_event_count,'Общих событий'],[result.object_views.length,'Типов объектов']].map(([n,t])=><div key={t}><strong>{n}</strong><span>{t}</span></div>)}
   </div>
   <p>Один Event может относиться к нескольким объектам. Объектные траектории не равны числу независимых хозяйственных процессов.</p>
   <label className="activity-domain-label">Тип объекта
    <select aria-label="Тип объекта внешней модели" value={type} onChange={e=>{setType(Number(e.target.value));setVariant(0);setStepPage(0);setEdgePage(0);setActivityPage(0);}}>
     {result.object_views.map((v,i)=><option key={v.object_type} value={i}>{v.object_type} · {v.object_count}</option>)}
    </select>
   </label>
   {view?<div className="activity-domain-group">
    <p>Объектов с событиями: {view.objects_with_events} из {view.object_count}. Однозначных вариантов: {view.variants.length}.</p>
    {view.ambiguous_objects>0?<div className="activity-v7-note hold">Объектов с неопределённым порядком: {view.ambiguous_objects}. Переходы и границы этого типа не подтверждены; ниже только варианты остальных объектов.</div>:null}
    <h3>События и частоты</h3>
    <div className="activity-domain-ops">{view.activities.slice(activityPage*PAGE,(activityPage+1)*PAGE).map(a=><div key={a.activity} className="activity-domain-op"><strong>{a.activity}</strong><span>{a.count} объектных появлений</span></div>)}</div>
    <Pager page={activityPage} total={view.activities.length} setPage={setActivityPage} label="События"/>
    {view.comparison==='MATCHED'?<>
     <h3>Проверенные прямые переходы</h3>
     <div className="activity-domain-ops">{view.transitions.slice(edgePage*PAGE,(edgePage+1)*PAGE).map(e=><div key={JSON.stringify([e.from,e.to])} className="activity-domain-op"><strong>{e.from} → {e.to}</strong><span>Появлений: {e.count}</span></div>)}</div>
     {!view.transitions.length?<p>Прямых переходов для этого типа нет.</p>:null}
     <Pager page={edgePage} total={view.transitions.length} setPage={setEdgePage} label="Переходы"/>
    </>:null}
    <h3>Полные варианты объектных траекторий</h3>
    {view.variants.length?<label className="activity-domain-label">Вариант
      <select aria-label="Вариант траектории" value={variant} onChange={e=>{setVariant(Number(e.target.value));setStepPage(0);}}>
       {view.variants.map((v,i)=><option key={i} value={i}>Вариант {i+1} · {v.object_count} объектов · {v.steps.length} событий</option>)}
      </select>
     </label>:<p>Однозначных траекторий нет.</p>}
    {selected?<><div className="activity-domain-ops">{selected.steps.slice(stepPage*PAGE,(stepPage+1)*PAGE).map((step,i)=><div key={stepPage*PAGE+i} className="activity-domain-op">
     <strong>{stepPage*PAGE+i+1}. {step.activity}</strong><span>Роль объекта в событии: {step.qualifiers.join(', ')}</span>
     {step.related.length?<span>Другие объекты: {step.related.map(x=>x.object_type+' ('+x.qualifier+')').join(', ')}</span>:null}
    </div>)}</div><Pager page={stepPage} total={selected.steps.length} setPage={setStepPage} label="Этапы варианта"/></>:null}
   </div>:null}
   <div className="activity-v7-note hold">Совпадение структуры не доказывает фактическое исполнение, причинность, правила решений, применимость технологии или анонимность. Передача и выпуск .iwxa закрыты.</div>
   <details><summary>Основания дальнейшей проверки</summary><ul>{result.risk_reasons.map(r=><li key={r}>{REASONS[r]??'Требуется отдельная проверка'}</li>)}</ul></details>
  </section>:null}
 </div>;
}
