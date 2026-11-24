export const R4PM_VERSION:'0.6.2';
export const R4PM_RESULT_MAX_BYTES:number;
export type R4pmGraph={
 id:string;object_type:string|null;
 activities:{id:string;label:string;occurrences:number;start:boolean;end:boolean}[];
 transitions:{from:string;to:string;occurrences:number}[];
 activity_occurrences:number;transition_occurrences:number;
 topology:'NO_RECORDED_ACTIVITY'|'CYCLE_IN_TOOL_GRAPH'|'LINEAR_TOOL_GRAPH'|'NONLINEAR_TOOL_GRAPH';
};
export type R4pmReview={
 status:'LOCAL_TOOL_RESULT_REVIEW';engine:'Rust4PM';version:'0.6.2';
 operation:'count_ocel'|'discover_dfg'|'discover_ocdfg';
 scope:'OCEL_EVENT_COUNT'|'CASE_CENTRIC_DFG'|'OBJECT_CENTRIC_DFG';
 event_count:number|null;graphs:R4pmGraph[];
 source_authority:'UNVERIFIED_LOCAL_TOOL_OUTPUT';
 epistemic_status:'TOOL_REPORTED_ANALYSIS_NOT_EXECUTION_EVIDENCE';
 count_semantics:'OCCURRENCES_NOT_DISTINCT_CASES';complete_traces:'NOT_PROVIDED';
 causality:'NOT_ESTABLISHED';technology_equivalence:'NOT_ESTABLISHED';
 anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
};
export function reviewR4pmResult(raw:unknown):R4pmReview;
export function readR4pmResultBytes(bytes:Uint8Array):R4pmReview;
