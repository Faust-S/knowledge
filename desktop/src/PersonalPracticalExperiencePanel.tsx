import {useState} from 'react';
import type {PersonalPracticalExperience} from '../../modules/activity-base-anonymizer/personal-technology-extraction.mjs';
const lines=(v:string)=>v.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
export function PersonalPracticalExperiencePanel({experience,requirements,contexts,onApply}:{
 experience:PersonalPracticalExperience;requirements:string;contexts:string;onApply:(requirements:string,contexts:string)=>void;
}){
 const [selected,setSelected]=useState<Record<string,string>>(()=>Object.fromEntries(experience.rules.filter(r=>!r.wording_review_required).map(r=>[r.rule_id,r.suggested_text])));
 const [page,setPage]=useState(0);
 const append=(previous:string,kind:string)=>[...new Set([...lines(previous),...experience.rules.filter(r=>r.kind===kind&&Object.hasOwn(selected,r.rule_id))
  .map(r=>selected[r.rule_id].trim()).filter(Boolean)])].join('\n');
 const nextRequirements=append(requirements,'HUMAN_REVIEW_CRITERION'),nextContexts=append(contexts,'REPORTED_CONTEXT_LIMITATION');
 const valid=lines(nextRequirements).length<=32&&lines(nextContexts).length<=16&&nextRequirements.length<=4096&&nextContexts.length<=4096&&
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
  {experience.rules.length?<button className="activity-v7-primary" disabled={!valid||(nextRequirements===requirements&&nextContexts===contexts)}
    onClick={()=>onApply(nextRequirements,nextContexts)}>Добавить выбранные критерии и локальные условия</button>:null}
  {!valid?<p>Уточните объём критериев или контекста, чтобы сохранить допустимый состав продукта.</p>:null}
  <p>Правила остаются локальным предложением. Уточните смысл, применимость и частные ссылки перед выпуском технологии.</p>
 </div>;
}
