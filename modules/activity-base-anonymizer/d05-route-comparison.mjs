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
  return {routeId,number,source,signature,operations,edgeCount,differences,incomplete,ambiguous,aliases,inputs,nodes,ordered};
}
export function reviewD05RouteModels(records,{includeTechnologyDraft=false}={}){
  require(typeof includeTechnologyDraft==='boolean','D05_ROUTE_DRAFT_OPTION_INVALID');
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
  const result={status:'LOCAL_MODEL_COMPARISON',model_count:entries.length,group_count:groups.length,
    repeated_group_count:groups.filter(g=>g.model_count>1).length,groups,
    epistemic_status:'CALCULATED_OR_DECLARED_NOT_OBSERVED',
    source_authority:'UNVERIFIED_LOCAL_COPY',technology_equivalence:'NOT_ESTABLISHED',
    anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
  return includeTechnologyDraft?attachTechnologyDraft(result,records,entries,[]):result;
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
  const incomplete=(status,codes)=>({...base,status,issue_codes:[...new Set(codes)].sort(cmp),signature:null,parts:null,draftChecks:null,draftContext:null});
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
  return {...base,status:'DECLARED_CHECKS_READ',signature:key([context,stableSet(checks)]),parts:signatures,
    draftChecks:checks,draftContext:context};
}

/** Inputs: stored operation-route records; original getObject details of
 * quality-plan records; stored quality-check-template records. Caller must
 * provide a consistent selected Workspace snapshot. This pure function
 * neither authenticates the source nor performs a Kernel read.
 */
export function reviewD05RouteModelsWithQuality(records,planDetails,templateRecords,{includeTechnologyDraft=false}={}){
  require(typeof includeTechnologyDraft==='boolean','D05_ROUTE_DRAFT_OPTION_INVALID');
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
      models:members.map(({signature,parts,draftChecks,draftContext,...visible})=>visible)};
  });
  const output={...result,quality_review:{status:'LOCAL_NORMATIVE_QUALITY_REVIEW',
    groups,quality_validation:'NOT_PERFORMED_BY_ACTIVITY',
    revision_alignment:'CURRENT_SNAPSHOT_NOT_APPROVED_TECHNOLOGY',
    execution_evidence:'NOT_ESTABLISHED'}};
  return includeTechnologyDraft?attachTechnologyDraft(output,records,entries,reviewed):output;
}


/** Existing local ObjectWithRelations representation. No new exchange
 * carrier or trusted assertion. Ordinary route models remain compatible.
 */
export function reviewD05ResultSelection(records,options={}){
  if(!Array.isArray(records)||!records.some(r=>obj(r)&&Object.hasOwn(r,'object')))
    return reviewD05RouteModels(records,options);
  require(records.length>0&&records.length<=24,'D05_ROUTE_SELECTION_LIMIT');
  const routes=[],plans=[],templates=[];
  for(const item of records){
    require(obj(item)&&obj(item.object)&&obj(item.relations)&&
      Array.isArray(item.relations.outgoing)&&Array.isArray(item.relations.incoming),
      'D05_ROUTE_QUALITY_LOCAL_DETAIL_REQUIRED');
    switch(item.object.schema_id){
      case ROUTE:routes.push(item.object);break;
      case DOMAIN+'.quality-plan':plans.push(item);break;
      case DOMAIN+'.quality-check-template':templates.push(item.object);break;
      default:throw new ActivityHold('D05_ROUTE_QUALITY_RESULT_INVALID');
    }
  }
  return reviewD05RouteModelsWithQuality(routes,plans,templates,options);
}

// Modelled example of existing Result shapes, not production evidence.
export function buildD05RouteQualityComparisonExample(workspaceId='example-quality-workspace'){
  const examples=buildD05RouteComparisonExample(),out=[];
  const detail=(object_id,type,value,outgoing=[])=>({
    object:{workspace_id:workspaceId,object_id,revision:1,schema_id:DOMAIN+'.'+type,
      schema_version:D05_SOURCE_PIN.version,data:{object_id,object_type:type,
        source_schema_version:D05_SOURCE_PIN.version,display_label:'Учебная модель',
        source_service_id:DOMAIN+'.quality-plan',algorithm_version:null,
        status:'ready_for_review',summary_markdown:'',value}},
    relations:{incoming:[],outgoing:outgoing.map((to_object_id,i)=>({
      workspace_id:workspaceId,relation_id:'example-link-'+object_id+'-'+i,
      from_object_id:object_id,to_object_id,kind:'based_on',
    }))},
  });
  examples.forEach((route,i)=>{
    const n=i+1,routeId=route.object_id,checkId='example-check-'+n,planId='example-plan-'+n;
    const check={check_id:checkId,title:'Контроль ширины детали',control_type:'final',
      related_material_id:'',related_operation_id:route.data.inputs.operations.at(-1).id,
      related_product_characteristic:'Ширина',requirement:'Размер по технологическому чертежу',
      unit:'мм',lower_limit:i===1?'99.5':'99.8',target_value:'100',
      upper_limit:i===1?'100.5':'100.2',allowed_values:'',result_type:'numeric',
      inspection_method:'measurement',inspection_method_custom:'',sampling_rule:'Каждая деталь',
      responsible_role:'Контролёр',required_evidence:'Протокол измерений',blocking:true,
      action_on_failure:'stop-release',action_custom:'',comment:''};
    out.push(detail(routeId,'operation-route',route),
      detail(planId,'quality-plan',{object_type:'quality-plan',
        common:{linkedOperationRouteId:routeId,product:'Деталь',productVersion:'1',
          requirementBasis:'Технологический чертёж',sourceDocuments:'Чертёж 1'},
        linked_operation_route_id:routeId,check_template_ids:[checkId],defect_ids:[]},
        [routeId,checkId]),
      detail(checkId,'quality-check-template',check));
  });
  return out;
}


// A4.3-I. Owner-local preparation of a technology candidate. Explicitly
// opt-in because declared requirements can contain identifying information.
// The ordinary review and generic D2 still return no raw parameter values.
// No new exchange format, authoring engine, approval or persistent store.
const DRAFT_LIMIT=8*1024*1024;
const DECLARED='DECLARED_SOURCE_CONDITION';
const ADAPT='ADAPTATION_REVIEW';
const MAPPING='FUNCTIONAL_MAPPING_REQUIRED';
const DRAFT_ROUTE_FIELDS=[
  ['quantity',ADAPT],['calendarMode',ADAPT],['workingDays',ADAPT],
  ['hoursPerDay',ADAPT],['overallReserve',ADAPT],
];
const DRAFT_OPERATION_FIELDS=[
  ['duration',ADAPT],['unit',ADAPT],['setup',ADAPT],['buffer',ADAPT],['slack',ADAPT],
  ['performer',MAPPING],['equipment',MAPPING],['material',MAPPING],
];
const DRAFT_REQUIRED_FIELDS=[
  'PURPOSE','INPUTS','OUTPUTS','APPLICABILITY','RESOURCE_CAPABILITIES',
  'DOMAIN_VALIDATION','DISCLOSURE_REVIEW',
];
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
function draftValue(value,fieldName){
  if(fieldName==='workingDays')
    return Array.isArray(value)&&value.length>0&&value.length<=7&&
      value.every(v=>Number.isInteger(v)&&v>=0&&v<=6)&&
      new Set(value).size===value.length?[...value].sort((a,b)=>a-b):null;
  if(fieldName==='blocking')return typeof value==='boolean'?value:null;
  return qualityText(value)&&nonempty(value)?value:null;
}
function condition(scope,field,value,use){
  return {key:scope+'.'+field,scope,field,use,value:draftValue(value,field)};
}
function draftProfile(record,entry,quality){
  const conditions=DRAFT_ROUTE_FIELDS.map(([f,use])=>condition('route',f,entry.inputs[f],use));
  for(const opId of entry.ordered){
    const scope=entry.aliases.get(opId),raw=entry.nodes.get(opId).raw;
    for(const [f,use] of DRAFT_OPERATION_FIELDS)conditions.push(condition(scope,f,raw[f],use));
  }
  // A linked plan is still a current declared plan, not an approved revision
  // bundle. Keep entire check lists in their source variant. Do not synthesize
  // ranges, mix tolerances, union methods or assign a free-text material ID.
  let checks=[];
  if(quality?.status==='DECLARED_CHECKS_READ'){
    const ordered=[...quality.draftChecks].sort((a,b)=>cmp(key(a),key(b)));
    checks=ordered.map(([anchor,parts],i)=>{
      const [operation_id,title,control_type]=anchor;
      const fields=[];
      QUALITY_FIELDS.forEach(([category,names],j)=>names.forEach((f,k)=>{
        // related_material_id is a source-local reference; comment is not a
        // transferable requirement. Keep their presence as an explicit gap.
        if(f==='related_material_id'||f==='comment'){
          if(nonempty(parts[j][k]))fields.push({field:f,use:MAPPING,value:null,
            status:'LOCAL_REFERENCE_REVIEW_REQUIRED'});
          return;
        }
        const value=draftValue(parts[j][k],f);
        fields.push({field:f,use:f==='responsible_role'?MAPPING:DECLARED,value,
          status:value===null?'NOT_SPECIFIED_OR_NOT_APPLICABLE':'DECLARED'});
      }));
      return {id:'check_'+String(i+1).padStart(3,'0'),operation_id,title,control_type,fields,
        comparison:'NOT_COMPARABLE'};
    });
  }
  // Never copy individual order names, product IDs, exact calendar dates,
  // material-ready flags, free notes or source document names into the draft.
  // Their possible meaning must be resolved by the subject specialist.
  const localContext=[];
  if(nonempty(entry.inputs.orderName))localContext.push('ORDER_CONTEXT');
  if(nonempty(entry.inputs.startDate)||nonempty(entry.inputs.dueDate)||
     [...entry.nodes.values()].some(n=>nonempty(n.raw.materialReadyDate)))
    localContext.push('LOCAL_DATES');
  if([...entry.nodes.values()].some(n=>typeof n.raw.materialReady==='boolean'))
    localContext.push('MATERIAL_AVAILABILITY');
  if([...entry.nodes.values()].some(n=>nonempty(n.raw.comment)))
    localContext.push('OPERATION_NOTES');
  if(quality?.draftContext?.some(nonempty))localContext.push('QUALITY_SOURCE_CONTEXT');
  const gaps=[...DRAFT_REQUIRED_FIELDS];
  if(entry.ambiguous)gaps.push('OPERATION_OCCURRENCE_MAPPING');
  if(!quality||quality.status!=='DECLARED_CHECKS_READ')gaps.push('QUALITY_PLAN_REVIEW');
  if(conditions.some(c=>c.value===null))gaps.push('UNSPECIFIED_EXECUTION_CONDITIONS');
  if(localContext.length||checks.some(c=>c.fields.some(f=>f.status==='LOCAL_REFERENCE_REVIEW_REQUIRED')))
    gaps.push('LOCAL_CONTEXT_REVIEW');
  return {model_number:entry.number,source_kind:entry.source,
    source_revision:Number.isSafeInteger(record?.revision)&&record.revision>0?record.revision:null,
    conditions,quality_status:quality?.status??'NOT_READ',quality_issues:quality?.issue_codes??[],
    checks,local_context_review:localContext,unresolved:gaps};
}
function attachTechnologyDraft(review,records,entries,quality){
  const profiles=entries.map((entry,i)=>draftProfile(records[i],entry,quality[i]));
  const groups=review.groups.map(group=>{
    const members=group.model_numbers.map(n=>profiles[n-1]);
    const maps=members.map(m=>new Map(m.conditions.map(c=>[c.key,c])));
    const shared=[],different=[],unknown=[];
    // A value is shared only if all members contain an identical nonempty
    // declaration. Missing/invalid values NEVER become a common zero.
    for(const c of members[0].conditions){
      const cells=maps.map(m=>m.get(c.key));
      if(cells.some(v=>!v||v.value===null))unknown.push(c.key);
      else if(members.length>1&&cells.every(v=>key(v.value)===key(c.value)))shared.push(c.key);
      else if(members.length>1)different.push(c.key);
    }
    // Match entire check declarations, including all original fields that
    // were intentionally omitted from the presentation. Use multiset counts
    // so repeated occurrences cannot inflate shared requirements.
    if(members.length>1&&members.every(m=>m.quality_status==='DECLARED_CHECKS_READ')){
      const signatures=group.model_numbers.map(n=>quality[n-1].draftChecks.map(key).sort(cmp));
      const counts=signatures.map(list=>{
        const map=new Map();for(const s of list)map.set(s,(map.get(s)??0)+1);return map;
      });
      const common=new Map([...counts[0]].map(([s,n])=>[s,Math.min(n,...counts.slice(1).map(m=>m.get(s)??0))]));
      for(let i=0;i<members.length;i++){
        const seen=new Map();
        members[i].checks.forEach((check,j)=>{
          const s=signatures[i][j],n=(seen.get(s)??0)+1;seen.set(s,n);
          check.comparison=n<=(common.get(s)??0)?'COMMON_DECLARATION':'SOURCE_SPECIFIC';
        });
      }
    }
    // Keep every coherent source profile, including identical ones: repeated
    // records are not independent execution samples. No cross-product of
    // parameters and no inferred permission to substitute a profile.
    return {group_id:group.id,
      shared_check_count:members[0].checks.filter(c=>c.comparison==='COMMON_DECLARATION').length,
      shared_condition_keys:shared,
      differing_condition_keys:different,unresolved_condition_keys:unknown,
      profiles:members,variant_policy:'KEEP_ORIGINAL_CONDITION_BUNDLES'};
  });
  const draft={status:'LOCAL_TECHNOLOGY_DRAFT',groups,
    purpose:'PREPARE_FOR_DOMAIN_AND_DISCLOSURE_REVIEW',
    model_semantics:'DECLARED_CONDITIONS_NOT_EXECUTION',
    applicability:'NOT_ESTABLISHED',external_transfer:false};
  require(new TextEncoder().encode(key(draft)).byteLength<=DRAFT_LIMIT,'D05_ROUTE_DRAFT_OUTPUT_LIMIT');
  return {...review,technology_draft:draft};
}


// A4.3-II/III: a user's local proposal to generalize ONE complete source
// profile. This is not an IWXA Standard object or an authorization decision.
// The UI keeps the source review immutable and uses this function only to
// assemble a readable local draft. No inferred capability, no auto approval.
const PROPOSAL_TEXT_FIELDS=['purpose','inputs','outputs','applicability','adaptation_guidance','local_context_guidance'];
const PROPOSAL_OP_FIELDS=['label','role','equipment','material'];
function proposalText(value){
  return qualityText(value)&&nonempty(value)?value.trim():null;
}
function exactKeys(value,allowed){
  return obj(value)&&Object.keys(value).every(k=>allowed.includes(k));
}
export function prepareD05TechnologyProposal(review,groupId,modelNumber,form){
  require(review?.technology_draft?.status==='LOCAL_TECHNOLOGY_DRAFT'&&
    review.export_allowed===false&&review.anonymity==='NOT_ESTABLISHED'&&
    Array.isArray(review.groups)&&exactKeys(form,[...PROPOSAL_TEXT_FIELDS,'operations','quality_roles']),
    'D05_ROUTE_PROPOSAL_INPUT_INVALID');
  const group=review.groups.find(g=>g.id===groupId);
  const draft=review.technology_draft.groups.find(g=>g.group_id===groupId);
  const profile=draft?.profiles.find(p=>p.model_number===modelNumber);
  require(group&&profile&&group.model_numbers.includes(modelNumber),'D05_ROUTE_PROPOSAL_PROFILE_INVALID');
  const opForms=form.operations??{},roleForms=form.quality_roles??{};
  require(exactKeys(opForms,group.operations.map(o=>o.id))&&
    Object.values(opForms).every(v=>exactKeys(v,PROPOSAL_OP_FIELDS))&&
    exactKeys(roleForms,profile.checks.map(c=>c.id)),
    'D05_ROUTE_PROPOSAL_MAPPING_INVALID');
  const missing=[];
  const terms=Object.fromEntries(PROPOSAL_TEXT_FIELDS.map(f=>{
    const value=proposalText(form[f]);
    if(value===null&&(f!=='local_context_guidance'||profile.local_context_review.length||
      profile.checks.some(c=>c.fields.some(x=>x.status==='LOCAL_REFERENCE_REVIEW_REQUIRED'))))
      missing.push({scope:'technology',field:f});
    return [f,value];
  }));
  const operations=group.operations.map(op=>{
    const mapping=Object.fromEntries(PROPOSAL_OP_FIELDS.map(f=>{
      const value=proposalText(opForms[op.id]?.[f]);
      if(value===null)missing.push({scope:op.id,field:f});
      return [f,value];
    }));
    return {operation_id:op.id,source_name:op.name,kind:op.kind,parallel:op.parallel,
      milestone:op.milestone,predecessors:[...op.predecessors],proposed:mapping,
      source_parameter_conditions:profile.conditions.filter(c=>c.scope===op.id&&c.use==='ADAPTATION_REVIEW')
        .map(c=>({...c,value:Array.isArray(c.value)?[...c.value]:c.value}))};
  });
  const checks=profile.checks.map(c=>{
    const role=proposalText(roleForms[c.id]);
    if(role===null)missing.push({scope:c.id,field:'responsible_role'});
    // Never relax the original controls or their blocking behavior. User
    // role suggestions are separate; material references require review.
    return {check_id:c.id,title:c.title,operation_id:c.operation_id,control_type:c.control_type,
      declared_fields:c.fields.filter(f=>f.field!=='responsible_role').map(f=>({...f})),
      proposed_responsible_role:role};
  });
  const sourceGaps=profile.unresolved.filter(x=>
    ['OPERATION_OCCURRENCE_MAPPING','QUALITY_PLAN_REVIEW','UNSPECIFIED_EXECUTION_CONDITIONS'].includes(x));
  const result={
    status:missing.length?'PROPOSAL_NEEDS_INPUT':sourceGaps.length?'PROPOSAL_WITH_SOURCE_GAPS':'PROPOSAL_FOR_DOMAIN_REVIEW',
    source_model_number:modelNumber,source_revision:profile.source_revision,
    declared_by:'LOCAL_USER_PROPOSAL',terms,operations,quality_checks:checks,
    source_route_parameters:profile.conditions.filter(c=>c.scope==='route')
      .map(c=>({...c,value:Array.isArray(c.value)?[...c.value]:c.value})),
    missing_fields:missing,unresolved_source_requirements:sourceGaps,
    local_context_review:[...profile.local_context_review],
    source_quality_status:profile.quality_status,
    domain_validation:'NOT_PERFORMED',applicability:'NOT_ESTABLISHED',
    anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null,
  };
  require(new TextEncoder().encode(key(result)).byteLength<=DRAFT_LIMIT,'D05_ROUTE_DRAFT_OUTPUT_LIMIT');
  return result;
}
