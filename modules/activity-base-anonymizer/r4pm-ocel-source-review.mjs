// A4.2-III: local independent aggregate check against exact selected bytes.
// This does not attest that the mining result was calculated from this file.
import {ActivityHold} from './engine.mjs';
import {inspectLocalOcelCounts} from './ocel2-evidence.mjs';
import {R4PM_MAX_BYTES,R4PM_VERSION} from './r4pm-result-review.mjs';
function need(ok,code){if(!ok)throw new ActivityHold(code)}
export async function compareRust4pmOcelSource(result,bytes){
 need(result?.engine==='Rust4PM'&&result.version===R4PM_VERSION&&
  ['count_ocel','discover_ocdfg','discover_ocel_variants'].includes(result.operation)&&
  result.source_binding==='UNVERIFIED_LOCAL_RESULT'&&result.export_allowed===false,'R4PM_OCEL_COMPARISON_UNSUPPORTED');
 need(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=R4PM_MAX_BYTES,'R4PM_OCEL_SOURCE_LIMIT');
 let raw;
 try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}
 catch{throw new ActivityHold('R4PM_OCEL_SOURCE_JSON_INVALID')}
 const facts=inspectLocalOcelCounts(raw);
 const mismatches=[];
 if(result.operation==='count_ocel'){
  if(result.unique_event_count!==facts.event_count)mismatches.push({code:'EVENT_COUNT',object_type:null});
 }else{
  const actual=new Map(facts.object_types.map(r=>[r.object_type,r]));
  const graphs=new Map(result.graphs.map(g=>[g.object_type,g]));
  for(const [type,row] of actual){
   const g=graphs.get(type);
   if(!g){mismatches.push({code:'OBJECT_TYPE_MISSING',object_type:type});continue}
   if(g.derived_nonempty_trace_count!==row.nonempty_object_count||g.activity_occurrences!==row.event_occurrences)
    mismatches.push({code:'OBJECT_OR_EVENT_OCCURRENCES',object_type:type});
   if(g.activities.length!==row.activities.length||
     row.activities.some(a=>!g.activities.some(b=>b.name===a.name&&b.occurrences===a.count)))
    mismatches.push({code:'ACTIVITY_OCCURRENCES',object_type:type});
   if(g.variant_summary&&(g.variant_summary.reported_object_count!==row.object_count||
     g.variant_summary.empty_trace_count!==row.object_count-row.nonempty_object_count))
    mismatches.push({code:'VARIANT_OBJECT_COUNT',object_type:type});
  }
  for(const type of graphs.keys())if(!actual.has(type))mismatches.push({code:'OBJECT_TYPE_UNEXPECTED',object_type:type});
 }
 need(globalThis.crypto?.subtle,'LOCAL_DIGEST_UNAVAILABLE');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 const sha256=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
 return {source_sha256:sha256,status:mismatches.length?'MISMATCH':'AGGREGATES_MATCH',
  mismatches,facts,chronology:facts.tied_object_count?'AMBIGUOUS_SAME_TIME':'NO_EQUAL_TIME_FOUND_IN_RESTRICTED_SOURCE',
  full_trace_order_verified:false,source_binding:'UNVERIFIED_LOCAL_PAIR',
  independent_execution:'NOT_ESTABLISHED',anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}
