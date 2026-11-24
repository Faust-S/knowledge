import {useLayoutEffect,useRef,useState,type ChangeEvent} from 'react';
import {reviewObservationResult,type ArxObservationReview,type DpObservationReview,type ObservationMetric}
 from '../../modules/activity-base-anonymizer/observation-review.mjs';
import type {D05DisclosureCandidate} from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const METRICS:Record<ObservationMetric,string>={CONTRIBUTING_ORGANIZATIONS:'Участвующие организации',
 ACCEPTED_ORDER_COUNT:'Принятые заказы',TOTAL_OPERATION_MINUTES:'Суммарная длительность, мин'};
const source=(r:ArxObservationReview|DpObservationReview)=>r.source_kind==='DECLARED_MODEL'?'Модельные наблюдения':'Заявленные наблюдения исполнения';
const fmt=(v:number)=>v.toLocaleString('ru-RU',{maximumFractionDigits:4});
const pct=(v:number)=>fmt(100*v)+'%';
const MAX=8*1024*1024;
export function ObservationReviewPanel({candidate}:{candidate:D05DisclosureCandidate}){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [arx,setArx]=useState<ArxObservationReview|null>(null);
 const [dp,setDp]=useState<DpObservationReview|null>(null);
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[problem,setProblem]=useState('');
 function clear(){generation.current++;setArx(null);setDp(null);setBusy(false);setProblem('');if(input.current)input.current.value='';}
 useLayoutEffect(()=>{clear();return()=>{generation.current++;};},[candidate]);
 async function load(event:ChangeEvent<HTMLInputElement>){
  const files=Array.from(event.target.files??[]);event.target.value='';
  if(!files.length)return;
  const token=++generation.current;setBusy(true);setProblem('');
  try{
   if(files.length!==2||files.some(f=>!f.size||f.size>MAX))throw {code:'OBSERVATION_FILE_PAIR'};
   const data=await Promise.all(files.map(async f=>{
    const bytes=new Uint8Array(await f.arrayBuffer());
    return {bytes,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
   }));
   const requests=data.filter(d=>['ACTIVITY_ARX_COHORT_V1','ACTIVITY_DP_AGGREGATE_V1'].includes(d.value?.profile));
   if(requests.length!==1)throw {code:'OBSERVATION_FILE_PAIR'};
   const request=requests[0],raw=data.find(d=>d!==request)!.value;
   const result=await reviewObservationResult(candidate,request.bytes,raw);
   if(token!==generation.current)return;
   if(result.kind==='arx')setArx(result);else setDp(result);
  }catch(error){
   if(token!==generation.current)return;
   const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
   setProblem(code==='OBSERVATION_TECHNOLOGY_CHANGED'?'Результат относится к другой редакции технологии.':
    code==='OBSERVATION_REQUEST_CHANGED'?'Результат получен из другой выборки.':
    code==='OBSERVATION_FILE_PAIR'?'Выберите одновременно исходный запрос и результат: два JSON до 8 МБ каждый.':
    'Пара файлов не соответствует поддерживаемому профилю. Предыдущий результат не заменён.');
  }finally{if(token===generation.current)setBusy(false);}
 }
 return <div className="activity-domain-proposal">
  <div className="activity-v7-actions"><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>
   {open?'Закрыть проверку наблюдений':'Проверка наблюдений и статистики'}</button></div>
  {open?<div className="activity-domain-group">
   <h3>Оценка раскрытия наблюдений</h3>
   <p>ARX проверяет заданную выборку наблюдений по организациям. OpenDP готовит отдельный статистический показатель. Нормативные условия технологии не изменяются.</p>
   <p>Из результата Agent выберите два файла: исходный запрос и ответ инструмента. Activity проверит редакцию технологии и точные байты запроса. Происхождение из принятой задачи пока не подтверждается.</p>
   <div className="activity-v7-actions">
    <input ref={input} type="file" multiple accept=".json,application/json" className="visually-hidden" aria-label="Выбрать запрос и результат проверки наблюдений" onChange={load}/>
    <button disabled={busy} onClick={()=>input.current?.click()}>Открыть пару файлов</button>
    <button disabled={!busy&&!arx&&!dp&&!problem} onClick={clear}>Очистить результаты наблюдений</button>
   </div>
   {busy?<p role="status">Сопоставляются запрос и результат…</p>:null}
   {problem?<p role="alert" className="activity-v7-note hold">{problem}</p>:null}
   {arx?<div className="activity-domain-group" aria-label="Результат ARX">
    <h3>ARX {arx.version}</h3>
    <p>{source(arx)}. Заявленные уникальные записи организаций: {arx.row_count}. Целевое k: {arx.k}. Исключение записей не допускается.</p>
    <div className="activity-v7-stats">
     <div><strong>{pct(arx.before_highest_sample_risk)}</strong><span>Макс. риск в выборке до</span></div>
     <div><strong>{arx.after_highest_sample_risk===null?'Нет решения':pct(arx.after_highest_sample_risk)}</strong><span>Макс. риск в выборке после</span></div>
    </div>
    {arx.result_available?<div className="activity-domain-ops">
     {arx.levels.map(l=><div key={l.key} className="activity-domain-op"><strong>{l.key}</strong><span>Уровень обобщения: {l.level} из {l.max_level}</span></div>)}
    </div>:<p role="status">Решение в заданных пределах не получено. Не ослабляйте существенные требования технологии автоматически.</p>}
    <p>Оценка относится только к указанным квазиидентификаторам и выборке. Доля риска не является вероятностью раскрытия предприятия во всех внешних источниках.</p>
   </div>:null}
   {dp?<div className="activity-domain-group" aria-label="Результат OpenDP">
    <h3>OpenDP {dp.version}</h3>
    <p>{source(dp)}. {METRICS[dp.metric]}. Соседство: добавление или удаление одного заявленного вклада организации.</p>
    <div className="activity-v7-stats">
     <div><strong>{fmt(dp.noisy_value)}</strong><span>Зашумлённая оценка</span></div>
     <div><strong>{fmt(dp.epsilon_milli/1000)}</strong><span>Заданный ε</span></div>
     <div><strong>{fmt(dp.public_bound)}</strong><span>Предел вклада</span></div>
     <div><strong>{fmt(dp.scale)}</strong><span>Масштаб шума</span></div>
    </div>
    <p>Заявленный расчёт privacy map: ε ≤ {fmt(dp.privacy_map_at_one)}, δ = 0. Отрицательное значение возможно из-за шума, это не фактическое число заказов. Бюджет повторных выпусков не учтён.</p>
   </div>:null}
   <p className="activity-v7-note hold">Проверки локальны. Уникальность организаций, связывание с другими публикациями, полезность обобщения и право раскрытия требуют отдельного рассмотрения.</p>
  </div>:null}
 </div>;
}
