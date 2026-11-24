// Activity A4.2: review the exact Rust4PM 0.6.2 JSON produced by Agent's
// existing R4PM_PYTHON_V1 worker. No process-discovery algorithm, new Task,
// artifact store or Exchange. A local copy is NOT an authorized source.
import {ActivityHold} from './engine.mjs';
import {layoutObservedGraph} from './graph-order.mjs';
export const R4PM_VERSION='0.6.2';
export const R4PM_RESULT_MAX_BYTES=8*1024*1024;
const MAX_GRAPHS=32,MAX_ACTIVITIES=256,MAX_EDGES=2048;
const MAX_TOTAL_NODES=4096,MAX_TOTAL_EDGES=16384;
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>record(v)&&Object.keys(v).length===keys.length&&
  keys.every(k=>Object.hasOwn(v,k));
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const label=v=>typeof v==='string'&&v.trim().length>0&&v.length<=256&&
  !/[\u0000-\u001f\u007f-\u009f]/.test(v);
const count=v=>Number.isSafeInteger(v)&&v>=0;
const positive=v=>count(v)&&v>0;
function total(values){
  let n=0;for(const value of values){n+=value;need(count(n),'R4PM_RESULT_COUNT_OVERFLOW');}
  return n;
}
function graph(raw,objectType,index){
  need(exact(raw,['activities','directly_follows_relations','start_activities','end_activities'])&&
    record(raw.activities)&&Array.isArray(raw.directly_follows_relations)&&
    Array.isArray(raw.start_activities)&&Array.isArray(raw.end_activities),
    'R4PM_RESULT_GRAPH_INVALID');
  const activities=Object.entries(raw.activities).sort(([a],[b])=>cmp(a,b));
  need(activities.length<=MAX_ACTIVITIES&&raw.directly_follows_relations.length<=MAX_EDGES,
    'R4PM_RESULT_GRAPH_LIMIT');
  need(activities.every(([name,n])=>label(name)&&count(n)),'R4PM_RESULT_ACTIVITY_INVALID');
  const byName=new Map(activities);
  const boundaries=names=>{
    need(names.length<=activities.length&&names.every(x=>byName.has(x)&&positive(byName.get(x)))&&
      new Set(names).size===names.length,'R4PM_RESULT_BOUNDARY_INVALID');
    return new Set(names);
  };
  const starts=boundaries(raw.start_activities),ends=boundaries(raw.end_activities);
  const aliases=new Map(activities.map(([name],i)=>[name,'activity_'+String(i+1).padStart(3,'0')]));
  const nodes=activities.map(([name,occurrences])=>({
    id:aliases.get(name),label:name,occurrences,start:starts.has(name),end:ends.has(name)}));
  const seen=new Set(),incoming=new Map(),outgoing=new Map(),edges=[];
  for(const e of raw.directly_follows_relations){
    need(Array.isArray(e)&&e.length===2&&Array.isArray(e[0])&&e[0].length===2&&
      positive(e[1])&&e[0].every(name=>byName.has(name)&&positive(byName.get(name))),
      'R4PM_RESULT_EDGE_INVALID');
    const [from,to]=e[0],n=e[1],key=JSON.stringify([from,to]);
    need(!seen.has(key),'R4PM_RESULT_DUPLICATE_EDGE');seen.add(key);
    incoming.set(to,total([incoming.get(to)??0,n]));
    outgoing.set(from,total([outgoing.get(from)??0,n]));
    edges.push({from:aliases.get(from),to:aliases.get(to),occurrences:n});
  }
  // A directly-follows count is an occurrence count, not number of distinct
  // cases or a transition probability. Each occurrence can have at most one
  // predecessor and successor within the particular flattened trace.
  for(const [name,n] of activities){
    need((incoming.get(name)??0)<=n&&(outgoing.get(name)??0)<=n,
      'R4PM_RESULT_COUNT_INCONSISTENT');
  }
  edges.sort((a,b)=>cmp(a.from,b.from)||cmp(a.to,b.to));
  const layout=layoutObservedGraph({states:nodes,observed_successions:edges});
  const occurrences=total(nodes.map(n=>n.occurrences));
  const transitionOccurrences=total(edges.map(e=>e.occurrences));
  return {id:'graph_'+String(index+1).padStart(2,'0'),object_type:objectType,
    activities:nodes,transitions:edges,activity_occurrences:occurrences,
    transition_occurrences:transitionOccurrences,
    topology:nodes.length===0||occurrences===0?'NO_RECORDED_ACTIVITY':
      layout.cyclic?'CYCLE_IN_TOOL_GRAPH':layout.linear?'LINEAR_TOOL_GRAPH':'NONLINEAR_TOOL_GRAPH'};
}
/** Exact result payload from the pinned worker stdout (not an Agent grant).
 * Object-centric graphs remain separate: shared events can be counted in
 * several object-local traces. Never sum graph counts into unique events.
 */
export function reviewR4pmResult(raw){
  need(exact(raw,['engine','version','operation','data'])&&raw.engine==='Rust4PM'&&
    raw.version===R4PM_VERSION,'R4PM_RESULT_PROFILE_INVALID');
  let graphs=[],eventCount=null,scope;
  if(raw.operation==='count_ocel'){
    need(count(raw.data),'R4PM_RESULT_EVENT_COUNT_INVALID');
    eventCount=raw.data;scope='OCEL_EVENT_COUNT';
  }else if(raw.operation==='discover_dfg'){
    graphs=[graph(raw.data,null,0)];scope='CASE_CENTRIC_DFG';
  }else if(raw.operation==='discover_ocdfg'){
    need(exact(raw.data,['object_type_to_dfg'])&&record(raw.data.object_type_to_dfg),
      'R4PM_RESULT_OCDFG_INVALID');
    const entries=Object.entries(raw.data.object_type_to_dfg).sort(([a],[b])=>cmp(a,b));
    need(entries.length<=MAX_GRAPHS&&entries.every(([name])=>label(name)),
      'R4PM_RESULT_OBJECT_TYPE_INVALID');
    let nodes=0,edges=0;
    for(const [i,[name,value]] of entries.entries()){
      const view=graph(value,name,i);
      nodes+=view.activities.length;edges+=view.transitions.length;
      need(nodes<=MAX_TOTAL_NODES&&edges<=MAX_TOTAL_EDGES,'R4PM_RESULT_GRAPH_LIMIT');
      graphs.push(view);
    }
    scope='OBJECT_CENTRIC_DFG';
  }else need(false,'R4PM_RESULT_OPERATION_UNSUPPORTED');
  return {status:'LOCAL_TOOL_RESULT_REVIEW',engine:'Rust4PM',version:R4PM_VERSION,
    operation:raw.operation,scope,event_count:eventCount,graphs,
    source_authority:'UNVERIFIED_LOCAL_TOOL_OUTPUT',
    epistemic_status:'TOOL_REPORTED_ANALYSIS_NOT_EXECUTION_EVIDENCE',
    count_semantics:'OCCURRENCES_NOT_DISTINCT_CASES',
    complete_traces:'NOT_PROVIDED',causality:'NOT_ESTABLISHED',
    technology_equivalence:'NOT_ESTABLISHED',anonymity:'NOT_ESTABLISHED',
    export_allowed:false,iwxa_package:null};
}
export function readR4pmResultBytes(bytes){
  need(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=R4PM_RESULT_MAX_BYTES,
    'R4PM_RESULT_FILE_LIMIT');
  let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new ActivityHold('R4PM_RESULT_JSON_INVALID');}
  return reviewR4pmResult(value);
}
