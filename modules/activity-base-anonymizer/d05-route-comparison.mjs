// Activity 0.4 / A4.1. Owner-local review of existing CehoVod route models.
// Not an event miner, normative author, scheduler, authority or Exchange format.
import {ActivityHold} from './engine.mjs';
import {layoutObservedGraph} from './graph-order.mjs';
import {D05_SOURCE_PIN} from './d05-t3-evidence-binding.mjs';

const DOMAIN=D05_SOURCE_PIN.domain;
const ROUTE=DOMAIN+'.operation-route';
const KINDS=new Set(['internal','subcontract','wait','inspection','transport']);
const MAX_ROUTES=24, MAX_NODES=128, MAX_EDGES=1024;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const require=(yes,code)=>{if(!yes)throw new ActivityHold(code);};
const field=(v)=>v===undefined?null:
  typeof v==='string'&&v.length<=4096?v:
  typeof v==='boolean'?v:null;
const key=(v)=>JSON.stringify(v);
function routeInput(record){
  require(obj(record),'D05_ROUTE_RECORD_REQUIRED');
  // A local copy of a Kernel Object is not a verified Kernel read.
  // Validate the known existing envelope and retain no caller authority.
  let route=record,source='CALCULATOR_MODEL';
  if(Object.hasOwn(record,'schema_id')){
    require(record.schema_id===ROUTE&&record.schema_version===D05_SOURCE_PIN.version&&
      id(record.object_id)&&Number.isSafeInteger(record.revision)&&record.revision>0&&
      obj(record.data)&&record.data.object_id===record.object_id&&
      record.data.object_type==='operation-route'&&obj(record.data.value)&&
      record.data.value.object_id===record.object_id,
      'D05_ROUTE_KERNEL_ENVELOPE_MISMATCH');
    route=record.data.value;source='LOCAL_KERNEL_RESULT_COPY';
  }
  require(id(route.object_id)&&route.object_type==='operation-route'&&obj(route.data),
    'D05_ROUTE_IDENTITY_INVALID');
  if(source==='CALCULATOR_MODEL'){
    require(route.origin_module===DOMAIN&&route.service_id===ROUTE&&
      route.provenance==='calculated'&&route.status==='active','D05_ROUTE_CALCULATOR_PROFILE_INVALID');
  }
  const direct=route.data.inputs;
  const nested=route.data.object_type==='operation-route'&&obj(route.data.data)
    ?route.data.data.inputs:undefined;
  const d=obj(direct)&&Array.isArray(direct.operations);
  const n=obj(nested)&&Array.isArray(nested.operations);
  require(d!==n,'D05_ROUTE_INPUT_MISSING_OR_AMBIGUOUS');
  return {id:route.object_id,inputs:d?direct:nested,source};
}
function operationName(v){
  require(typeof v==='string'&&v.length<=256&&!/[\u0000-\u001f\u007f]/.test(v),
    'D05_ROUTE_OPERATION_NAME_INVALID');
  const name=v.normalize('NFC').trim();
  require(name.length>0,'D05_ROUTE_OPERATION_NAME_INVALID');
  return name;
}
const CHECKS=[
  ['DURATION',['duration','unit','setup','buffer','slack']],
  ['RESOURCES',['performer','equipment']],
  ['MATERIALS',['material','materialReady','materialReadyDate']],
  ['NOTES',['comment']],
];
const ROUTE_FIELDS=['quantity','calendarMode','workingDays','hoursPerDay','overallReserve','startDate','dueDate'];
function shapeRoute(record,number){
  const {id:routeId,inputs,source}=routeInput(record);
  const raw=inputs.operations;
  require(raw.length>0&&raw.length<=MAX_NODES,'D05_ROUTE_OPERATION_LIMIT');
  const nodes=new Map(),names=new Set();
  let ambiguous=false,edgeCount=0;
  for(const op of raw){
    require(obj(op)&&id(op.id)&&!nodes.has(op.id)&&KINDS.has(op.type)&&
      typeof op.parallel==='boolean'&&typeof op.isMilestone==='boolean'&&
      Array.isArray(op.predecessors)&&op.predecessors.length<=MAX_NODES&&
      op.predecessors.every(id)&&new Set(op.predecessors).size===op.predecessors.length,
      'D05_ROUTE_OPERATION_INVALID');
    const name=operationName(op.name);
    // Do not collapse two occurrences with the same operation name/type.
    const semantic=key([name,op.type]);
    if(names.has(semantic))ambiguous=true;
    names.add(semantic);
    nodes.set(op.id,{name,kind:op.type,parallel:op.parallel,milestone:op.isMilestone,
      semantic,preds:[...op.predecessors],raw:op});
    edgeCount+=op.predecessors.length;
    require(edgeCount<=MAX_EDGES,'D05_ROUTE_EDGE_LIMIT');
  }
  const edges=[];
  for(const [to,node] of nodes){
    for(const from of node.preds){
      require(from!==to&&nodes.has(from),'D05_ROUTE_DEPENDENCY_INVALID');
      edges.push({from,to});
    }
  }
  // Reuse the original Activity presentation order only for DAG validation
  // and display. Never add inferred dependencies or compute a schedule.
  const graph=layoutObservedGraph({states:[...nodes.keys()].map(id=>({id})),observed_successions:edges});
  require(!graph.cyclic,'D05_ROUTE_DEPENDENCY_CYCLE');
  const ordered=ambiguous?graph.ordered.map(x=>x.id):
    [...nodes.keys()].sort((a,b)=>cmp(nodes.get(a).semantic,nodes.get(b).semantic));
  const aliases=new Map(ordered.map((id,i)=>[id,'op_'+String(i+1).padStart(3,'0')]));
  const operations=ordered.map(id=>{
    const n=nodes.get(id);
    return {id:aliases.get(id),name:n.name,kind:n.kind,parallel:n.parallel,milestone:n.milestone,
      predecessors:n.preds.map(p=>aliases.get(p)).sort(cmp)};
  });
  // Equality is deliberately conservative: exact names/type, explicit flags
  // and every original predecessor edge. No graph similarity or name guessing.
  const signature=ambiguous?null:key(operations.map(o=>
    [o.name,o.kind,o.parallel,o.milestone,o.predecessors]));
  const incomplete=[];
  const differences=new Map(CHECKS.map(([label,fields])=>{
    const values=ordered.map(id=>fields.map(f=>field(nodes.get(id).raw[f])));
    if(values.some(row=>row.includes(null)))incomplete.push(label);
    return [label,key(values)];
  }));
  // These comparisons flag discrepancies, not compatibility. Calendar and
  // quantity stay local and are never copied into the structural output.
  const routeValues=ROUTE_FIELDS.map(f=>f==='workingDays'
    ?(Array.isArray(inputs[f])&&inputs[f].length<=7&&inputs[f].every(x=>Number.isInteger(x)&&x>=0&&x<=6)
      &&new Set(inputs[f]).size===inputs[f].length?[...inputs[f]].sort((a,b)=>a-b):null)
    :field(inputs[f]));
  if(routeValues.includes(null))incomplete.push('ROUTE_PARAMETERS');
  differences.set('ROUTE_PARAMETERS',key(routeValues));
  return {routeId,number,source,signature,operations,edgeCount,differences,incomplete,ambiguous,aliases};
}
export function reviewD05RouteModels(records){
  require(Array.isArray(records)&&records.length>0&&records.length<=MAX_ROUTES,
    'D05_ROUTE_SELECTION_LIMIT');
  const entries=records.map((r,i)=>shapeRoute(r,i+1));
  require(new Set(entries.map(x=>x.routeId)).size===entries.length,
    'D05_ROUTE_DUPLICATE_MODEL_ID');
  const buckets=new Map();
  for(const row of entries){
    const identity=row.signature===null?'ambiguous:'+row.number:'exact:'+row.signature;
    if(!buckets.has(identity))buckets.set(identity,[]);
    buckets.get(identity).push(row);
  }
  const groups=[...buckets.values()].map((members,i)=>{
    const first=members[0];
    const flags=[...first.differences.keys()].filter(k=>
      new Set(members.map(m=>m.differences.get(k))).size>1);
    return {id:'group_'+String(i+1).padStart(2,'0'),
      basis:first.ambiguous?'AMBIGUOUS_OPERATION_OCCURRENCES':
        members.length>1?'EXACT_NAMED_DEPENDENCY_STRUCTURE':'SINGLE_MODEL',
      model_count:members.length,model_numbers:members.map(m=>m.number),
      source_kinds:[...new Set(members.map(m=>m.source))].sort(cmp),
      operations:first.operations,dependency_count:first.edgeCount,
      differing_fields:flags,incomplete_fields:[...new Set(members.flatMap(m=>m.incomplete))].sort(cmp)};
  });
  return {status:'LOCAL_MODEL_COMPARISON',model_count:entries.length,group_count:groups.length,
    repeated_group_count:groups.filter(g=>g.model_count>1).length,groups,
    epistemic_status:'CALCULATED_OR_DECLARED_NOT_OBSERVED',
    source_authority:'UNVERIFIED_LOCAL_COPY',technology_equivalence:'NOT_ESTABLISHED',
    anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}

// Reproducible example in the existing calculator shape. Not factory evidence.
export function buildD05RouteComparisonExample(){
  function model(index,names,edges,hours){
    const ids=names.map((_,i)=>'example-'+index+'-'+(i+1));
    return {object_id:'example-route-'+index,object_type:'operation-route',
      origin_module:DOMAIN,service_id:ROUTE,provenance:'calculated',status:'active',
      data:{inputs:{quantity:'120',calendarMode:'work-days',workingDays:[1,2,3,4,5],
        hoursPerDay:'8',operations:names.map((name,i)=>({id:ids[i],name,
          type:name==='Контроль размеров'?'inspection':'internal',parallel:false,isMilestone:false,
          predecessors:edges.filter(e=>e[1]===i).map(e=>ids[e[0]]),
          duration:String(hours[i]),unit:'hours',setup:'0',buffer:'0',slack:'0',
          performer:'',equipment:'',material:'',materialReady:false,materialReadyDate:'',comment:''}))}}};
  }
  return [
    model(1,['Раскрой','Гибка','Контроль размеров'],[[0,1],[1,2]],[3,2,1]),
    model(2,['Раскрой','Гибка','Контроль размеров'],[[0,1],[1,2]],[4,2,1]),
    model(3,['Раскрой','Сверление','Контроль размеров'],[[0,1],[1,2]],[3,2,1])
  ];
}


// A4.1-IV: compare normative quality plans, not inspection results. Read the
// existing Result and Kernel relationship shapes; do not author a new process
// or reimplement the domain's quality-validation/completion rules.
const QUALITY_TYPES=['incoming-material','before-op','in-op','after-op','final',
  'subcontract-acceptance','packaging','completeness','pre-shipment'];
const OPERATION_CONTROL=new Set(['before-op','in-op','after-op','subcontract-acceptance']);
const QUALITY_METHODS=['visual','measurement','count','test','document','kit-check',
  'trial-assembly','functional','subcontractor-check','custom'];
const QUALITY_RESULTS=['pass-fail','numeric','enumerated','text'];
const QUALITY_ACTIONS=['recheck','adjust','rework','sort','return-to-subcontractor',
  'scrap','concession','stop-release','custom'];
const QUALITY_FIELDS=[
  ['CRITERIA',['related_material_id','related_product_characteristic','requirement','unit',
    'lower_limit','target_value','upper_limit','allowed_values','result_type']],
  ['METHOD_AND_SAMPLING',['inspection_method','inspection_method_custom','sampling_rule']],
  ['ROLE_AND_EVIDENCE',['responsible_role','required_evidence']],
  ['FAILURE_AND_BLOCKING',['blocking','action_on_failure','action_custom']],
  ['CONTROL_NOTES',['comment']],
];
const PLAN_CONTEXT=['product','productVersion','requirementBasis','sourceDocuments'];
const qualityText=v=>typeof v==='string'&&v.length<=4096&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const filled=v=>qualityText(v)&&v.trim().length>0;
const stableSet=rows=>JSON.stringify(rows.map(key).sort(cmp));
function qualityBody(row,type,ws){
  require(obj(row)&&row.workspace_id===ws&&row.schema_id===DOMAIN+'.'+type&&
    row.schema_version===D05_SOURCE_PIN.version&&!row.deleted_at&&row.deleted!==true&&
    id(row.object_id)&&Number.isSafeInteger(row.revision)&&row.revision>0&&
    obj(row.data)&&row.data.object_id===row.object_id&&row.data.object_type===type&&
    obj(row.data.value),'D05_ROUTE_QUALITY_RESULT_INVALID');
  const value=row.data.value;
  if(obj(value.data)){
    require(value.object_id===row.object_id&&value.object_type===type,
      'D05_ROUTE_QUALITY_RESULT_INVALID');
    return value.data;
  }
  return value;
}
function planTargets(detail,ws){
  const row=detail?.object;
  const body=qualityBody(row,'quality-plan',ws);
  require(obj(detail.relations)&&Array.isArray(detail.relations.outgoing)&&
    detail.relations.outgoing.length<=512,'D05_ROUTE_QUALITY_RELATIONS_INVALID');
  const links=new Set(),relationIds=new Set();
  for(const rel of detail.relations.outgoing){
    require(obj(rel)&&rel.workspace_id===ws&&rel.from_object_id===row.object_id&&
      id(rel.to_object_id)&&id(rel.relation_id)&&!relationIds.has(rel.relation_id),
      'D05_ROUTE_QUALITY_RELATIONS_INVALID');
    relationIds.add(rel.relation_id);
    if(rel.kind==='based_on'&&!rel.deleted_at&&rel.deleted!==true)links.add(rel.to_object_id);
  }
  return {row,body,links};
}
function inspectPlan(route,plans,templates,routeIds){
  const matching=plans.filter(p=>p.body.linked_operation_route_id===route.routeId||
    p.body.common?.linkedOperationRouteId===route.routeId||p.links.has(route.routeId));
  const base={model_number:route.number,check_count:0,blocking_count:0,issue_codes:[]};
  const incomplete=(status,codes)=>({...base,status,issue_codes:[...new Set(codes)].sort(cmp),signature:null,parts:null});
  if(!matching.length)return incomplete('NO_LINKED_PLAN',['QUALITY_PLAN_MISSING']);
  if(matching.length!==1)return incomplete('AMBIGUOUS_PLAN',['QUALITY_MULTIPLE_PLANS']);
  const {body,links}=matching[0],issues=[];
  const ref=body.linked_operation_route_id,common=body.common;
  if(!obj(common)||ref!==route.routeId||common.linkedOperationRouteId!==route.routeId||
    !links.has(route.routeId)||[...links].some(target=>routeIds.has(target)&&target!==route.routeId))
    return incomplete('INCOMPLETE_PLAN',['QUALITY_ROUTE_LINK_UNCONFIRMED']);
  if(body.object_type!=='quality-plan'||!Array.isArray(body.check_template_ids)||
    body.check_template_ids.length>128||!body.check_template_ids.every(id)||
    new Set(body.check_template_ids).size!==body.check_template_ids.length)
    return incomplete('INCOMPLETE_PLAN',['QUALITY_TEMPLATE_REFERENCES_INVALID']);
  if(!body.check_template_ids.length)issues.push('QUALITY_NO_CHECKS');
  if([...links].some(target=>templates.has(target)&&!body.check_template_ids.includes(target)))
    issues.push('QUALITY_TEMPLATE_LINK_MISMATCH');
  const parts=new Map(QUALITY_FIELDS.map(([k])=>[k,[]])),checks=[];
  const context=PLAN_CONTEXT.map(f=>qualityText(common[f])?common[f]:null);
  if(context.includes(null)||!filled(common.requirementBasis))issues.push('QUALITY_CONTEXT_INCOMPLETE');
  for(const templateId of body.check_template_ids){
    const template=templates.get(templateId);
    if(!links.has(templateId)||!template){
      issues.push('QUALITY_TEMPLATE_LINK_UNCONFIRMED');continue;
    }
    if(template.check_id!==templateId||!filled(template.title)||
      !QUALITY_TYPES.includes(template.control_type)||!QUALITY_METHODS.includes(template.inspection_method)||
      !QUALITY_RESULTS.includes(template.result_type)||!QUALITY_ACTIONS.includes(template.action_on_failure)||
      typeof template.blocking!=='boolean'||!qualityText(template.related_operation_id)||
      QUALITY_FIELDS.flatMap(([,fs])=>fs).some(f=>f!=='blocking'&&!qualityText(template[f]))){
      issues.push('QUALITY_CHECK_FIELDS_INCOMPLETE');continue;
    }
    const sourceOp=template.related_operation_id;
    const opAlias=sourceOp?route.aliases.get(sourceOp):null;
    if((sourceOp&&!opAlias)||(!sourceOp&&OPERATION_CONTROL.has(template.control_type))){
      issues.push('QUALITY_OPERATION_LINK_UNCONFIRMED');continue;
    }
    // Do not bind a repeated-name occurrence to an arbitrary peer.
    if(route.ambiguous&&opAlias){issues.push('QUALITY_OPERATION_OCCURRENCE_AMBIGUOUS');continue;}
    if(!filled(template.requirement)&&!filled(template.lower_limit)&&
      !filled(template.upper_limit)&&!filled(template.allowed_values)&&!filled(template.target_value))
      issues.push('QUALITY_CRITERION_UNSPECIFIED');
    if((template.result_type==='numeric'&&!filled(template.lower_limit)&&
        !filled(template.upper_limit)&&!filled(template.target_value))||
       (template.result_type==='enumerated'&&!filled(template.allowed_values)))
      issues.push('QUALITY_CRITERION_UNSPECIFIED');
    if(!filled(template.responsible_role)||!filled(template.required_evidence))
      issues.push('QUALITY_ROLE_OR_EVIDENCE_UNSPECIFIED');
    if((template.inspection_method==='custom'&&!filled(template.inspection_method_custom))||
       (template.action_on_failure==='custom'&&!filled(template.action_custom)))
      issues.push('QUALITY_CUSTOM_RULE_UNSPECIFIED');
    // Compare exact declared fields (no numerical normalization or inferred
    // equivalence). The local operation alias only comes from the matched
    // original route's own operation IDs.
    const anchor=[opAlias,template.title,template.control_type];
    const values=QUALITY_FIELDS.map(([category,fields])=>{
      const part=fields.map(f=>template[f]);parts.get(category).push([anchor,part]);return part;
    });
    checks.push([anchor,values]);
    base.check_count++;if(template.blocking)base.blocking_count++;
  }
  if(issues.length)return incomplete('INCOMPLETE_PLAN',issues);
  const signatures=new Map([...parts].map(([k,rows])=>[k,stableSet(rows)]));
  signatures.set('PLAN_CONTEXT',key(context));
  return {...base,status:'DECLARED_CHECKS_READ',signature:key([context,stableSet(checks)]),parts:signatures};
}

/** Inputs: stored operation-route records; original getObject details of
 * quality-plan records; stored quality-check-template records. Caller must
 * provide a consistent selected Workspace snapshot. This pure function
 * neither authenticates the source nor performs a Kernel read.
 */
export function reviewD05RouteModelsWithQuality(records,planDetails,templateRecords){
  const result=reviewD05RouteModels(records);
  const ws=records[0]?.workspace_id;
  require(id(ws)&&records.every(r=>r.workspace_id===ws&&r.schema_id===ROUTE&&
    !r.deleted_at&&r.deleted!==true),'D05_ROUTE_QUALITY_SCOPE_INVALID');
  require(Array.isArray(planDetails)&&planDetails.length<=96&&
    Array.isArray(templateRecords)&&templateRecords.length<=256,'D05_ROUTE_QUALITY_LIMIT');
  const plans=planDetails.map(p=>planTargets(p,ws));
  require(new Set(plans.map(p=>p.row.object_id)).size===plans.length,'D05_ROUTE_QUALITY_DUPLICATE');
  const templates=new Map();
  for(const row of templateRecords){
    const body=qualityBody(row,'quality-check-template',ws);
    require(!templates.has(row.object_id),'D05_ROUTE_QUALITY_DUPLICATE');
    templates.set(row.object_id,body);
  }
  const entries=records.map((r,i)=>shapeRoute(r,i+1));
  const ids=new Set(entries.map(r=>r.routeId));
  const reviewed=entries.map(r=>inspectPlan(r,plans,templates,ids));
  const groups=result.groups.map(group=>{
    const members=group.model_numbers.map(n=>reviewed[n-1]);
    const comparable=members.length>1&&members.every(m=>m.status==='DECLARED_CHECKS_READ');
    let comparison='NOT_COMPARABLE',differing_fields=[];
    if(comparable){
      const different=new Set(members.map(m=>m.signature)).size>1;
      comparison=different?'DECLARED_FIELDS_DIFFER':'NO_DIFFERENCE_IN_CHECKED_FIELDS';
      differing_fields=[...members[0].parts.keys()].filter(k=>
        new Set(members.map(m=>m.parts.get(k))).size>1);
      if(different&&!differing_fields.length)differing_fields=['CHECK_COMBINATION'];
    }
    return {group_id:group.id,comparison,differing_fields,
      models:members.map(({signature,parts,...visible})=>visible)};
  });
  return {...result,quality_review:{status:'LOCAL_NORMATIVE_QUALITY_REVIEW',
    groups,quality_validation:'NOT_PERFORMED_BY_ACTIVITY',
    revision_alignment:'CURRENT_SNAPSHOT_NOT_APPROVED_TECHNOLOGY',
    execution_evidence:'NOT_ESTABLISHED'}};
}
