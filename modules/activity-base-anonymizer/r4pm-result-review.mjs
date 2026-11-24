// A4.2: review original Rust4PM 0.6.2 output. Not a mining engine,
// source authority, execution proof, persistent store or export service.
import {ActivityHold} from './engine.mjs';
export const R4PM_VERSION='0.6.2';
export const R4PM_MAX_BYTES=8*1024*1024;
const LIMITS={graphs:128,activities:512,edges:4096,totalActivities:8192,totalEdges:32768};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function need(ok,code){if(!ok)throw new ActivityHold(code)}
function record(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)}
function exact(v,keys,code){need(record(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),code)}
function label(v){return typeof v==='string'&&v.trim().length>0&&v.length<=256&&!/[\x00-\x1f\x7f]/.test(v)}
function count(v){return Number.isSafeInteger(v)&&v>0&&v<=0xffffffff}
function sum(values){return values.reduce((a,b)=>a+b,0)}
function boundary(values,activity,code){
 need(Array.isArray(values)&&values.length<=LIMITS.activities,code);
 const result=new Set();
 for(const v of values){need(label(v)&&activity.has(v)&&!result.has(v),code);result.add(v)}
 return result;
}
function reviewGraph(raw,id,objectType){
 exact(raw,['activities','directly_follows_relations','start_activities','end_activities'],'R4PM_GRAPH_SHAPE_INVALID');
 need(record(raw.activities),'R4PM_ACTIVITY_MAP_INVALID');
 const entries=Object.entries(raw.activities).sort(([a],[b])=>cmp(a,b));
 need(entries.length<=LIMITS.activities,'R4PM_GRAPH_LIMIT');
 const activity=new Map(entries);
 for(const [name,n] of entries)need(label(name)&&count(n),'R4PM_ACTIVITY_INVALID');
 const starts=boundary(raw.start_activities,activity,'R4PM_START_SET_INVALID');
 const ends=boundary(raw.end_activities,activity,'R4PM_END_SET_INVALID');
 need(Array.isArray(raw.directly_follows_relations)&&raw.directly_follows_relations.length<=LIMITS.edges,'R4PM_GRAPH_LIMIT');
 const edges=[],seen=new Set(),incoming=new Map(entries.map(([name])=>[name,0])),outgoing=new Map(incoming);
 for(const item of raw.directly_follows_relations){
  need(Array.isArray(item)&&item.length===2&&Array.isArray(item[0])&&item[0].length===2,'R4PM_EDGE_SHAPE_INVALID');
  const [[from,to],n]=item,key=JSON.stringify([from,to]);
  need(label(from)&&label(to)&&activity.has(from)&&activity.has(to)&&count(n)&&!seen.has(key),'R4PM_EDGE_INVALID');
  seen.add(key);incoming.set(to,incoming.get(to)+n);outgoing.set(from,outgoing.get(from)+n);
  edges.push({from,to,occurrences:n});
 }
 // In 0.6.2 START/END are sets. For an intact DFG the residual
 // of activity occurrences minus incoming/outgoing edges gives boundary counts.
 // This cannot recover which transitions belong to a particular trace.
 const rows=entries.map(([name,n])=>{
  const start=n-incoming.get(name),end=n-outgoing.get(name);
  need(start>=0&&end>=0&&(start>0)===starts.has(name)&&(end>0)===ends.has(name),'R4PM_FLOW_BALANCE_INVALID');
  return {name,occurrences:n,start:starts.has(name),end:ends.has(name),
   derived_trace_starts:start,derived_trace_ends:end};
 });
 const traceCount=sum(rows.map(r=>r.derived_trace_starts));
 need(traceCount===sum(rows.map(r=>r.derived_trace_ends))&&(!rows.length||traceCount>0),'R4PM_FLOW_BALANCE_INVALID');
 const adjacency=new Map(entries.map(([name])=>[name,[]])),reverse=new Map(entries.map(([name])=>[name,[]]));
 for(const {from,to} of edges){adjacency.get(from).push(to);reverse.get(to).push(from)}
 const reachable=(seeds,links)=>{
  const found=new Set(seeds),pending=[...seeds];
  while(pending.length){for(const other of links.get(pending.pop()))if(!found.has(other)){found.add(other);pending.push(other)}}
  return found.size;
 };
 need(reachable(starts,adjacency)===entries.length&&reachable(ends,reverse)===entries.length,'R4PM_DISCONNECTED_FLOW');
 edges.sort((a,b)=>b.occurrences-a.occurrences||cmp(a.from,b.from)||cmp(a.to,b.to));
 return {id,object_type:objectType,activities:rows,transitions:edges,
  activity_occurrences:sum(rows.map(r=>r.occurrences)),transition_occurrences:sum(edges.map(e=>e.occurrences)),
  derived_nonempty_trace_count:traceCount,start_activity_count:starts.size,end_activity_count:ends.size,
  self_loop_count:edges.filter(e=>e.from===e.to).length};
}
export function reviewRust4pmResult(raw){
 exact(raw,['engine','version','operation','data'],'R4PM_RESULT_SHAPE_INVALID');
 need(raw.engine==='Rust4PM'&&raw.version===R4PM_VERSION,'R4PM_ENGINE_VERSION_UNSUPPORTED');
 need(['count_ocel','discover_dfg','discover_ocdfg'].includes(raw.operation),'R4PM_OPERATION_UNSUPPORTED');
 const result={engine:'Rust4PM',version:R4PM_VERSION,operation:raw.operation,
  local_only:true,source_binding:'UNVERIFIED_LOCAL_RESULT',epistemic_status:'REPORTED_ANALYSIS',
  full_trace_variants:'NOT_AVAILABLE_FROM_DFG',causal_dependencies:'NOT_ESTABLISHED',
  independent_execution:'NOT_ESTABLISHED',anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null,
  unique_event_count:null,graphs:[]};
 if(raw.operation==='count_ocel'){
  need(Number.isSafeInteger(raw.data)&&raw.data>=0,'R4PM_COUNT_INVALID');result.unique_event_count=raw.data;return result;
 }
 if(raw.operation==='discover_dfg')result.graphs=[reviewGraph(raw.data,'graph_001',null)];
 else{
  exact(raw.data,['object_type_to_dfg'],'R4PM_OCDFG_SHAPE_INVALID');
  need(record(raw.data.object_type_to_dfg),'R4PM_OCDFG_SHAPE_INVALID');
  const groups=Object.entries(raw.data.object_type_to_dfg).sort(([a],[b])=>cmp(a,b));
  need(groups.length<=LIMITS.graphs,'R4PM_GRAPH_LIMIT');
  let nodes=0,edges=0;
  for(const [i,[name,graph]] of groups.entries()){
   need(label(name),'R4PM_OBJECT_TYPE_INVALID');
   const g=reviewGraph(graph,'graph_'+String(i+1).padStart(3,'0'),name);
   nodes+=g.activities.length;edges+=g.transitions.length;
   need(nodes<=LIMITS.totalActivities&&edges<=LIMITS.totalEdges,'R4PM_GRAPH_LIMIT');
   result.graphs.push(g);
  }
 }
 return result;
}
// A built-in example only, never a claim of an actual runtime invocation.
export function buildRust4pmReviewExample(){
 return {engine:'Rust4PM',version:R4PM_VERSION,operation:'discover_ocdfg',data:{object_type_to_dfg:{
  'Заказ':{activities:{'Подготовить':3,'Проверить':4,'Завершить':3},
   directly_follows_relations:[[['Подготовить','Проверить'],3],[['Проверить','Проверить'],1],[['Проверить','Завершить'],3]],
   start_activities:['Подготовить'],end_activities:['Завершить']},
  'Изделие':{activities:{'Проверить':3,'Завершить':3},directly_follows_relations:[[['Проверить','Завершить'],3]],
   start_activities:['Проверить'],end_activities:['Завершить']}
 }}};
}
