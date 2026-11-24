import {useState} from 'react';
import {prepareD05TechnologyProposal,type D05TechnologyProposalForm,type D05TechnologyProposal,
 type D05DraftProfile,type D05RouteGroup} from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';
type TextField='purpose'|'inputs'|'outputs'|'applicability'|'adaptation_guidance'|'local_context_guidance';
type OpField='label'|'role'|'equipment'|'material';
const TEXT:Array<{field:TextField;label:string;hint:string}>=[
 {field:'purpose',label:'Назначение технологии',hint:'Для какого результата применяется технология'},
 {field:'inputs',label:'Входы и требования',hint:'Материалы, исходные документы, данные и условия'},
 {field:'outputs',label:'Выходы и результат',hint:'Что должен получить заказчик или следующий процесс'},
 {field:'applicability',label:'Границы применения',hint:'Для каких изделий, условий и ограничений подходит'},
 {field:'adaptation_guidance',label:'Правила адаптации',hint:'Как получатель должен пересчитать объём, время, календарь и резервы'},
 {field:'local_context_guidance',label:'Уточнение исключённого контекста',hint:'Какие требования нужно сохранить вместо частных дат, документов и примечаний'},
];
const OP:Array<{field:OpField;label:string;hint:string}>=[
 {field:'label',label:'Обобщённое название операции',hint:'Предметный смысл без частных наименований'},
 {field:'role',label:'Роль и квалификация',hint:'Требуемые компетенции, а не имя исполнителя'},
 {field:'equipment',label:'Требования к оборудованию',hint:'Функция, характеристики, ограничения или обоснованное отсутствие требования'},
 {field:'material',label:'Требования к материалам',hint:'Свойства и совместимость или обоснованное отсутствие требования'},
];
const FIELD_LABELS=Object.fromEntries([...TEXT,...OP].map(x=>[x.field,x.label]));
export function TechnologyProposalEditor({review,groupId,profile,operations,form,onChange}:{
 review:unknown;groupId:string;profile:D05DraftProfile;operations:D05RouteGroup['operations'];
 form:D05TechnologyProposalForm;onChange:(form:D05TechnologyProposalForm)=>void;
}){
 const [open,setOpen]=useState(false),[opId,setOpId]=useState(operations[0].id);
 const [checkId,setCheckId]=useState(profile.checks[0]?.id??'');
 const [preview,setPreview]=useState<D05TechnologyProposal|null>(null),[error,setError]=useState('');
 const update=(value:D05TechnologyProposalForm)=>{setPreview(null);setError('');onChange(value);};
 const prepared=()=>{
  try{setError('');setPreview(prepareD05TechnologyProposal(review,groupId,profile.model_number,form));}
  catch{setPreview(null);setError('Не удалось сформировать предложение. Проверьте выбранный вариант и значения полей.');}
 };
 const op=operations.find(o=>o.id===opId);
 const check=profile.checks.find(c=>c.id===checkId);
 const scopeLabel=(id:string)=>id==='technology'?'Технология':
  operations.find(o=>o.id===id)?.name??profile.checks.find(c=>c.id===id)?.title??'Контрольная точка';
 const proposalOp=preview?.operations.find(o=>o.operation_id===opId);
 return <div className="activity-domain-proposal">
  <div className="activity-v7-actions"><button aria-expanded={open} onClick={()=>setOpen(x=>!x)}>
    {open?'Закрыть уточнение технологии':'Уточнить технологию'}</button></div>
  {open?<div className="activity-domain-group">
   <h3>Предметное уточнение технологии</h3>
   <p>Сформулируйте требования для выбранного исходного варианта {profile.model_number}. Значения других вариантов не используются. Если конкретный ресурс не нужен, укажите это с обоснованием. Исходные условия и контрольные точки не изменяются.</p>
   <div className="activity-domain-proposal-fields">
    {TEXT.map(x=><label key={x.field} className="activity-domain-label">{x.label}
     <textarea rows={2} maxLength={4096} value={form[x.field]??''} placeholder={x.hint}
      onChange={e=>update({...form,[x.field]:e.target.value})}/></label>)}
   </div>
   <label className="activity-domain-label">Операция для уточнения
    <select value={opId} aria-label="Операция для уточнения" onChange={e=>setOpId(e.target.value)}>
     {operations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
    </select></label>
   {op?<div className="activity-domain-proposal-fields">
    {OP.map(x=><label key={x.field} className="activity-domain-label">{x.label}
     <textarea rows={2} maxLength={4096} placeholder={x.hint} value={form.operations?.[opId]?.[x.field]??''}
      onChange={e=>update({...form,operations:{...form.operations,[opId]:{...form.operations?.[opId],[x.field]:e.target.value}}})}/></label>)}
   </div>:null}
   {check?<><label className="activity-domain-label">Контрольная точка для уточнения
    <select value={checkId} aria-label="Контрольная точка для уточнения" onChange={e=>setCheckId(e.target.value)}>
     {profile.checks.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
    </select></label>
    <label className="activity-domain-label">Функциональная роль при контроле
     <textarea rows={2} maxLength={4096} value={form.quality_roles?.[checkId]??''} placeholder="Квалификация и ответственность проверяющего"
      onChange={e=>update({...form,quality_roles:{...form.quality_roles,[checkId]:e.target.value}})}/></label>
   </>:null}
   <div className="activity-v7-actions"><button className="activity-v7-primary" onClick={prepared}>Подготовить локальное предложение</button>
    <button onClick={()=>update({})}>Очистить уточнения варианта</button></div>
   {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
   {preview?<div className="activity-domain-group" aria-label="Предложение технологии">
    <h3>Предложение технологии</h3>
    <p role="status">{preview.status==='PROPOSAL_FOR_DOMAIN_REVIEW'?'Предложение подготовлено для предметной проверки':'Нужны дополнительные сведения'}</p>
    <p>Незаполненных полей: {preview.missing_fields.length}. Нерешённых исходных требований: {preview.unresolved_source_requirements.length}.</p>
    {preview.missing_fields.length?<div className="activity-domain-proposal-gaps" tabIndex={0}>
     <ul>{preview.missing_fields.map(x=><li key={x.scope+'.'+x.field}>{scopeLabel(x.scope)}: {FIELD_LABELS[x.field]??'Ответственная роль'}</li>)}</ul>
    </div>:null}
    {proposalOp?<div className="activity-domain-op">
     <strong>{proposalOp.proposed.label??proposalOp.source_name}</strong>
     {OP.filter(x=>x.field!=='label').map(x=><span key={x.field}>{x.label}: {proposalOp.proposed[x.field]??'Не задано'}</span>)}
    </div>:null}
    <p>Контрольных точек исходного варианта сохранено: {preview.quality_checks.length}. Допуски и блокировка выпуска не изменены.</p>
    <p className="activity-v7-note">Предложение существует в текущей выборке. Не является утверждённой, сохранённой или разрешённой к передаче технологией.</p>
   </div>:null}
  </div>:null}
 </div>;
}
