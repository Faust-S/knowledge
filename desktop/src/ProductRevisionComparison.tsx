import {useState} from 'react';
import type {ProductRevisionReview,TextChangeReview} from '../../modules/activity-base-anonymizer/technology-product-revision.mjs';
const markers:Record<TextChangeReview['changed_markers'][number]['kind'],string>={NUMBERS:'Числовые фрагменты',UNITS:'Единицы измерения',COMPARISONS:'Знаки сравнения',CONDITIONS:'Условия и последовательность',OBLIGATIONS:'Запреты и обязательность'};
const fields:Record<string,string>={title:'Название',technology:'Технология',terms:'Общие условия',purpose:'Назначение',inputs:'Входы',outputs:'Результат',applicability:'Применимость',instructions:'Инструкция',result_requirements:'Критерии результата',context_requirements:'Локальный контекст',operations:'Операции',quality_checks:'Контроль качества',label:'Наименование',role:'Роль',equipment_requirement:'Оборудование',material_requirement:'Материал',adaptation_guidance:'Адаптация',local_context_guidance:'Локальные требования',responsible_role:'Ответственный',declared_fields:'Требования',parameters:'Параметры',route_parameters:'Параметры маршрута',cadence:'Периодичность',guidance:'Правило адаптации',value:'Значение'};
const label=(path:string)=>path.split('.').slice(1).map(k=>fields[k]??(/^\d+$/.test(k)?String(Number(k)+1):k)).join(' / ');
const show=(items:string[])=>items.length?items.join(' · '):'нет';
export function ProductRevisionComparison({review,disabled=false,onConfirm,onCancel}:{
 review:ProductRevisionReview;disabled?:boolean;onConfirm:()=>void;onCancel:()=>void;
}){
 const [page,setPage]=useState(0),[acknowledged,setAcknowledged]=useState(false);
 const warnings=review.edits.filter(e=>e.text_review.changed_markers.length>0).length;
 return <div className="activity-domain-group">
  <h4>Сравнение редакций технологии</h4>
  <p>Изменяется полей: {review.edits.length}. Полей с изменившимися числовыми, условными или обязательными выражениями: {warnings}.</p>
  {review.edits.slice(page*5,(page+1)*5).map(e=><div key={e.path} className="activity-domain-op">
   <strong>{label(e.path)}</strong>
   <span>Было</span><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{e.previous}</p>
   <span>Стало</span><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{e.replacement}</p>
   {e.text_review.changed_markers.map(m=><p key={m.kind} className="activity-v7-note hold">{markers[m.kind]}: {show(m.before)} → {show(m.after)}</p>)}
  </div>)}
  {review.edits.length>5?<div className="activity-v7-actions"><button disabled={disabled||!page} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page+1} / {Math.ceil(review.edits.length/5)}</span><button disabled={disabled||(page+1)*5>=review.edits.length} onClick={()=>setPage(p=>p+1)}>Далее</button></div>:null}
  <p>Сравнение выявляет изменение выражений, но не устанавливает смысловую эквивалентность. Проверьте, что в новой редакции сохранены полезные условия, исключения и правила выполнения.</p>
  {warnings>0?<label><input type="checkbox" disabled={disabled} checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/> Проверены изменившиеся условия и числовые сведения</label>:null}
  <div className="activity-v7-actions"><button className="activity-v7-primary" disabled={disabled||(warnings>0&&!acknowledged)} onClick={onConfirm}>Применить редакцию</button><button disabled={disabled} onClick={onCancel}>Отменить</button></div>
 </div>;
}
