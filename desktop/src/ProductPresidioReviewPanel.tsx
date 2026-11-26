import {useLayoutEffect,useRef,useState,type ChangeEvent} from 'react';
import {ProductGeneralizationPanel} from './ProductGeneralizationPanel';
import {ProductRevisionComparison} from './ProductRevisionComparison';
import type {SourceReference} from '../../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
import {productTextInventory,reviewProductPresidioTextScreening} from '../../modules/activity-base-anonymizer/presidio-text-review.mjs';
import {editableProductTexts,reviseTechnologyProductText} from '../../modules/activity-base-anonymizer/technology-product-revision.mjs';
import type {ProductPreview} from '../../modules/activity-base-anonymizer/technology-product.mjs';
type Review=Awaited<ReturnType<typeof reviewProductPresidioTextScreening>>;
export function ProductPresidioReviewPanel({product,onRevision,sourceReferences}:{product:ProductPreview;onRevision?:(value:ProductPreview)=>void;sourceReferences?:SourceReference[]}){
 const input=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [reviews,setReviews]=useState<Partial<Record<'en'|'ru',Review>>>({}),[problem,setProblem]=useState('');
 const [rawReports,setRawReports]=useState<Partial<Record<'en'|'ru',unknown>>>({});
 const [pending,setPending]=useState<{signature:string;value:Awaited<ReturnType<typeof reviseTechnologyProductText>>}|null>(null);
 const [replacement,setReplacement]=useState(''),[reason,setReason]=useState(''),[page,setPage]=useState<Record<'en'|'ru',number>>({en:0,ru:0});
 const [busy,setBusy]=useState(false),[selected,setSelected]=useState<{language:'en'|'ru';path:string}|null>(null);
 useLayoutEffect(()=>{generation.current++;setReviews({});setRawReports({});setPending(null);setProblem('');setSelected(null);setReplacement('');setReason('');setPage({en:0,ru:0});setBusy(false);return()=>{generation.current++;};},[product]);
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
 const row=selected?reviews[selected.language]?.fields.find(f=>f.path===selected.path):null;
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
  <h3>Проверка полного продукта</h3><p>Оригинальный Presidio через Agent проверяет все текстовые поля, включая название и критерии результата. Это проверка признаков идентификации, а не доказательство анонимности.</p>
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
