import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
export function personalRows(){
 return [1,2,3].map(i=>({occurrence_ref:'OCC-private-'+i,task_ref:'TASK-private-'+i,task_digest:String(i).repeat(64),
  accepted_digest:String(i+3).repeat(64),objective:'Review PRIVATE_SOURCE weekly notes',interval_seconds:604800,
  context_flags:{memory:true,knowledge:false,web:false}}));
}
export function personalProposal(){
 return {title:'Weekly household review',purpose:'Review household commitments and prepare next steps',
  inputs:'Recipient commitments and calendar notes',outputs:'Prioritized list for the next seven days',
  applicability:'A person or work team with their own accessible notes',instructions:'Read the supplied commitments. Separate deadlines from preferences. List overdue items, then propose a manageable next-week plan.',
  result_requirements:['Every proposed item has a reason','Identify absent information','Do not report an action as completed'],
  cadence:{mode:'RECIPIENT_INTERVAL',interval_seconds:null,guidance:'Choose a sustainable review cadence'},
  context_requirements:['Recipient calendar or supplied list of commitments']};
}
export function d05Candidate(){
 const r=reviewD05ResultSelection(buildD05RouteQualityComparisonExample(),{includeTechnologyDraft:true});
 const g=r.groups[0],p=r.technology_draft.groups[0].profiles[0];
 const form={purpose:'Manufacture sheet parts',inputs:'Sheet material and drawing',outputs:'Part meeting dimensions',
  applicability:'Specified material and thickness range',adaptation_guidance:'Calculate the recipient lot and scheduling values',
  local_context_guidance:'Check the current drawing and recipient resources',
  operations:Object.fromEntries(g.operations.map(o=>[o.id,{label:o.name,role:'Qualified role',
   equipment:'Equipment of required class',material:'Material to drawing'}])),
  quality_roles:Object.fromEntries(p.checks.map(c=>[c.id,'Qualified inspector']))};
 const decisions=Object.fromEntries(p.conditions.filter(c=>c.use==='ADAPTATION_REVIEW').map(c=>[c.key,
  c.field==='quantity'||c.value===null?{mode:'PARAMETERIZE',guidance:'Determine for the recipient order'}:{mode:'RETAIN_DECLARATION'}]));
 return prepareD05DisclosureCandidate(r,g.id,p.model_number,form,decisions);
}
export function personalBinding(){
 return {workspace_id:'recipient-personal',due_at:'2030-01-02T08:00:00Z',interval_seconds:604800,
  use_memory:false,use_knowledge:false,use_web:false,local_context:'Use my supplied local commitments.'};
}
export function d05Binding(product){
 const t=product.technology;
 const value=p=>p.field==='quantity'?'20':p.field==='overallReserve'?'0':p.field==='hoursPerDay'?'8':p.field==='workingDays'?[1,2,3,4,5]:
  p.field==='calendarMode'?'work-days':p.field==='unit'?'hours':'1';
 const params=rows=>Object.fromEntries(rows.filter(p=>p.mode==='PARAMETERIZE').map(p=>[p.field,value(p)]));
 return {order_name:'Recipient batch',start_date:'2030-01-02',due_date:'2030-01-05',route:params(t.route_parameters),
  operations:Object.fromEntries(t.operations.map(o=>[o.operation_id,{parameters:params(o.parameters),performer:'Recipient operator',
   equipment:'Recipient equipment',material:'Recipient material',material_ready:false,material_ready_date:''}])),
  quality:Object.fromEntries(t.quality_checks.map(c=>[c.check_id,{responsible_role:'Recipient inspector',related_material_id:'',comment:''}])),
  product:'Part',product_version:'B',batch:'B20',responsible:'Recipient owner',prep_date:'2030-01-02',
  requirement_basis:'Recipient drawing',source_documents:'Recipient drawing revision B'};
}
