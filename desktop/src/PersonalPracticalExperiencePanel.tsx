import {useState} from 'react';
import type {PersonalPracticalExperience} from '../../modules/activity-base-anonymizer/personal-technology-extraction.mjs';
const lines=(v:string)=>v.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
export function PersonalPracticalExperiencePanel({experience,requirements,contexts,onApply}:{
 experience:PersonalPracticalExperience;requirements:string;contexts:string;onApply:(requirements:string,contexts:string)=>void;
}){
 const [selected,setSelected]=useState<Record<string,string>>(()=>Object.fromEntries(experience.rules.filter(r=>!r.wording_review_required).map(r=>[r.rule_id,r.suggested_text])));
 const [page,setPage]=useState(0),[relatedPage,setRelatedPage]=useState(0);
 const [combined,setCombined]=useState<Record<string,string>>({});
 const append=(previous:string,kind:string)=>[...new Set([...lines(previous),...experience.rules.filter(r=>r.kind===kind&&Object.hasOwn(selected,r.rule_id))
  .map(r=>selected[r.rule_id].trim()).filter(Boolean),...(kind==='HUMAN_REVIEW_CRITERION'?Object.values(combined).map(v=>v.trim()).filter(Boolean):[])])].join('\n');
 const nextRequirements=append(requirements,'HUMAN_REVIEW_CRITERION'),nextContexts=append(contexts,'REPORTED_CONTEXT_LIMITATION');
 const valid=Object.values(combined).every(v=>v.trim().length>0&&!/[\r\n]/.test(v.trim()))&&lines(nextRequirements).length<=32&&lines(nextContexts).length<=16&&nextRequirements.length<=4096&&nextContexts.length<=4096&&
  [...lines(nextRequirements),...lines(nextContexts)].every(x=>x.length<=1000);
 return <div className="activity-domain-group">
  <h3>Практический опыт без модельного вызова</h3>
  <p>Из {experience.occurrence_count} принятых результатов выделено {experience.rules.length} повторяющихся явных указаний и ограничений. Предположения и результаты отдельных задач не становятся автоматически правилами.</p>
  {experience.rules.slice(page*6,(page+1)*6).map(r=><div className="activity-domain-op" key={r.rule_id}>
   <strong>{r.kind==='HUMAN_REVIEW_CRITERION'?'Критерий из замечаний владельца':'Ограничение исходных сведений'}</strong>
   <span>Повторений: {r.occurrence_count}</span><p>{r.source_text}</p>
   {r.wording_review_required?<details open><summary>Сопоставленные формулировки: {r.variants.length}</summary>
    <p>Сравнение известных вариантов слов, не подтверждённая смысловая эквивалентность. Сверьте условия и выберите общее правило самостоятельно.</p>
    {r.variants.map(v=><p key={v.source_text}>{v.source_text} ({v.occurrence_count} повторений)</p>)}</details>:null}
   <label><input type="checkbox" checked={Object.hasOwn(selected,r.rule_id)} onChange={e=>setSelected(old=>{const next={...old};if(e.target.checked)next[r.rule_id]=r.suggested_text;else delete next[r.rule_id];return next;})}/> Использовать в черновике</label>
   {Object.hasOwn(selected,r.rule_id)?<textarea rows={2} maxLength={1000} aria-label="Обобщённое правило личной технологии" value={selected[r.rule_id]}
    onChange={e=>setSelected(old=>({...old,[r.rule_id]:e.target.value}))}/>:null}
  </div>)}
  {experience.rules.length>6?<div className="activity-v7-actions"><button disabled={!page} onClick={()=>setPage(x=>x-1)}>Назад</button>
   <span>{page+1} / {Math.ceil(experience.rules.length/6)}</span><button disabled={(page+1)*6>=experience.rules.length} onClick={()=>setPage(x=>x+1)}>Далее</button></div>:null}
  {experience.related_candidates.length?<details className="activity-domain-group"><summary>Возможные общие правила из разных формулировок ({experience.related_candidates.length})</summary>
   <p>Совпадают слова действия и часть предметных слов. Это подсказки для содержательного сравнения, не автоматически признанные одинаковые правила.</p>
   {experience.related_candidates.slice(relatedPage*4,(relatedPage+1)*4).map(p=>{const id=p.left_id+':'+p.right_id;
    const occupied=experience.related_candidates.some(q=>q!==p&&Object.hasOwn(combined,q.left_id+':'+q.right_id)&&[q.left_id,q.right_id].some(k=>k===p.left_id||k===p.right_id));
    return <div key={id} className="activity-domain-op"><p>{p.left.source_text}</p><p>{p.right.source_text}</p><span>Разных принятых результатов: {p.distinct_observations}</span>
     <label><input type="checkbox" disabled={occupied} checked={Object.hasOwn(combined,id)} onChange={e=>setCombined(old=>{const v={...old};if(e.target.checked)v[id]='';else delete v[id];return v;})}/> Сформулировать одно общее правило</label>
     {Object.hasOwn(combined,id)?<textarea rows={3} maxLength={1000} aria-label="Согласованное общее правило" value={combined[id]} onChange={e=>setCombined(v=>({...v,[id]:e.target.value}))}/>:null}</div>;})}
   {experience.related_candidates.length>4?<div className="activity-v7-actions"><button disabled={!relatedPage} onClick={()=>setRelatedPage(p=>p-1)}>Назад</button><span>{relatedPage+1} / {Math.ceil(experience.related_candidates.length/4)}</span><button disabled={(relatedPage+1)*4>=experience.related_candidates.length} onClick={()=>setRelatedPage(p=>p+1)}>Далее</button></div>:null}
  </details>:null}
  {experience.related_comparison_limited?<p>Сравнение близких формулировок ограничено объёмом выборки. Дословно повторяющиеся правила сохранены.</p>:null}
  {experience.rules.length||Object.keys(combined).length?<button className="activity-v7-primary" disabled={!valid||(nextRequirements===requirements&&nextContexts===contexts)}
    onClick={()=>onApply(nextRequirements,nextContexts)}>Добавить выбранные критерии и локальные условия</button>:null}
  {!valid?<p>Уточните объём критериев или контекста, чтобы сохранить допустимый состав продукта.</p>:null}
  <p>Правила остаются локальным предложением. Уточните смысл, применимость и частные ссылки перед выпуском технологии.</p>
 </div>;
}
