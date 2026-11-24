import type {Rust4pmResultReview} from './r4pm-result-review.mjs';
import type {LocalOcelCountReview} from './ocel2-evidence.mjs';
export interface Rust4pmOcelSourceReview {
 source_sha256:string;status:'MISMATCH'|'AGGREGATES_MATCH';
 mismatches:{code:'EVENT_COUNT'|'OBJECT_TYPE_MISSING'|'OBJECT_TYPE_UNEXPECTED'|'OBJECT_OR_EVENT_OCCURRENCES'|'ACTIVITY_OCCURRENCES'|'VARIANT_OBJECT_COUNT';object_type:string|null}[];
 facts:LocalOcelCountReview;chronology:'AMBIGUOUS_SAME_TIME'|'NO_EQUAL_TIME_FOUND_IN_RESTRICTED_SOURCE';
 full_trace_order_verified:false;source_binding:'UNVERIFIED_LOCAL_PAIR';independent_execution:'NOT_ESTABLISHED';
 anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
}
export function compareRust4pmOcelSource(result:Rust4pmResultReview,bytes:Uint8Array):Promise<Rust4pmOcelSourceReview>;
