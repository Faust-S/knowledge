import {useLayoutEffect,useRef,useState} from 'react';
import {extractD05PracticalLessons,type PracticalLessonReview} from '../../modules/activity-base-anonymizer/d05-practical-lessons.mjs';
export function D05PracticalLessonsPanel({review,groupId,modelNumber,guidance,onApply}:{
 review:unknown;groupId:string;modelNumber:number;guidance:string;onApply:(value:string)=>void;
}){
 const epoch=useRef(0),[result,setResult]=useState<PracticalLessonReview|null>(null),[busy,setBusy]=useState(false);
 const [includeCompatible,setIncludeCompatible]=useState(true);
 const [combined,setCombined]=useState<Record<string,string>>({}),[relatedPage,setRelatedPage]=useState(0);
 const [selected,setSelected]=useState<Record<string,string>>({}),[page,setPage]=useState(0),[error,setError]=useState('');
 useLayoutEffect(()=>{const token=++epoch.current;setResult(null);setSelected({});setCombined({});setPage(0);setRelatedPage(0);setError('');setBusy(true);
  void extractD05PracticalLessons(review,groupId,modelNumber,{includeCompatibleDeclarations:includeCompatible}).then(r=>{if(token===epoch.current){setResult(r);setSelected(Object.fromEntries(r.lessons.filter(l=>l.suggested_guidance&&!l.wording_review_required).map(l=>[l.lesson_id,l.suggested_guidance!])));}})
   .catch(()=>{if(token===epoch.current)setError('Не удалось сопоставить зарегистрированные исправления с выбранной технологией.');})
   .finally(()=>{if(token===epoch.current)setBusy(false);});
  return()=>{epoch.current++;};},[review,groupId,modelNumber,includeCompatible]);
 if(!busy&&!error&&!result)return null;
 const pairKey=(p:{left_id:string;right_id:string})=>p.left_id+':'+p.right_id;
 const occupied=new Set(result?.related_candidates.filter(p=>Object.hasOwn(combined,pairKey(p))).flatMap(p=>[p.left_id,p.right_id])??[]);
 const lines=[...Object.entries(selected).filter(([id])=>!occupied.has(id)).map(([,v])=>v),...Object.values(combined)].map(x=>x.trim()).filter(Boolean);
 const additions=[...new Set(lines)].filter(line=>!guidance.includes(line));
 const next=[guidance.trim(),...additions].filter(Boolean).join('\n');
 return <div className="activity-domain-group">
  <h3>Практические правила из зарегистрированных исправлений</h3>
  <label><input type="checkbox" checked={includeCompatible} onChange={e=>setIncludeCompatible(e.target.checked)}/> Учитывать опыт совместимых исходных маршрутов</label>
  {result?<p>Маршрутов в выборке: {result.source_model_numbers.length}. Отчётов: {result.source_report_count}. {result.excluded_duplicate_order_count||result.excluded_unaligned_count?`Исключены повторные заказы (${result.excluded_duplicate_order_count}) и неоднозначные контрольные связи (${result.excluded_unaligned_count}).`:''}</p>:null}
  {result&&!result.lessons.length?<p>В выбранном опыте нет связанных описаний исправления и контрольного отклонения.</p>:null}
  <p>Выделены связанные отклонения, записанные действия и последующие проверки той же контрольной точки и партии. Повторяющиеся записи одного заказа не увеличивают число заказов. Сведения требуют предметного обобщения и обезличивания.</p>
  {busy?<p role="status">Сопоставляются зарегистрированные исправления…</p>:null}
  {error?<p role="alert">{error}</p>:null}
  {result?.lessons.slice(page*6,(page+1)*6).map(l=><div key={l.lesson_id} className="activity-domain-op">
   <strong>{l.control}</strong><p>{l.problem}</p><p>Записанное действие: {l.action}</p>
   {l.wording_review_required?<details open><summary>Сопоставленные формулировки: {l.variants.length}</summary>
    <p>Проверьте, что разные описания относятся к одному исправлению. Выбор общего правила не производится автоматически.</p>
    {l.variants.map(v=><div key={JSON.stringify([v.problem,v.action])}><p>{v.problem}</p><p>{v.action}</p><span>Заказов: {v.order_count}</span></div>)}</details>:null}
   <span>Заказов с таким описанием: {l.order_count}. С последующей положительной проверкой: {l.rechecked_order_count}. Требуют уточнения: {l.unresolved_order_count}.</span>
   {l.suggested_guidance?<><label><input type="checkbox" disabled={occupied.has(l.lesson_id)} checked={!occupied.has(l.lesson_id)&&Object.hasOwn(selected,l.lesson_id)}
    onChange={e=>setSelected(old=>{const v={...old};if(e.target.checked)v[l.lesson_id]=l.suggested_guidance!;else delete v[l.lesson_id];return v;})}/> Включить правило в черновик</label>
    {!occupied.has(l.lesson_id)&&Object.hasOwn(selected,l.lesson_id)?<textarea rows={3} maxLength={4096} aria-label="Обобщённое практическое правило" value={selected[l.lesson_id]} onChange={e=>setSelected(old=>({...old,[l.lesson_id]:e.target.value}))}/>:null}</>:<p>Недостаточно сведений о результате исправления. Не предлагается готовое правило.</p>}
  </div>)}
  {result&&result.lessons.length>6?<div className="activity-v7-actions"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page+1} / {Math.ceil(result.lessons.length/6)}</span><button disabled={(page+1)*6>=result.lessons.length} onClick={()=>setPage(p=>p+1)}>Далее</button></div>:null}
  {result?.related_candidates.length?<details className="activity-domain-group"><summary>Возможные общие исправления ({result.related_candidates.length})</summary>
   <p>Сравнение близких описаний одной контрольной точки. При неполном результате исправления объединённое правило не предлагается.</p>
   {result.related_candidates.slice(relatedPage*4,(relatedPage+1)*4).map(p=>{const id=pairKey(p),a=result.lessons.find(l=>l.lesson_id===p.left_id)!,b=result.lessons.find(l=>l.lesson_id===p.right_id)!;
    const checked=Object.hasOwn(combined,id),blocked=!a.suggested_guidance||!b.suggested_guidance||!checked&&(occupied.has(p.left_id)||occupied.has(p.right_id));
    return <div key={id} className="activity-domain-op"><p><strong>{a.control}</strong></p><p>{a.problem}: {a.action}</p><p>{b.problem}: {b.action}</p>
     <label><input type="checkbox" disabled={blocked} checked={checked} onChange={e=>setCombined(old=>{const v={...old};if(e.target.checked)v[id]='';else delete v[id];return v;})}/> Сформулировать общее правило вместо двух отдельных</label>
     {checked?<textarea rows={3} maxLength={4096} aria-label="Согласованное исправление" value={combined[id]} onChange={e=>setCombined(v=>({...v,[id]:e.target.value}))}/>:null}</div>;})}
   {result.related_candidates.length>4?<div className="activity-v7-actions"><button disabled={!relatedPage} onClick={()=>setRelatedPage(p=>p-1)}>Назад</button><span>{relatedPage+1} / {Math.ceil(result.related_candidates.length/4)}</span><button disabled={(relatedPage+1)*4>=result.related_candidates.length} onClick={()=>setRelatedPage(p=>p+1)}>Далее</button></div>:null}
  </details>:null}
  {result?.related_comparison_limited?<p>Сравнение близких формулировок ограничено объёмом выборки; отдельные правила сохранены.</p>:null}
  {lines.length>0?<button className="activity-v7-primary" disabled={!additions.length||next.length>4096||Object.values(combined).some(v=>!v.trim())} onClick={()=>onApply(next)}>Добавить выбранные правила к локальным требованиям</button>:null}
  {next.length>4096?<p>Сократите выбранные формулировки до 4096 символов, не меняя их технический смысл.</p>:null}
 </div>;
}
