import {useLayoutEffect,useRef,useState} from 'react';
import {extractD05PracticalLessons,type PracticalLessonReview} from '../../modules/activity-base-anonymizer/d05-practical-lessons.mjs';
export function D05PracticalLessonsPanel({review,groupId,modelNumber,guidance,onApply}:{
 review:unknown;groupId:string;modelNumber:number;guidance:string;onApply:(value:string)=>void;
}){
 const epoch=useRef(0),[result,setResult]=useState<PracticalLessonReview|null>(null),[busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<Record<string,string>>({}),[page,setPage]=useState(0),[error,setError]=useState('');
 useLayoutEffect(()=>{const token=++epoch.current;setResult(null);setSelected({});setPage(0);setError('');setBusy(true);
  void extractD05PracticalLessons(review,groupId,modelNumber).then(r=>{if(token===epoch.current){setResult(r);setSelected(Object.fromEntries(r.lessons.filter(l=>l.suggested_guidance).map(l=>[l.lesson_id,l.suggested_guidance!])));}})
   .catch(()=>{if(token===epoch.current)setError('Не удалось сопоставить зарегистрированные исправления с выбранной технологией.');})
   .finally(()=>{if(token===epoch.current)setBusy(false);});
  return()=>{epoch.current++;};},[review,groupId,modelNumber]);
 if(!result?.lessons.length&&!busy&&!error)return null;
 const lines=Object.values(selected).map(x=>x.trim()).filter(Boolean);
 const additions=[...new Set(lines)].filter(line=>!guidance.includes(line));
 const next=[guidance.trim(),...additions].filter(Boolean).join('\n');
 return <div className="activity-domain-group">
  <h3>Практические правила из зарегистрированных исправлений</h3>
  <p>Выделены связанные отклонения, записанные действия и последующие проверки той же контрольной точки и партии. Повторяющиеся записи одного заказа не увеличивают число заказов. Сведения требуют предметного обобщения и обезличивания.</p>
  {busy?<p role="status">Сопоставляются зарегистрированные исправления…</p>:null}
  {error?<p role="alert">{error}</p>:null}
  {result?.lessons.slice(page*6,(page+1)*6).map(l=><div key={l.lesson_id} className="activity-domain-op">
   <strong>{l.control}</strong><p>{l.problem}</p><p>Записанное действие: {l.action}</p>
   <span>Заказов с таким описанием: {l.order_count}. С последующей положительной проверкой: {l.rechecked_order_count}. Требуют уточнения: {l.unresolved_order_count}.</span>
   {l.suggested_guidance?<><label><input type="checkbox" checked={Object.hasOwn(selected,l.lesson_id)}
    onChange={e=>setSelected(old=>{const v={...old};if(e.target.checked)v[l.lesson_id]=l.suggested_guidance!;else delete v[l.lesson_id];return v;})}/> Включить правило в черновик</label>
    {Object.hasOwn(selected,l.lesson_id)?<textarea rows={3} maxLength={4096} aria-label="Обобщённое практическое правило" value={selected[l.lesson_id]} onChange={e=>setSelected(old=>({...old,[l.lesson_id]:e.target.value}))}/>:null}</>:<p>Недостаточно сведений о результате исправления. Не предлагается готовое правило.</p>}
  </div>)}
  {result&&result.lessons.length>6?<div className="activity-v7-actions"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page+1} / {Math.ceil(result.lessons.length/6)}</span><button disabled={(page+1)*6>=result.lessons.length} onClick={()=>setPage(p=>p+1)}>Далее</button></div>:null}
  {lines.length>0?<button className="activity-v7-primary" disabled={!additions.length||next.length>4096} onClick={()=>onApply(next)}>Добавить выбранные правила к локальным требованиям</button>:null}
  {next.length>4096?<p>Сократите выбранные формулировки до 4096 символов, не меняя их технический смысл.</p>:null}
 </div>;
}
