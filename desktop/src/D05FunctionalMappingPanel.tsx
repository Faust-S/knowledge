import {useState} from 'react';
import type {D05ContextMapping,D05FunctionalMappingReview,D05FunctionalMappingRow} from '../../modules/activity-base-anonymizer/d05-adaptation-suggestions.mjs';
const labels:Record<string,string>={orderName:'Название заказа',startDate:'Дата запуска',dueDate:'Срок заказа',materialReady:'Наличие материала',materialReadyDate:'Дата готовности материала',comment:'Примечание',product:'Изделие',productVersion:'Редакция изделия',requirementBasis:'Основание требований',sourceDocuments:'Исходные документы',related_material_id:'Исходная ссылка на материал',requirement:'Требование',unit:'Единица',lower_limit:'Нижний допуск',target_value:'Целевое значение',upper_limit:'Верхний допуск',allowed_values:'Допустимые значения',inspection_method:'Метод контроля',sampling_rule:'Выборка',required_evidence:'Подтверждение',blocking:'Блокирует выпуск',action_on_failure:'Действие при отклонении'};
const contextLabels:Record<string,string>={ORDER_CONTEXT:'Заказ получателя',LOCAL_DATES:'Календарь получателя',MATERIAL_AVAILABILITY:'Доступность материалов',QUALITY_SOURCE_CONTEXT:'Технические документы получателя',OPERATION_NOTES:'Исходные примечания к операциям',CONTROL_MATERIAL_MAPPING:'Привязка контрольного материала',CONTROL_NOTE_REVIEW:'Примечание к контролю',SOURCE_NOTE_INSTRUCTION:'Явное указание в исходном примечании'};
const valueLabel=(v:unknown)=>v===null?'Недоступно':typeof v==='boolean'?v?'Да':'Нет':Array.isArray(v)?v.join(', '):String(v);
export function SourceRequirement({row,onUse}:{row?:D05FunctionalMappingRow;onUse:(value:string)=>void}){
 if(!row)return null;
 return <div>
  <span>Исходное обозначение: {row.source_text??'Не задано'}</span><p>{row.hint}</p>
  {row.proposal_basis==='ROLE_NEEDS_CLARIFICATION'?<p>Исходная роль неоднозначна или не установлена. Укажите компетенции самостоятельно.</p>:null}
  {row.suggested_requirement&&row.suggested_requirement!==row.current_requirement?<><p>{row.proposal_basis==='DECLARED_FUNCTIONAL_ROLE'?'Заявленная функциональная роль: ':'Исходная формулировка: '}{row.suggested_requirement}</p>
   <button disabled={!!row.current_requirement} onClick={()=>onUse(row.suggested_requirement!)}>Использовать в пустом поле</button></>:null}
 </div>;
}
export function LinkedControlRequirements({controls}:{controls:D05FunctionalMappingRow['linked_controls']}){
 if(!controls.length)return null;
 return <details><summary>Связанные требования контроля ({controls.length})</summary>
  <p>Учитывайте эти исходные условия при выборе ресурсов. Контрольные требования не изменяются в этом редакторе.</p>
  {controls.map(c=><div className="activity-domain-op" key={c.check_id}><strong>{c.title}</strong>
   {c.requirements.map(r=><p key={r.field}>{labels[r.field]??r.field}: {valueLabel(r.value)}</p>)}</div>)}
 </details>;
}
export function D05LocalContextPanel({review,scopeLabel,portableScopeLabel,guidance,mappings,onApply}:{
 review:D05FunctionalMappingReview;scopeLabel:(scope:string)=>string;portableScopeLabel:(scope:string)=>string;guidance:string;mappings:D05ContextMapping[];
 onApply:(guidance:string,mappings:D05ContextMapping[])=>void;
}){
 const [page,setPage]=useState(0),[contextPage,setContextPage]=useState(0),[selected,setSelected]=useState(''),[requirement,setRequirement]=useState('');
 const key=(e:{scope:string;field:string})=>e.scope+':'+e.field;
 const current=review.local_context_entries.find(e=>key(e)===selected);
 const lines=guidance.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
 const append=(v:string)=>lines.includes(v)?guidance:[guidance.trim(),v].filter(Boolean).join('\n');
 const scoped=(scope:string,value:string)=>scope==='technology'?value:portableScopeLabel(scope)+': '+value;
 const prior=mappings.find(m=>key(m)===selected);
 const priorLine=prior?.guidance_line??prior?.requirement;
 const nextGuidance=(v:string)=>{
  if(priorLine&&priorLine!==v&&!mappings.some(m=>key(m)!==selected&&(m.guidance_line??m.requirement)===priorLine)){
   const original=guidance.split(/\r?\n/);const index=original.findIndex(line=>line.trim()===priorLine);
   if(index>=0){if(lines.includes(v))original.splice(index,1);else original[index]=v;return original.join('\n');}
  }
  return append(v);
 };
 const scopedValue=current?scoped(current.scope,requirement.trim()):requirement.trim();
 const valid=!!requirement.trim()&&!/[\r\n]/.test(requirement.trim())&&nextGuidance(scopedValue).length<=4096;
 const suggestions=review.context_requirements.filter(r=>r.suggested_requirement&&!lines.includes(scoped(r.scope,r.suggested_requirement)));
 const all=[...new Set(suggestions.filter(r=>r.code!=='SOURCE_NOTE_INSTRUCTION').map(r=>scoped(r.scope,r.suggested_requirement!)))];
 const suggestedText=[guidance.trim(),...all].filter(Boolean).join('\n');
 function adopt(){
  if(!current||!valid)return;
  const text=requirement.trim(),item={scope:current.scope,field:current.field,requirement:text,guidance_line:scopedValue};
  // Only retain the exact association to this reviewed local source entry.
  // No copy of the source value is put into the technological product.
  const next=[...mappings.filter(m=>key(m)!==key(item)),item];
  if(next.length>512)return;
  onApply(nextGuidance(scopedValue),next);setRequirement('');setSelected('');
 }
 return <details className="activity-domain-group">
  <summary>Обобщить локальные условия и документы</summary>
  <p>Правила получателя выводятся из известных видов исходных условий. Неизвестное содержание примечания или документа не восстанавливается автоматически.</p>
  {review.context_requirements.slice(contextPage*6,(contextPage+1)*6).map((r,i)=><div key={r.scope+':'+r.code+':'+i} className="activity-domain-op">
   <strong>{contextLabels[r.code]??r.code} · {scopeLabel(r.scope)}</strong>
   {r.suggested_requirement?<><p>{r.suggested_requirement}</p>{r.code==='SOURCE_NOTE_INSTRUCTION'?<p>Сначала проверьте применимость и частные обозначения. Это исходное указание, не новый норматив.</p>:null}<button disabled={lines.includes(scoped(r.scope,r.suggested_requirement))||append(scoped(r.scope,r.suggested_requirement)).length>4096} onClick={()=>onApply(append(scoped(r.scope,r.suggested_requirement!)),mappings)}>Добавить к условиям получателя</button></>:<p>Требуется содержательное уточнение исходной записи.</p>}
  </div>)}
  {review.context_requirements.length>6?<div className="activity-v7-actions"><button disabled={!contextPage} onClick={()=>setContextPage(p=>p-1)}>Назад</button><span>{contextPage+1} / {Math.ceil(review.context_requirements.length/6)}</span><button disabled={(contextPage+1)*6>=review.context_requirements.length} onClick={()=>setContextPage(p=>p+1)}>Далее</button></div>:null}
  {all.length>1?<button disabled={suggestedText.length>4096} onClick={()=>onApply(suggestedText,mappings)}>Добавить предложенные правила ({all.length})</button>:null}
  <h4>Исходные локальные сведения</h4>
  {!review.local_context_entries.length?<p>Подробные сведения не включены в выборку либо отсутствуют. Для просмотра включите исходные примечания и документы перед чтением маршрутов.</p>:null}
  {review.local_context_entries.slice(page*6,(page+1)*6).map(e=><div className="activity-domain-op" key={key(e)}>
   <strong>{scopeLabel(e.scope)} · {labels[e.field]??e.field}</strong><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{valueLabel(e.value)}</p>
   {e.status==='DECLARED_LOCAL_VALUE'?<button onClick={()=>{setSelected(key(e));setRequirement(mappings.find(m=>key(m)===key(e))?.requirement??'');}}>Сформулировать переносимое условие</button>:null}
   {mappings.some(m=>key(m)===key(e)&&lines.includes(m.guidance_line??m.requirement))?<p>Связанное условие: {mappings.find(m=>key(m)===key(e))?.requirement}</p>:null}
  </div>)}
  {review.local_context_entries.length>6?<div className="activity-v7-actions"><button disabled={!page} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page+1} / {Math.ceil(review.local_context_entries.length/6)}</span><button disabled={(page+1)*6>=review.local_context_entries.length} onClick={()=>setPage(p=>p+1)}>Далее</button></div>:null}
  {current?<div className="activity-domain-op">
   <strong>{scopeLabel(current.scope)} · {labels[current.field]??current.field}</strong><p style={{whiteSpace:'pre-wrap'}}>{valueLabel(current.value)}</p>
   <label className="activity-domain-label">Что должен сделать или обеспечить получатель
    <textarea rows={3} maxLength={4096} value={requirement} onChange={e=>setRequirement(e.target.value)} placeholder="Сохраните функциональный смысл, обязательные условия и исключения без частных обозначений."/></label>
   <p>Условие добавляется одной строкой с областью применения. Короткое исходное обозначение будет доступно для проверки совпадений в конечном продукте.</p>
   {requirement.trim()?<p>В переносимой технологии: {scopedValue}</p>:null}
   <button disabled={!valid||mappings.length>=512&&!mappings.some(m=>key(m)===selected)} onClick={adopt}>Добавить обобщённое условие</button>
   <button onClick={()=>{setSelected('');setRequirement('');}}>Отмена</button>
  </div>:null}
 </details>;
}
