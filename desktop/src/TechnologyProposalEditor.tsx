import {useMemo,useState} from 'react';
import {reviewD05FunctionalMappings,type D05ContextMapping} from '../../modules/activity-base-anonymizer/d05-adaptation-suggestions.mjs';
import {D05LocalContextPanel,SourceRequirement,LinkedControlRequirements} from './D05FunctionalMappingPanel';
import {TechnologyDisclosurePanel} from './TechnologyDisclosurePanel';
import {D05ExtractionPanel} from './D05ExtractionPanel';
import {D05PracticalLessonsPanel} from './D05PracticalLessonsPanel';
import {prepareD05TechnologyProposal,type D05TechnologyProposalForm,type D05TechnologyProposal,
 type D05DraftProfile,type D05RouteGroup,type D05ParameterDecision} from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';
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
export function TechnologyProposalEditor({review,groupId,profile,operations,form,onChange,decisions,onDecisions,contextMappings,onContextMappings}:{
 review:unknown;groupId:string;profile:D05DraftProfile;operations:D05RouteGroup['operations'];
 form:D05TechnologyProposalForm;onChange:(form:D05TechnologyProposalForm)=>void;
 decisions:Record<string,D05ParameterDecision>;onDecisions:(value:Record<string,D05ParameterDecision>)=>void;
 contextMappings:D05ContextMapping[];onContextMappings:(value:D05ContextMapping[])=>void;
}){
 const [open,setOpen]=useState(false),[opId,setOpId]=useState(operations[0].id);
 const [checkId,setCheckId]=useState(profile.checks[0]?.id??'');
 const [preview,setPreview]=useState<D05TechnologyProposal|null>(null),[error,setError]=useState('');
 const [suggestedTitle,setSuggestedTitle]=useState('');
 const mapping=useMemo(()=>{if(!open)return null;try{return reviewD05FunctionalMappings(review,groupId,profile.model_number);}catch{return null;}},[open,review,groupId,profile.model_number]);
 const update=(value:D05TechnologyProposalForm)=>{setPreview(null);setError('');onChange(value);};
 const prepared=()=>{
  try{setError('');setPreview(prepareD05TechnologyProposal(review,groupId,profile.model_number,form));}
  catch{setPreview(null);setError('Не удалось сформировать предложение. Проверьте выбранный вариант и значения полей.');}
 };
 const op=operations.find(o=>o.id===opId);
 const check=profile.checks.find(c=>c.id===checkId);
 const scopeLabel=(id:string)=>id==='technology'?'Технология':
  operations.find(o=>o.id===id)?.name??profile.checks.find(c=>c.id===id)?.title??'Контрольная точка';
 const portableScopeLabel=(id:string)=>{
  const label=form.operations?.[id]?.label?.trim().replace(/\s+/g,' ');
  return id.startsWith('op_')?'Операция '+id+(label?' ('+label+')':''):'Контрольная точка '+id;
 };
 const proposalOp=preview?.operations.find(o=>o.operation_id===opId);
 const mappedRows=(mapping?.rows??[]).map(r=>({...r,current_requirement:(r.field==='responsible_role'?form.quality_roles?.[r.scope]:form.operations?.[r.scope]?.[r.field])?.trim()||null}));
 const operationMapping=mappedRows.filter(r=>r.scope===opId);
 const qualityMapping=mappedRows.find(r=>r.scope===checkId&&r.field==='responsible_role');
 const missingSuggestions=mappedRows.filter(r=>r.suggested_requirement&&!r.current_requirement);
 function fillFromSource(){
  const next={...form,operations:{...form.operations},quality_roles:{...form.quality_roles}};
  for(const row of missingSuggestions){
   if(!row.suggested_requirement)continue;
   if(row.field==='responsible_role')next.quality_roles[row.scope]=row.suggested_requirement;
   else next.operations[row.scope]={...next.operations[row.scope],[row.field]:row.suggested_requirement};
  }
  update(next);
 }
 return <div className="activity-domain-proposal">
  <div className="activity-v7-actions"><button aria-expanded={open} onClick={()=>setOpen(x=>!x)}>
    {open?'Закрыть уточнение технологии':'Уточнить технологию'}</button></div>
  {open?<div className="activity-domain-group">
   <h3>Предметное уточнение технологии</h3>
   <p>Сформулируйте требования для выбранного исходного варианта {profile.model_number}. Значения других вариантов не используются. Если конкретный ресурс не нужен, укажите это с обоснованием. Исходные условия и контрольные точки не изменяются.</p>
   <D05ExtractionPanel review={review} groupId={groupId} modelNumber={profile.model_number} form={form} decisions={decisions}
    scopeLabel={scopeLabel} onApply={(next,params,title)=>{update(next);onDecisions(params);if(title)setSuggestedTitle(old=>old||title);}}/>
   <D05PracticalLessonsPanel review={review} groupId={groupId} modelNumber={profile.model_number} guidance={form.local_context_guidance??''}
    onApply={value=>update({...form,local_context_guidance:value})}/>
   {mapping?<div className="activity-domain-group">
    <h4>Функциональные требования к среде получателя</h4>
    <p>Сопоставьте исходные обозначения с действительными функциями и связанными контрольными условиями. Исходное описание можно перенести в рабочий черновик, но оно само по себе не подтверждает пригодность ресурса и может содержать частные сведения.</p>
    <button disabled={!missingSuggestions.length} onClick={fillFromSource}>Заполнить пустые поля исходными формулировками ({missingSuggestions.length})</button>
    <D05LocalContextPanel review={mapping} scopeLabel={scopeLabel} portableScopeLabel={portableScopeLabel} guidance={form.local_context_guidance??''} mappings={contextMappings}
     onApply={(guidance,mappings)=>{update({...form,local_context_guidance:guidance});onContextMappings(mappings);}}/>
   </div>:<p role="status">Функциональное сопоставление текущей выборки недоступно.</p>}
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
    <LinkedControlRequirements controls={operationMapping[0]?.linked_controls??[]}/>
    {OP.map(x=><div key={x.field} className="activity-domain-op">
     <label className="activity-domain-label">{x.label}
      <textarea rows={2} maxLength={4096} placeholder={x.hint} value={form.operations?.[opId]?.[x.field]??''}
       onChange={e=>update({...form,operations:{...form.operations,[opId]:{...form.operations?.[opId],[x.field]:e.target.value}}})}/></label>
     <SourceRequirement row={operationMapping.find(r=>r.field===x.field)} onUse={value=>update({...form,operations:{...form.operations,[opId]:{...form.operations?.[opId],[x.field]:value}}})}/>
    </div>)}
   </div>:null}
   {check?<><label className="activity-domain-label">Контрольная точка для уточнения
    <select value={checkId} aria-label="Контрольная точка для уточнения" onChange={e=>setCheckId(e.target.value)}>
     {profile.checks.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
    </select></label>
    <label className="activity-domain-label">Функциональная роль при контроле
     <textarea rows={2} maxLength={4096} value={form.quality_roles?.[checkId]??''} placeholder="Квалификация и ответственность проверяющего"
      onChange={e=>update({...form,quality_roles:{...form.quality_roles,[checkId]:e.target.value}})}/></label>
    <SourceRequirement row={qualityMapping} onUse={value=>update({...form,quality_roles:{...form.quality_roles,[checkId]:value}})}/>
    <LinkedControlRequirements controls={qualityMapping?.linked_controls??[]}/>
   </>:null}
   <div className="activity-v7-actions"><button className="activity-v7-primary" onClick={prepared}>Подготовить локальное предложение</button>
    <button onClick={()=>{update({});onDecisions({});onContextMappings([]);setSuggestedTitle('');}}>Очистить уточнения варианта</button></div>
   {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
   {preview?<div className="activity-domain-group" aria-label="Предложение технологии">
    <h3>Предложение технологии</h3>
    <p role="status">{preview.status==='PROPOSAL_FOR_DOMAIN_REVIEW'?'Предложение подготовлено для предметной проверки':
     preview.status==='PROPOSAL_WITH_SOURCE_GAPS'?'Предложение сформировано с нерешёнными исходными требованиями':'Нужны дополнительные сведения'}</p>
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
   <TechnologyDisclosurePanel review={review} groupId={groupId} profile={profile} operations={operations}
    form={form} decisions={decisions} onChange={onDecisions} contextMappings={contextMappings} suggestedTitle={suggestedTitle}/>
  </div>:null}
 </div>;
}
