import {useLayoutEffect,useRef,useState,type ChangeEvent} from 'react';
import {reviewD05SimPyComparison,type SimPyComparisonReview,type SimPyScenarioReview}
 from '../../modules/activity-base-anonymizer/d05-simpy-review.mjs';
import type {D05DisclosureCandidate} from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const MAX=8*1024*1024;
const num=(v:number)=>v.toLocaleString('ru-RU',{maximumFractionDigits:1});
const time=(v:number)=>num(v/60)+' ч';
const cost=(v:number,currency:string)=>{
 const f=new Intl.NumberFormat('ru-RU',{style:'currency',currency});
 return f.format(v/10**(f.resolvedOptions().maximumFractionDigits??2));
};
function Scenario({title,value,currency}:{title:string;value:SimPyScenarioReview;currency:string}){
 return <div className="activity-domain-group">
  <h4>{title}</h4>
  <div className="activity-v7-stats">
   <div><strong>{value.on_time_model_orders} / {value.model_order_count}</strong><span>Модельных заказов в срок</span></div>
   <div><strong>{time(value.elapsed_minutes)}</strong><span>Весь поток</span></div>
   <div><strong>{time(value.sum_turnaround_minutes/value.model_order_count)}</strong><span>Средний цикл заказа</span></div>
   <div><strong>{time(value.sum_queue_minutes)}</strong><span>Суммарное ожидание ресурса</span></div>
   <div><strong>{cost(value.declared_total_cost_minor,currency)}</strong><span>Заявленные затраты</span></div>
  </div>
  <p>Использование ресурсов: {cost(value.resource_cost_minor,currency)}. Другие заявленные затраты: {cost(value.other_cost_minor,currency)}.</p>
  <div className="activity-domain-ops">{value.resources.map(r=><div className="activity-domain-op" key={r.key}>
   <strong>{r.key}</strong><span>Мест: {r.capacity}. Загрузка: {num(r.capacity_minutes?100*r.busy_minutes/r.capacity_minutes:0)}%</span>
   <span>Ожидание: {time(r.queue_minutes)}. Затраты: {cost(r.cost_minor,currency)}.</span>
  </div>)}</div>
 </div>;
}
export function SimulationReviewPanel({candidate}:{candidate:D05DisclosureCandidate}){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [review,setReview]=useState<SimPyComparisonReview|null>(null);
 function clear(){generation.current++;setBusy(false);setError('');setReview(null);if(input.current)input.current.value='';}
 useLayoutEffect(()=>{clear();return()=>{generation.current++;};},[candidate]);
 async function load(event:ChangeEvent<HTMLInputElement>){
  const files=Array.from(event.target.files??[]);event.target.value='';if(!files.length)return;
  const token=++generation.current;setBusy(true);setError('');
  try{
   if(files.length!==2||files.some(f=>!f.size||f.size>MAX))throw {code:'SIMPY_FILE_PAIR'};
   const rows=await Promise.all(files.map(async f=>{const bytes=new Uint8Array(await f.arrayBuffer());
    return {bytes,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};}));
   const inputs=rows.filter(x=>x.value?.profile==='ACTIVITY_D05_SIMPY_COMPARISON_V1');
   if(inputs.length!==1)throw {code:'SIMPY_FILE_PAIR'};
   const req=inputs[0],result=await reviewD05SimPyComparison(candidate,req.bytes,rows.find(x=>x!==req)!.value);
   if(token===generation.current)setReview(result);
  }catch(err){
   if(token!==generation.current)return;
   const code=err&&typeof err==='object'&&'code' in err?String(err.code):'';
   setError(code==='SIMPY_TECHNOLOGY_CHANGED'?'Сравнение относится к другой редакции технологии.':
    code==='SIMPY_REQUEST_CHANGED'?'Расчёт получен из другого запроса.':
    code==='SIMPY_FILE_PAIR'?'Выберите исходный запрос и результат: два JSON до 8 МБ каждый.':
    'Не удалось сопоставить расчёт с условиями и показателями. Предыдущий результат не заменён.');
  }finally{if(token===generation.current)setBusy(false);}
 }
 return <div className="activity-domain-proposal">
  <div className="activity-v7-actions"><button aria-expanded={open} onClick={()=>setOpen(x=>!x)}>
   {open?'Закрыть сравнение применения':'Сравнение условий применения'}</button></div>
  {open?<div className="activity-domain-group">
   <h3>Моделирование технологии</h3>
   <p>Сопоставьте базовые и предполагаемые условия получателя на одном потоке заказов. Activity читает результат локального оригинального SimPy из Agent, не заменяя планирование Atlas или предметную приёмку.</p>
   <div className="activity-v7-actions">
    <input ref={input} className="visually-hidden" type="file" multiple accept=".json,application/json" aria-label="Выбрать запрос и результат моделирования" onChange={load}/>
    <button disabled={busy} onClick={()=>input.current?.click()}>Открыть расчёт SimPy</button>
    <button disabled={!review&&!busy&&!error} onClick={clear}>Очистить сравнение</button>
   </div>
   {busy?<p role="status">Проверяются условия и расчёт…</p>:null}
   {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
   {review?<div className="activity-domain-group" aria-label="Сравнение результатов SimPy">
    <p>SimPy {review.version}. Срок на заказ: {time(review.deadline_after_minutes)}. Сохранено контрольных точек: {review.quality_checks_count}. {review.buffer_policy==='HOLD_RESOURCE_DURING_BUFFER'?'Ресурс занят во время буфера.':'Ресурс освобождается до буфера.'}</p>
    <div className="activity-v7-stats">
     <div><strong>{time(review.baseline.elapsed_minutes-review.recipient.elapsed_minutes)}</strong><span>Сокращение времени потока</span></div>
     <div><strong>{time(review.baseline.sum_queue_minutes-review.recipient.sum_queue_minutes)}</strong><span>Сокращение ожидания</span></div>
     <div><strong>{cost(review.baseline.declared_total_cost_minor-review.recipient.declared_total_cost_minor,review.currency)}</strong><span>Разница заявленных затрат</span></div>
    </div>
    <Scenario title="Базовый вариант" value={review.baseline} currency={review.currency}/>
    <Scenario title="Вариант получателя" value={review.recipient} currency={review.currency}/>
    <p className="activity-v7-note hold">Модель, а не исполнение. Непрерывная шкала без смен, материалы доступны, случайные отказы и физические результаты контроля не моделируются. Затраты не равны полной себестоимости. Источник задачи и применимость не подтверждены.</p>
   </div>:null}
  </div>:null}
 </div>;
}
