import {useLayoutEffect,useRef,useState,type ChangeEvent} from 'react';
import {prepareContextualGeneralizationPlan,prepareContextualGeneralizationRequest,reviewContextualGeneralizationPlan,prepareContextualGeneralizationHandoff,collectContextualPlanProposals,
 type ContextualGeneralizationPlan,type ContextualGeneralizationRequest,type ContextualPlanReview,type ContextualFieldReview,type SourceReference}
 from '../../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
import type {ProductPreview} from '../../modules/activity-base-anonymizer/technology-product.mjs';
import {ProductRevisionComparison} from './ProductRevisionComparison';

const PAGE=8,FILE_LIMIT=8*1024*1024,LOAD_LIMIT=8*1024*1024;
const names:Record<string,string>={title:'Название',technology:'Технология',terms:'Общие условия',purpose:'Назначение',inputs:'Входы',outputs:'Результат',
 applicability:'Применимость',instructions:'Инструкция',result_requirements:'Критерии результата',context_requirements:'Контекст получателя',
 operations:'Операции',quality_checks:'Контроль',label:'Название',role:'Роль',equipment_requirement:'Оборудование',material_requirement:'Материал',
 adaptation_guidance:'Адаптация',local_context_guidance:'Практические условия',route_parameters:'Параметры маршрута',parameters:'Параметры',
 guidance:'Правило выбора',responsible_role:'Ответственный',declared_fields:'Требования',value:'Значение',cadence:'Периодичность'};
const label=(path:string)=>path.split('.').slice(1).map(k=>names[k]??(/^\d+$/.test(k)?String(Number(k)+1):k)).join(' / ');
const blockLabels={TECHNICAL_MARKERS_CHANGED:'Изменены физические величины или сравнения',CONTROL_NUMBERS_CHANGED:'Изменены числовые условия контроля',
 PRACTICAL_SCOPE_CHANGED:'Изменена область или значимые выражения практического правила'};
type Loaded={raw:unknown;fields:ContextualFieldReview[]};
const defaultSelection=(fields:ContextualFieldReview[])=>fields.filter(f=>f.decision==='REWRITE'&&!f.block&&!f.remaining_matches.length).map(f=>f.path);

export function ProductContextualPlanPanel({product,reports,references,language,disabled,onRevision}:{
 product:ProductPreview;reports:Partial<Record<'en'|'ru',unknown>>;references:SourceReference[];language:'ru'|'en';
 disabled:boolean;onRevision:(value:ProductPreview)=>void;
}){
 const file=useRef<HTMLInputElement>(null),generation=useRef(0),running=useRef(false);
 const [plan,setPlan]=useState<ContextualGeneralizationPlan|null>(null),[request,setRequest]=useState<ContextualGeneralizationRequest|null>(null);
 const [active,setActive]=useState(''),[loaded,setLoaded]=useState<Record<string,Loaded>>({}),[accepted,setAccepted]=useState<string[]>([]);
 const [page,setPage]=useState(0),[unplannedPage,setUnplannedPage]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [pending,setPending]=useState<ContextualPlanReview|null>(null);
 const [handoffNext,setHandoffNext]=useState(0),[handoffNotice,setHandoffNotice]=useState('');
 useLayoutEffect(()=>{
  generation.current++;setPlan(null);setRequest(null);setActive('');setLoaded({});setAccepted([]);setPage(0);setUnplannedPage(0);setPending(null);setBusy(false);setError('');setHandoffNext(0);setHandoffNotice('');
  return()=>{generation.current++;};
 },[product,reports,references,language]);
 const blocked=disabled||busy;
 const batch=plan?.batches.find(b=>b.request_sha256===active);
 const answered=plan?.batches.filter(b=>Object.hasOwn(loaded,b.request_sha256))??[];
 const fields=answered.flatMap(b=>loaded[b.request_sha256].fields);
 const current=active&&Object.hasOwn(loaded,active)?loaded[active]:null;
 const next=plan?.batches.find(b=>!Object.hasOwn(loaded,b.request_sha256));
 const acceptedSet=new Set(accepted);
 const unresolved=fields.filter(f=>f.block||f.decision==='NEEDS_REVIEW'||f.remaining_matches.length>0).length;
 const review=pending?.base_product_sha256===product.product_sha256&&pending.plan_sha256===plan?.plan_sha256?pending:null;
 async function exactRequest(b:ContextualGeneralizationPlan['batches'][number],token:number){
  const value=await prepareContextualGeneralizationRequest(product,Object.values(reports),language,references,b.paths);
  if(value.request_sha256!==b.request_sha256)throw Error('request changed');
  if(token===generation.current)setRequest(value);
 }
 async function prepare(){
  if(blocked||running.current||plan)return;
  const token=++generation.current;running.current=true;setBusy(true);setError('');
  try{
   const value=await prepareContextualGeneralizationPlan(product,Object.values(reports),language,references);
   if(token!==generation.current)return;
   setPlan(value);const first=value.batches[0];
   if(first){setActive(first.request_sha256);await exactRequest(first,token);}
  }catch{if(token===generation.current)setError('Не удалось подготовить целую технологию. Проверьте текущую редакцию и исходные проверки.');}
  finally{running.current=false;if(token===generation.current)setBusy(false);}
 }
 async function openBatch(id:string){
  if(!plan||blocked||running.current)return;
  const selected=plan.batches.find(b=>b.request_sha256===id);if(!selected)return;
  const token=++generation.current;setActive(id);setPage(0);setRequest(null);setError('');
  if(Object.hasOwn(loaded,id))return;
  running.current=true;setBusy(true);
  try{await exactRequest(selected,token);}
  catch{if(token===generation.current)setError('Не удалось восстановить точное задание группы.');}
  finally{running.current=false;if(token===generation.current)setBusy(false);}
 }
 function save(){
  if(!request||blocked||request.request_sha256!==active)return;
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(request)],{type:'application/json'}));
  a.href=url;a.download='activity-local-contextual-'+(batch?.batch_id??'request')+'.json';
  try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }
 async function saveHandoff(){
  if(!plan||blocked||running.current||!plan.batches.length)return;
  const token=++generation.current;running.current=true;setBusy(true);setError('');setHandoffNotice('');
  try{
   const first=handoffNext<plan.batches.length?handoffNext:0;
   const value=await prepareContextualGeneralizationHandoff(product,Object.values(reports),language,references,plan.plan_sha256,first);
   if(token!==generation.current)return;
   const last=first+value.requests.length,url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download='activity-local-plan-'+plan.plan_sha256.slice(0,12)+'-'+(first+1)+'-'+last+'.json';
   try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
   setHandoffNext(last);setHandoffNotice('Подготовлены задания '+(first+1)+'–'+last+' из '+plan.batches.length+'. Откройте файл в Agent.');
  }catch{if(token===generation.current)setError('Не удалось подготовить комплект точных заданий текущей технологии.');}
  finally{running.current=false;if(token===generation.current)setBusy(false);}
 }
 async function load(e:ChangeEvent<HTMLInputElement>){
  const files=Array.from(e.target.files??[]);e.target.value='';
  if(!plan||!files.length||blocked||running.current)return;
  const token=++generation.current;running.current=true;setBusy(true);setError('');setPending(null);
  try{
   if(files.some(f=>!f.size||f.size>FILE_LIMIT)||files.reduce((sum,f)=>sum+f.size,0)>LOAD_LIMIT)throw Error('size');
   const raw=await Promise.all(files.map(async f=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer()))));
   const proposals=collectContextualPlanProposals(plan,raw,Object.values(loaded).map(v=>v.raw));
   if(!proposals.length)return;
   const read=await reviewContextualGeneralizationPlan(product,Object.values(reports),language,references,plan.plan_sha256,proposals,[]);
   if(token!==generation.current)return;
   const byDigest=new Map(proposals.map(v=>[(v as {request_sha256:string}).request_sha256,v]));
   const additions=Object.fromEntries(read.answered_batches.map(b=>[b.request_sha256,{raw:byDigest.get(b.request_sha256),fields:b.fields}]));
   setLoaded(old=>({...old,...additions}));setAccepted(old=>[...new Set([...old,...defaultSelection(read.answered_batches.flatMap(b=>b.fields))])]);
   const first=read.answered_batches[0];if(first){setActive(first.request_sha256);setPage(0);setRequest(null);}
  }catch(e){if(token===generation.current)setError(e&&typeof e==='object'&&'code' in e&&e.code==='TECHNOLOGY_CONTEXTUAL_HANDOFF_CONFLICT'?
   'Ответ этой группы уже открыт. Для замены сначала удалите предыдущий ответ группы.':
   'Ответы не соответствуют плану или допустимому объёму. Ни один из выбранных файлов не добавлен.');}
  finally{running.current=false;if(token===generation.current)setBusy(false);}
 }
 function removeCurrent(){
  if(!current||blocked)return;
  const removed=new Set(current.fields.map(f=>f.path));
  setLoaded(old=>Object.fromEntries(Object.entries(old).filter(([key])=>key!==active)));
  setAccepted(old=>old.filter(path=>!removed.has(path)));setPending(null);setRequest(null);setPage(0);setError('');
 }
 async function compare(){
  if(!plan||blocked||running.current||!accepted.length)return;
  const token=++generation.current;running.current=true;setBusy(true);setError('');setPending(null);
  try{
   const value=await reviewContextualGeneralizationPlan(product,Object.values(reports),language,references,plan.plan_sha256,
    answered.map(b=>loaded[b.request_sha256].raw),accepted);
   if(token===generation.current)setPending(value);
  }catch{if(token===generation.current)setError('Не удалось объединить выбранные формулировки. Проверьте исходные ответы и совместимость новой редакции.');}
  finally{running.current=false;if(token===generation.current)setBusy(false);}
 }
 return <section className="activity-domain-group">
  <h4>Вся технология</h4>
  <p>Activity распределяет содержательные поля по заданиям локальной модели, учитывая связи операций и контроля. Ответы всех групп относятся к одной редакции. Выбранные формулировки объединяются перед подтверждением.</p>
  {!plan?<button className="activity-v7-primary" disabled={blocked} onClick={()=>void prepare()}>Подготовить всю технологию</button>:<>
   <div className="activity-v7-stats">
    <div><strong>{fields.length} / {plan.editable_field_count}</strong><span>Полей с ответом</span></div>
    <div><strong>{answered.length} / {plan.batches.length}</strong><span>Групп с ответом</span></div>
    <div><strong>{accepted.length}</strong><span>Выбрано исправлений</span></div>
   </div>
   <p>Без ответа: {plan.planned_field_count-fields.length}. Не помещаются в задание: {plan.unplanned.length}. Полей с вопросами, отклонёнными заменами или известными совпадениями: {unresolved}.</p>
   <p>Подготовьте комплект заданий для Personal Agent. После работы локальной модели и проверки Task сохраните комплект ответов в Agent и откройте здесь. Файлы содержат частные сведения.</p>
   {plan.batches.length?<div className="activity-v7-actions"><button className="activity-v7-primary" disabled={blocked} onClick={()=>void saveHandoff()}>
    {handoffNext===0?'Сохранить комплект заданий для Agent':handoffNext<plan.batches.length?'Сохранить следующую часть заданий':'Сохранить комплект повторно'}</button></div>:null}
   {handoffNotice?<p role="status">{handoffNotice}</p>:null}
   {plan.unplanned.length?<details><summary>Поля для отдельного уточнения ({plan.unplanned.length})</summary>
    <p>Связанный контекст превышает допустимый объём. Он не обрезан. Уточните эти поля в редакторе содержания.</p>
    {plan.unplanned.slice(unplannedPage*PAGE,(unplannedPage+1)*PAGE).map(f=><p key={f.path}>{label(f.path)}</p>)}
    {plan.unplanned.length>PAGE?<div className="activity-v7-actions"><button disabled={blocked||!unplannedPage} onClick={()=>setUnplannedPage(p=>p-1)}>Назад</button><span>{unplannedPage+1} / {Math.ceil(plan.unplanned.length/PAGE)}</span><button disabled={blocked||(unplannedPage+1)*PAGE>=plan.unplanned.length} onClick={()=>setUnplannedPage(p=>p+1)}>Далее</button></div>:null}
   </details>:null}
   {plan.batches.length?<>
    <label className="activity-domain-label">Группа полей<select value={active} disabled={blocked} onChange={e=>void openBatch(e.target.value)}>
     {plan.batches.map((b,i)=><option key={b.request_sha256} value={b.request_sha256}>Группа {i+1} · {b.paths.length} полей · {Object.hasOwn(loaded,b.request_sha256)?'ответ получен':'ожидает ответа'}</option>)}
    </select></label>
    {batch?<details><summary>Состав группы ({batch.paths.length})</summary>{batch.paths.map(path=><p key={path}>{label(path)}</p>)}</details>:null}
    <div className="activity-v7-actions">
     {request?.request_sha256===active?<button disabled={blocked} onClick={save}>Сохранить задание группы</button>:!current?<button disabled={blocked||!batch} onClick={()=>void openBatch(active)}>Подготовить задание группы</button>:null}
     <input ref={file} type="file" multiple accept=".json,application/json" className="visually-hidden" aria-label="Открыть ответы групп локальной модели" onChange={load}/>
     <button disabled={blocked} onClick={()=>file.current?.click()}>Открыть ответы Agent</button>
     {next?<button disabled={blocked||next.request_sha256===active&&!current} onClick={()=>void openBatch(next.request_sha256)}>Следующая группа без ответа</button>:null}
    </div>
    {current?<div className="activity-domain-group">
     <div className="activity-v7-actions"><button disabled={blocked} onClick={removeCurrent}>Удалить ответ группы</button></div>
     {current.fields.slice(page*PAGE,(page+1)*PAGE).map(f=><div key={f.path} className="activity-domain-op">
      <strong>{label(f.path)}</strong><span>{f.decision==='RETAIN'?'Сохранить':f.decision==='NEEDS_REVIEW'?'Требуется уточнение':'Предложена новая формулировка'}</span>
      <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{f.previous}</p>
      {f.value?<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{f.value}</p>:null}<p>{f.reason}</p>
      {f.block?<p className="activity-v7-note hold">{blockLabels[f.block]}. Замена исключена.</p>:null}
      {f.remaining_matches.length?<p className="activity-v7-note hold">Известные совпадения: {f.remaining_matches.map(m=>m.value+(m.introduced?' (новое)':'')).join('; ')}. Требуется содержательная оценка.</p>:null}
      {f.decision==='REWRITE'&&!f.block?<label><input type="checkbox" disabled={blocked} checked={acceptedSet.has(f.path)}
       onChange={e=>{setPending(null);setAccepted(old=>e.target.checked?[...new Set([...old,f.path])]:old.filter(p=>p!==f.path));}}/> Включить в единую редакцию</label>:null}
     </div>)}
     {current.fields.length>PAGE?<div className="activity-v7-actions"><button disabled={blocked||!page} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page+1} / {Math.ceil(current.fields.length/PAGE)}</span><button disabled={blocked||(page+1)*PAGE>=current.fields.length} onClick={()=>setPage(p=>p+1)}>Далее</button></div>:null}
    </div>:null}
   </>:null}
   {fields.length?<><p>{fields.length===plan.editable_field_count?'Ответы получены по всем редактируемым полям.':'Часть полей ещё не рассмотрена моделью.'} Ответ модели не доказывает пригодность или анонимность. Сравните общий результат и оставшиеся ограничения.</p>
    <div className="activity-v7-actions"><button className="activity-v7-primary" disabled={blocked||!accepted.length} onClick={()=>void compare()}>Сравнить единую редакцию ({accepted.length})</button></div></>:null}
   {review?.revision?<ProductRevisionComparison key={review.revision.preview.product_sha256} review={review.revision.local_review} disabled={blocked}
    onConfirm={()=>{if(!blocked&&review.revision&&review.base_product_sha256===product.product_sha256){setPending(null);onRevision(review.revision.preview);}}} onCancel={()=>setPending(null)}/>:null}
  </>}
  {busy?<p role="status">Обрабатывается локальная технология…</p>:null}
  {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
 </section>;
}
