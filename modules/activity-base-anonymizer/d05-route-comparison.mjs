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
  return {routeId,number,source,signature,operations,edgeCount,differences,incomplete,ambiguous};
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
