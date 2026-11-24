export type D05RouteGroup={
 id:string;basis:'AMBIGUOUS_OPERATION_OCCURRENCES'|'EXACT_NAMED_DEPENDENCY_STRUCTURE'|'SINGLE_MODEL';
 model_count:number;model_numbers:number[];source_kinds:string[];
 operations:Array<{id:string;name:string;kind:'internal'|'subcontract'|'wait'|'inspection'|'transport';
 parallel:boolean;milestone:boolean;predecessors:string[]}>;
 dependency_count:number;differing_fields:string[];
};
export type D05RouteReview={
 status:'LOCAL_MODEL_COMPARISON';model_count:number;group_count:number;repeated_group_count:number;
 groups:D05RouteGroup[];epistemic_status:'CALCULATED_OR_DECLARED_NOT_OBSERVED';
 source_authority:'UNVERIFIED_LOCAL_COPY';technology_equivalence:'NOT_ESTABLISHED';
 anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
};
export function reviewD05RouteModels(records:unknown):D05RouteReview;
export function buildD05RouteComparisonExample():unknown[];
