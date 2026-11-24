// Suggest the recipient binding choices of ONE coherent D05 source profile.
// Reuse the existing D05 proposal and validation. Common declarations are not
// measured productivity or a new norm. Never mix separate source variants.
import {ActivityHold} from './engine.mjs';
import {prepareD05TechnologyProposal} from './d05-route-comparison.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const routeGuidance={
 quantity:'Определить объём по собственному заказу и утверждённой партии.',
 calendarMode:'Выбрать календарь исполнения по рабочему режиму получателя.',
 workingDays:'Использовать фактические рабочие дни и смены получателя.',
 hoursPerDay:'Определить доступное время по календарю и режиму работы получателя.',
 overallReserve:'Рассчитать общий резерв по сроку заказа, рискам и принятым правилам планирования.'
};
const opGuidance={
 duration:'Определить длительность по утверждённой технологии, характеристикам изделия и ресурса; не сокращать обязательную технологическую выдержку.',
 setup:'Определить подготовительное время по операции, партии, переналадке и используемому ресурсу.',
 buffer:'Определить буфер по условиям исполнения и риску отклонений, не заменяя обязательные технологические выдержки.',
 slack:'Определить допустимый резерв операции по срокам и связанным операциям.',
 unit:'Установить единицу времени согласованно с длительностью и календарём; не менять физический смысл выдержки.'
};
export function suggestD05ParameterDecisions(review,groupId,modelNumber){
 const proposal=prepareD05TechnologyProposal(review,groupId,modelNumber,{});
 const draft=review.technology_draft.groups.find(g=>g.group_id===groupId);
 const common=new Set(draft.shared_condition_keys),different=new Set(draft.differing_condition_keys),unknown=new Set(draft.unresolved_condition_keys);
 const fields=[...proposal.source_route_parameters,...proposal.operations.flatMap(o=>o.source_parameter_conditions)];
 const decisions={},explanations=[];
 for(const c of fields){
  const localRoute=c.scope==='route';
  const reason=c.value===null||unknown.has(c.key)?'SOURCE_INCOMPLETE':
   different.has(c.key)?'VARIANT_DIFFERS':common.has(c.key)?'COMMON_DECLARATION':'SELECTED_DECLARATION';
  const guidance=(localRoute?routeGuidance:opGuidance)[c.field];
  need(typeof guidance==='string','TECHNOLOGY_D05_ADAPTATION_FIELD');
  // Calendar/order always local. Retain the chosen operation's known values
  // by default, even if another route variant differs. The specialist can
  // explicitly parameterize them; no silent averaging or widening.
  const knownUnit=c.field==='unit'&&['hours','work-days','calendar-days'].includes(c.value);
  const knownNumber=c.field!=='unit'&&typeof c.value==='string'&&/^[0-9]{1,9}(?:[.,][0-9]{1,6})?$/.test(c.value);
  const retain=!localRoute&&(knownUnit||knownNumber);
  decisions[c.key]=retain?{mode:'RETAIN_DECLARATION'}:{mode:'PARAMETERIZE',guidance};
  explanations.push({key:c.key,scope:c.scope,field:c.field,reason,proposed_mode:decisions[c.key].mode,
    needs_domain_attention:!retain&&!localRoute||reason==='VARIANT_DIFFERS'||reason==='SOURCE_INCOMPLETE'});
 }
 return {status:'LOCAL_D05_ADAPTATION_SUGGESTIONS',group_id:groupId,model_number:modelNumber,decisions,explanations,
  source_semantics:'DECLARATIONS_NOT_EXECUTION',review_required:true,export_allowed:false,iwxa_package:null};
}
