import {useLayoutEffect,useRef,useState,type ChangeEvent} from 'react';
import {prepareD05ExtractionRequest,reviewD05ExtractionProposal,type D05ExtractionRequest,type D05ExtractionReview}
 from '../../modules/activity-base-anonymizer/d05-technology-extraction.mjs';
import type {D05TechnologyProposalForm,D05ParameterDecision} from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';

function saveLocalRequest(request:D05ExtractionRequest){
 const blob=new Blob([JSON.stringify(request)],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='activity-d05-local-extraction-request.json';
 try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
const labels:Record<string,string>={title:'Название',purpose:'Назначение',inputs:'Входы',outputs:'Результат',
 applicability:'Применимость',adaptation_guidance:'Адаптация',local_context_guidance:'Локальные требования',
 label:'Название операции',role:'Роль',equipment:'Оборудование',material:'Материалы',responsible_role:'Роль при контроле'};
export function D05ExtractionPanel({review,groupId,modelNumber,form,decisions,onApply,scopeLabel}:{
 review:unknown;groupId:string;modelNumber:number;form:D05TechnologyProposalForm;
 decisions:Record<string,D05ParameterDecision>;
 onApply:(form:D05TechnologyProposalForm,decisions:Record<string,D05ParameterDecision>,title:string|null)=>void;
 scopeLabel:(scope:string)=>string;
}){
 const file=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [request,setRequest]=useState<D05ExtractionRequest|null>(null),[result,setResult]=useState<D05ExtractionReview|null>(null);
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState(''),[page,setPage]=useState(0);
 const [includeCompatibleDeclarations,setCompatible]=useState(true);
 useLayoutEffect(()=>{generation.current++;setRequest(null);setResult(null);setProblem('');setBusy(false);setPage(0);
  return()=>{generation.current++;};},[review,groupId,modelNumber,includeCompatibleDeclarations]);
 async function prepare(){
  const token=++generation.current;setBusy(true);setProblem('');setResult(null);setRequest(null);
  try{const value=await prepareD05ExtractionRequest(review,groupId,modelNumber,{includeCompatibleDeclarations});
   if(token===generation.current)setRequest(value);}
  catch{if(token===generation.current)setProblem('Для извлечения нужен однозначный маршрут с исходной картой качества. Большие выборки необходимо разделить по технологиям.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 async function load(e:ChangeEvent<HTMLInputElement>){
  const selected=e.target.files?.[0];e.target.value='';if(!selected)return;
  const token=++generation.current;setBusy(true);setProblem('');setResult(null);setPage(0);
  try{
   if(!selected.size||selected.size>2*1024*1024)throw Error('size');
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer()));
   const value=await reviewD05ExtractionProposal(review,groupId,modelNumber,raw,{includeCompatibleDeclarations});
   if(token===generation.current)setResult(value);
  }catch{if(token===generation.current)setProblem('Ответ не соответствует точной редакции источника, полям предложения или указанным основаниям. Проверьте задачу в Agent.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 function apply(){
  if(!result)return;
  // A proposed model field only fills a gap; never overwrite accepted user edits.
  const next={...form,operations:{...form.operations},quality_roles:{...form.quality_roles}};
  for(const k of ['purpose','inputs','outputs','applicability','adaptation_guidance','local_context_guidance'] as const)
   if(!next[k]?.trim()&&result.form[k])next[k]=result.form[k];
  for(const [id,fields] of Object.entries(result.form.operations??{})){
   const op={...next.operations[id]};
   for(const k of ['label','role','equipment','material'] as const)if(!op[k]?.trim()&&fields[k])op[k]=fields[k];
   next.operations[id]=op;
  }
  for(const [id,value] of Object.entries(result.form.quality_roles??{}))if(!next.quality_roles[id]?.trim())next.quality_roles[id]=value;
  onApply(next,{...result.decisions,...decisions},result.suggested_title);
 }
 const fields=result?Object.entries(result.fields):[],pageSize=12;
 const family=request?.document.comparison.compatible_declarations;
 return <div className="activity-domain-group">
  <h3>Автоматизированное извлечение технологии</h3>
  <p>Локальная модель обобщает выбранную технологию, не меняя операции, зависимости, допуски и контроль качества.</p>
  <label className="activity-domain-label">Объём исходного опыта
   <select disabled={busy} value={includeCompatibleDeclarations?'compatible':'single'} onChange={e=>setCompatible(e.target.value==='compatible')}>
    <option value="compatible">Выбранная технология и совпадающие технические декларации</option>
    <option value="single">Только выбранный вариант</option>
   </select>
  </label>
  <p>Сходные маршруты с различными технологическими условиями или допусками остаются отдельными. Объём партии и календарь получателя не считаются техническими пределами.</p>
  <div className="activity-v7-actions"><button disabled={busy} onClick={()=>void prepare()}>Подготовить задание для локальной модели</button>
   {request?<button disabled={busy} onClick={()=>saveLocalRequest(request)}>Сохранить локальное задание Agent</button>:null}
   <input ref={file} className="visually-hidden" type="file" accept=".json,application/json" aria-label="Открыть извлечённую производственную технологию" onChange={load}/>
   <button disabled={busy} onClick={()=>file.current?.click()}>Открыть извлечённую технологию</button></div>
  {family?<div className="activity-v7-stats"><div><strong>{family.member_count}</strong><span>Совпадающих исходных деклараций</span></div>
   <div><strong>{family.technical_condition_count}</strong><span>Совпадающих технических условий</span></div>
   <div><strong>{family.control_count}</strong><span>Совпадающих контрольных точек</span></div></div>:null}
  {request?<p role="status">Подготовлено {request.field_count} предметных полей. {family?'Повторение заявленных условий не подтверждает фактическое исполнение.':'Включён один исходный вариант.'} Откройте локальное задание в Agent. Используйте только разрешённую локальную модель и отдельную рабочую область; файл содержит частные сведения, не отправляйте его в облако.</p>:null}
  {busy?<p role="status">Проверяется выбранная редакция…</p>:null}
  {problem?<p role="alert" className="activity-v7-note hold">{problem}</p>:null}
  {result?<><div className="activity-v7-stats"><div><strong>{fields.length-result.missing_fields.length}</strong><span>Подготовлено полей</span></div>
    <div><strong>{result.proposed_fields.length}</strong><span>Предложения</span></div><div><strong>{result.missing_fields.length}</strong><span>Не установлено</span></div></div>
   <p>{result.product?'Предметное содержимое прошло проверку структуры.':'Нужны дополнительные предметные сведения или проверка обязательных условий.'} Исходные цитаты не заменяют проверку смысла.</p>
   {result.suggested_title?<p><strong>{result.suggested_title}</strong></p>:null}
   <button className="activity-v7-primary" onClick={apply}>Заполнить незаполненные поля и настройки</button>
   <details><summary>Сведения и основания</summary>
    {fields.slice(page*pageSize,(page+1)*pageSize).map(([id,row])=>{
     const dot=id.indexOf('.'),scope=id.slice(0,dot),field=id.slice(dot+1);
     return <div className="activity-domain-op" key={id}><strong>{scopeLabel(scope)}: {labels[field]??field}</strong>
      <span>{row.basis==='MISSING'?'Не установлено':row.basis==='SOURCE_SUPPORTED'?'Есть ссылка на исходное поле':'Предложение модели'}</span>
      {row.value?<p>{row.value}</p>:null}{row.note?<p>{row.note}</p>:null}{row.refs.map((r,i)=><p key={i}>{r.quote}</p>)}</div>;
    })}
    {fields.length>pageSize?<div className="activity-v7-actions"><button disabled={!page} onClick={()=>setPage(x=>x-1)}>Назад</button>
     <span>{page+1} / {Math.ceil(fields.length/pageSize)}</span><button disabled={(page+1)*pageSize>=fields.length} onClick={()=>setPage(x=>x+1)}>Далее</button></div>:null}
   </details>
  </>:null}
 </div>;
}
