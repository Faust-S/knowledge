// Presentation only. Accepts exactly the A2-screened structural candidate
// emitted by the ORIGINAL T3 D1/D2 trusted Activity Host.
// No Kernel, source rows, actor IDs, clock data, inference or graph writes.
import {layoutObservedGraph} from './graph-order.mjs';

const OBJECT=/^object_type_[0-9]{3,5}$/;
const EVENT=/^event_type_[0-9]{3,5}$/;
const BANDS=new Set(['3-9','10-49','50+']);
const ORDER='OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY';
const ONLY=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=ok=>{if(!ok)throw Error('T3_SCREENED_TRANSITION_MAP_REQUIRED');};

/**
 * Not an OCEL2 graph. A compact read-only adjacency view over the ORIGINAL
 * source-qualified order edges. Aliases are NOT business activity names.
 * Branching is coexistence of different observed successions, not a DMN rule.
 * A cycle is repeated order, NOT established rework.
 */
export function buildT3TransitionMap(view){
  need(ONLY(view,['object_type','cohort_band','observed_event_kinds',
    'object_local_successions'])&&OBJECT.test(view.object_type)&&
    BANDS.has(view.cohort_band)&&
    Array.isArray(view.observed_event_kinds)&&
    view.observed_event_kinds.length<=10000&&
    view.observed_event_kinds.every(x=>typeof x==='string'&&EVENT.test(x))&&
    Array.isArray(view.object_local_successions)&&
    view.object_local_successions.length<=10000);
  const ids=[...view.observed_event_kinds];
  const distinct=new Set(ids);
  need(distinct.size===ids.length);
  const edges=[],unique=new Set();
  for(const e of view.object_local_successions){
    need(ONLY(e,['from','to','cohort_band','relation'])&&
      typeof e.from==='string'&&typeof e.to==='string'&&
      EVENT.test(e.from)&&EVENT.test(e.to)&&
      distinct.has(e.from)&&distinct.has(e.to)&&
      BANDS.has(e.cohort_band)&&e.relation===ORDER);
    const key=JSON.stringify([e.from,e.to]);
    need(!unique.has(key));
    unique.add(key);
    edges.push(Object.freeze({
      from:e.from,to:e.to,cohort_band:e.cohort_band,
      relation:ORDER,
    }));
  }
  edges.sort((a,b)=>a.from.localeCompare(b.from,'en')||
    a.to.localeCompare(b.to,'en'));
  const {ordered,linear,cyclic}=layoutObservedGraph({
    states:[...distinct].sort().map(id=>({id})),
    observed_successions:edges,
  });
  const outgoing=new Map(ids.map(id=>[id,[]]));
  const incoming=new Map(ids.map(id=>[id,[]]));
  for(const edge of edges){
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  const nodes=ordered.map(row=>Object.freeze({
    id:row.id,
    label:'Событие '+row.id.slice('event_type_'.length),
    incoming:Object.freeze(incoming.get(row.id)),
    outgoing:Object.freeze(outgoing.get(row.id)),
  }));
  const branches=nodes.filter(n=>n.outgoing.length>1).length;
  const convergences=nodes.filter(n=>n.incoming.length>1).length;
  const disconnected=nodes.filter(n=>!n.incoming.length&&!n.outgoing.length).length;
  return Object.freeze({
    nodes:Object.freeze(nodes),
    transitions:Object.freeze(edges),
    cyclic,branched:branches>0||convergences>0,
    linear:!cyclic&&linear&&edges.length>0,
    branch_points:branches,convergence_points:convergences,
    isolated_event_kinds:disconnected,
    source_role:'OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY',
    inferred_edges:0,
    export_allowed:false,
  });
}
