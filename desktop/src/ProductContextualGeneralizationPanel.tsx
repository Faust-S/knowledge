import {useLayoutEffect,useMemo,useRef,useState,type ChangeEvent} from 'react';
import {prepareContextualGeneralizationRequest,reviewContextualGeneralizationProposal,type ContextualGeneralizationRequest,type ContextualGeneralizationReview,type GeneralizationPlan,type SourceReference}
 from '../../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
import {editableProductTexts,reviseTechnologyProductText,reviewTechnologyTransferContent} from '../../modules/activity-base-anonymizer/technology-product-revision.mjs';
import type {ProductPreview} from '../../modules/activity-base-anonymizer/technology-product.mjs';
import {ProductRevisionComparison} from './ProductRevisionComparison';

const names:Record<string,string>={title:'Название',technology:'Технология',terms:'Общие условия',purpose:'Назначение',inputs:'Входы',outputs:'Результат',
 applicability:'Применимость',instructions:'Инструкция',result_requirements:'Критерии результата',context_requirements:'Контекст получателя',
 operations:'Операции',quality_checks:'Контроль',label:'Название',role:'Роль',equipment_requirement:'Оборудование',material_requirement:'Материал',
 adaptation_guidance:'Адаптация',local_context_guidance:'Практические условия',route_parameters:'Параметры маршрута',parameters:'Параметры',
 guidance:'Правило выбора',responsible_role:'Ответственный',declared_fields:'Требования',value:'Значение',cadence:'Периодичность'};
const label=(path:string)=>path.split('.').slice(1).map(k=>names[k]??(/^\d+$/.test(k)?String(Number(k)+1):k)).join(' / ');
const blockLabels={TECHNICAL_MARKERS_CHANGED:'Изменены физические единицы или сравнения',CONTROL_NUMBERS_CHANGED:'Изменены числовые условия контроля',PRACTICAL_SCOPE_CHANGED:'Изменена или не распознана область практического правила'};
const LIMIT=16,PAGE=8;

export function ProductContextualGeneralizationPanel({product,reports,references,language,plan,disabled,onRevision}:{
 product:ProductPreview;reports:Partial<Record<'en'|'ru',unknown>>;references:SourceReference[];language:'ru'|'en';
 plan:GeneralizationPlan|null;disabled:boolean;onRevision:(value:ProductPreview)=>void;
}){
 const file=useRef<HTMLInputElement>(null),generation=useRef(0),running=useRef(false);
 const [paths,setPaths]=useState<string[]>([]),[page,setPage]=useState(0),[reviewPage,setReviewPage]=useState(0);
 const [request,setRequest]=useState<ContextualGeneralizationRequest|null>(null),[review,setReview]=useState<ContextualGeneralizationReview|null>(null);
 const [accepted,setAccepted]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [pending,setPending]=useState<{signature:string;value:Awaited<ReturnType<typeof reviseTechnologyProductText>>}|null>(null);
 const inventory=useMemo(()=>editableProductTexts(product.object_data).filter(f=>f.edit_kind!=='FIXED'),[product]);
 const priority=useMemo(()=>new Set([...(plan?.groups??[]).flatMap(g=>g.spans.filter(s=>s.edit_kind!=='FIXED').map(s=>s.path)),
  ...reviewTechnologyTransferContent(product.object_data).issues.map(i=>i.path)]),[plan,product]);
 const ordered=useMemo(()=>[...inventory].sort((a,b)=>Number(priority.has(b.path))-Number(priority.has(a.path))),[inventory,priority]);
 const visible=ordered.slice(page*PAGE,(page+1)*PAGE);
 useLayoutEffect(()=>{
  generation.current++;setPaths([]);setPage(0);setReviewPage(0);setRequest(null);setReview(null);setAccepted([]);setPending(null);setBusy(false);setError('');
  return()=>{generation.current++;};
 },[product,reports,references,language]);
 const blocked=disabled||busy;
 function choose(next:string[]){
  if(blocked||next.length>LIMIT)return;
  generation.current++;setPaths(next);setRequest(null);setReview(null);setAccepted([]);setPending(null);setReviewPage(0);setError('');
 }
 async function prepare(){
  if(blocked||running.current||!paths.length)return;
  const token=++generation.current;running.current=true;setBusy(true);setError('');setRequest(null);setReview(null);setAccepted([]);setPending(null);
  try{
   const result=await prepareContextualGeneralizationRequest(product,Object.values(reports),language,references,paths);
   if(token===generation.current)setRequest(result);
  }catch(e){
   if(token===generation.current){
    const code=e&&typeof e==='object'&&'code' in e?String(e.code):'';
    setError(code==='TECHNOLOGY_CONTEXTUAL_GENERALIZATION_INPUT_LIMIT'?'Выбранные поля вместе со связанными условиями слишком велики. Выберите меньшую группу.':'Не удалось подготовить задание для текущей редакции и проверок.');
   }
  }finally{running.current=false;if(token===generation.current)setBusy(false);}
 }
 function save(){
  if(!request||blocked)return;
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(request)],{type:'application/json'}));
  a.href=url;a.download='activity-local-contextual-generalization.json';
  try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }
 async function load(e:ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];e.target.value='';
  if(!f||!request||blocked||running.current)return;
  const token=++generation.current;running.current=true;setBusy(true);setError('');setReview(null);setAccepted([]);setPending(null);setReviewPage(0);
  try{
   if(!f.size||f.size>2*1024*1024)throw Error('limit');
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer()));
   const result=await reviewContextualGeneralizationProposal(product,Object.values(reports),language,references,paths,raw);
   if(token===generation.current){
    setReview(result);
    // Rewrites which leave or introduce a known reference require explicit selection.
    setAccepted(result.fields.filter(f=>f.decision==='REWRITE'&&!f.block&&!f.remaining_matches.length).map(f=>f.path));
   }
  }catch{if(token===generation.current)setError('Ответ не соответствует подготовленному заданию, набору полей или допустимой редакции. Проверьте JSON и сформируйте ответ по точному локальному заданию.');}
  finally{running.current=false;if(token===generation.current)setBusy(false);}
 }
 const signature=JSON.stringify([review?.request_sha256,[...accepted].sort()]);
 const current=pending?.signature===signature?pending.value:null;
 async function compare(){
  if(!review||blocked||running.current||!accepted.length)return;
  const token=++generation.current;running.current=true;setBusy(true);setError('');setPending(null);
  try{
   const edits=(review.revision?.local_review.edits??[]).filter(e=>accepted.includes(e.path)).map(e=>({path:e.path,previous:e.previous,replacement:e.replacement,reason:e.reason}));
   const value=await reviseTechnologyProductText(product,{base_product_sha256:review.base_product_sha256,edits});
   if(token===generation.current)setPending({signature,value});
  }catch{if(token===generation.current)setError('Выбранные формулировки несовместимы с действующей технологией. Уточните их в редакторе.');}
  finally{running.current=false;if(token===generation.current)setBusy(false);}
 }
 return <details className="activity-domain-group">
  <summary>Контекстное обезличивание технологии</summary>
  <p>Локальная модель анализирует целые поля, а не только обнаруженные имена. Она предлагает переносимые формулировки, сохраняет технические условия или указывает, что требуется уточнение владельца. Это не автоматическая публикация.</p>
  <p>Выбрано {paths.length} из {inventory.length} текстовых полей. За один запрос можно обработать до {LIMIT} полей. Остальные поля не считаются проверенными.</p>
  <div className="activity-v7-actions"><button disabled={blocked||!priority.size} onClick={()=>choose(ordered.filter(f=>priority.has(f.path)).slice(0,LIMIT).map(f=>f.path))}>Выбрать приоритетные поля</button>
   <button disabled={blocked} onClick={()=>choose(visible.map(f=>f.path))}>Выбрать текущую страницу</button>
   <button disabled={blocked||!paths.length} onClick={()=>choose([])}>Снять выбор</button></div>
  {visible.map(f=><label key={f.path} className="activity-domain-op"><input type="checkbox" checked={paths.includes(f.path)} disabled={blocked||!paths.includes(f.path)&&paths.length>=LIMIT}
   onChange={e=>choose(e.target.checked?[...paths,f.path]:paths.filter(p=>p!==f.path))}/><strong>{label(f.path)}</strong>
   <span>{priority.has(f.path)?'Есть обнаружения или пробелы · ':''}{f.edit_kind==='CONTROL_TEXT'?'Текст контроля':'Редактируемое поле'}</span>
   <span style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{f.text.length>180?f.text.slice(0,180)+'…':f.text}</span></label>)}
  {ordered.length>PAGE?<div className="activity-v7-actions"><button disabled={blocked||!page} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page+1} / {Math.ceil(ordered.length/PAGE)}</span><button disabled={blocked||(page+1)*PAGE>=ordered.length} onClick={()=>setPage(p=>p+1)}>Далее</button></div>:null}
  <div className="activity-v7-actions"><button className="activity-v7-primary" disabled={blocked||!paths.length} onClick={()=>void prepare()}>Подготовить задание локальной модели</button></div>
  {request?<><p>Задание подготовлено для {request.field_count} полей. Сохраните его и используйте разрешённую локальную модель. Файл содержит частные сведения. Не отправляйте его в облачные сервисы.</p>
   <div className="activity-v7-actions"><button disabled={blocked} onClick={save}>Сохранить локальное задание</button>
    <input ref={file} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Открыть контекстное предложение модели" onChange={load}/>
    <button disabled={blocked} onClick={()=>file.current?.click()}>Открыть ответ модели</button></div></>:null}
  {busy?<p role="status">Подготавливается локальная редакция…</p>:null}
  {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
  {review?<><div className="activity-v7-stats"><div><strong>{review.selected_field_count}</strong><span>Рассмотрено полей</span></div>
   <div><strong>{review.changed_field_count}</strong><span>Предложено изменений</span></div>
   <div><strong>{review.blocked_field_count}</strong><span>Требуют предметной правки</span></div></div>
   <p>Без предложенных изменений или с неуточнённым контекстом: {review.fields.filter(f=>f.decision!=='REWRITE').length}. Полей с оставшимися известными совпадениями: {review.remaining_match_field_count}. Новых совпадений: {review.introduced_match_field_count} полей.</p>
   {review.fields.slice(reviewPage*PAGE,(reviewPage+1)*PAGE).map(f=><div className="activity-domain-op" key={f.path}>
    <strong>{label(f.path)}</strong><span>{f.decision==='RETAIN'?'Сохранить':f.decision==='NEEDS_REVIEW'?'Уточнить у владельца':'Предложена новая формулировка'}</span>
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{f.previous}</p>
    {f.value?<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{f.value}</p>:null}
    <p>{f.reason}</p>{f.block?<p className="activity-v7-note hold">{blockLabels[f.block]}. Эта замена не включена в редакцию.</p>:null}
    {f.remaining_matches.length?<p className="activity-v7-note hold">Известные совпадения: {f.remaining_matches.map(m=>m.value+(m.introduced?' (новое)':'')).join('; ')}. Уточните, действительно ли это частное обозначение.</p>:null}
    {f.decision==='REWRITE'&&!f.block?<label><input type="checkbox" disabled={blocked} checked={accepted.includes(f.path)}
     onChange={e=>{setPending(null);setAccepted(old=>e.target.checked?[...old,f.path]:old.filter(p=>p!==f.path));}}/> Включить в сравнение редакций</label>:null}
   </div>)}
   {review.fields.length>PAGE?<div className="activity-v7-actions"><button disabled={blocked||!reviewPage} onClick={()=>setReviewPage(p=>p-1)}>Назад</button><span>{reviewPage+1} / {Math.ceil(review.fields.length/PAGE)}</span><button disabled={blocked||(reviewPage+1)*PAGE>=review.fields.length} onClick={()=>setReviewPage(p=>p+1)}>Далее</button></div>:null}
   <p>Сохранение известных маркеров не доказывает смысловую эквивалентность и анонимность. После изменения повторите проверку полного продукта.</p>
   <button disabled={blocked||!accepted.length} onClick={()=>void compare()}>Сравнить выбранные формулировки ({accepted.length})</button>
   {current?<ProductRevisionComparison key={signature} review={current.local_review} disabled={blocked}
    onConfirm={()=>{if(!blocked&&current.local_review.base_product_sha256===product.product_sha256){setPending(null);onRevision(current.preview);}}} onCancel={()=>setPending(null)}/>:null}
  </>:null}
 </details>;
}
