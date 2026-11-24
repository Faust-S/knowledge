import {useLayoutEffect,useRef,useState,type ChangeEvent} from 'react';
import type {D05SignedRouteReview,D05RouteReviewPort} from '../../modules/activity-base-anonymizer/d05-route-host.mjs';
import {reviewD05RouteModels,buildD05RouteComparisonExample,type D05RouteReview}
 from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const KINDS={internal:'Внутренняя',subcontract:'Подрядная',wait:'Ожидание',inspection:'Контроль',transport:'Транспорт'};
const DIFFS:Record<string,string>={DURATION:'Длительность и буферы',RESOURCES:'Исполнители и оборудование',
 MATERIALS:'Материалы и готовность',NOTES:'Примечания',ROUTE_PARAMETERS:'Объём и параметры маршрута'};
const BASIS={EXACT_NAMED_DEPENDENCY_STRUCTURE:'Совпадает структура именованных операций и зависимостей',
 SINGLE_MODEL:'Отдельная структура',
 AMBIGUOUS_OPERATION_OCCURRENCES:'Повторяющиеся названия требуют сопоставления отдельных операций'};
const ERRORS:Record<string,string>={
 D05_ROUTE_SELECTION_LIMIT:'Выберите от одного до 24 маршрутов.',
 D05_ROUTE_RECORD_REQUIRED:'Файл должен содержать один объект маршрута.',
 D05_ROUTE_IDENTITY_INVALID:'Не найден исходный объект operation-route.',
 D05_ROUTE_CALCULATOR_PROFILE_INVALID:'Этот файл не является поддерживаемой моделью маршрута CehoVod.',
 D05_ROUTE_KERNEL_ENVELOPE_MISMATCH:'Редакция или идентичность сохранённого Result не совпадает.',
 D05_ROUTE_INPUT_MISSING_OR_AMBIGUOUS:'Отсутствуют операции или обнаружены конкурирующие представления маршрута.',
 D05_ROUTE_OPERATION_NAME_INVALID:'Не заполнено допустимое название операции.',
 D05_ROUTE_OPERATION_INVALID:'Недопустимые или повторяющиеся операции.',
 D05_ROUTE_OPERATION_LIMIT:'Нужно от 1 до 128 операций на маршрут.',
 D05_ROUTE_EDGE_LIMIT:'Слишком много зависимостей в маршруте.',
 D05_ROUTE_DEPENDENCY_INVALID:'Ссылка на отсутствующую операцию или самозависимость.',
 D05_ROUTE_DEPENDENCY_CYCLE:'В плановых зависимостях есть цикл.',
 D05_ROUTE_DUPLICATE_MODEL_ID:'Один маршрут выбран несколько раз. Выберите только одну его редакцию.',
 D05_ROUTE_FILE_LIMIT:'Выберите не более 24 JSON-файлов общим объёмом до 8 МБ.',
 D05_ROUTE_FILE_INVALID:'Не удалось прочитать JSON-файл.',
 D05_ROUTE_HOST_NO_MODELS:'В выбранной рабочей области нет сохранённых маршрутов CehoVod.',
 D05_ROUTE_HOST_SELECTION_LIMIT:'В области более 24 маршрутов. Пока доступна выборка до 24 моделей.',
 D05_ROUTE_HOST_SOURCE_LIMIT:'Размер выборки сохранённых моделей превышает 8 МБ.',
 D05_ROUTE_HOST_SOURCE_CHANGED:'Исходные модели изменились во время чтения. Повторите выборку.',
 D05_ROUTE_HOST_CONTEXT_CHANGED:'Выбранный контекст изменился. Результат чтения сброшен.',
 D05_ROUTE_HOST_RECORD_MISMATCH:'Исходная модель не соответствует поддерживаемому контракту CehoVod.',
 D05_ROUTE_HOST_READ_REFUSED:'Нет действующего разрешённого чтения выбранных моделей.',
 T3_CONTROL_CONTEXT_CHANGED_DURING_READ:'Рабочая область или право чтения изменились.',
 T3_CONTROL_HOST_DETACHED:'Подключённый источник закрыт.'};
const PAGE_SIZE=8;
export function DomainRouteComparison({host=null}:{host?:D05RouteReviewPort|null}){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [result,setResult]=useState<D05RouteReview|D05SignedRouteReview|null>(null),[source,setSource]=useState('');
 const [hostConnected,setHostConnected]=useState(false);
 const [problem,setProblem]=useState(''),[busy,setBusy]=useState(false),[groupIndex,setGroupIndex]=useState(0);
 const [page,setPage]=useState(0);
 const reset=()=>{
  generation.current++;setResult(null);setProblem('');setSource('');setBusy(false);setGroupIndex(0);setPage(0);
  if(input.current)input.current.value='';
 };
 useLayoutEffect(()=>{
   generation.current++;
   setResult(null);setProblem('');setSource('');setBusy(false);setGroupIndex(0);setPage(0);setHostConnected(false);
   let off:(()=>void)|null=null;
   if(host){try{
     off=host.subscribeInvalidation(()=>{
       generation.current++;setResult(null);setSource('');setBusy(false);setGroupIndex(0);setPage(0);
       setProblem('Контекст изменился. Предыдущая выборка очищена.');
     });
     if(typeof off!=='function')throw Error('invalid subscription');
     setHostConnected(true);
   }catch{setProblem('Не удалось подключить выбранный предметный источник.');}}
   return ()=>{generation.current++;if(typeof off==='function')off();};
 },[host]);
 const apply=(records:unknown,label:string,token:number)=>{
  if(token!==generation.current)return;
  const value=reviewD05RouteModels(records);
  if(token!==generation.current)return;
  setResult(value);setSource(label);setGroupIndex(0);setPage(0);
 };
 const fail=(err:unknown,token:number)=>{
  if(token!==generation.current)return;
  const code=err&&typeof err==='object'&&'code' in err?String(err.code):'D05_ROUTE_FILE_INVALID';
  setResult(null);setProblem(ERRORS[code]??'Не удалось проверить выбранные модели.');
 };
 const example=()=>{
  reset();const token=generation.current;
  try{apply(buildD05RouteComparisonExample(),'Встроенный пример трёх моделей',token);}
  catch(err){fail(err,token);}
 };
 async function loadSelectedRoutes(){
   if(!host||!hostConnected)return;
   reset();const token=generation.current;setBusy(true);
   try{
     const value=await host.readSelectedRoutes();
     if(token!==generation.current)return;
     if(value.source_authority!=='ORIGINAL_SIGNED_SELECTED_READBACK'||value.export_allowed!==false||value.anonymity!=='NOT_ESTABLISHED')throw {code:'D05_ROUTE_HOST_RECORD_MISMATCH'};
     setResult(value);setSource('Сохранённые маршруты выбранной рабочей области');
   }catch(err){fail(err,token);}
   finally{if(token===generation.current)setBusy(false);}
 }
 async function onFiles(event:ChangeEvent<HTMLInputElement>){
  const picked=Array.from(event.target.files??[]);event.target.value='';
  if(!picked.length)return;
  reset();const token=generation.current;setBusy(true);
  try{
   if(picked.length>24||picked.reduce((n,file)=>n+file.size,0)>8*1024*1024)throw {code:'D05_ROUTE_FILE_LIMIT'};
   const records:unknown[]=[];
   for(const file of picked){
    if(token!==generation.current)return;
    const raw:unknown=JSON.parse(await file.text());
    if(token!==generation.current)return;
    records.push(raw);
   }
   apply(records,'Выбранные локальные модели',token);
  }catch(err){fail(err,token);}
  finally{if(token===generation.current)setBusy(false);}
 }
 const group=result?.groups[groupIndex];
 const pageCount=Math.max(1,Math.ceil((group?.operations.length??0)/PAGE_SIZE));
 const localNumber=(opId:string)=>(group?.operations.findIndex(x=>x.id===opId)??-1)+1;
 return <div className="activity-domain-review">
  <section className="activity-v7-card">
   <h2>Сопоставление технологических маршрутов CehoVod</h2>
   <p>Выберите несколько JSON-объектов operation-route из калькулятора или локальные копии сохранённых Result. Один файл содержит один маршрут. Activity сравнивает названия, типы операций и исходные зависимости; оборудование и другие параметры не объединяются автоматически.</p>
   <div className="activity-v7-actions">
    {hostConnected?<button className="activity-v7-primary" disabled={busy} onClick={loadSelectedRoutes}>Получить сохранённые маршруты</button>:null}
    <input type="file" ref={input} multiple accept=".json,application/json" className="visually-hidden" onChange={onFiles} aria-label="Выбрать JSON маршрутов CehoVod"/>
    <button className="activity-v7-primary" disabled={busy} onClick={()=>input.current?.click()}>Выбрать маршруты JSON</button>
    <button disabled={busy} aria-label="Открыть пример маршрутов CehoVod" onClick={example}>Открыть пример маршрутов</button>
    <button disabled={!busy&&!result&&!problem} onClick={reset}>Очистить выборку</button>
   </div>
   <div className="activity-v7-note">{hostConnected?'Доступно штатное чтение выбранной рабочей области через доверенный Host.':'Доменный источник не подключён. Доступны локальные JSON-модели.'} Названия операций могут содержать частные сведения. Данные не записываются и не передаются. При выходе из раздела выборка очищается.</div>
  </section>
  {busy?<p role="status">Читаются выбранные файлы…</p>:null}
  {problem?<div role="alert" className="activity-v7-note hold">{problem}</div>:null}
  {result?<section className="activity-v7-card" aria-label="Результат сопоставления маршрутов">
   <h2>Группы структурных кандидатов</h2>
   <p>{source}. Это модели и нормативные маршруты, не наблюдённое исполнение.</p>
   {result.source_authority==='ORIGINAL_SIGNED_SELECTED_READBACK'?<p>Исходная Workspace прочитана через оригинальный подписанный Host.</p>:<p>Локальная модель: происхождение и право использования не подтверждены.</p>}
   <div className="activity-v7-stats">
    <div><strong>{result.model_count}</strong><span>Модели</span></div>
    <div><strong>{result.group_count}</strong><span>Группы структур</span></div>
    <div><strong>{result.repeated_group_count}</strong><span>Повторяющиеся группы</span></div>
   </div>
   <p role="status">{'Моделей: '+result.model_count+' · Групп: '+result.group_count+' · Повторяющихся групп: '+result.repeated_group_count}</p>
   <label className="activity-domain-label">Группа маршрутов
    <select aria-label="Группа маршрутов" value={groupIndex} onChange={e=>{setGroupIndex(Number(e.target.value));setPage(0);}}>
     {result.groups.map((g,i)=><option key={g.id} value={i}>Группа {i+1} · {g.model_count} моделей</option>)}
    </select>
   </label>
   {group?<div className="activity-domain-group">
    <h3>{BASIS[group.basis]}</h3>
    <p>Номера в текущей выборке: {group.model_numbers.join(', ')}. Операций: {group.operations.length}. Зависимостей: {group.dependency_count}.</p>
    {group.differing_fields.length>0?<p className="activity-v7-note"><strong>Требуют согласования:</strong> {group.differing_fields.map(x=>DIFFS[x]??x).join(', ')}.</p>:
      <p>В проверенных полях различий не обнаружено. Это не подтверждает совпадение требований и применимости технологий.</p>}
    {group.incomplete_fields.length>0?<p className="activity-v7-note"><strong>Недостаточно параметров:</strong> {group.incomplete_fields.map(x=>DIFFS[x]??x).join(', ')}. Отсутствующие значения не считаются совпадением.</p>:null}
    <h3>Операции и исходные зависимости</h3>
    <div className="activity-domain-ops">
     {group.operations.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map((op,i)=>
      <div key={op.id} className="activity-domain-op"><strong>{page*PAGE_SIZE+i+1}. {op.name}</strong>
       <span>{KINDS[op.kind]}{op.parallel?' · Параллельная возможность':''}{op.milestone?' · Контрольная веха':''}</span>
       <span>{op.predecessors.length?'Предшественники: '+op.predecessors.map(localNumber).join(', '):'Нет предшественников'}</span>
      </div>)}
    </div>
    <div className="activity-v7-actions">
     <button disabled={page===0} onClick={()=>setPage(x=>x-1)}>Назад</button>
     <span>Страница {page+1} из {pageCount}</span>
     <button disabled={page+1>=pageCount} onClick={()=>setPage(x=>x+1)}>Далее</button>
    </div>
   </div>:null}
   <div className="activity-v7-note hold">Эквивалентность технологии не установлена. Анонимность и право передачи не подтверждены. Выпуск .iwxa закрыт.</div>
  </section>:null}
 </div>;
}
