export declare const OCEL2_SYNTHETIC_SCHEMA: string;
export declare const OCEL2_VIEW_SCHEMA: string;
export interface Ocel2ObjectView {
  id: string;
  object_type_alias: string;
  observed_object_count: number;
  unobserved_object_count: number;
  activity_aliases: string[];
  observed_successions: Array<{
    from: string; to: string; object_trace_occurrences: number; relation: string;
  }>;
  branching: 'OBSERVED_VARIANTS_NOT_DECISION_RULES' | 'NO_BRANCH_EVIDENCE';
}
export interface Ocel2EvidenceView {
  schema: string;
  stage: 'OCEL2_JSON_SYNTHETIC_RESTRICTED_EVIDENCE_ONLY';
  standard_readiness: {
    ocel2: string; xes: string; bpmn: string; dmn: string; cmmn: string; prov: string;
  };
  object_views: Ocel2ObjectView[];
  event_type_count: number;
  object_type_count: number;
  shared_event_count: number;
  declared_object_link_count: number;
  status: 'HOLD' | 'STRUCTURE_PRESERVED_REVIEW_REQUIRED';
  reason_codes: string[];
  anonymity: 'NOT_ESTABLISHED';
  residual_risk: 'UNDETERMINED';
  export_allowed: false;
  iwxa_package: null;
  source_integrity: 'SYNTHETIC_DIGEST_MATCH_NOT_HOST_AUTHORITY';
}
export declare function inspectSyntheticOcel2(envelope: unknown): Promise<Ocel2EvidenceView>;
export declare function buildSyntheticOcel2Example(): Promise<unknown>;
export interface ExternalOcDfgReview {
  status:'HOLD_AMBIGUOUS_ORDER'|'MATCHED_LOCAL_MODEL';
  model_kind:'RUST4PM_OCDFG_NATIVE_JSON';
  source_binding:'LOCAL_CONTENT_MATCH_NOT_HOST_AUTHORITY';
  epistemic_status:'UNVERIFIED_LOCAL_EVENT_RECORDS';
  source_digest:string; model_digest:string;
  object_count:number; event_count:number; shared_event_count:number;
  object_views:Array<{
    object_type:string; object_count:number; objects_with_events:number; ambiguous_objects:number;
    comparison:'MATCHED'|'AMBIGUOUS_TIME_ORDER';
    activities:Array<{activity:string;count:number}>;
    transitions:Array<{from:string;to:string;count:number}>;
    starts:Array<{activity:string;count:number}>;
    ends:Array<{activity:string;count:number}>;
    variants:Array<{object_count:number;steps:Array<{
      activity:string;qualifiers:string[];related:Array<{object_type:string;qualifier:string}>;
    }>}>;
  }>;
  risk_reasons:string[];
  technology_equivalence:'NOT_ESTABLISHED';anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
}
export declare function reviewExternalOcDfg(ocel:unknown,model:unknown):Promise<ExternalOcDfgReview>;
