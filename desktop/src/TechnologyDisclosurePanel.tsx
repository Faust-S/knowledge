import {useLayoutEffect,useMemo,useState} from 'react';
import {selectD05PracticalExperience} from '../../modules/activity-base-anonymizer/d05-practical-lessons.mjs';
import type {SourceReference} from '../../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
import {suggestD05ParameterDecisions,collectD05FunctionalReferences,type D05ContextMapping} from '../../modules/activity-base-anonymizer/d05-adaptation-suggestions.mjs';
import {PresidioReviewPanel} from './PresidioReviewPanel';
import {ObservationReviewPanel} from './ObservationReviewPanel';
import {TechnologyProductPanel} from './TechnologyProductPanel';
import {prepareD05DisclosureCandidate,type D05DisclosureCandidate,type D05DraftProfile,
 type D05RouteGroup,type D05RouteReview,type D05TechnologyProposalForm,type D05ParameterDecision,type D05DraftValue}
 from '../../modules/activity-base-anonymizer/d05-route-comparison.mjs';
const LABEL:Record<string,string>={quantity:'Объём',calendarMode:'Календарь',workingDays:'Рабочие дни',
 hoursPerDay:'Часов в день',overallReserve:'Общий резерв',duration:'Длительность',unit:'Единица времени',
 setup:'Подготовительное время',buffer:'Буфер',slack:'Резерв операции'};
const display=(v:D05DraftValue)=>v===null?'Не задано':Array.isArray(v)?v.map(x=>['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][x]??x).join(', '):String(v);
export function TechnologyDisclosurePanel({review,groupId,profile,operations,form,decisions,onChange,contextMappings,suggestedTitle=''}:{
 review:unknown;groupId:string;profile:D05DraftProfile;operations:D05RouteGroup['operations'];
 form:D05TechnologyProposalForm;decisions:Record<string,D05ParameterDecision>;
 onChange:(value:Record<string,D05ParameterDecision>)=>void;contextMappings:D05ContextMapping[];suggestedTitle?:string;
}){
 const [open,setOpen]=useState(false),[scope,setScope]=useState('route');
 const [computed,setComputed]=useState<{form:D05TechnologyProposalForm;decisions:Record<string,D05ParameterDecision>;value:D05DisclosureCandidate}|null>(null);
 const [error,setError]=useState('');
 const candidate=computed?.form===form&&computed.decisions===decisions?computed.value:null;
 const [sourceReferences,setSourceReferences]=useState<SourceReference[]>([]);
 const [referencesReady,setReferencesReady]=useState(false);
 useLayoutEffect(()=>{
  let active=true;setReferencesReady(false);
  const selected=(review as D05RouteReview)?.recorded_execution_review?.profiles.find(p=>p.model_number===profile.model_number)?.source_references??[];
  setSourceReferences(selected);
  void selectD05PracticalExperience(review,groupId,profile.model_number,{includeCompatibleDeclarations:true})
   .then(r=>{if(active){setSourceReferences(r.source_references);setReferencesReady(true);}})
   .catch(()=>{if(active)setReferencesReady(true);});
  return()=>{active=false;};
 },[review,groupId,profile.model_number]);
 const allReferences=useMemo(()=>{
  const combined=new Map(sourceReferences.map(ref=>[JSON.stringify(ref),ref]));
  if(candidate)for(const ref of collectD05FunctionalReferences(review,groupId,profile.model_number,form,contextMappings))combined.set(JSON.stringify(ref),ref);
  return [...combined.values()];
 },[sourceReferences,candidate,review,groupId,profile.model_number,form,contextMappings]);
 const fields=profile.conditions.filter(c=>c.use==='ADAPTATION_REVIEW');
 const selectedFields=fields.filter(c=>c.scope===scope);
 const scopeName=(id:string)=>id==='route'?'Маршрут':operations.find(o=>o.id===id)?.name??'Операция';
 const change=(value:Record<string,D05ParameterDecision>)=>{setComputed(null);setError('');onChange(value);};
 function setMode(key:string,mode:string){
   const next={...decisions};
   if(mode==='')delete next[key];
   else if(mode==='RETAIN_DECLARATION'||mode==='PARAMETERIZE')next[key]={mode,
     ...(mode==='PARAMETERIZE'?{guidance:decisions[key]?.guidance??''}:{})};
   change(next);
 }
 function prepare(){
   try{setError('');setComputed({form,decisions,value:prepareD05DisclosureCandidate(review,groupId,profile.model_number,form,decisions)});}
   catch{setComputed(null);setError('Не удалось подготовить кандидат. Проверьте заполнение и решения по параметрам.');}
 }
 return <div className="activity-domain-proposal">
  <div className="activity-v7-actions"><button aria-expanded={open} onClick={()=>setOpen(x=>!x)}>
   {open?'Закрыть подготовку к обезличиванию':'Подготовить к обезличиванию'}</button></div>
  {open?<div className="activity-domain-group">
   <h3>Параметры переносимой технологии</h3>
   <div className="activity-v7-actions"><button onClick={()=>{
    try{const suggested=suggestD05ParameterDecisions(review,groupId,profile.model_number);change({...suggested.decisions,...decisions});}
    catch{setError('Не удалось подготовить настройки для выбранного варианта.');}
   }}>Предложить настройки автоматически</button></div>
   <p>Объём, календарь и общий резерв определяются получателем. Известные условия операций выбранного варианта сохраняются. Уже выбранные решения не перезаписываются. Предложение необходимо предметно проверить.</p>
   <p>Выберите, что оставить как заявленное условие, а что заменить правилом адаптации. Для технически существенной длительности сохраняйте необходимое требование. Исходное значение параметризованного поля в кандидат не попадает.</p>
   <label className="activity-domain-label">Область параметров
    <select value={scope} aria-label="Область параметров для переноса" onChange={e=>setScope(e.target.value)}>
     <option value="route">Параметры маршрута</option>
     {operations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
    </select></label>
   <div className="activity-v7-actions">
    {scope==='route'?<button disabled={!form.adaptation_guidance?.trim()} onClick={()=>{
      const next={...decisions};selectedFields.forEach(c=>next[c.key]={mode:'PARAMETERIZE',guidance:form.adaptation_guidance!});change(next);
     }}>Применить правило адаптации к маршруту</button>:null}
    <button onClick={()=>{
      const next={...decisions};selectedFields.filter(c=>c.value!==null).forEach(c=>next[c.key]={mode:'RETAIN_DECLARATION'});change(next);
     }}>Сохранить известные параметры этой области</button>
   </div>
   <div className="activity-domain-ops">
    {selectedFields.map(c=><div className="activity-domain-op" key={c.key}>
      <strong>{LABEL[c.field]??c.field}</strong>
      <span>Исходное значение: {display(c.value)}</span>
      <label className="activity-domain-label">Решение
       <select aria-label={'Решение: '+(LABEL[c.field]??c.field)} value={decisions[c.key]?.mode??''}
        onChange={e=>setMode(c.key,e.target.value)}>
        <option value="">Не выбрано</option>
        <option value="RETAIN_DECLARATION" disabled={c.value===null}>Сохранить заявленное значение</option>
        <option value="PARAMETERIZE">Заменить правилом адаптации</option>
       </select></label>
      {decisions[c.key]?.mode==='PARAMETERIZE'?<label className="activity-domain-label">Правило адаптации
        <textarea rows={2} maxLength={4096} value={decisions[c.key].guidance??''}
         placeholder="Как получатель определяет этот параметр"
         onChange={e=>change({...decisions,[c.key]:{mode:'PARAMETERIZE',guidance:e.target.value}})}/>
       </label>:null}
    </div>)}
   </div>
   <div className="activity-v7-actions">
    <button className="activity-v7-primary" onClick={prepare}>Сформировать кандидат для проверки раскрытия</button>
    <button onClick={()=>change({})}>Очистить решения по параметрам</button>
   </div>
   {error?<p role="alert" className="activity-v7-note hold">{error}</p>:null}
   {candidate?<div className="activity-domain-group" aria-label="Кандидат для проверки раскрытия">
    <h3>Кандидат для проверки раскрытия</h3>
    <p role="status">{candidate.status==='LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW'?'Локальный кандидат подготовлен для проверки раскрытия':'Кандидат содержит незавершённые требования'}</p>
    <div className="activity-v7-stats">
     <div><strong>{candidate.parameter_summary.retained}</strong><span>Сохранено параметров</span></div>
     <div><strong>{candidate.parameter_summary.parameterized}</strong><span>Заменено правилами</span></div>
     <div><strong>{candidate.parameter_summary.pending}</strong><span>Нужно решить</span></div>
     <div><strong>{candidate.text_review_fields.length}</strong><span>Текстовых полей для проверки</span></div>
    </div>
    {candidate.pending_parameter_decisions.length?<div className="activity-domain-proposal-gaps" tabIndex={0}>
     <ul>{candidate.pending_parameter_decisions.map(p=><li key={p.key}><button onClick={()=>setScope(p.scope)}>
      {scopeName(p.scope)}: {LABEL[p.field]??p.field}</button></li>)}</ul>
    </div>:null}
    <p>Незаполненных полей предложения: {candidate.missing_proposal_fields.length}. Нерешённых исходных требований: {candidate.unresolved_source_requirements.length}. Сохранено контрольных точек: {candidate.technology.quality_checks.length}.</p>
    <PresidioReviewPanel candidate={candidate}/>
    <ObservationReviewPanel candidate={candidate}/>
    {referencesReady?<TechnologyProductPanel candidate={candidate} suggestedTitle={suggestedTitle} sourceReferences={allReferences}/>:<p role="status">Сопоставляются известные частные обозначения исходного опыта…</p>}
    <p className="activity-v7-note hold">Текстовая проверка не заменяет оценку уникальности графа, коммерческих сведений и статистических выпусков. Анонимность и право передачи не установлены.</p>
   </div>:null}
  </div>:null}
 </div>;
}
