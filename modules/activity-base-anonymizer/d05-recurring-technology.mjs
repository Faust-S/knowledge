// Recognize repeated *declarations* in the accumulated original D05 Results.
// Compatibility here is exact agreement in the retained technical conditions,
// not evidence of successful execution or permission to combine unlike routes.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {prepareD05TechnologyProposal} from './d05-route-comparison.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const canonical=v=>Array.isArray(v)?v.map(canonical):v!==null&&typeof v==='object'?
 Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const key=v=>JSON.stringify(canonical(v));
const ordered=(v,k)=>[...v].sort((a,b)=>cmp(k(a),k(b)));
const routeKeys=new Set(['quantity','calendarMode','workingDays','hoursPerDay','overallReserve']);
function technical(profile){
 // Every retained operation declaration is part of the family identity.
 // No averaging durations, normalizing units, guessing resources or widening
 // acceptance tolerances. Only recipient-owned route planning is variable.
 const conditions=ordered(profile.conditions.filter(c=>c.scope!=='route'),c=>c.key);
 const checks=ordered(profile.checks.map(c=>({operation_id:c.operation_id,title:c.title,control_type:c.control_type,
  fields:ordered(c.fields,f=>f.field)})),key);
 return {source_kind:profile.source_kind,conditions,checks};
}
function routeVariations(members){
 const values=[];
 for(const field of routeKeys){
  const observed=new Map();
  for(const m of members){
   const value=m.conditions.find(c=>c.scope==='route'&&c.field===field)?.value??null;
   const id=key(value),row=observed.get(id)??{value,count:0};
   row.count++;observed.set(id,row);
  }
  values.push({field,observations:ordered([...observed.values()],v=>key(v.value)),distinct_count:observed.size});
 }
 return values;
}
export async function reviewD05RecurringTechnologies(review,groupId){
 need(review?.technology_draft?.status==='LOCAL_TECHNOLOGY_DRAFT'&&review.export_allowed===false&&
  review.anonymity==='NOT_ESTABLISHED','TECHNOLOGY_D05_RECURRING_SOURCE');
 const group=review.groups.find(g=>g.id===groupId),draft=review.technology_draft.groups.find(g=>g.group_id===groupId);
 need(group&&draft&&group.basis!=='AMBIGUOUS_OPERATION_OCCURRENCES'&&Array.isArray(draft.profiles)&&
  draft.profiles.length===group.model_numbers.length&&new Set(draft.profiles.map(p=>p.model_number)).size===draft.profiles.length&&
  group.model_numbers.every(n=>draft.profiles.some(p=>p.model_number===n)),'TECHNOLOGY_D05_RECURRING_SOURCE');
 const bySignature=new Map(),excluded=[];
 for(const profile of draft.profiles){
  // Reuse the existing proposal validator and the exact source mapping.
  const proposal=prepareD05TechnologyProposal(review,groupId,profile.model_number,{});
  if(profile.quality_status!=='DECLARED_CHECKS_READ'||!profile.checks.length||
   proposal.unresolved_source_requirements.includes('OPERATION_OCCURRENCE_MAPPING')){
   excluded.push({model_number:profile.model_number,reason:'INCOMPLETE_SOURCE_CONTROL_MAPPING'});continue;
  }
  const signature=technical(profile),s=key(signature),row=bySignature.get(s)??{signature,members:[]};
  row.members.push(profile);bySignature.set(s,row);
 }
 const families=[];
 for(const row of bySignature.values()){
  const members=[...row.members].sort((a,b)=>a.model_number-b.model_number);
  const technical_sha256=await sha256Canonical({operations:group.operations,technical:row.signature});
  const family_id='family_'+technical_sha256;
  const conditions=row.signature.conditions;
  const gaps=conditions.filter(c=>c.value===null).map(c=>c.key);
  const family={
   family_id,technical_sha256,source_sha256:await sha256Canonical({group_id:groupId,operations:group.operations,members}),
   member_count:members.length,model_numbers:members.map(m=>m.model_number),representative_model_number:members[0].model_number,
   operation_count:group.operations.length,control_count:row.signature.checks.length,
   technical_condition_count:conditions.length,unknown_technical_conditions:gaps,
   route_planning_declarations:routeVariations(members),
   recurrence:members.length>1?'REPEATED_MATCHING_DECLARATIONS':'SINGLE_DECLARATION',
   qualification:'SOURCE_DECLARATIONS_ONLY',
  };
  families.push(family);
 }
 families.sort((a,b)=>b.member_count-a.member_count||a.representative_model_number-b.representative_model_number);
 return {status:'LOCAL_D05_RECURRING_TECHNOLOGY_REVIEW',group_id:groupId,model_count:group.model_count,
  family_count:families.length,repeated_family_count:families.filter(f=>f.member_count>1).length,
  families,excluded_models:excluded.sort((a,b)=>a.model_number-b.model_number),
  execution_evidence:'NOT_ESTABLISHED',technology_equivalence:'NOT_ESTABLISHED',
  source_authority:'UNVERIFIED_LOCAL_PROJECTION',export_allowed:false,iwxa_package:null};
}
