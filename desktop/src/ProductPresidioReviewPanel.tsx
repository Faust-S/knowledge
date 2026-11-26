import {useLayoutEffect,useMemo,useRef,useState,type ChangeEvent} from 'react';
import {ProductGeneralizationPanel} from './ProductGeneralizationPanel';
import {ProductRevisionComparison} from './ProductRevisionComparison';
import type {SourceReference} from '../../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
import {productTextInventory,reviewProductPresidioTextScreening} from '../../modules/activity-base-anonymizer/presidio-text-review.mjs';
import {editableProductTexts,reviseTechnologyProductText,reviewTechnologyTransferContent} from '../../modules/activity-base-anonymizer/technology-product-revision.mjs';
import type {ProductPreview} from '../../modules/activity-base-anonymizer/technology-product.mjs';
type Review=Awaited<ReturnType<typeof reviewProductPresidioTextScreening>>;
const issueLabels={EXPLICIT_PLACEHOLDER:'Вместо условия оставлено незаполненное обозначение',GENERIC_PROCEDURE:'Общая формулировка не описывает способ выполнения',PARAMETER_WITHOUT_SELECTION_RULE:'Не описано, как выбрать значение',IDENTICAL_DISTINCT_ROLES:'Одинаковый текст в полях разного назначения'};
const fieldLabels:Record<string,string>={purpose:'Назначение',inputs:'Входные данные',outputs:'Результат',applicability:'Границы применения',instructions:'Инструкция',result_requirements:'Критерии результата',context_requirements:'Локальные сведения',terms:'Условия',operations:'Операции',quality_checks:'Контроль',role:'Роль',equipment_requirement:'Оборудование',material_requirement:'Материал',guidance:'Правило выбора',adaptation_guidance:'Адаптация',local_context_guidance:'Локальные условия',route_parameters:'Параметры маршрута',parameters:'Параметры',title:'Название',declared_fields:'Требования',value:'Значение',label:'Наименование',responsible_role:'Ответственный',cadence:'Периодичность'};
const fieldLabel=(path:string)=>path.split('.').slice(2).map(k=>fieldLabels[k]??(/^\d+$/.test(k)?String(Number(k)+1):k)).join(' / ')||'Название';
export function ProductPresidioReviewPanel({product,onRevision,sourceReferences}:{product:ProductPreview;onRevision?:(value:ProductPreview)=>void;sourceReferences?:SourceReference[]}){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [reviews,setReviews]=useState<Partial<Record<'en'|'ru',Review>>>({}),[problem,setProblem]=useState('');
 const [rawReports,setRawReports]=useState<Partial<Record<'en'|'ru',unknown>>>({});
 const [pending,setPending]=useState<{signature:string;value:Awaited<ReturnType<typeof reviseTechnologyProductText>>}|null>(null);
 const [replacement,setReplacement]=useState(''),[reason,setReason]=useState(''),[page,setPage]=useState<Record<'en'|'ru',number>>({en:0,ru:0});
 const [busy,setBusy]=useState(false),[selected,setSelected]=useState<{language:'en'|'ru'|'content';path:string}|null>(null);
 const [contentPage,setContentPage]=useState(0);
 const content=useMemo(()=>reviewTechnologyTransferContent(product.object_data),[product]);
 const editable=useMemo(()=>editableProductTexts(product.object_data).filter(f=>f.edit_kind!=='FIXED'),[product]);
 useLayoutEffect(()=>{generation.current++;setReviews({});setRawReports({});setPending(null);setProblem('');setSelected(null);setReplacement('');setReason('');setPage({en:0,ru:0});setContentPage(0);setBusy(false);return()=>{generation.current++;};},[product]);
 async function load(e:ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];e.target.value='';if(!f)return;
  const token=++generation.current;setBusy(true);setProblem('');
  try{
   if(!f.size||f.size>8*1024*1024)throw Error('limit');
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer()));
   const r=await reviewProductPresidioTextScreening(product,raw);
   if(token!==generation.current)return;
   setPending(null);setRawReports(x=>({...x,[r.language]:raw}));setReviews(x=>({...x,[r.language]:r}));setSelected(null);setReplacement('');setReason('');setPage(x=>({...x,[r.language]:0}));
  }catch{if(token===generation.current)setProblem('Результат должен относиться ко всему текущему продукту, включая название. Проверка прежней редакции не подходит.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 const row=selected?.language==='content'?{path:selected.path,findings:[]}:selected?reviews[selected.language]?.fields.find(f=>f.path===selected.path):null;
 function selectContent(path:string){const field=editable.find(f=>f.path===path);if(!field)return;setPending(null);setSelected({language:'content',path});setReplacement(field.text);setReason('');}
 const value=row?productTextInventory(product.object_data).find(f=>f.path===row.path)?.text??'':'';
 const editKind=row?editableProductTexts(product.object_data).find(f=>f.path===row.path)?.edit_kind:'FIXED';
 const signature=JSON.stringify([product.product_sha256,selected,replacement.trim(),reason.trim()]);
 const current=pending?.signature===signature?pending.value:null;
 function confirmRevision(){
  if(!current||busy||!onRevision||current.local_review.base_product_sha256!==product.product_sha256)return;
  onRevision(current.preview);setPending(null);setReviews({});setRawReports({});setSelected(null);setReplacement('');setReason('');
 }
 async function revise(){
  if(!row||!onRevision)return;
  const token=++generation.current;setBusy(true);setProblem('');setPending(null);
  try{const result=await reviseTechnologyProductText(product,{base_product_sha256:product.product_sha256,edits:[{path:row.path,previous:value,replacement:replacement.trim(),reason:reason.trim()}]});
   if(token===generation.current)setPending({signature,value:result});}
  catch{if(token===generation.current)setProblem('Не удалось исправить поле. Технические числовые условия, структуру и фиксированные параметры менять нельзя.');}
  finally{if(token===generation.current)setBusy(false);}
 }
 function saveForScreening(){
  const url=URL.createObjectURL(new Blob([JSON.stringify(product)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='activity-local-technology-product.json';
  try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }
 return <div className="activity-domain-proposal">
  <h3>Проверка полного продукта</h3>
  <div className="activity-domain-group"><h4>Что должен получить и уточнить получатель</h4>
   {content.recipient.target==='D05_OPERATION_ROUTE_QUALITY'?<p>Операций: {content.recipient.operation_count}. Настраиваемых параметров маршрута: {content.recipient.route_parameter_count}, операций: {content.recipient.operation_parameter_count}. Контрольных точек: {content.recipient.quality_control_count}, блокирующих: {content.recipient.blocking_control_count}. Локальных привязок материала: {content.recipient.material_mapping_count}.</p>:<p>Критериев результата: {content.recipient.result_requirement_count}. Требований к локальным сведениям: {content.recipient.context_requirement_count}. Периодичность: {content.recipient.recipient_interval?'выбирает получатель':'сохранён исходный интервал'}.</p>}
   <p>Редактор выделяет явно незаполненные и слишком общие формулировки. Это не подтверждение пригодности технологии в другой среде.</p>
   {content.issues.length?<><p>Полей для содержательного уточнения: {new Set(content.issues.map(i=>i.path)).size}.</p>
    {content.issues.slice(contentPage*6,(contentPage+1)*6).map(i=><div key={i.path+i.code} className="activity-domain-op"><strong>{fieldLabel(i.path)}</strong><p>{issueLabels[i.code]}</p><p>{editable.find(f=>f.path===i.path)?.text}</p>{i.related_paths.length?<p>Совпадает с: {i.related_paths.map(fieldLabel).join(', ')}</p>:null}{onRevision?<button disabled={busy} onClick={()=>selectContent(i.path)}>Уточнить формулировку</button>:null}</div>)}
    {content.issues.length>6?<div className="activity-v7-actions"><button disabled={busy||!contentPage} onClick={()=>setContentPage(p=>p-1)}>Назад</button><span>{contentPage+1} / {Math.ceil(content.issues.length/6)}</span><button disabled={busy||(contentPage+1)*6>=content.issues.length} onClick={()=>setContentPage(p=>p+1)}>Далее</button></div>:null}</>:<p>Явных текстовых пробелов по доступным правилам не найдено.</p>}
   {onRevision?<label className="activity-domain-label">Редактировать содержательное поле<select value={selected?.language==='content'?selected.path:''} disabled={busy} onChange={e=>{if(e.target.value)selectContent(e.target.value);else setSelected(null);}}><option value="">Выберите поле</option>{editable.map(f=><option key={f.path} value={f.path}>{fieldLabel(f.path)}</option>)}</select></label>:null}
  </div><p>Оригинальный Presidio через Agent проверяет все текстовые поля, включая название и критерии результата. Это проверка признаков идентификации, а не доказательство анонимности.</p>
  <p>Сохраните текущую редакцию для локального инструмента Presidio в Agent. Этот рабочий JSON может содержать частные сведения и не предназначен для передачи получателю.</p>
  <div className="activity-v7-actions"><button disabled={busy} onClick={saveForScreening}>Сохранить текущую редакцию для проверки</button><input ref={input} type="file" className="visually-hidden" accept=".json,application/json" aria-label="Открыть результат проверки продукта" onChange={load}/>
  <button disabled={busy} onClick={()=>input.current?.click()}>Открыть проверку продукта</button></div>
  {problem?<p role="alert" className="activity-v7-note hold">{problem}</p>:null}
  {Object.entries(reviews).map(([lang,r])=>r?<div key={lang} className="activity-domain-group"><strong>{lang==='ru'?'Русский':'Английский'} профиль</strong>
   <p>Проверено {r.scanned_field_count} полей. Обнаружений: {r.finding_count}.</p>
   <div className="activity-domain-ops">{r.fields.slice(page[r.language]*24,(page[r.language]+1)*24).map(f=><button key={f.path} className="activity-domain-op" onClick={()=>{setSelected({language:r.language,path:f.path});setReplacement(productTextInventory(product.object_data).find(x=>x.path===f.path)?.text??'');setReason('');}}>{f.path}<span>{f.findings.length} обнаружений</span></button>)}</div>
   {r.fields.length>24?<div className="activity-v7-actions"><button disabled={page[r.language]===0} onClick={()=>setPage(x=>({...x,[r.language]:x[r.language]-1}))}>Назад</button><span>{page[r.language]+1} / {Math.ceil(r.fields.length/24)}</span><button disabled={(page[r.language]+1)*24>=r.fields.length} onClick={()=>setPage(x=>({...x,[r.language]:x[r.language]+1}))}>Далее</button></div>:null}
  </div>:null)}
  {onRevision?<ProductGeneralizationPanel product={product} reports={rawReports} sourceReferences={sourceReferences} onRevision={onRevision} disabled={busy}/>:null}
  {row?<div className="activity-domain-group"><strong>{row.path}</strong><p>{value}</p>{row.findings.map((f,i)=><p key={i}>{f.entity_type}: {Array.from(value).slice(f.start,f.end).join('')}</p>)}
   {onRevision&&editKind!=='FIXED'?<><label className="activity-domain-label">Обобщённая формулировка<textarea rows={4} value={replacement} maxLength={16000} onChange={e=>setReplacement(e.target.value)}/></label>
    <label className="activity-domain-label">Что изменено и почему<input value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
    {editKind==='CONTROL_TEXT'?<p>Сохраните смысл требования и все технические числовые условия. Нужна новая предметная проверка.</p>:null}
    <button disabled={busy||!replacement.trim()||replacement.trim()===value||!reason.trim()} onClick={()=>void revise()}>Сравнить исправление</button>
    {current?<ProductRevisionComparison key={signature} review={current.local_review} disabled={busy} onConfirm={confirmRevision} onCancel={()=>setPending(null)}/>:null}</>:<p>Это фиксированное предметное поле. Изменение требует возврата к исходной технологии.</p>}
   </div>:null}
 </div>;
}
