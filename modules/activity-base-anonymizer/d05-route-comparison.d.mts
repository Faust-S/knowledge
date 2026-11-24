export type D05RouteGroup={
 id:string;basis:'AMBIGUOUS_OPERATION_OCCURRENCES'|'EXACT_NAMED_DEPENDENCY_STRUCTURE'|'SINGLE_MODEL';
 model_count:number;model_numbers:number[];source_kinds:string[];
 operations:Array<{id:string;name:string;kind:'internal'|'subcontract'|'wait'|'inspection'|'transport';
 parallel:boolean;milestone:boolean;predecessors:string[]}>;
 dependency_count:number;differing_fields:string[];incomplete_fields:string[];
};
export type D05RouteReview={
 status:'LOCAL_MODEL_COMPARISON';model_count:number;group_count:number;repeated_group_count:number;
 groups:D05RouteGroup[];epistemic_status:'CALCULATED_OR_DECLARED_NOT_OBSERVED';
 source_authority:'UNVERIFIED_LOCAL_COPY';technology_equivalence:'NOT_ESTABLISHED';
 anonymity:'NOT_ESTABLISHED';export_allowed:false;iwxa_package:null;
};
export function reviewD05RouteModels(records:unknown):D05RouteReview;
export function buildD05RouteComparisonExample():unknown[];

export type D05QualityModel={
 model_number:number;check_count:number;blocking_count:number;
 status:'NO_LINKED_PLAN'|'AMBIGUOUS_PLAN'|'INCOMPLETE_PLAN'|'DECLARED_CHECKS_READ';
 issue_codes:string[];
};
export type D05QualityReview={
 status:'LOCAL_NORMATIVE_QUALITY_REVIEW';
 groups:Array<{group_id:string;comparison:'NOT_COMPARABLE'|'DECLARED_FIELDS_DIFFER'|'NO_DIFFERENCE_IN_CHECKED_FIELDS';
 differing_fields:string[];models:D05QualityModel[]}>;
 quality_validation:'NOT_PERFORMED_BY_ACTIVITY';
 revision_alignment:'CURRENT_SNAPSHOT_NOT_APPROVED_TECHNOLOGY';
 execution_evidence:'NOT_ESTABLISHED';
};
export type D05RouteQualityReview=D05RouteReview & {quality_review:D05QualityReview};
export function reviewD05RouteModelsWithQuality(records:unknown,planDetails:unknown,templateRecords:unknown):D05RouteQualityReview;
