export const R4PM_VERSION:'0.6.2';
export const R4PM_MAX_BYTES:number;
export interface Rust4pmGraphReview {
 id:string;object_type:string|null;
 activities:{name:string;occurrences:number;start:boolean;end:boolean;derived_trace_starts:number;derived_trace_ends:number}[];
 transitions:{from:string;to:string;occurrences:number}[];
 activity_occurrences:number;transition_occurrences:number;derived_nonempty_trace_count:number;
 start_activity_count:number;end_activity_count:number;self_loop_count:number;
}
export interface Rust4pmResultReview {
 engine:'Rust4PM';version:'0.6.2';operation:'count_ocel'|'discover_dfg'|'discover_ocdfg';
 local_only:true;source_binding:'UNVERIFIED_LOCAL_RESULT';epistemic_status:'REPORTED_ANALYSIS';
 full_trace_variants:'NOT_AVAILABLE_FROM_DFG';causal_dependencies:'NOT_ESTABLISHED';
 independent_execution:'NOT_ESTABLISHED';anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
 unique_event_count:number|null;graphs:Rust4pmGraphReview[];
}
export function reviewRust4pmResult(raw:unknown):Rust4pmResultReview;
export function buildRust4pmReviewExample():unknown;
