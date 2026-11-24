import {createContext,useContext,useLayoutEffect,useRef,useState} from 'react';
import type {ProductPreview} from '../../modules/activity-base-anonymizer/technology-product.mjs';
import type {TechnologyReleasePort,TechnologyReleaseResult} from '../../modules/activity-base-anonymizer/technology-release-host.mjs';
export const TechnologyReleaseContext=createContext<TechnologyReleasePort|null>(null);
const labels:Record<string,string>={
 purpose:'Назначение',inputs:'Входы',outputs:'Результат',applicability:'Границы применения',
 adaptation_guidance:'Правила адаптации',local_context_guidance:'Локальный контекст',
 quantity:'Объём',calendarMode:'Календарь',workingDays:'Рабочие дни',hoursPerDay:'Часов в день',
 overallReserve:'Общий резерв',duration:'Длительность',unit:'Единица',setup:'Подготовка',
 buffer:'Буфер',slack:'Резерв',related_material_id:'Материал получателя',
 related_product_characteristic:'Характеристика',requirement:'Требование',lower_limit:'Нижний допуск',
 target_value:'Целевое значение',upper_limit:'Верхний допуск',allowed_values:'Допустимые значения',
 result_type:'Вид результата',inspection_method:'Метод контроля',inspection_method_custom:'Особый метод',
 sampling_rule:'Правило выборки',required_evidence:'Подтверждение',blocking:'Блокирует выпуск',
 action_on_failure:'При несоответствии',action_custom:'Особое действие',comment:'Локальный комментарий',
};
const display=(v:unknown):string=>v==null?'Не задано':typeof v==='boolean'?(v?'Да':'Нет'):
 Array.isArray(v)?v.join(', '):String(v);
const messages:Record<TechnologyReleaseResult['status'],string>={
 ORIGINAL_TECHNOLOGY_RELEASED:'Файл .iwxa сохранён, повторно прочитан и подтверждён оригинальным Exchange.',
 TECHNOLOGY_RELEASE_CANCELLED:'Выпуск отменён. Файл не выпущен.',
 TECHNOLOGY_RELEASE_NOT_STARTED:'Владелец не подтвердил выпуск или условия изменились. Сохранение файла не начато.',
 TECHNOLOGY_RELEASE_BUSY:'В исходном Host уже выполняется выпуск. Повторная команда не отправлена.',
 TECHNOLOGY_RELEASE_RECONCILIATION_REQUIRED:'Нужна сверка исходного Exchange и файла. Не повторяйте выпуск.',
 TECHNOLOGY_SAVE_OUTCOME_UNKNOWN:'Исход сохранения не установлен. Проверьте файл у владельца, не повторяйте выпуск.',
 TECHNOLOGY_SAVE_READBACK_FAILED:'Сохранённый файл не подтверждён повторным чтением. Требуется сверка у владельца.',
 TECHNOLOGY_SAVED_CONFIRMATION_UNCERTAIN:'Файл сохранён, но подтверждение Exchange не установлено. Требуется сверка, не повторный выпуск.',
};
function ProductContents({product}:{product:ProductPreview}){
 const data=product.object_data;
 return <details className="activity-domain-group"><summary>Полное содержимое технологии</summary>
  <h4>{data.title}</h4>
  {data.target==='PERSONAL_AGENT_TASK_PROMPT'?<>
   {(['purpose','inputs','outputs','applicability'] as const).map(k=><p key={k}><strong>{labels[k]}: </strong>{data.technology[k]}</p>)}
   <h4>Инструкция</h4><div style={{whiteSpace:'pre-wrap'}}>{data.technology.instructions}</div>
   <h4>Критерии результата</h4><ul>{data.technology.result_requirements.map((v,i)=><li key={i}>{v}</li>)}</ul>
   <h4>Контекст получателя</h4><ul>{data.technology.context_requirements.map((v,i)=><li key={i}>{v}</li>)}</ul>
   <p><strong>Периодичность: </strong>{data.technology.cadence.mode==='RETAIN_INTERVAL'?
    display(data.technology.cadence.interval_seconds)+' с':data.technology.cadence.guidance}</p>
  </>:<>
   {Object.entries(data.technology.terms).map(([k,v])=><p key={k}><strong>{labels[k]??k}: </strong>{display(v)}</p>)}
   <h4>Параметры маршрута</h4>
   {data.technology.route_parameters.map(p=><p key={p.field}><strong>{labels[p.field]??p.field}: </strong>
    {p.mode==='PARAMETERIZE'?'Определяет получатель: '+p.guidance:display(p.value)}</p>)}
   <h4>Операции</h4>{data.technology.operations.map(op=><details key={op.operation_id} className="activity-domain-op">
    <summary>{op.label} ({op.operation_id})</summary><p>Тип: {op.kind}. Параллельно: {display(op.parallel)}. Веха: {display(op.milestone)}.</p>
    <p>Предшественники: {op.predecessors.join(', ')||'Нет'}</p><p>Роль: {op.role}</p>
    <p>Оборудование: {op.equipment_requirement}</p><p>Материалы: {op.material_requirement}</p>
    {op.parameters.map(p=><p key={p.field}><strong>{labels[p.field]??p.field}: </strong>
     {p.mode==='PARAMETERIZE'?'Определяет получатель: '+p.guidance:display(p.value)}</p>)}
   </details>)}
   <h4>Контроль качества</h4>{data.technology.quality_checks.map(c=><details key={c.check_id} className="activity-domain-op">
    <summary>{c.title} ({c.check_id})</summary><p>Тип: {c.control_type}. Операция: {c.operation_id??'Весь маршрут'}. Роль: {c.responsible_role}.</p>
    {c.declared_fields.map(f=><p key={f.field}><strong>{labels[f.field]??f.field}: </strong>
     {f.use==='FUNCTIONAL_MAPPING_REQUIRED'?'Определяет получатель':display(f.value)}</p>)}
   </details>)}
  </>}
 </details>;
}
export function TechnologyReleasePanel({product}:{product:ProductPreview}){
 const host=useContext(TechnologyReleaseContext),generation=useRef(0),dispatch=useRef(false);
 const [busy,setBusy]=useState(false),[result,setResult]=useState<TechnologyReleaseResult|null>(null);
 const [unknown,setUnknown]=useState(false);
 useLayoutEffect(()=>{generation.current++;dispatch.current=false;setBusy(false);setResult(null);setUnknown(false);
  return()=>{generation.current++;};},[host,product.product_sha256]);
 const blocked=unknown||!!result&&(result.export_confirmed||result.file_saved!==false||
  result.status==='TECHNOLOGY_RELEASE_RECONCILIATION_REQUIRED');
 async function release(){
  if(!host||dispatch.current||blocked)return;
  const token=++generation.current;dispatch.current=true;setBusy(true);setResult(null);
  try{
   const value=await host.reviewAndRelease({product_sha256:product.product_sha256,object_data:product.object_data});
   if(token!==generation.current)return;
   if(value.product_sha256!==product.product_sha256||!Object.hasOwn(messages,value.status))throw Error('receipt');
   if(value.status==='ORIGINAL_TECHNOLOGY_RELEASED'&&(!value.export_confirmed||value.file_saved!==true||
    !/^[a-f0-9]{64}$/.test(value.package_digest??'')))throw Error('receipt');
   setResult(value);
  }catch{if(token===generation.current)setUnknown(true);}
  finally{if(token===generation.current){dispatch.current=false;setBusy(false);}}
 }
 return <div className="activity-domain-proposal">
  <ProductContents product={product}/>
  <h3>Передача технологии</h3>
  <p>Передаётся только показанное предметное содержимое. Изменение редакции требует нового решения владельца. Принятый черновик и текстовая проверка не дают права раскрытия.</p>
  {host?<><div className="activity-v7-actions"><button className="activity-v7-primary" disabled={busy||blocked}
   onClick={()=>void release()}>Проверить у владельца и выпустить .iwxa</button></div>
   {busy?<p role="status">Исходный владелец проверяет редакцию и разрешение на выпуск…</p>:null}
   {result?<p role="status" className={'activity-v7-note '+(result.export_confirmed?'':'hold')}>{messages[result.status]}</p>:null}
   {unknown?<p role="alert" className="activity-v7-note hold">Ответ владельца не получен. Проверьте исходный Exchange и файл; не повторяйте выпуск.</p>:null}
  </>:<p className="activity-v7-note hold">Для выпуска подключите исходного владельца Exchange. В автономном просмотре файл не создаётся.</p>}
 </div>;
}
